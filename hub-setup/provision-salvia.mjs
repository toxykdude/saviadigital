#!/usr/bin/env node
// Provision the "salviadigital" tenant on the mipago.online hub and mint its
// API key. Follows the hub's own scheme exactly (src/auth/api-keys.ts):
//   raw key  = "sv_live_" + base64url(24 random bytes)
//   key_hash = sha256("mipago:v1:" + rawKey)   ← only the hash is stored
//
// RUN FROM THE mipago.online REPO ROOT (needs wrangler + hub Cloudflare auth):
//   MIPAGO_CALLBACK_SECRET=<64-hex> node <this-script>/provision-salvia.mjs --staging
//   (omit --staging for production — mirrors the hub's env conventions)
//
// Modes:
//   default      create tenant (if missing) + mint key
//   --new-key    tenant exists → mint an additional key only (rotation)
//
// The callback_secret MUST equal the salvia-form worker's MIPAGO_CALLBACK_SECRET
// secret (currently the value from ~/powerhouse-web/creds.env).

import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const STAGING = args.includes('--staging');
const NEW_KEY_ONLY = args.includes('--new-key');
const ENV = STAGING ? 'staging' : 'production';
const DB = STAGING ? 'mipago-db-staging' : 'mipago-db';
const ENV_ARGS = STAGING ? ['--env', 'staging'] : [];

const secret = process.env.MIPAGO_CALLBACK_SECRET;
if (!secret || !/^[0-9a-f]{64}$/.test(secret)) {
  console.error('Refusing to run: MIPAGO_CALLBACK_SECRET must be a 64-hex string in the environment.');
  console.error('E.g.: MIPAGO_CALLBACK_SECRET=$(grep -A1 \'#Mipago_Callback_Secret\' ~/powerhouse-web/creds.env | tail -1) node ...');
  process.exit(1);
}

const now = Date.now();
const esc = (s) => s.replace(/'/g, "''");

function d1(sql) {
  // --json keeps output machine-parseable; --remote targets the real D1.
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', DB, ...ENV_ARGS, '--remote', '--json', '--command', sql], { encoding: 'utf8' });
  return JSON.parse(out);
}

// callback_url stays NULL until salvia.digital lives on Cloudflare with the
// /api/* workers route (hub Workers cannot reach *.workers.dev — error 1042).
// Until then the salvia-form reconcile cron is the fulfillment path; set it
// later with the UPDATE in hub-setup/README.md.
const TENANT_SQL = `INSERT INTO tenants (id, slug, name, reference_prefix, status, branding_json, allowed_origins_json, callback_url, callback_secret, created_at, updated_at)
VALUES ('salviadigital', 'salviadigital', 'Salviadigital', 'SV', 'active',
  '{"name":"Salviadigital","primary_color":"#2CF59B","secondary_color":"#060809","background_color":"#060809"}',
  '["https://salvia.digital","https://www.salvia.digital"]',
  NULL, '${esc(secret)}', ${now}, ${now});`;

function mintKeySql() {
  const raw = `sv_live_${randomBytes(24).toString('base64url')}`;
  const keyHash = createHash('sha256').update(`mipago:v1:${raw}`).digest('hex');
  const id = `key_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const sql = `INSERT INTO api_keys (id, tenant_id, key_hash, name, prefix_hint, status, created_at)
VALUES ('${id}', 'salviadigital', '${keyHash}', '${STAGING ? 'staging' : 'production'}', 'sv_live_', 'active', ${now});`;
  return { raw, sql };
}

const existing = d1(`SELECT id, reference_prefix FROM tenants WHERE id = 'salviadigital' OR reference_prefix = 'SV';`);
if (existing[0]?.results?.length && !NEW_KEY_ONLY) {
  console.error('Tenant "salviadigital" (or prefix SV) already exists on ' + ENV + '. Re-run with --new-key to mint another key.');
  process.exit(1);
}
if (!existing[0]?.results?.length && NEW_KEY_ONLY) {
  console.error('Tenant does not exist yet on ' + ENV + ' — run without --new-key first.');
  process.exit(1);
}

if (!NEW_KEY_ONLY) {
  d1(TENANT_SQL);
  console.log(`✓ tenant "salviadigital" created on ${ENV} (prefix SV, origins salvia.digital, callback_url NULL)`);
}

const { raw, sql } = mintKeySql();
d1(sql);
console.log(`✓ api key stored on ${ENV} (hash only, as designed)`);
console.log('\n=== API KEY (' + ENV + ') — show once, store as a secret immediately ===');
console.log(raw);
console.log('====================================================================');
console.log(`
Next, on the salviadigital side (any machine with the salvia account token):
  # 1. store the key on the worker (dashboard → Encrypt, or):
  npx wrangler secret put MIPAGO_API_KEY   # paste the key above
  # 2. arm payments against the ${STAGING ? 'staging' : 'production'} hub and redeploy:
  #    wrangler.toml → MIPAGO_ENABLED = "true"${STAGING ? '' : '\n#    MIPAGO_API_URL = "https://mipago.online"'}
  npx wrangler deploy
  # 3. sanity: curl https://salvia-form.saviadigital.workers.dev/api/health
`);
