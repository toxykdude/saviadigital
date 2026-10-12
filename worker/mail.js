// Email notifications via Resend — lead alerts (existing rail) and payment
// fulfillment notices. All sends are best-effort: an email failure must never
// fail a verified callback (the KV record is the fulfillment source of truth).

const TO_EMAIL = 'juan.manuelcano@live.com';
const FROM_EMAIL = 'Salviadigital Web <noreply@salvia.digital>';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function sendEmail(env, { subject, html, replyTo }) {
  if (!env.RESEND_API_KEY) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [TO_EMAIL],
        reply_to: replyTo || undefined,
        subject,
        html,
      }),
    });
    return r.ok;
  } catch (_) {
    return false;
  }
}

/* ---------- Contact lead (legacy rail, unchanged behavior) ---------- */

function leadBody(d) {
  const row = (k, v) => `<tr><td style="padding:6px 12px;background:#f4f4f4;font-weight:600;">${escapeHtml(k)}</td><td style="padding:6px 12px;">${escapeHtml(v)}</td></tr>`;
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222">
<h2 style="margin:0 0 12px">Nuevo lead desde salviadigital</h2>
<table style="border-collapse:collapse">${row('Nombre', d.nombre)}${row('Empresa', d.empresa)}${row('Email', d.email)}${row('Teléfono', d.telefono)}${row('Servicio', d.servicio)}${row('Presupuesto', d.presupuesto)}${row('Mensaje', d.mensaje)}${row('Fecha', d.date)}</table>
<p style="color:#888;margin-top:16px">Responde directamente a este correo para contestar al cliente.</p>
</body></html>`;
}

export function sendLeadEmail(env, lead) {
  return sendEmail(env, {
    subject: `Nuevo lead — ${lead.servicio || 'web'} — ${lead.nombre}`,
    html: leadBody(lead),
    replyTo: lead.email,
  });
}

/* ---------- Payment notifications ---------- */

const cop = (n) => '$' + Number(n).toLocaleString('es-CO');

function paymentApprovedOwnerBody({ plan, payment, record, providerTx }) {
  const row = (k, v) => `<tr><td style="padding:6px 12px;background:#f0f9f3;font-weight:600;">${escapeHtml(k)}</td><td style="padding:6px 12px;">${escapeHtml(v)}</td></tr>`;
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222">
<h2 style="margin:0 0 12px;color:#0a7a45">Pago aprobado — ${escapeHtml(plan.name)}</h2>
<table style="border-collapse:collapse">
${row('Servicio', plan.name)}
${row('Monto', `${cop(payment.amount)} ${payment.currency}`)}
${row('Cliente', record.customer.name)}
${row('Email', record.customer.email)}
${row('Teléfono', record.customer.phone || '—')}
${row('Referencia hub', payment.reference)}
${row('Payment ID', payment.id)}
${row('Tx Wompi', providerTx || '—')}
${row('Order ID', record.order_id)}
${row('Entrega estimada', plan.delivery)}
</table>
<p style="margin-top:16px">Contacta al cliente para coordinar el kickoff del servicio.</p>
</body></html>`;
}

function paymentApprovedCustomerBody({ plan, payment, record }) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222">
<h2 style="margin:0 0 12px">¡Pago recibido, ${escapeHtml(record.customer.name.split(' ')[0])}!</h2>
<p>Confirmamos el pago de <strong>${escapeHtml(plan.name)}</strong> por <strong>${cop(payment.amount)} ${payment.currency}</strong>.</p>
<p style="color:#555">Referencia: <strong>${escapeHtml(payment.reference)}</strong></p>
<p>Un experto de Salviadigital te contactará en menos de 24 horas para coordinar el kickoff y la entrega (${escapeHtml(plan.delivery)}).</p>
<p style="color:#888;margin-top:16px">Gracias por confiar en Salviadigital — gerencia@salvia.digital</p>
</body></html>`;
}

/** Owner alert + customer confirmation for an APPROVED payment. */
export async function sendPaymentApprovedEmails(env, ctx) {
  const ownerOk = await sendEmail(env, {
    subject: `Pago aprobado — ${ctx.plan.name} — ${cop(ctx.payment.amount)} — ${ctx.record.customer.name}`,
    html: paymentApprovedOwnerBody(ctx),
    replyTo: ctx.record.customer.email,
  });
  const customerOk = await sendEmail(env, {
    subject: `Pago recibido — ${ctx.plan.name} — Salviadigital`,
    html: paymentApprovedCustomerBody(ctx),
  });
  return { ownerOk, customerOk };
}

/** Owner-only alert for declined / errored / mismatched payments. */
export function sendPaymentIssueEmail(env, { subject, lines }) {
  const li = lines.map(l => `<li>${escapeHtml(l)}</li>`).join('');
  return sendEmail(env, {
    subject,
    html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222"><h2 style="margin:0 0 12px">${escapeHtml(subject)}</h2><ul style="padding-left:18px;line-height:1.8">${li}</ul></body></html>`,
  });
}
