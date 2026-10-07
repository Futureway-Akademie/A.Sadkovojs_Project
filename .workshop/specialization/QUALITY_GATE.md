# Quality Gate

Das Quality Gate ergänzt den zentralen Workshop-Workflow und darf ihn nicht überschreiben.

## Vor jedem Task-Abschluss

```bash
npm run lint
npm run typecheck
npm run build
```

Alle drei Befehle müssen ohne Fehler durchlaufen.

## Zusätzlich je nach Task

- Datenbank-Tasks: `supabase db reset` wendet alle Migrationen an; `npm run test:db` läuft erfolgreich.
- Berechtigungs-Tasks: Prüfung über direkte API-/Datenbankzugriffe mit verschiedenen Rollen (`npm run test:api`), nicht nur über die Oberfläche.
- UI-Tasks: Sichtprüfung bei ca. 390×844, 768×1024 und 1440×900 ohne horizontales Scrollen bei Kernaktionen.
- Website-Änderungen: öffentliche Seiten und `/api/service-request` verhalten sich unverändert.

Nicht ausgeführte Prüfungen werden in `verification` ausdrücklich als solche benannt.
