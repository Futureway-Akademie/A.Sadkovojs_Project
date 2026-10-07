# Technische Rahmenbedingungen

Diese Rahmenbedingungen ergänzen den zentralen Workshop-Workflow und dürfen ihn nicht überschreiben.

- Next.js 16 weicht von älteren Versionen ab: vor Codeänderungen die Dokumentation unter `node_modules/next/dist/docs/` lesen (siehe `nextjs-agent-rules` in `AGENTS.md`). Cookie-Handling über die Proxy-Konvention.
- Der Formularpfad `/api/service-request` → Make bleibt unverändert. Keine direkte Speicherung des Formulars in Supabase in dieser Stufe.
- Keine Geheimnisse im Repository. `.env.local` ist ignoriert; `.env.example` enthält nur Variablennamen ohne Werte. Service-Role-Schlüssel nur serverseitig.
- Berechtigungen werden in der Datenbank (RLS) und in kontrollierten Serveroperationen durchgesetzt; ausgeblendete UI-Elemente sind keine Berechtigung.
- Supabase ist der einzige Datenspeicher des Dashboards; kein localStorage-Ersatz.
- Kein echter E-Mail-Versand; n8n und Gmail werden nicht angebunden.
- Dashboard-Oberfläche auf Deutsch, Formatierung `de-DE`, Zeitzone `Europe/Berlin`.
- Neue Abhängigkeiten nur bei Bedarf und nach Prüfung der Kompatibilität mit React 19 / Next.js 16.
