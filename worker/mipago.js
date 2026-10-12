// mipago.online hub client + callback signature verifier.
// Ported from the mipago skill's assets/verifier.ts (live-verified 2026-10-12).
// WebCrypto only: runs in Cloudflare Workers and Node >= 18.

export const CALLBACK_MAX_SKEW_SECONDS = 300;

const PAYMENT_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

/* ---------------- Callback verification ---------------- */

export function readCallbackHeaders(request) {
  return {
    signature: request.headers.get('X-Mipago-Signature'),
    timestamp: request.headers.get('X-Mipago-Timestamp'),
  };
}

/** Constant-time hex compare. Early length return only leaks length —
 *  irrelevant because hex HMAC digests are always 64 chars. */
export function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Also used for the plain API keys (X-Reconcile-Key). */
export function timingSafeEqual(a, b) {
  const ea = encodeURIComponent(String(a));
  const eb = encodeURIComponent(String(b));
  const max = Math.max(ea.length, eb.length);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < max; i++) {
    diff |= (ea.charCodeAt(i) || 0) ^ (eb.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function hmacSha256Hex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyCallbackSignature(secret, rawBody, headers) {
  if (!secret) return { ok: false, reason: 'missing_secret' };
  if (!headers.signature || !headers.timestamp) {
    return { ok: false, reason: 'missing_headers' };
  }
  if (!/^\d+$/.test(headers.timestamp)) {
    return { ok: false, reason: 'bad_timestamp' };
  }
  // The hub sends Date.now() MILLISECONDS while the docs say unix seconds.
  // Values above 1e12 can only be ms (seconds that large = year 33,658).
  // The HMAC always uses the raw header string, so it is unit-agnostic.
  const raw = parseInt(headers.timestamp, 10);
  const ts = raw > 1e12 ? Math.floor(raw / 1000) : raw;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > CALLBACK_MAX_SKEW_SECONDS) {
    return { ok: false, reason: 'bad_timestamp' };
  }
  const expected = await hmacSha256Hex(secret, `${headers.timestamp}.${rawBody}`);
  if (!timingSafeEqualHex(expected, headers.signature)) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  return { ok: true };
}

/* ---------------- Hub API client ---------------- */

function hubBase(env) {
  const base = String(env.MIPAGO_API_URL || 'https://staging.mipago.online').replace(/\/+$/, '');
  return base;
}

function hubHeaders(env) {
  return {
    Authorization: `Bearer ${env.MIPAGO_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

/** POST {base}/api/v1/payments → 201 { id, reference, status, checkout_url, expires_at } */
export async function hubCreatePayment(env, payment) {
  const res = await fetch(`${hubBase(env)}/api/v1/payments`, {
    method: 'POST',
    headers: hubHeaders(env),
    body: JSON.stringify(payment),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, status: res.status, detail: detail.slice(0, 400) };
  }
  const data = await res.json();
  return { ok: true, data };
}

/** GET {base}/api/v1/payments/:id/status → authoritative status (hub re-checks Wompi) */
export async function hubGetStatus(env, id) {
  if (!PAYMENT_ID_RE.test(id)) return { ok: false, status: 400, detail: 'bad id' };
  const res = await fetch(`${hubBase(env)}/api/v1/payments/${id}/status`, {
    headers: hubHeaders(env),
  });
  if (!res.ok) return { ok: false, status: res.status, detail: 'hub error' };
  return { ok: true, data: await res.json() };
}

/** POST {base}/api/v1/payments/:id/cancel (before payment) → CANCELLED */
export async function hubCancelPayment(env, id) {
  if (!PAYMENT_ID_RE.test(id)) return { ok: false, status: 400, detail: 'bad id' };
  const res = await fetch(`${hubBase(env)}/api/v1/payments/${id}/cancel`, {
    method: 'POST',
    headers: hubHeaders(env),
  });
  if (!res.ok) return { ok: false, status: res.status, detail: 'hub error' };
  return { ok: true, data: await res.json() };
}
