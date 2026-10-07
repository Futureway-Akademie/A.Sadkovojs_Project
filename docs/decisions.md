# Entscheidungen

## 2026-10-07 – Website-Code im Workshop-Repository

### Kontext

Das Workshop-Repository enthielt nur die Workshop-Struktur; die Website liegt als separates Projekt vor.

### Entscheidung

Der Website-Code wird ohne Git-Historie in dieses Repository übernommen (Quelle `FuzzCube/rheinwerk-industrieservice`, Commit `39d9936`) und das Dashboard im selben Next.js-Projekt unter `/dashboard` umgesetzt.

### Begründung

Die Spezifikation verlangt das Dashboard im bestehenden Website-Projekt; Fortschritt soll zugleich im Workshop-Dashboard sichtbar sein.

## 2026-10-07 – Markenname RheinWerk

### Kontext

Die Spezifikation nennt „Rheinberg Industry Service“, Website und Designsystem verwenden „RheinWerk Industrieservice“.

### Entscheidung

Das Dashboard verwendet den Namen und das Designsystem von RheinWerk.

### Begründung

Einheitliches Erscheinungsbild mit der bestehenden Website.

## 2026-10-07 – Formularpfad bleibt bei Make

### Kontext

Das Formular leitet Anfragen derzeit über `/api/service-request` an Make weiter; die Spezifikation beschreibt eine künftige n8n-Anbindung und verbietet eine vorläufige direkte Speicherung in Supabase.

### Entscheidung

Der bestehende Pfad bleibt unverändert. Der n8n-Ein-/Ausgabevertrag wird nur dokumentiert.

### Begründung

Vorgabe der Spezifikation; die Umstellung gehört zu einer späteren Stufe.

## 2026-10-07 – Entwicklung gegen lokales Supabase

### Kontext

Für die Supabase-Anbindung wird ein Projekt benötigt. Ein Cloud-Projekt ist noch nicht verknüpft; die Supabase CLI und Docker sind lokal vorhanden.

### Entscheidung

Entwicklung gegen den lokalen Supabase-Stack. Alle Schemaänderungen, RLS-Richtlinien und Storage-Buckets entstehen ausschließlich als Migrationen unter `supabase/migrations/`, keine manuellen Änderungen über Studio. Demo-Nutzer werden per Skript angelegt. Die spätere Übernahme in ein Cloud-Projekt erfolgt über `supabase link` und `supabase db push`.

### Begründung

Schnelle, kostenlose und jederzeit zurücksetzbare Entwicklung (`supabase db reset`); Migrationen halten lokale und spätere Cloud-Datenbank identisch.

## 2026-10-07 – Proxy erneuert nur die Sitzung

### Kontext

Next.js 16 ersetzt Middleware durch `proxy.ts`. Die Next.js-Dokumentation rät davon ab, Proxy als vollständige Autorisierungslösung zu verwenden.

### Entscheidung

`proxy.ts` erneuert ausschließlich die Supabase-Sitzungscookies und läuft nur auf `/dashboard`, `/login` und `/auth/*`. Weiterleitungen und Zugriffsschutz folgen serverseitig im Dashboard (task-4-1) und über RLS.

### Begründung

Öffentliche Website und `/api/service-request` bleiben unverändert und ohne zusätzlichen Auth-Aufruf; Berechtigungen werden dort durchgesetzt, wo sie nicht umgangen werden können.

## 2026-10-07 – RLS nur lesend, Schreiben über kontrollierte Operationen

### Kontext

Die Spezifikation verlangt Berechtigungen in der Datenbank, Prüfung der Elternzugehörigkeit, Statusübergänge und Audit-Ereignisse in derselben Transaktion.

### Entscheidung

RLS-Richtlinien gewähren nur `SELECT`. Client-Rollen erhalten keine Schreibrechte auf Tabellen; alle Änderungen erfolgen über `security definer`-Funktionen (Phase 2). Zugriffs-Hilfsfunktionen liegen im nicht exponierten Schema `private`. Dispatcher sehen fremde Einsätze nur über `technician_busy_intervals`.

### Begründung

Schreibregeln (Übergänge, Audit, Nebenläufigkeit) lassen sich in Funktionen vollständig und atomar prüfen; Insert-/Update-Richtlinien könnten diese Regeln nicht abbilden und würden direkte API-Umgehungen ermöglichen.
