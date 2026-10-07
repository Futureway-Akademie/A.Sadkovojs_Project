// Creates or updates the demo staff through the Supabase Auth Admin API (no direct writes to auth tables).
// Usage: npm run demo:users
//
// * Password comes from DEMO_USER_PASSWORD (.env.local), never from the repository.
// * Idempotent: existing demo users are updated, not duplicated.
// * Only users marked with app_metadata.demo_seed = DEMO_SEED_OWNER are touched; a live user with the same
//   e-mail address is reported and left unchanged.
// * createUser with email_confirm: true sends no invitation or confirmation e-mail.
// * Remote projects require DEMO_BOOTSTRAP_ALLOW_REMOTE=1.
import { createClient } from "@supabase/supabase-js";
import { DEMO_SEED_OWNER, DEMO_STAFF } from "./demo/staff.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const password = process.env.DEMO_USER_PASSWORD;

if (!url || !secretKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL und SUPABASE_SECRET_KEY werden benötigt.");
  process.exit(1);
}
if (!password || password.length < 12) {
  console.error("DEMO_USER_PASSWORD fehlt oder ist kürzer als 12 Zeichen (in .env.local setzen).");
  process.exit(1);
}
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url);
if (!isLocal && process.env.DEMO_BOOTSTRAP_ALLOW_REMOTE !== "1") {
  console.error(`Abbruch: ${url} ist kein lokaler Stack. Für ein Remote-Projekt DEMO_BOOTSTRAP_ALLOW_REMOTE=1 setzen.`);
  process.exit(1);
}

const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserByEmail(email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Nutzer konnten nicht gelesen werden: ${error.message}`);
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 200) return null;
  }
}

console.log(`Demo-Nutzer für ${url}\n`);
const results = [];
let conflicts = 0;

for (const member of DEMO_STAFF) {
  const existing = await findUserByEmail(member.email);
  let userId;
  let action;

  if (!existing) {
    const { data, error } = await admin.auth.admin.createUser({
      email: member.email,
      password,
      email_confirm: true,
      app_metadata: { demo_seed: DEMO_SEED_OWNER },
      user_metadata: { display_name: member.displayName },
    });
    if (error) throw new Error(`${member.email}: ${error.message}`);
    userId = data.user.id;
    action = "angelegt";
  } else if (existing.app_metadata?.demo_seed !== DEMO_SEED_OWNER) {
    console.error(`! ${member.email} existiert bereits ohne Demo-Kennzeichnung – nicht verändert.`);
    conflicts += 1;
    continue;
  } else {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      ban_duration: "none",
      user_metadata: { display_name: member.displayName },
    });
    if (error) throw new Error(`${member.email}: ${error.message}`);
    userId = existing.id;
    action = "aktualisiert";
  }

  const { error: profileError } = await admin
    .from("profiles")
    .upsert({ id: userId, display_name: member.displayName, role: member.role, is_active: true }, { onConflict: "id" });
  if (profileError) throw new Error(`Profil ${member.email}: ${profileError.message}`);

  results.push({ rolle: member.role, name: member.displayName, email: member.email, status: action });
}

console.table(results);
if (conflicts > 0) {
  console.error(`${conflicts} E-Mail-Adresse(n) gehören nicht zum Demo-Seed. Bitte isolierte Demo-Umgebung verwenden.`);
  process.exit(1);
}
console.log("Anmeldung mit den E-Mail-Adressen oben und dem Passwort aus DEMO_USER_PASSWORD.");
