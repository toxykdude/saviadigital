# Salviadigital — sitio + pagos

`index.html` (sitio estático, salvia.digital) + Cloudflare Worker
(`salvia-form`) con dos rieles:

1. **Formulario de contacto** → email por Resend (POST `/`).
2. **Pagos mipago.online** para 4 servicios empaquetados:
   landing page, agente IA/chatbot, campaña láser y tour virtual 360° con dron.

## Servicios y precios (COP, IVA incluido)

| plan_key | Servicio | Precio | Base de mercado (investigado 2026-10) |
|---|---|---|---|
| `landing` | Landing Page de Conversión | $1.490.000 | $400k–$3,5M según tier (Muselab, Plago, CES, Cangrejo Digital) |
| `chatbot` | Agente IA / Chatbot | $1.990.000 | SaaS $19–169 USD/mes; LIWA $299k/mes; dev a medida €2k–15k |
| `laser` | Campaña de Publicidad Láser | $4.900.000 | Paquetes evento US$750–2.000+; campañas de fachada más altas |
| `tour360` | Tour Virtual 360° con Dron | $1.290.000 | ~$700k por punto aéreo (Air Photo Colombia); US$100–250/pt |

Fuente de verdad de montos: **`worker/plans.js`** (el cliente solo envía
`plan_key`; el monto se calcula siempre server-side).

## Arquitectura de pagos

```
Navegador ──POST /api/payments/create──▶ Worker ──POST /api/v1/payments──▶ hub mipago
Navegador ◀──checkout_url──────────────── Worker ◀──201─────────────────── (Wompi COP)

Wompi ──webhook──▶ hub ──POST /api/payments/callback (HMAC)──▶ Worker ──▶ KV + emails
                                                                    ▲
GitHub Actions (cron */15) ──POST /api/reconcile (X-Reconcile-Key)──┘ (red de seguridad)
```

- **Registro**: KV `payment:<id>` — `{status: open|fulfilled|final|…}`, TTL 7 días.
  Se escribe ANTES de entregar `checkout_url` (fail closed).
- **Callback verificado**: HMAC-SHA256 sobre `timestamp.rawBody`, comparación
  timing-safe, ventana ±5 min, timestamps en **ms o s** (el hub envía ms aunque
  el doc diga s). Dedup por `X-Mipago-Event-Id`.
- **Compuerta de monto**: el callback solo cumple si `amount === plans.js`.
  Divergencia → registro `amount_mismatch` + alerta email, sin entrega.
- **Fulfillment**: transición KV `open→fulfilled` + email al owner y al cliente
  (Resend). Declined/error → registro final, nunca se cumple.
- **Estado/cancel proxys sanitizados** (sin datos del comprador al navegador).

## Puesta en marcha

> **Estado (2026-10-12):** worker desplegado y armado excepto por la key del
> hub — KV creado y vinculado, secretos `MIPAGO_CALLBACK_SECRET`,
> `RECONCILE_KEY` y `RESEND_API_KEY` seteados, `MIPAGO_ENABLED=false` a la
> espera del tenant. Provisión del tenant en el hub + pasos restantes:
> **`hub-setup/README.md`**.

### 1. KV + secrets (dashboard → Encrypt, o wrangler)

```bash
npx wrangler kv namespace create PAYMENTS_KV   # pegar el id en wrangler.toml
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put MIPAGO_API_KEY          # key del tenant (staging primero)
npx wrangler secret put MIPAGO_CALLBACK_SECRET  # 64-hex
npx wrangler secret put RECONCILE_KEY           # aleatorio; mismo valor en GitHub secret
npx wrangler deploy
```

Variables ya en `wrangler.toml`: `MIPAGO_ENABLED` (flip a `"true"` al final),
`MIPAGO_API_URL` (staging → prod), `SITE_URL`.

### 2. Prerrequisitos del lado del hub / operador (NO están en este repo)

1. **Wompi events URL** por entorno (comercios.wompi.co):
   staging `https://staging.mipago.online/webhooks/wompi`,
   prod `https://mipago.online/webhooks/wompi`. Sin registro no hay webhooks
   → no hay callbacks, nunca.
2. **Ruta custom domain para el callback**: el hub es un Worker y NO puede
   alcanzar `*.workers.dev` (error 1042 del edge). Registrar en el hub:
   `https://salvia.digital/api/payments/callback` y descomentar `routes` en
   `wrangler.toml` (la zona salvia.digital debe estar en la cuenta).
   El navegador sí puede usar workers.dev — por eso el create/status van por ahí.
3. **Sincronizar `callback_secret`**: `tenants.callback_secret` (D1 del hub)
   DEBE igualar `MIPAGO_CALLBACK_SECRET`. Divergencia = 401 silencioso 24 h.
4. `allowed_origins_json` del tenant debe incluir `https://salvia.digital`
   (también valida el `return_url`).

### 3. Checklist sandbox (staging, correr TODO en vivo)

| # | Prueba | Pasa si |
|---|---|---|
| 1 | Crear pago | `/api/payments/create` devuelve `checkout_url` en ~1 s |
| 2 | Abrir `checkout_url` | Redirect a checkout.wompi.co, banner "MODO DE PRUEBAS", monto correcto |
| 3 | Pagar `4242 4242 4242 4242` | "¡Pago aprobado!" y el proxy de estado devuelve `APPROVED` |
| 4 | Callback genuino | KV `fulfilled`, emails owner+cliente, `tenant_callbacks` delivered |
| 5 | Pagar `4111 1111 1111 1111` | `DECLINED` en ambas capas; registro intacto |
| 6 | Reenvío dedup | Mismo `X-Mipago-Event-Id` → 200 corto, sin doble fulfill |
| 7 | Firma alterada | 401, cero efectos |
| 8 | Link expirado | `EXPIRED` tras TTL + cron; UI amable |
| 9 | Cancelar | create → cancel → `CANCELLED` |

### 4. Gates de go-live (en orden)

1. Checklist 9/9 en staging.
2. Rotar todo secreto que haya tocado un log; re-sincronizar el D1 del hub.
3. Chequear tenant-row en el D1 de PRODUCCIÓN (callback_url, origins, secreto).
4. Limpiar artefactos sandbox (pagos de prueba).
5. `MIPAGO_API_URL=https://mipago.online` + key prod + `MIPAGO_ENABLED="true"`
   → **redeploy** (env vars aplican por despliegue).
6. Smoke: un pago real mínimo end-to-end.

## Tests locales

```bash
node test/payments.test.mjs   # 15/15: fail-closed, HMAC ms/s, dedup, monto, reconcile…
```

## Notas

- `MIPAGO_ENABLED=false` (default): el create responde 503 `payments_disabled`
  y la UI invita a WhatsApp — se puede desplegar sin riesgo antes de configurar.
- El worker tenía un bug latente de CORS (sin handler OPTIONS, el preflight
  del formulario con JSON fallaba). Ahora todas las rutas responden preflight.
- Emails: owner `juan.manuelcano@live.com`, from `noreply@salvia.digital` (vía Resend).
