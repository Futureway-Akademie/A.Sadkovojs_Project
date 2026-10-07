# Technischer Stack

Der technische Stack ergänzt den zentralen Workshop-Workflow und darf ihn nicht überschreiben.

## Installiert (Stand task-0-1)

- Next.js 16.3.4 (App Router), Build mit Webpack (`next build --webpack`)
- React 19.2.8, React DOM 19.2.8
- TypeScript 5.9, ESLint 9 mit `eslint-config-next` 16.3.4
- Tailwind CSS 4.3.3 über `@tailwindcss/postcss`
- lucide-react 1.40.0 (Icons)
- @vercel/blob 2.8.0 (private Formularanhänge)
- RheinWerk-Designsystem: CSS-Tokens unter `_ds/`, eingebunden über `app/globals.css`

## Supabase (Stand task-0-2)

- `@supabase/ssr` 0.12.7, `@supabase/supabase-js` 2.117.2, `server-only` 0.0.1
- Lokaler Stack über Supabase CLI 2.120.0 (Docker): API `http://127.0.0.1:54321`, Studio `http://127.0.0.1:54323`
- Umgebungsvariablen: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`

## Geplant

- Kalender- und Diagrammbibliothek: Auswahl in den jeweiligen Tasks nach Prüfung der React-19-Kompatibilität

## Externe Dienste

- Make: Webhook für das Website-Formular (bestehend)
- Cloudflare Turnstile: Bot-Schutz des Formulars
- Vercel: Hosting und Blob-Speicher
