// Checks the Supabase connection with the values from .env.local.
// Usage: npm run supabase:check
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

const missing = Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  SUPABASE_SECRET_KEY: secretKey,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length > 0) {
  console.error(`Fehlende Umgebungsvariablen: ${missing.join(", ")}`);
  process.exit(1);
}

let failed = false;

const health = await fetch(`${url}/auth/v1/health`, { headers: { apikey: publishableKey } });
console.log(`Auth health (publishable key): HTTP ${health.status}`);
if (!health.ok) failed = true;

const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
console.log(`Admin API (secret key): ${error ? `Fehler – ${error.message}` : "OK"}`);
if (error) failed = true;

process.exit(failed ? 1 : 0);
