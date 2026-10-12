# Hub-side provisioning runbook (operator)

Tenant provisioning + credential minting for the salviadigital rail, plus the
live status matrix. The salvia worker lives in a *different* Cloudflare
account than the hub — hub-side changes go through the hub repo.

## Status (2026-10-12 — LIVE, end to end)

| Piece | State |
|---|---|
| Landing **salvia.digital** | ✅ **LIVE** — Precios section with 4 payable services (GitHub Pages, pushed via `gh` token) |
| `salvia-form` worker | ✅ **PRODUCTION** — `MIPAGO_ENABLED=true`, hub `https://mipago.online` |
| Hub tenant `salviadigital` | ✅ staging **and production** (prefix **SV**, own callback secret per env) |
| Worker secrets | ✅ `MIPAGO_API_KEY` (sv **prod**), `MIPAGO_CALLBACK_SECRET` (prod tenant), `RECONCILE_KEY` (rotated), `RESEND_API_KEY` |
| Prod chain verified | ✅ create → `SV-…` on mipago.online → hosted checkout renders Salviadigital + COP amounts + Wompi → cancel finalizes KV |
| Security probes | ✅ callback sig 200 prod secret / 401 wrong · reconcile 200 rotated key |
| Reconcile cron | ✅ **ops-box crontab** `*/15` (`/root/salvia-reconcile.sh`) — the GitHub workflow was parked (push token lacks `workflow` scope); reference copy in `hub-setup/reconcile-workflow.yml.reference` |
| creds.env | ✅ `#Salvia_Mipago_Api_Key_Production`/`_Staging`, `#Salvia_Mipago_Callback_Secret` (prod)/`_Staging` |
| First real charge | ⏳ recommended smoke: minimum real payment end to end |
| Callback URL registration | ⛔ `salvia.digital` zone not on Cloudflare — reconcile cron fulfills (15-min cadence) |

## Landing deployment (salvia.digital = GitHub Pages)

Pushed with the `gh` CLI token on the ops box (the fine-grained PATs lack
Contents:write; the .env `GITHUB_TOKEN` value is a dead duplicate — regenerate
if you want token-based pushes). NOTE: that `gh` token lacks `workflow` scope,
so `.github/workflows/*` cannot be pushed with it — the reconcile workflow is
parked at `hub-setup/reconcile-workflow.yml.reference`; to restore it, run
`gh auth refresh -s workflow`, re-add the file, push, and set the
`RECONCILE_KEY` repo secret (the ops-box cron covers fulfillment meanwhile).

## Minting more keys (the reusable pattern)

`mint-tenant-key.yml` on the hub repo dispatches
`scripts/provision-tenant.mjs` (full provision if the tenant is missing,
`--new-key` otherwise) and returns raw values **RSA-OAEP-encrypted** to a
public key you supply — nothing sensitive ever hits logs or dispatch inputs:

```bash
# 1. generate a keypair locally (keep the private key!)
node -e "const{generateKeyPairSync}=require('crypto');const{publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:4096});require('fs').writeFileSync('m.pem',privateKey.export({type:'pkcs8',format:'pem'}));console.log(publicKey.export({type:'spki',format:'der'}).toString('base64'))"
# 2. dispatch from the hub repo (Actions → mint-tenant-key → Run workflow),
#    paste the base64 public key; staging first, production after 9/9
# 3. decrypt the ENCRYPTED_*_B64 lines from the run log with your private key
# 4. set them as worker secrets, delete the run + local material
```

## Sandbox card pass (the remaining manual step)

Open https://salvia.digital → Precios → any service → pay
**4242 4242 4242 4242** (any future expiry, any CVC) → expect approval, the
site's confirmation screen, and reconcile-driven fulfillment emails.
**4111 1111 1111 1111** → declined path. Until the repo is pushed and the
`reconcile-payments` cron runs, trigger reconciliation manually:

```bash
curl -X POST https://salvia-form.saviadigital.workers.dev/api/reconcile \
  -H "X-Reconcile-Key: $(awk '/^#MIPAGO_RECONCILE_KEY/{getline; print; exit}' ~/powerhouse-web/creds.env)"
```

## Callback zone decision (still open)

Instant signed callbacks need the API on a custom domain the hub can reach
(never `*.workers.dev` — edge error 1042). When `salvia.digital` moves onto
Cloudflare: uncomment `routes` in `wrangler.toml`, deploy, then on the hub:

```sql
UPDATE tenants SET callback_url = 'https://salvia.digital/api/payments/callback',
                    updated_at = <ms> WHERE id = 'salviadigital';
```

Until then: payments complete via the status API + reconcile — fulfillment
is cron-cadence, not instant.

## Go-live (after sandbox 9/9)

1. Dispatch `mint-tenant-key` with `environment=production` (full provision —
   the prod tenant doesn't exist yet; the fresh prod secret comes back
   encrypted → set it as the worker's `MIPAGO_CALLBACK_SECRET`).
2. Worker: `MIPAGO_API_URL=https://mipago.online`, prod key, deploy.
3. One real minimum payment end-to-end.
4. Push this repo to GitHub + set the `RECONCILE_KEY` secret so the
   `reconcile-payments` cron takes over.
