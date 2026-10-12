// Cloudflare Worker — Salviadigital
// Rail 1 (legacy): contact form → Resend email.          POST /
// Rail 2: mipago.online payments for the four packaged services.
//   POST   /api/payments/create          → checkout_url (server-side amounts)
//   POST   /api/payments/callback        → hub webhook, HMAC-verified (custom domain route!)
//   GET    /api/payments/:id/status      → sanitized status proxy
//   POST   /api/payments/:id/cancel      → sanitized cancel proxy
//   POST   /api/reconcile                → keyed safety net (X-Reconcile-Key)
//   GET    /api/health                   → wiring diagnostics
//
// Secrets (Worker → Settings → Variables and Secrets → Encrypt):
//   RESEND_API_KEY, MIPAGO_API_KEY, MIPAGO_CALLBACK_SECRET, RECONCILE_KEY
// Vars: MIPAGO_ENABLED, MIPAGO_API_URL, SITE_URL. Binding: PAYMENTS_KV.

import { PLANS, getPlan } from './plans.js';
import {
  readCallbackHeaders,
  verifyCallbackSignature,
  timingSafeEqual,
  hubCreatePayment,
  hubGetStatus,
  hubCancelPayment,
} from './mipago.js';
import {
  sendLeadEmail,
  sendPaymentApprovedEmails,
  sendPaymentIssueEmail,
} from './mail.js';

const ALLOWED_ORIGINS = [
  'https://salvia.digital',
  'https://www.salvia.digital',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

const PAYMENT_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

/* ---------------- CORS ----------------
   The browser calls this worker cross-origin (workers.dev) with JSON bodies,
   which triggers preflight. Without an OPTIONS handler + Allow-Headers the
   fetch fails before reaching the handler — so every route answers these. */
function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : 'https://salvia.digital';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Reconcile-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request) },
  });
}

function failClosed(env) {
  if (env.MIPAGO_ENABLED !== 'true') return { error: 'payments_disabled', message: 'Pagos online no habilitados todavía.' };
  if (!env.MIPAGO_API_KEY) return { error: 'payments_not_configured', message: 'Falta MIPAGO_API_KEY.' };
  if (!env.PAYMENTS_KV) return { error: 'payments_not_configured', message: 'Falta el binding PAYMENTS_KV.' };
  return null;
}

const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());
const validPhone = (v) => v === undefined || v === null || String(v).trim() === '' || /^[+\d][\d\s.-]{6,20}$/.test(String(v).trim());

/* ---------------- Router ---------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (pathname === '/' ) {
      return handleLeadForm(request, env);
    }
    if (pathname === '/api/payments/create' && request.method === 'POST') {
      return handleCreate(request, env);
    }
    if (pathname === '/api/payments/callback' && request.method === 'POST') {
      return handleCallback(request, env);
    }

    let m = pathname.match(/^\/api\/payments\/([A-Za-z0-9_-]{6,64})\/status$/);
    if (m && request.method === 'GET') return handleStatusProxy(request, env, m[1]);

    m = pathname.match(/^\/api\/payments\/([A-Za-z0-9_-]{6,64})\/cancel$/);
    if (m && request.method === 'POST') return handleCancelProxy(request, env, m[1]);

    if (pathname === '/api/reconcile' && request.method === 'POST') {
      return handleReconcile(request, env);
    }
    if (pathname === '/api/health' && request.method === 'GET') {
      return json(request, {
        ok: true,
        payments_enabled: env.MIPAGO_ENABLED === 'true',
        hub_configured: !!env.MIPAGO_API_KEY,
        callback_secret_set: !!env.MIPAGO_CALLBACK_SECRET,
        kv_bound: !!env.PAYMENTS_KV,
        resend_set: !!env.RESEND_API_KEY,
        hub_url: env.MIPAGO_API_URL || 'https://staging.mipago.online (default)',
      });
    }

    return json(request, { error: 'not_found' }, 404);
  },
};

/* ---------------- Rail 1: contact form (legacy, unchanged) ---------------- */

