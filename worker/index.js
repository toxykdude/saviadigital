// Cloudflare Worker — Salviadigital contact form → Resend
// Deploy: create a Worker at https://workers.cloudflare.com (free plan),
// paste this code, then add a secret named RESEND_API_KEY with your
// Resend sending key (Worker → Settings → Variables and Secrets → Encrypt).
// Finally set FORM_ENDPOINT in index.html to the worker's URL.

const ALLOWED_ORIGINS = ['https://salvia.digital', 'https://www.salvia.digital'];
const TO_EMAIL = 'juan.manuelcano@live.com';
const FROM_EMAIL = 'Salviadigital Web <noreply@salvia.digital>';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function buildBody(d) {
  const row = (k, v) => `<tr><td style="padding:6px 12px;background:#f4f4f4;font-weight:600;">${escapeHtml(k)}</td><td style="padding:6px 12px;">${escapeHtml(v)}</td></tr>`;
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222">
<h2 style="margin:0 0 12px">Nuevo lead desde salviadigital</h2>
<table style="border-collapse:collapse">${row('Nombre', d.nombre)}${row('Empresa', d.empresa)}${row('Email', d.email)}${row('Teléfono', d.telefono)}${row('Servicio', d.servicio)}${row('Presupuesto', d.presupuesto)}${row('Mensaje', d.mensaje)}${row('Fecha', d.date)}</table>
<p style="color:#888;margin-top:16px">Responde directamente a este correo para contestar al cliente.</p>
</body></html>`;
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const origin = request.headers.get('Origin') || '';
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403 });

    let d;
    try { d = await request.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
    if (!d || !d.email || !d.nombre || !d.mensaje) return new Response('Missing fields', { status: 400 });

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_API_KEY, // secret injected by Cloudflare
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [TO_EMAIL],
        reply_to: d.email, // replies go straight to the customer
        subject: `Nuevo lead — ${d.servicio || 'web'} — ${d.nombre}`,
        html: buildBody(d)
      })
    });

    if (!r.ok) return new Response('Upstream error', { status: 502 });
    return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
};
