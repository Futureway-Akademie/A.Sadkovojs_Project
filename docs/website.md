# Website: RheinWerk Industrieservice

> Übernommen aus `FuzzCube/rheinwerk-industrieservice` (Commit `39d9936`) ohne Git-Historie. Pfade beziehen sich auf das Repository-Root.


Vollständige Version der ursprünglichen Website auf Basis von Next.js 16, App Router, TypeScript und Tailwind CSS. Die ursprünglichen HTML-Referenzdateien wurden nicht übernommen; die CSS-Tokens des ursprünglichen Designsystems liegen unter `_ds/` und werden direkt von der Anwendung verwendet.

## Implementiert

- Sämtliche Seiten, die Navigation, das mobile Menü, responsive Zustände und der Informationsassistent.
- Ein fünfstufiges deutsches Formular mit Speicherung des Entwurfs in `sessionStorage`.
- Prüfung der Pflichtfelder auf Client- und Serverseite mit einer Liste der zu korrigierenden Felder.
- Deterministisches `human_review: true` bei Produktionsstillstand sowie bei Sicherheitsgefahr `Ja` oder `Unklar`.
- Make-Antworten `201`, `400` und `409`; ein erneutes Absenden wird als bereits erfolgreich übermittelt angezeigt.
- Bis zu drei private PDF-, JPG- oder PNG-Dateien mit jeweils maximal 5 MB über Vercel Blob.
- Cloudflare Turnstile, grundlegende Ratenbegrenzung für Anfragen und Uploads sowie ein Server-Proxy zu Make.

## Lokaler Start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Prüfungen:

```bash
npm run lint
npm run typecheck
npm run build
```

Der Production-Build verwendet Webpack, da Turbopack in isolierten Umgebungen versuchen kann, einen internen Dienstport zu öffnen.

## Umgebungsvariablen

Übernehmen Sie die Werte aus [.env.example](../.env.example):

- `MAKE_WEBHOOK_URL`: URL des Custom Webhooks in Make.
- `MAKE_API_KEY`: optional; wird von Make im Header `x-make-apikey` erwartet.
- `BLOB_READ_WRITE_TOKEN`: wird beim Verbinden von Vercel Blob mit dem Projekt erstellt.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: öffentlicher Cloudflare-Turnstile-Schlüssel.
- `TURNSTILE_SECRET_KEY`: geheimer Cloudflare-Turnstile-Schlüssel.

Dieselben Variablen müssen in Vercel unter `Project Settings > Environment Variables` hinterlegt werden. Geheimnisse dürfen nicht mit `NEXT_PUBLIC_` beginnen.

## Vertrag mit Make

Der Browser sendet JSON ausschließlich an `/api/service-request`. Der Server prüft das Formular und Turnstile, erstellt temporäre Links für private Dateien, entfernt das Turnstile-Token und leitet die Anfrage an Make weiter.

Wichtige Anfragefelder:

```json
{
  "schema_version": "1.0",
  "submission_id": "uuid",
  "source": "rheinwerk_website_service_request",
  "locale": "de-DE",
  "submitted_at": "ISO-8601",
  "contact": {},
  "site_and_equipment": {},
  "request": {
    "service_type": "inspection",
    "preferred_service_date": "2026-09-10",
    "requires_human_review": false
  },
  "contract_and_attachments": {
    "attachments": [
      {
        "file_name": "foto.jpg",
        "pathname": "service-requests/uuid/foto-random.jpg",
        "mime_type": "image/jpeg",
        "size_bytes": 123456,
        "upload_status": "uploaded",
        "download_url": "temporärer privater Link"
      }
    ]
  },
  "privacy_consent": true
}
```

Der temporäre Dateilink ist eine Stunde lang gültig. Make muss die Datei innerhalb dieses Zeitraums zur Klassifizierung herunterladen. Der Blob bleibt privat.

Am Ende des Make-Szenarios wird ein `Webhook response`-Modul benötigt, das eine der vereinbarten Antworten zurückgibt:

```json
// HTTP 201
{
  "status": "created",
  "ticket_key": "KEY-123",
  "human_review": false
}
```

```json
// HTTP 400
{
  "status": "invalid",
  "message": "Required fields are missing or privacy consent was not given."
}
```

```json
// HTTP 409
{
  "status": "duplicate",
  "message": "This service request has already been submitted."
}
```

Bei einer kritischen Anfrage setzt der Server selbst `request.requires_human_review: true` und verhindert, dass eine `201`-Antwort diesen Wert wieder auf `false` ändert.

## Wo sich die Logik befindet

- [app/[[...slug]]/page.tsx](../app/[[...slug]]/page.tsx): Seiten-Routing.
- [components/pages.tsx](../components/pages.tsx): Inhalte der wichtigsten Seiten.
- [components/service-form.tsx](../components/service-form.tsx): Formular, Fehler, Datei-Uploads und Verarbeitung von `201/400/409`.
- [app/api/service-request/route.ts](../app/api/service-request/route.ts): Prüfung, Turnstile, temporäre Blob-Links und Proxy zu Make.
- [app/api/upload/route.ts](../app/api/upload/route.ts): Berechtigungen für direkte Uploads in Vercel Blob.
- [lib/form-contract.ts](../lib/form-contract.ts): TypeScript-Vertrag und serverseitige Validierung.
- [app/globals.css](../app/globals.css): Übertragenes Designsystem und responsive Layouts.

## Vor dem Production-Einsatz

Das aktuelle Anfrage-Limit wird im Speicher einer separaten Serverless-Funktion gehalten und eignet sich als zusätzliche Schutzschicht für eine kleine Demo. Für ein gemeinsames Limit über alle Instanzen hinweg sollte Vercel Firewall oder ein externer Limit-Speicher verwendet werden. Legen Sie außerdem eine Aufbewahrungsfrist für Blob-Dateien fest und löschen Sie sie nach der Klassifizierung oder dem Abschluss der Prüfung entsprechend der Datenschutzrichtlinie.
