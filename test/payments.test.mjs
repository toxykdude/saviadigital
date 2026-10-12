// Local verification harness for the payment rail. No wrangler needed.
//   node test/payments.test.mjs
// Mocks: in-memory KV, hub API (MIPAGO_API_URL=https://hub.test), Resend.
// Proves: fail-closed create, pending-before-checkout, HMAC verification
// (ms timestamps, tamper, replay), dedup, amount gate, decline handling,
// reconcile safety net, sanitized proxies, legacy form, CORS preflight.

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from '../worker/index.js';

const CALLBACK_SECRET = 'a'.repeat(64); // 64-hex stand-in
const RECONCILE_KEY = 'reconcile-secret';

/* ---------- mocks ---------- */
function makeKv() {
  const store = new Map();
  return {
    store,
    async get(k) { return store.get(k) ?? null; },
    async put(k, v, opts) {
      if (kv.failNextPut) { const e = kv.failNextPut; kv.failNextPut = null; throw e; }
      store.set(k, v);
    },
    async delete(k) { store.delete(k); },
    async list({ prefix = '', cursor, limit = 100 } = {}) {
      const keys = [...store.keys()].filter(k => k.startsWith(prefix))
        .map(name => ({ name }))
        .slice(0, limit);
      return { keys, list_complete: true };
    },
    failNextPut: null,
  };
}

const hub = {
  payments: new Map(), // id -> { createResponse, statusSequence[], statusIdx }
  createCalls: [],
  cancelCalls: [],
};

const resend = { calls: [] };

