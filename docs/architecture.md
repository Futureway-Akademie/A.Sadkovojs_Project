# Architektur

## Überblick

- **Frontend und Server:** Next.js 16 (App Router) im Repository-Root. Öffentliche Website und Mitarbeiterbereich `/dashboard` werden über Route Groups getrennt.
- **Daten:** Supabase Postgres mit 13 Kerntabellen (`profiles`, `requests`, `messages`, `visits`, `work_entries`, `invoices`, `invoice_items`, `attachments`, `request_events`, `automation_runs`, `service_rates`, `employee_availability`, `settings`).
- **Berechtigung:** Supabase Auth; Rolle und Aktivstatus in `profiles`; Durchsetzung über RLS und kontrollierte RPC-Funktionen. Ausgeblendete UI-Elemente gelten nicht als Berechtigung.
- **Dateien:** privater Supabase-Storage-Bucket für Dashboard-Dateien; Website-Formularanhänge bleiben vorerst in Vercel Blob.
- **Integrationen:** Website-Formular → Make (bestehend, unverändert). n8n und Gmail folgen in einer späteren Stufe; der Vertrag wird in Phase 9 dokumentiert.

## Supabase-Anbindung

| Datei | Zweck |
| --- | --- |
| `lib/supabase/client.ts` | Browser-Client (Publishable Key, Sitzung aus Cookies) |
| `lib/supabase/server.ts` | Server-Client für Server Components, Server Actions und Route Handler; handelt mit den Rechten des angemeldeten Nutzers (RLS greift). Pro Anfrage neu erzeugen. |
| `lib/supabase/admin.ts` | Admin-Client mit `SUPABASE_SECRET_KEY`; umgeht RLS. `server-only`, nur für kontrollierte Serveroperationen und Skripte. |
| `lib/supabase/proxy.ts`, `proxy.ts` | Next.js-16-Proxy: erneuert die Sitzung und schreibt Cookies samt `Cache-Control: private, no-store`. Läuft nur auf `/dashboard`, `/login` und `/auth/*`. |
| `lib/supabase/env.ts` | Liest und prüft die Umgebungsvariablen. |

Der Proxy schützt keine Routen. Zugriffskontrolle erfolgt im Dashboard-Layout (task-4-1) und in der Datenbank (RLS).

Entwicklung gegen den lokalen Supabase-Stack (`supabase start`, Docker). Schemaänderungen ausschließlich als Migrationen unter `supabase/migrations/`. Verbindungsprüfung: `npm run supabase:check`.

Details werden mit den jeweiligen Tasks ergänzt.