async function handleLeadForm(request, env) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const origin = request.headers.get('Origin') || '';
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403 });

  let d;
  try { d = await request.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
  if (!d || !d.email || !d.nombre || !d.mensaje) return new Response('Missing fields', { status: 400 });

  const ok = await sendLeadEmail(env, d);
  if (!ok) return new Response('Upstream error', { status: 502 });
  return new Response('{"ok":true}', {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsHeaders(request)['Access-Control-Allow-Origin'] },
  });
}

/* ---------------- Rail 2: payments ---------------- */

async function handleCreate(request, env) {
  const closed = failClosed(env);
  if (closed) return json(request, closed, closed.error === 'payments_disabled' ? 503 : 500);

  let body;
  try { body = await request.json(); } catch { return json(request, { error: 'bad_json' }, 400); }

  const plan = getPlan(body?.plan_key);
  if (!plan) return json(request, { error: 'unknown_plan', message: 'Servicio no disponible.' }, 400);

  const c = body.customer || {};
  const name = String(c.name || '').trim();
  const email = String(c.email || '').trim();
  const phone = String(c.phone || '').trim();
  if (name.length < 2) return json(request, { error: 'invalid_name' }, 400);
  if (!validEmail(email)) return json(request, { error: 'invalid_email' }, 400);
  if (!validPhone(phone)) return json(request, { error: 'invalid_phone' }, 400);

  const siteUrl = String(env.SITE_URL || 'https://salvia.digital').replace(/\/+$/, '');
  const order_id = crypto.randomUUID();

  const created = await hubCreatePayment(env, {
    amount: plan.amount, // COP major units, computed server-side only
    currency: 'COP',
    description: `${plan.description} — Salviadigital`,
    customer: { email, name, ...(phone ? { phone } : {}) },
    return_url: `${siteUrl}/`,
    metadata: {
      plan_key: plan.key,
      plan_name: plan.name,
      order_id,
      source: 'salviadigital-web',
    },
  });
  if (!created.ok) {
    return json(request, { error: 'hub_error', status: created.status, detail: created.detail }, 502);
  }

  // Pending record BEFORE handing out checkout_url — an approved payment with
  // no pending record cannot be auto-fulfilled (runbook §3). Fail closed.
  const record = {
    payment_id: created.data.id,
    order_id,
    plan_key: plan.key,
    plan_name: plan.name,
    amount_pesos: plan.amount,
    currency: 'COP',
    status: 'open',
    customer: { name, email, ...(phone ? { phone } : {}) },
    created_at: new Date().toISOString(),
  };
  try {
    await env.PAYMENTS_KV.put(`payment:${created.data.id}`, JSON.stringify(record), { expirationTtl: 7 * 24 * 3600 });
  } catch (e) {
    // Best-effort cancel so the customer never lands on an untrackable checkout.
    await hubCancelPayment(env, created.data.id).catch(() => {});
    return json(request, { error: 'registry_write_failed' }, 500);
  }

  return json(request, {
    payment_id: created.data.id,
    reference: created.data.reference,
    checkout_url: created.data.checkout_url,
    amount: plan.amount,
    currency: 'COP',
    plan_key: plan.key,
  });
}

