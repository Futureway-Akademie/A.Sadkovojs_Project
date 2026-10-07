# Projektbrief

## Projektname

RheinWerk Service-Dashboard

## Idee / Problem

Serviceanfragen der RheinWerk-Website werden bisher nur an Make weitergeleitet und nirgends dauerhaft verwaltet. Es fehlen Erstbearbeitung, Einsatzplanung, Arbeitserfassung, Rechnungsstellung und Auswertung. Das Projekt ergänzt einen geschützten Mitarbeiterbereich unter `/dashboard` mit Supabase als Datenspeicher. Es handelt sich um ein Demonstrationsprojekt für ein fiktives Unternehmen.

Grundlage ist die Spezifikation `rheinberg-dashboard-prompt-en.md` (liegt außerhalb des Repositorys und ist nicht versioniert).

## Zielgruppe

Mitarbeitende eines Industrieservice-Unternehmens in vier Rollen: Admin, Manager, Dispatcher, Techniker.

## Zielplattform

Webanwendung im bestehenden Next.js-Projekt, responsiv für Smartphone (ca. 390 px), Tablet und Desktop. Oberfläche auf Deutsch.

## Kernfunktionen

- Anmeldung über Supabase Auth; Konten nur durch Admins, keine öffentliche Registrierung.
- Rollenbasierte Berechtigungen per RLS und kontrollierten Serveroperationen.
- 13 Kerntabellen mit Statusmodell für Erstbearbeitung, Arbeit, Einsätze und Rechnungen sowie append-only Audit-Ereignissen.
- Dispatcher: Prüfung, Korrektur, E-Mail-Entwürfe, Ablehnung, Einsatzplanung mit Konfliktprüfung.
- Techniker: eigene Einsätze, Wochenkalender, Zeit-/Teile-/Berichtserfassung, Abschluss der Anfrage, Rechnung mit PDF.
- Manager: KPIs mit Periodenvergleich, Aufmerksamkeitsliste, Teamübersicht, Finanzen, Diagramme, Automatisierungskennzahlen.
- Admin: Mitarbeitende, Rollen, Tarife, Arbeitszeiten, Einstellungen.
- Reproduzierbare Demodaten (ca. 600 Anfragen über 24 Monate, 8 Mitarbeitende).

## Nicht-Ziele

- Anbindung von n8n und Gmail (nur Vertrag dokumentiert; kein echter E-Mail-Versand).
- Direkte Speicherung des Website-Formulars in Supabase in dieser Stufe.
- Eigenes CRM, Lagerverwaltung oder Buchhaltungssystem; Gutschriften.
- Rechtlich oder steuerlich verbindliche Rechnungen.
- localStorage als Ersatz für Supabase.

## MVP

Funktionsfähiges `/dashboard` mit Anmeldung, allen vier Rollenansichten, Supabase-Migrationen inklusive RLS und RPCs, Demodaten-Seed, Rechnungs-PDF und Manager-Analytik auf Datenbankdaten.

## Definition of Done

- `npm run lint`, `npm run typecheck` und `npm run build` laufen erfolgreich.
- Berechtigungen werden in der Datenbank (RLS, RPC) erzwungen, nicht nur in der Oberfläche.
- Keine Geheimnisse im Repository; `.env.example` enthält nur Namen.
- Oberfläche auf Deutsch, Datums- und Betragsformat `de-DE`, Zeitzone `Europe/Berlin`.
- Kein Bereich behauptet einen tatsächlichen E-Mail-Versand.
- Nicht ausgeführte Prüfungen werden als solche benannt.

## Technische Rahmenbedingungen

- Next.js 16.3.4 (App Router), React 19.2.8, TypeScript, Tailwind CSS 4, lucide-react.
- RheinWerk-Designsystem (Navy, Blau, Lime, Warm-White) aus `_ds/`.
- Supabase (Postgres, Auth, Storage) mit `@supabase/ssr`; Next.js-16-Proxy für Cookies.
- Bestehender Formular-Proxy zu Make und Vercel Blob bleiben unverändert.