const kv = makeKv();
const env = {
  RESEND_API_KEY: 're_test',
  MIPAGO_ENABLED: 'true',
  MIPAGO_API_URL: 'https://hub.test',
  MIPAGO_API_KEY: 'sv_test_key',
  MIPAGO_CALLBACK_SECRET: CALLBACK_SECRET,
  SITE_URL: 'https://salvia.digital',
  RECONCILE_KEY,
  PAYMENTS_KV: kv,
};

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://hub.test')) {
    if (u.endsWith('/api/v1/payments') && init.method === 'POST') {
      hub.createCalls.push(JSON.parse(init.body));
      const id = `pay_${String(hub.createCalls.length).padStart(6, '0')}`;
      const p = { id, reference: 'SV-01JTEST' + id.slice(-3), status: 'CREATED', checkout_url: `https://hub.test/checkout/${id}`, expires_at: '2026-10-12T23:00:00Z' };
      hub.payments.set(id, { data: p, statusSequence: ['PENDING'], statusIdx: 0, status: 'CREATED' });
      return new Response(JSON.stringify(p), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    const m = u.match(/\/api\/v1\/payments\/([^/]+)\/status$/);
    if (m && !init.method) {
      const p = hub.payments.get(m[1]);
      if (!p) return new Response('{"error":"not found"}', { status: 404 });
      return new Response(JSON.stringify({
        id: p.data.id, reference: p.data.reference, status: p.status,
        wompi_status: p.status, refreshed: true, amount: p.data.amountRequested ?? hub.createCalls[Number(m[1].slice(-1)) - 1]?.amount,
        currency: 'COP', customer: { email: 'leak@attempt' }, // must be stripped by proxy
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const mc = u.match(/\/api\/v1\/payments\/([^/]+)\/cancel$/);
    if (mc && init.method === 'POST') {
      hub.cancelCalls.push(mc[1]);
      const p = hub.payments.get(mc[1]);
      if (p) p.status = 'CANCELLED';
      return new Response(JSON.stringify({ id: mc[1], reference: p?.data.reference, status: 'CANCELLED' }), { status: 200 });
    }
    throw new Error('unexpected hub url ' + u);
  }
  if (u === 'https://api.resend.com/emails') {
    resend.calls.push({ subject: JSON.parse(init.body).subject, to: JSON.parse(init.body).to });
    return new Response('{"id":"email"}', { status: 200 });
  }
  throw new Error('unexpected fetch ' + u);
};

function sign(body, tsMs = Date.now(), secret = CALLBACK_SECRET) {
  const timestamp = String(tsMs);
  const sig = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return { 'X-Mipago-Signature': sig, 'X-Mipago-Timestamp': timestamp, 'X-Mipago-Event-Id': `evt_${Math.random().toString(36).slice(2, 10)}`, 'Content-Type': 'application/json' };
}

const base = 'https://salvia-form.test';
const req = (path, init) => new Request(base + path, init);
const post = (path, body, headers = {}, origin = 'https://salvia.digital') =>
  new Request(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

const results = [];
async function test(name, fn) {
  try { await fn(); results.push(`  ok  ${name}`); }
  catch (e) { results.push(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}

/* ---------- tests ---------- */

await test('health reflects wiring', async () => {
  const r = await worker.fetch(req('/api/health'), env);
  const d = await r.json();
  assert.equal(d.payments_enabled, true);
  assert.equal(d.kv_bound, true);
  assert.equal(d.hub_configured, true);
});

await test('create fails closed while disabled (503)', async () => {
  const r = await worker.fetch(post('/api/payments/create', { plan_key: 'landing', customer: { name: 'Ana', email: 'a@b.co' } }), { ...env, MIPAGO_ENABLED: 'false' });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, 'payments_disabled');
});

await test('create rejects unknown plan / bad customer', async () => {
  assert.equal((await worker.fetch(post('/api/payments/create', { plan_key: 'nope' }), env)).status, 400);
  assert.equal((await worker.fetch(post('/api/payments/create', { plan_key: 'landing', customer: { name: 'A', email: 'a@b.co' } }), env)).status, 400);
  assert.equal((await worker.fetch(post('/api/payments/create', { plan_key: 'landing', customer: { name: 'Ana', email: 'nope' } }), env)).status, 400);
});

await test('create happy path: server-side amount, pending record before checkout_url', async () => {
  const r = await worker.fetch(post('/api/payments/create', {
    plan_key: 'landing',
    customer: { name: 'Ana Ríos', email: 'ana@example.com', phone: '573001234567' },
  }), env);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.amount, 1490000); // from server plan table, not the client
  assert.equal(d.currency, 'COP');
  assert.ok(d.checkout_url.startsWith('https://hub.test/checkout/'));
  const rec = JSON.parse(await kv.get(`payment:${d.payment_id}`));
  assert.equal(rec.status, 'open');
  assert.equal(rec.amount_pesos, 1490000);
  assert.equal(rec.customer.email, 'ana@example.com');
  // hub got the amount + metadata linkage
  const hubCall = hub.createCalls.at(-1);
  assert.equal(hubCall.amount, 1490000);
  assert.equal(hubCall.metadata.plan_key, 'landing');
  assert.equal(hubCall.return_url, 'https://salvia.digital/');
});

await test('registry write failure → no checkout_url, hub cancel called (fail closed)', async () => {
  kv.failNextPut = new Error('KV down');
  const r = await worker.fetch(post('/api/payments/create', {
    plan_key: 'chatbot', customer: { name: 'Beto', email: 'b@b.co' },
  }), env);
  assert.notEqual(r.status, 200);
  const d = await r.json().catch(() => ({}));
  assert.equal(d.error, 'registry_write_failed');
  assert.ok(hub.cancelCalls.length >= 1, 'best-effort cancel should fire');
});

async function createPaid(plan_key, name = 'Carla Sosa') {
  const r = await worker.fetch(post('/api/payments/create', {
    plan_key, customer: { name, email: `${name.split(' ')[0].toLowerCase()}@example.com` },
  }), env);
  const d = await r.json();
  const p = hub.payments.get(d.payment_id);
  p.data.amountRequested = d.amount;
  return { d, p };
}

async function sendEvent(type, payment, extra = {}, headers = {}) {
  const body = JSON.stringify({
    id: headers['X-Mipago-Event-Id'] || 'evt_x1', type, created_at: new Date().toISOString(),
    payment: { id: payment.id, reference: payment.reference, amount: extra.amount ?? payment.amountRequested ?? 0, currency: 'COP', status: extra.status ?? (type === 'payment.approved' ? 'APPROVED' : type.split('.')[1].toUpperCase()), metadata: { plan_key: 'x' } },
    provider: { name: 'wompi', transaction_id: extra.tx ?? 'wompi-tx-1' },
  });
  const h = { ...sign(body), ...headers };
  return worker.fetch(post('/api/payments/callback', body, h), env);
}

await test('callback: tampered signature → 401, zero side effects', async () => {
  const { p } = await createPaid('laser');
  const body = JSON.stringify({ id: 'evt_t', type: 'payment.approved', payment: { id: p.data.id, reference: p.data.reference, amount: 4900000, currency: 'COP', status: 'APPROVED' } });
  const h = sign(body);
  h['X-Mipago-Signature'] = ('0' === h['X-Mipago-Signature'][0] ? '1' : '0') + h['X-Mipago-Signature'].slice(1);
  const before = kv.store.size;
  const r = await worker.fetch(post('/api/payments/callback', body, h), env);
  assert.equal(r.status, 401);
  assert.equal(kv.store.size, before);
});

await test('callback: stale timestamp (6 min) → 401', async () => {
  const { p } = await createPaid('laser');
  const body = JSON.stringify({ id: 'evt_o', type: 'payment.approved', payment: { id: p.data.id, reference: p.data.reference, amount: 4900000, currency: 'COP', status: 'APPROVED' } });
  const r = await worker.fetch(post('/api/payments/callback', body, sign(body, Date.now() - 6.5 * 60 * 1000)), env);
  assert.equal(r.status, 401);
});

await test('callback: seconds-unit timestamps also verify (unit-agnostic HMAC)', async () => {
  const { p } = await createPaid('tour360');
  const body = JSON.stringify({ id: 'evt_s', type: 'payment.approved', payment: { id: p.data.id, reference: p.data.reference, amount: 1290000, currency: 'COP', status: 'APPROVED' } });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', CALLBACK_SECRET).update(`${ts}.${body}`).digest('hex');
  const r = await worker.fetch(post('/api/payments/callback', body, {
    'X-Mipago-Signature': sig, 'X-Mipago-Timestamp': ts, 'X-Mipago-Event-Id': 'evt_s',
  }), env);
  assert.equal(r.status, 200);
});

await test('callback: genuine approval → fulfilled once, owner+customer emailed, dedup works', async () => {
  const { d, p } = await createPaid('chatbot');
  const mailsBefore = resend.calls.length;
  const r1 = await sendEvent('payment.approved', { id: d.payment_id, reference: d.reference, amountRequested: 1990000 });
  assert.equal(r1.status, 200);
  const rec = JSON.parse(await kv.get(`payment:${d.payment_id}`));
  assert.equal(rec.status, 'fulfilled');
  assert.equal(rec.provider_tx, 'wompi-tx-1');
  assert.equal(rec.hub_reference, d.reference);
  assert.equal(resend.calls.length - mailsBefore, 2); // owner + customer

  // dedup: same event id, fresh timestamp → fast 200, no double fulfillment
  const mails = resend.calls.length;
  const body = JSON.stringify({ id: 'evt_dupe', type: 'payment.approved', payment: { id: d.payment_id, reference: d.reference, amount: 1990000, currency: 'COP', status: 'APPROVED' }, provider: { transaction_id: 'wompi-tx-1' } });
  const h1 = sign(body); h1['X-Mipago-Event-Id'] = 'evt_dupe';
  await worker.fetch(post('/api/payments/callback', body, h1), env);
  const h2 = sign(body, Date.now() + 1000); h2['X-Mipago-Event-Id'] = 'evt_dupe';
  await worker.fetch(post('/api/payments/callback', body, h2), env);
  assert.equal(resend.calls.length, mails, 'duplicate delivery must not re-notify');
});

await test('callback: amount mismatch → flagged, never fulfilled', async () => {
  const { d } = await createPaid('landing');
  const r = await sendEvent('payment.approved', { id: d.payment_id, reference: d.reference }, { amount: 1000 });
  assert.equal(r.status, 200);
  const rec = JSON.parse(await kv.get(`payment:${d.payment_id}`));
  assert.equal(rec.status, 'amount_mismatch');
});

await test('callback: declined → record final, owner alerted, customer NOT emailed', async () => {
  const { d } = await createPaid('tour360');
  const mails = resend.calls.length;
  const r = await sendEvent('payment.declined', { id: d.payment_id, reference: d.reference }, { status: 'DECLINED' });
  assert.equal(r.status, 200);
  const rec = JSON.parse(await kv.get(`payment:${d.payment_id}`));
  assert.equal(rec.status, 'final');
  assert.equal(rec.final_state, 'declined');
  assert.equal(resend.calls.length - mails, 1); // owner issue email only
});

await test('status proxy sanitizes hub payload (no customer leak)', async () => {
  const { d, p } = await createPaid('laser');
  p.status = 'PENDING';
  const r = await worker.fetch(req(`/api/payments/${d.payment_id}/status`), env);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.status, 'PENDING');
  assert.equal('customer' in body, false);
  assert.ok(body.reference);
});

await test('cancel proxy updates registry and hub', async () => {
  const { d } = await createPaid('landing');
  const r = await worker.fetch(post(`/api/payments/${d.payment_id}/cancel`, '{}'), env);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, 'CANCELLED');
  const rec = JSON.parse(await kv.get(`payment:${d.payment_id}`));
  assert.equal(rec.final_state, 'CANCELLED');
});

await test('reconcile: wrong key → 401; right key fulfills missed approval', async () => {
  const { d, p } = await createPaid('chatbot');
  p.status = 'APPROVED'; // hub says approved but callback never arrived
  // Age the record past reconcile's 5-minute grace window.
  const raw = JSON.parse(await kv.get(`payment:${d.payment_id}`));
  raw.created_at = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await kv.put(`payment:${d.payment_id}`, JSON.stringify(raw));
  const bad = await worker.fetch(post('/api/reconcile', '{}', { 'X-Reconcile-Key': 'wrong' }), env);
  assert.equal(bad.status, 401);

  const mails = resend.calls.length;
  const r = await worker.fetch(post('/api/reconcile', '{}', { 'X-Reconcile-Key': RECONCILE_KEY }), env);
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.ok(out.fulfilled >= 1);
  const rec = JSON.parse(await kv.get(`payment:${d.payment_id}`));
  assert.equal(rec.status, 'fulfilled');
  assert.equal(rec.fulfilled_via, 'reconcile');
  assert.equal(resend.calls.length - mails, 2);
});

await test('legacy contact form still works + CORS preflight answers', async () => {
  const mails = resend.calls.length;
  const r = await worker.fetch(post('/', JSON.stringify({
    nombre: 'Ana', empresa: 'Acme', email: 'ana@acme.com', telefono: '', servicio: 'Desarrollo Web',
    presupuesto: '', mensaje: 'Necesito una landing para mi negocio', date: new Date().toISOString(),
  })), env);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  assert.equal(resend.calls.length - mails, 1);

  const pre = await worker.fetch(new Request(base + '/api/payments/create', { method: 'OPTIONS', headers: { Origin: 'https://salvia.digital', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } }), env);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'https://salvia.digital');
  assert.ok(pre.headers.get('Access-Control-Allow-Headers').includes('Content-Type'));
});

globalThis.fetch = realFetch;

console.log(results.join('\n'));
console.log(`\n${results.filter(r => r.startsWith('  ok')).length}/${results.length} passed — hub creates: ${hub.createCalls.length}, cancels: ${hub.cancelCalls.length}, emails: ${resend.calls.length}`);