async function handleCallback(request, env) {
  // 1. Raw body BEFORE any JSON parsing (runbook §5).
  const rawBody = await request.text();

  // 2. HMAC-SHA256 over "timestamp.rawBody", timing-safe, ms-tolerant.
  const v = await verifyCallbackSignature(env.MIPAGO_CALLBACK_SECRET, rawBody, readCallbackHeaders(request));
  if (!v.ok) return new Response('Invalid signature', { status: 401 });

  // 3. Dedup on X-Mipago-Event-Id — short-circuit already-processed events.
  const eventId = request.headers.get('X-Mipago-Event-Id') || '';
  const evtKey = `evt:${eventId}`;
  if (eventId && env.PAYMENTS_KV) {
    const seen = await env.PAYMENTS_KV.get(evtKey);
    if (seen) return new Response('OK', { status: 200 });
  }

  let event;
  try { event = JSON.parse(rawBody); } catch { return new Response('OK', { status: 200 }); }

  const payment = event.payment || {};
  const recordRaw = env.PAYMENTS_KV ? await env.PAYMENTS_KV.get(`payment:${payment.id}`) : null;

  // 4. Approved → amount/currency gate → fulfill. Declined/error → finalize, never fulfill.
  if (event.type === 'payment.approved') {
    const record = recordRaw ? JSON.parse(recordRaw) : null;

    if (!record) {
      // Approved payment with no pending record: cannot auto-fulfill. Alert.
      await sendPaymentIssueEmail(env, {
        subject: `Pago aprobado SIN registro — ${payment.reference}`,
        lines: [
          `Payment ID: ${payment.id}`,
          `Referencia: ${payment.reference}`,
          `Monto: ${payment.amount} ${payment.currency}`,
          'El pago llegó sin registro previo (¿creado fuera de este worker?).',
        ],
      }).catch(() => {});
    } else if (record.status === 'fulfilled') {
      // Already fulfilled (e.g. reconcile won the race) — just ack.
    } else if (Number(payment.amount) !== record.amount_pesos || payment.currency !== record.currency) {
      await env.PAYMENTS_KV.put(`payment:${payment.id}`, JSON.stringify({
        ...record, status: 'amount_mismatch',
        reported_amount: payment.amount, reported_currency: payment.currency,
        flagged_at: new Date().toISOString(),
      }));
      await sendPaymentIssueEmail(env, {
        subject: `ALERTA: monto no coincide — ${payment.reference}`,
        lines: [
          `Servicio: ${record.plan_name} (esperado ${record.amount_pesos} ${record.currency})`,
          `Pagado: ${payment.amount} ${payment.currency}`,
          `Payment ID: ${payment.id} · Referencia: ${payment.reference}`,
          'Revisar manualmente antes de entregar el servicio.',
        ],
      }).catch(() => {});
    } else if (payment.status === 'APPROVED') {
      const providerTx = event.provider?.transaction_id || '';
      // Fulfillment source of truth: KV record transition open→fulfilled.
      await env.PAYMENTS_KV.put(`payment:${payment.id}`, JSON.stringify({
        ...record,
        status: 'fulfilled',
        hub_reference: payment.reference,
        provider_tx: providerTx,
        fulfilled_at: new Date().toISOString(),
        fulfilled_via: 'callback',
      }));
      // Notification is best-effort; never blocks the ack.
      const mails = await sendPaymentApprovedEmails(env, {
        plan: { name: record.plan_name, delivery: planDelivery(record.plan_key) },
        payment,
        record,
        providerTx,
      }).catch(() => ({ ownerOk: false, customerOk: false }));
      if (!mails.ownerOk) {
        await env.PAYMENTS_KV.put(`payment:${payment.id}`, JSON.stringify({
          ...JSON.parse(await env.PAYMENTS_KV.get(`payment:${payment.id}`) || '{}'),
          email_notice_failed: true,
        })).catch(() => {});
      }
    }
  } else if (event.type === 'payment.declined' || event.type === 'payment.error') {
    if (recordRaw) {
      const record = JSON.parse(recordRaw);
      if (record.status === 'open' || record.status === 'pending') {
        await env.PAYMENTS_KV.put(`payment:${payment.id}`, JSON.stringify({
          ...record, status: 'final', final_state: event.type.split('.')[1], finalized_at: new Date().toISOString(),
        }));
        await sendPaymentIssueEmail(env, {
          subject: `Pago ${event.type.split('.')[1]} — ${record.plan_name} — ${record.customer.name}`,
          lines: [
            `Payment ID: ${payment.id} · Referencia: ${payment.reference}`,
            `Cliente: ${record.customer.name} <${record.customer.email}>`,
            'El cliente puede reintentar con un nuevo pago.',
          ],
        }).catch(() => {});
      }
    }
  }

  // 5. Mark processed ONLY after side effects — failed deliveries retry.
  if (eventId && env.PAYMENTS_KV) {
    await env.PAYMENTS_KV.put(evtKey, new Date().toISOString(), { expirationTtl: 7 * 24 * 3600 });
  }

  // 6. Always 200 quickly after verification.
  return new Response('OK', { status: 200 });
}

function planDelivery(key) {
  return PLANS[key]?.delivery || 'coordinar con el cliente';
}

/* ---------------- Status / cancel proxies ---------------- */

async function handleStatusProxy(request, env, id) {
  if (!env.MIPAGO_API_KEY) return json(request, { error: 'payments_not_configured' }, 500);
  const r = await hubGetStatus(env, id);
  if (!r.ok) return json(request, { error: 'hub_error', status: r.status }, 502);
  // Sanitize: strip anything the hub adds later (customer objects etc.).
  const d = r.data || {};
  return json(request, {
    id: d.id, reference: d.reference, status: d.status,
    amount: d.amount, currency: d.currency, refreshed: d.refreshed,
  });
}

async function handleCancelProxy(request, env, id) {
  if (!env.MIPAGO_API_KEY) return json(request, { error: 'payments_not_configured' }, 500);
  const r = await hubCancelPayment(env, id);
  if (env.PAYMENTS_KV) {
    const raw = await env.PAYMENTS_KV.get(`payment:${id}`);
    if (raw) {
      const record = JSON.parse(raw);
      if (record.status === 'open') {
        await env.PAYMENTS_KV.put(`payment:${id}`, JSON.stringify({
          ...record, status: 'final', final_state: 'CANCELLED', finalized_at: new Date().toISOString(),
        }));
      }
    }
  }
  if (!r.ok) return json(request, { error: 'hub_error', status: r.status }, 502);
  const d = r.data || {};
  return json(request, { id: d.id, reference: d.reference, status: d.status });
}

/* ---------------- Reconcile safety net ---------------- */

async function handleReconcile(request, env) {
  const key = request.headers.get('X-Reconcile-Key') || '';
  if (!env.RECONCILE_KEY || !key || !timingSafeEqual(key, env.RECONCILE_KEY)) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!env.PAYMENTS_KV || !env.MIPAGO_API_KEY) {
    return json(request, { error: 'payments_not_configured' }, 500);
  }

  const scanned = [];
  let cursor;
  try {
    do {
      const page = await env.PAYMENTS_KV.list({ prefix: 'payment:', cursor, limit: 100 });
      for (const k of page.keys) {
        const raw = await env.PAYMENTS_KV.get(k.name);
        if (!raw) continue;
        const record = JSON.parse(raw);
        scanned.push(record);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  } catch (e) {
    return json(request, { error: 'kv_scan_failed', detail: String(e).slice(0, 200) }, 500);
  }

  const cutoff = Date.now() - 5 * 60 * 1000; // only records older than 5 min
  const results = { checked: 0, fulfilled: 0, finalized: 0, pending: 0, skipped: 0 };
  for (const record of scanned) {
    if (record.status !== 'open') { results.skipped++; continue; }
    if (Date.parse(record.created_at) > cutoff) { results.pending++; continue; }
    results.checked++;

    const r = await hubGetStatus(env, record.payment_id);
    if (!r.ok) continue;
    const status = r.data?.status;

    if (status === 'APPROVED') {
      const evtKey = `evt:reconcile:${record.payment_id}`;
      if (await env.PAYMENTS_KV.get(evtKey)) { results.skipped++; continue; }
      await env.PAYMENTS_KV.put(`payment:${record.payment_id}`, JSON.stringify({
        ...record, status: 'fulfilled', hub_reference: r.data.reference,
        fulfilled_at: new Date().toISOString(), fulfilled_via: 'reconcile',
      }));
      await sendPaymentApprovedEmails(env, {
        plan: { name: record.plan_name, delivery: planDelivery(record.plan_key) },
        payment: { id: r.data.id, reference: r.data.reference, amount: r.data.amount, currency: r.data.currency },
        record,
        providerTx: '', // status API carries no wompi tx id (known hub gap)
      }).catch(() => {});
      await env.PAYMENTS_KV.put(evtKey, new Date().toISOString(), { expirationTtl: 7 * 24 * 3600 });
      results.fulfilled++;
    } else if (status === 'DECLINED' || status === 'ERROR' || status === 'CANCELLED' || status === 'EXPIRED') {
      await env.PAYMENTS_KV.put(`payment:${record.payment_id}`, JSON.stringify({
        ...record, status: 'final', final_state: status, finalized_at: new Date().toISOString(),
      }));
      results.finalized++;
    }
  }
  return json(request, { ok: true, total_records: scanned.length, ...results });
}
