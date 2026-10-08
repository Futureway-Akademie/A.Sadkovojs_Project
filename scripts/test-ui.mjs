// Browser checks of the dashboard UI in headless Chrome over the DevTools protocol (task-4-2):
// - no horizontal scrolling at 390×844, 768×1024 and 1440×900 for the dashboard areas of every role
// - a failed save keeps all inputs (validation error and simulated version conflict), success shows the save state
// - review actions of the request page (task-5-2) against the database: correction, draft, queue, release,
//   version conflict, rejection; runs as a temporary dispatcher on its own test requests (local data stays, like test:api)
// Usage: npm run build && npm run start, then npm run test:ui
//   APP_URL (default http://localhost:3000), CHROME_PATH (default: Google Chrome on macOS),
//   UI_SCREENSHOTS=<dir> additionally stores a screenshot per page and width.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.UI_SCREENSHOTS;
const password = process.env.DEMO_USER_PASSWORD;
if (!password) {
  console.error("DEMO_USER_PASSWORD wird benötigt (Demo-Nutzer, npm run demo:users).");
  process.exit(1);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(BASE)) {
  console.error("Abbruch: test:ui läuft nur gegen eine lokale App.");
  process.exit(1);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : ` – ${detail}`}`);
  if (!ok) failures += 1;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const decode = (text) => text.replace(/&quot;/g, '"').replace(/&amp;/g, "&");

// Login over the real form (no JavaScript); returns the session cookies
async function loginCookies(email) {
  const jar = new Map();
  const keep = (response) => {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const index = pair.indexOf("=");
      jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  };
  const cookie = () => [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
  const page = await fetch(`${BASE}/login`, { redirect: "manual" });
  keep(page);
  const html = await page.text();
  const form = new FormData();
  for (const match of html.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)) form.append(decode(match[1]), decode(match[2] ?? ""));
  form.append("email", email);
  form.append("password", password);
  const response = await fetch(`${BASE}/login`, { method: "POST", body: form, headers: { cookie: cookie() }, redirect: "manual" });
  keep(response);
  if (response.status !== 303) throw new Error(`Login ${email} fehlgeschlagen (${response.status})`);
  return [...jar].filter(([, value]) => value !== "").map(([name, value]) => ({ name, value, url: BASE }));
}

// Minimal DevTools protocol client for one page
class Page {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners) listener(message);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  waitFor(method, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.listeners.delete(listener); reject(new Error(`Timeout ${method}`)); }, timeout);
      const listener = (message) => {
        if (message.method !== method) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(message.params);
      };
      this.listeners.add(listener);
    });
  }
  async eval(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "Auswertung fehlgeschlagen");
    return result.result.value;
  }
  async until(expression, timeout = 8000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await this.eval(expression)) return true;
      await sleep(100);
    }
    return false;
  }
  async open(url) {
    const loaded = this.waitFor("Page.loadEventFired");
    await this.send("Page.navigate", { url });
    await loaded;
    // Hydration and fonts
    await this.until("document.readyState === 'complete'");
    await sleep(300);
  }
}

const profile = await mkdtemp(path.join(tmpdir(), "rw-ui-"));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let page;
try {
  let target;
  for (let attempt = 0; attempt < 50 && !target; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((item) => item.type === "page");
    } catch {
      await sleep(200);
    }
  }
  if (!target) throw new Error(`Chrome nicht erreichbar (${CHROME}). CHROME_PATH setzen.`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve); socket.addEventListener("error", reject); });
  page = new Page(socket);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Network.enable");
  if (SHOTS) await mkdir(SHOTS, { recursive: true });

  const viewports = [
    { name: "390", width: 390, height: 844, mobile: true },
    { name: "768", width: 768, height: 1024, mobile: true },
    { name: "1440", width: 1440, height: 900, mobile: false },
  ];
  const roles = [
    { email: "admin.demo@example.com", pages: ["/dashboard/bausteine", "/dashboard/verwaltung", "/dashboard/uebersicht", "/dashboard/anfragen"] },
    { email: "manager.demo@example.com", pages: ["/dashboard/planung", "/dashboard/anfragen", "detail:/dashboard/anfragen?arbeit=completed", "detail:/dashboard/anfragen?erstbearbeitung=needs_review"] },
    { email: "dispo3.demo@example.com", pages: ["/dashboard/erstbearbeitung", "/dashboard/erstbearbeitung?tab=planung", "/dashboard/erstbearbeitung?tab=alle"] },
    { email: "technik1.demo@example.com", pages: ["/dashboard/heute", "/dashboard/kalender", "/dashboard/anfragen", "detail:/dashboard/anfragen", "einsatz:/dashboard/heute"] },
  ];

  console.log(`UI-Prüfung gegen ${BASE}\n\nKein horizontales Scrollen`);
  for (const role of roles) {
    await page.send("Network.clearBrowserCookies");
    await page.send("Network.setCookies", { cookies: await loginCookies(role.email) });
    for (const viewport of viewports) {
      await page.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
      for (const entry of role.pages) {
        // "detail:<list>" opens the first request of that list
        let pathname = entry;
        if (entry.startsWith("detail:") || entry.startsWith("einsatz:")) {
          const [kind, list] = [entry.slice(0, entry.indexOf(":")), entry.slice(entry.indexOf(":") + 1)];
          await page.open(`${BASE}${list}`);
          const selector = kind === "einsatz" ? ".visit-card__open" : ".data-table tbody a";
          pathname = await page.eval(`document.querySelector(${JSON.stringify(selector)})?.getAttribute("href") ?? ""`);
          if (!pathname) { check(`${role.email.split(".")[0]} ${entry}: keine Anfrage gefunden`, false); continue; }
        }
        await page.open(`${BASE}${pathname}`);
        const result = await page.eval(`({ path: location.pathname, scroll: document.documentElement.scrollWidth, width: window.innerWidth })`);
        check(`${role.email.split(".")[0]} ${pathname} @${viewport.name}`, result.path === pathname.split("?")[0] && result.scroll <= result.width, JSON.stringify(result));
        if (SHOTS) {
          const shot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
          await writeFile(path.join(SHOTS, `${role.email.split(".")[0]}-${entry.replace(/[^a-z0-9]+/gi, "_")}-${viewport.name}.png`), Buffer.from(shot.data, "base64"));
        }
      }
    }
  }

  console.log("\nEingaben bleiben bei fehlgeschlagenem Speichern erhalten");
  await page.send("Network.clearBrowserCookies");
  await page.send("Network.setCookies", { cookies: await loginCookies("admin.demo@example.com") });
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.open(`${BASE}/dashboard/bausteine`);
  const fill = (values) => page.eval(`(() => {
    const values = ${JSON.stringify(values)};
    for (const [name, value] of Object.entries(values)) {
      const element = document.querySelector('form.save-form [name="' + name + '"]');
      if (element.type === "checkbox") element.checked = value;
      else element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
  })()`);
  const read = () => page.eval(`(() => {
    const form = document.querySelector("form.save-form");
    const get = (name) => { const element = form.querySelector('[name="' + name + '"]'); return element.type === "checkbox" ? element.checked : element.value; };
    return {
      company: get("company"), hours: get("hours"), priority: get("priority"), note: get("note"), conflict: get("simulate_conflict"),
      invalid: [...form.querySelectorAll("[aria-invalid='true']")].map((element) => element.name),
      status: form.querySelector(".save-status")?.textContent ?? "",
      focused: document.activeElement?.name ?? null,
    };
  })()`);
  const submit = async (expectedClass) => {
    await page.eval(`document.querySelector("form.save-form").requestSubmit()`);
    return page.until(`!!document.querySelector("form.save-form .save-status.${expectedClass}") && !document.querySelector("form.save-form button[type=submit]").disabled`);
  };

  await fill({ company: "", hours: "abc", priority: "high", note: "Notiz bleibt stehen" });
  const unsaved = await read();
  check("Hinweis auf ungespeicherte Änderungen", unsaved.status.includes("Ungespeicherte Änderungen"), unsaved.status);
  check("Validierungsfehler wird angezeigt", await submit("save-status--error"));
  let state = await read();
  check("  Eingaben erhalten (Stunden, Priorität, Notiz)", state.hours === "abc" && state.priority === "high" && state.note === "Notiz bleibt stehen", JSON.stringify(state));
  check("  fehlerhafte Felder markiert, Fokus auf erstem Fehler", state.invalid.join(",") === "company,hours" && state.focused === "company", JSON.stringify(state));

  await fill({ company: "Muster Pumpentechnik GmbH", hours: "2,5", simulate_conflict: true });
  check("Versionskonflikt wird angezeigt", await submit("save-status--error"));
  state = await read();
  check("  Eingaben nach Konflikt erhalten", state.company === "Muster Pumpentechnik GmbH" && state.hours === "2,5" && state.priority === "high" && state.note === "Notiz bleibt stehen" && state.conflict === true, JSON.stringify(state));
  check("  Konfliktmeldung verständlich", /inzwischen .* geändert/.test(state.status), state.status);

  await fill({ simulate_conflict: false });
  check("Erfolgreiches Speichern zeigt Zeitpunkt", await submit("save-status--success"));
  state = await read();
  check("  Status „Gespeichert … HH:MM“, keine Fehlermarkierung", /Gespeichert .*\d{2}:\d{2}/.test(state.status) && state.invalid.length === 0, JSON.stringify(state));
  console.log("\nPrüfaktionen auf der Anfrageseite");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const runId = Date.now().toString(36);
  const dispoEmail = `ui-dispo-${runId}@example.com`;
  const { data: created } = await admin.auth.admin.createUser({ email: dispoEmail, password, email_confirm: true });
  const dispoId = created.user.id;
  await admin.from("profiles").insert({ id: dispoId, display_name: `UI-Test Dispatcher ${runId}`, role: "dispatcher" });
  const newRequest = async (key, overrides = {}) => {
    const { data, error } = await admin.from("requests").insert({
      source_event_key: `ui-${key}-${runId}`, request_number: "x", source: "demo_seed", is_demo: true,
      company_name: `UI-Test ${key}`, contact_name: "Erika Muster", business_email: `ui-${key}@example.com`, phone_number: "+49 211 1",
      street_house_number: "Werkstr. 1", postal_code: "40210", city: "Düsseldorf", equipment_kind: "pump", service_kind: "inspection",
      requested_visit_date: "2030-03-01", description: "UI-Test", customer_urgency: "zeitnah", safety_risk: "none_known",
      raw_payload: { test: runId }, dispatcher_id: dispoId, intake_status: "needs_review", human_review_required: true,
      ...overrides,
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  };
  const request = await newRequest("review");
  const startedAt = new Date(Date.now() - 120_000).toISOString();
  const { data: analysis, error: analysisError } = await admin.from("automation_runs").insert({ request_id: request.id, operation_key: `ui:${runId}`, step: "intake_analysis", status: "succeeded", decision: "human_review", started_at: startedAt, finished_at: new Date(Date.now() - 60_000).toISOString() }).select().single();
  if (analysisError) throw new Error(`Automatisierungslauf: ${analysisError.message}`);
  const dbRequest = async (id = request.id) => (await admin.from("requests").select("*").eq("id", id).single()).data;
  const waitFor = async (condition, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await condition()) return true; await sleep(150); }
    return false;
  };
  const actionForm = (summary) => `[...document.querySelectorAll("details.action")].find((d) => d.querySelector("summary").textContent.trim() === ${JSON.stringify(summary)})`;
  const fillIn = (formExpr, values) => page.eval(`(() => {
    const host = ${formExpr};
    if (host.tagName === "DETAILS") host.open = true;
    const form = host.tagName === "FORM" ? host : host.querySelector("form");
    for (const [name, value] of Object.entries(${JSON.stringify(values)})) {
      const element = form.querySelector('[name="' + name + '"]');
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
    form.requestSubmit();
  })()`);
  const formStatus = (formExpr) => page.eval(`(() => { const host = ${formExpr}; const form = host && (host.tagName === "FORM" ? host : host.querySelector("form")); return form ? { status: form.querySelector(".save-status")?.className + " " + form.querySelector(".save-status")?.textContent, values: Object.fromEntries([...form.querySelectorAll("input:not([type=hidden]), select, textarea")].map((e) => [e.name, e.value])), pending: form.querySelector("button[type=submit]").disabled } : null; })()`);
  const settled = async (formExpr, cls) => (await waitFor(async () => { const state = await formStatus(formExpr); return Boolean(state && !state.pending && state.status.includes(cls)); })) && formStatus(formExpr);

  await page.send("Network.clearBrowserCookies");
  await page.send("Network.setCookies", { cookies: await loginCookies(dispoEmail) });
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const requestUrl = `${BASE}/dashboard/anfragen/${request.id}`;
  await page.open(requestUrl);
  check("Aktionen für zugewiesenen Dispatcher sichtbar", await page.eval(`!!document.getElementById("aktionen")`));

  // Correction: missing reason keeps the chosen priority, then success marks the automation run
  await fillIn(actionForm("Analyse korrigieren"), { priority: "high", reason: "" });
  state = await settled(actionForm("Analyse korrigieren"), "save-status--error");
  check("Korrektur ohne Grund: Fehlermeldung, Auswahl bleibt erhalten", Boolean(state) && state.values.priority === "high", JSON.stringify(state));
  await fillIn(actionForm("Analyse korrigieren"), { priority: "high", reason: "Produktion steht laut Telefonat" });
  const corrected = await waitFor(async () => (await dbRequest()).priority === "high");
  const run = (await admin.from("automation_runs").select("corrected_at, correction_reason").eq("id", analysis.id).single()).data;
  const correctionEvent = (await admin.from("request_events").select("event_type").eq("request_id", request.id).eq("event_type", "automatic_result_corrected")).data;
  check("Korrektur über correct_analysis: Priorität, Lauf markiert, Ereignis", corrected && Boolean(run.corrected_at) && correctionEvent.length === 1, JSON.stringify(run));

  // Draft → edit → queue (two saves in a row use the refreshed version)
  await page.open(requestUrl);
  await fillIn(actionForm("E-Mail an Kunden vorbereiten"), { subject: "Rückfrage UI-Test", body_text: "Bitte senden Sie uns das Typenschild." });
  const drafted = await waitFor(async () => (await admin.from("messages").select("id").eq("request_id", request.id).eq("status", "draft")).data.length === 1);
  check("E-Mail vorbereiten erzeugt nur einen Entwurf", drafted);
  await page.until(`!!document.querySelector(".draft-actions")`);
  const draftForm = (index) => `document.querySelectorAll(".draft-actions form")[${index}]`;
  await fillIn(draftForm(0), { subject: "Rückfrage UI-Test (geändert)" });
  check("Entwurf bearbeitet", await waitFor(async () => (await admin.from("messages").select("subject").eq("request_id", request.id).single()).data.subject === "Rückfrage UI-Test (geändert)"));
  await sleep(500);
  await page.eval(`${draftForm(1)}.requestSubmit()`);
  const queued = await waitFor(async () => (await admin.from("messages").select("status").eq("request_id", request.id).single()).data.status === "queued");
  const message = (await admin.from("messages").select("status, sent_at").eq("request_id", request.id).single()).data;
  check("In Warteschlange gestellt, kein Versand (sent_at leer)", queued && message.sent_at === null, JSON.stringify(message));
  await page.open(requestUrl);
  const badges = await page.eval(`[...document.querySelectorAll("#korrespondenz .message .status-badge")].map((badge) => badge.textContent.trim())`);
  check("Oberfläche meldet keinen Versand (Status „In Warteschlange, nicht versendet“)", JSON.stringify(badges) === JSON.stringify(["In Warteschlange, nicht versendet"]), badges.join(","));

  // Release: complete_intake with priority → planning queue
  await fillIn(actionForm("Prüfen und freigeben"), { priority: "high", note: "Geprüft im UI-Test" });
  const released = await waitFor(async () => (await dbRequest()).intake_status === "processed");
  const after = await dbRequest();
  const queueRow = (await admin.from("dispatcher_queue").select("queue").eq("id", request.id).single()).data;
  check("Freigabe: processed, Modus human_review, Warteschlange Planung", released && after.intake_mode === "human_review" && queueRow.queue === "planning", `${after.intake_status} ${after.intake_mode} ${queueRow.queue}`);

  // Version conflict on reject keeps the reason; after reload the rejection succeeds
  await page.open(requestUrl);
  await admin.from("requests").update({ site_label: "Parallel geändert" }).eq("id", request.id);
  await fillIn(actionForm("Anfrage ablehnen"), { reason: "Außerhalb des Servicegebiets" });
  state = await settled(actionForm("Anfrage ablehnen"), "save-status--error");
  check("Versionskonflikt: verständliche Meldung, Grund bleibt erhalten", Boolean(state) && state.values.reason === "Außerhalb des Servicegebiets" && /inzwischen .* geändert/.test(state.status), JSON.stringify(state));
  check("  keine Änderung in der Datenbank", (await dbRequest()).intake_status === "processed");
  await page.open(requestUrl);
  await fillIn(actionForm("Anfrage ablehnen"), { reason: "Außerhalb des Servicegebiets" });
  const rejected = await waitFor(async () => (await dbRequest()).intake_status === "rejected");
  check("Ablehnung mit Grund über reject_request", rejected && (await dbRequest()).rejection_reason === "Außerhalb des Servicegebiets");
  await page.open(requestUrl);
  check("Nach Ablehnung keine Prüfaktionen mehr", await page.eval(`!document.getElementById("aktionen")`));
  console.log("\nEinsatzplanung im Kalender");
  const processed = { intake_status: "processed", priority: "normal", intake_mode: "manual", intake_completed_at: new Date().toISOString(), manual_minutes_baseline: 15, human_review_required: false };
  const planA = await newRequest("plan-a", processed);
  const planB = await newRequest("plan-b", processed);
  const { data: tech } = await admin.from("profiles").select("id, display_name").eq("display_name", "Tobias Krüger").single();
  // Own Monday per run (2030 onwards), so repeated runs never collide with earlier test bookings
  const weekDate = new Date(Date.UTC(2030, 0, 7) + Math.floor(Math.random() * 1500) * 7 * 86400000);
  const week = weekDate.toISOString().slice(0, 10);
  const utcOffsetHours = new Date(`${week}T12:00:00Z`).toLocaleString("en-US", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }) - 12;
  const visitsOf = async (requestId) => (await admin.from("visits").select("technician_id, scheduled_start, scheduled_end, status").eq("request_id", requestId)).data;
  const bookingForm = `document.querySelector("#booking form")`;
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.open(`${BASE}/dashboard/planung?woche=${week}&anfrage=${planA.id}`);
  check("Anfrage in „Zu planen“ ausgewählt", await page.eval(`document.querySelector('.plan-queue__item[aria-current="true"]')?.textContent.includes(${JSON.stringify(planA.request_number)})`));
  // Click at 09:00 in Tobias' lane on Monday
  await page.eval(`(() => {
    const day = document.querySelector(".plan-day");
    const row = [...day.querySelectorAll(".plan-row")].find((r) => r.querySelector(".plan-name").textContent.startsWith(${JSON.stringify(tech.display_name)}));
    const lane = row.querySelector(".plan-lane");
    const rect = lane.getBoundingClientRect();
    const x = rect.left + rect.width * (9 * 60 - 360) / 840;
    lane.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: rect.top + 5 }));
  })()`);
  let picked = await formStatus(bookingForm);
  check("Klick in den Kalender übernimmt Techniker, Datum und Zeit", picked.values.technician_id === tech.id && picked.values.date === week && picked.values.start === "09:00" && picked.values.end === "11:00", JSON.stringify(picked.values));
  await page.eval(`${bookingForm}.requestSubmit()`);
  const booked = await waitFor(async () => (await visitsOf(planA.id)).length === 1);
  const visitA = (await visitsOf(planA.id))[0];
  const expectedStart = new Date(Date.parse(`${week}T09:00:00Z`) - utcOffsetHours * 3600000).toISOString();
  const expectedEnd = new Date(Date.parse(`${week}T11:00:00Z`) - utcOffsetHours * 3600000).toISOString();
  check(`Einsatz über schedule_visit gebucht (${week} 09:00–11:00 Berlin)`, booked && new Date(visitA.scheduled_start).toISOString() === expectedStart && new Date(visitA.scheduled_end).toISOString() === expectedEnd && visitA.status === "scheduled", JSON.stringify(visitA));
  await page.open(`${BASE}/dashboard/planung?woche=${week}`);
  check("  im Kalender als eigene Anfrage sichtbar", await page.eval(`[...document.querySelectorAll(".plan-block--own")].some((b) => b.textContent.includes(${JSON.stringify(planA.request_number)}))`));
  check("  Anfrage verlässt „Zu planen“", await page.eval(`![...document.querySelectorAll(".plan-queue__item")].some((i) => i.textContent.includes(${JSON.stringify(planA.request_number)}))`));

  // Conflict: same technician and slot for request B → RW410, inputs kept, nothing booked
  await page.open(`${BASE}/dashboard/planung?woche=${week}&anfrage=${planB.id}`);
  await fillIn(bookingForm, { technician_id: tech.id, date: week, start: "10:00", end: "12:00" });
  state = await settled(bookingForm, "save-status--error");
  check("Überschneidung serverseitig abgelehnt, verständlich angezeigt", Boolean(state) && state.status.includes("bereits einen Einsatz") && state.status.includes("freien Zeitraum"), state?.status);
  check("  Eingaben bleiben erhalten, kein Einsatz angelegt", state?.values.start === "10:00" && state?.values.end === "12:00" && (await visitsOf(planB.id)).length === 0);
  await fillIn(bookingForm, { technician_id: tech.id, date: week, start: "18:00", end: "19:00" });
  state = await waitFor(async () => { const s2 = await formStatus(bookingForm); return !s2.pending && s2.values.start === "18:00" && s2.status.includes("error") && !s2.status.includes("bereits einen Einsatz"); }) && await formStatus(bookingForm);
  check("Außerhalb der Arbeitszeit abgelehnt", Boolean(state) && (await visitsOf(planB.id)).length === 0, state?.status);
  await fillIn(bookingForm, { technician_id: tech.id, date: week, start: "11:00", end: "12:00" });
  check("Direkt anschließender Termin (11:00) möglich", await waitFor(async () => (await visitsOf(planB.id)).length === 1));
  console.log("\nEinsatzaktionen und Arbeitserfassung");
  const techEmail = `ui-tech-${runId}@example.com`;
  const { data: techUser } = await admin.auth.admin.createUser({ email: techEmail, password, email_confirm: true });
  const techId = techUser.user.id;
  await admin.from("profiles").insert({ id: techId, display_name: `UI-Test Techniker ${runId}`, role: "technician" });
  await admin.from("employee_availability").insert([1, 2, 3, 4, 5].map((weekday) => ({ employee_id: techId, kind: "working_hours", weekday, local_start: "07:00", local_end: "16:00" })));
  const job = await newRequest("einsatz", { ...processed, service_kind: "diagnosis_repair", technician_id: techId, work_status: "scheduled" });
  const { data: jobVisit, error: jobVisitError } = await admin.from("visits").insert({ request_id: job.id, technician_id: techId, status: "scheduled", scheduled_start: `${week}T08:00:00Z`, scheduled_end: `${week}T10:00:00Z`, created_by: dispoId }).select().single();
  if (jobVisitError) throw new Error(jobVisitError.message);
  const visitRow = async () => (await admin.from("visits").select("*").eq("id", jobVisit.id).single()).data;
  const entries = async () => (await admin.from("work_entries").select("kind, description, quantity, unit_price, item_status").eq("request_id", job.id).order("created_at")).data;
  const visitUrl = `${BASE}/dashboard/einsatz/${jobVisit.id}`;
  const formIn = (summary) => `[...document.querySelectorAll("details.action")].find((d) => d.querySelector("summary").textContent.trim() === ${JSON.stringify(summary)})`;
  const formWithButton = (text) => `[...document.querySelectorAll("form.save-form")].find((f) => f.querySelector("button[type=submit]").textContent.trim() === ${JSON.stringify(text)})`;

  const otherJar = await loginCookies("technik2.demo@example.com");
  const foreignVisit = await fetch(visitUrl, { headers: { cookie: otherJar.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") }, redirect: "manual" });
  check("Anderer Techniker öffnet den Einsatz nicht (404)", foreignVisit.status === 404, String(foreignVisit.status));

  await page.send("Network.clearBrowserCookies");
  await page.send("Network.setCookies", { cookies: await loginCookies(techEmail) });
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.open(visitUrl);
  await page.eval(`${formWithButton("Arbeit starten")}.requestSubmit()`);
  check("Arbeit starten → Einsatz und Anfrage in Arbeit", await waitFor(async () => (await visitRow()).status === "in_progress" && (await dbRequest(job.id)).work_status === "in_progress"));

  await page.open(visitUrl);
  await fillIn(formIn("Arbeitszeit erfassen"), { quantity: "1,5" });
  check("Arbeitszeit 1,5 h nach Tarif erfasst", await waitFor(async () => (await entries()).some((entry) => entry.kind === "labor" && Number(entry.quantity) === 1.5 && Number(entry.unit_price) > 0 && entry.item_status === "performed")));
  await page.open(visitUrl);
  await fillIn(formIn("Teil erfassen"), { description: "Gleitringdichtung", quantity: "1", unit_price: "48,90", item_status: "ordered" });
  check("Teil als bestellt mit Preis 48,90 € erfasst", await waitFor(async () => (await entries()).some((entry) => entry.kind === "part" && Number(entry.unit_price) === 48.9 && entry.item_status === "ordered")));
  await page.open(visitUrl);
  await page.eval(`${formWithButton("Als verbaut markieren")}.requestSubmit()`);
  check("Teil als verbaut markiert", await waitFor(async () => (await entries()).some((entry) => entry.kind === "part" && entry.item_status === "used")));

  // Photos: JPEG accepted into the private bucket, PDF rejected
  const setFile = async (file) => {
    const { root } = await page.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await page.send("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file][name=photo]" });
    await page.send("DOM.setFileInputFiles", { nodeId, files: [path.resolve(file)] });
  };
  await page.open(visitUrl);
  await setFile("scripts/demo/files/typenschild-pumpe.jpg");
  await page.eval(`${formWithButton("Foto hochladen")}.requestSubmit()`);
  const photoSaved = await waitFor(async () => (await admin.from("attachments").select("id").eq("visit_id", jobVisit.id)).data.length === 1, 15000);
  const { data: photoRow } = await admin.from("attachments").select("bucket, storage_path, visibility, mime_type").eq("visit_id", jobVisit.id).maybeSingle();
  const stored = photoRow ? await admin.storage.from(photoRow.bucket).download(photoRow.storage_path) : { error: true };
  check("Foto im privaten Bucket „dashboard“ mit Metadaten", photoSaved && photoRow.bucket === "dashboard" && photoRow.storage_path.startsWith(`visits/${job.id}/${jobVisit.id}/`) && photoRow.visibility === "operational" && photoRow.mime_type === "image/jpeg" && !stored.error, JSON.stringify(photoRow));
  const anonymousPhoto = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/dashboard/${photoRow?.storage_path}`);
  check("  nicht öffentlich abrufbar", anonymousPhoto.status >= 400, String(anonymousPhoto.status));
  await page.open(visitUrl);
  const preview = await page.eval(`(async () => { const img = document.querySelector(".photo-grid img"); if (!img) return "kein Bild"; const response = await fetch(img.src); return response.status + " " + response.headers.get("content-type"); })()`);
  check("  Vorschau im Einsatz über die App abrufbar", preview === "200 image/jpeg", preview);
  await setFile("scripts/demo/files/pruefbericht-pumpe.pdf");
  await page.eval(`${formWithButton("Foto hochladen")}.requestSubmit()`);
  state = await settled(formWithButton("Foto hochladen"), "save-status--error");
  check("PDF als Foto abgelehnt, nichts gespeichert", Boolean(state) && state.status.includes("JPEG") && (await admin.from("attachments").select("id").eq("visit_id", jobVisit.id)).data.length === 1, state?.status);

  // Waiting for parts and resume
  await page.open(visitUrl);
  await fillIn(formIn("Auf Teile warten"), { reason: "Lagersatz bestellt" });
  check("Auf Teile warten → Einsatz und Anfrage warten", await waitFor(async () => (await visitRow()).status === "waiting_parts" && (await dbRequest(job.id)).work_status === "waiting_parts"));
  await page.open(visitUrl);
  await page.eval(`${formWithButton("Einsatz fortsetzen")}.requestSubmit()`);
  check("Einsatz fortgesetzt", await waitFor(async () => (await visitRow()).status === "in_progress"));

  // Completion: follow-up without reason keeps the report; with reason the request returns to planning
  await page.open(visitUrl);
  await page.eval(`(() => { const box = document.querySelector('${"input[name=follow_up]"}'); box.checked = true; })()`);
  await fillIn(formIn("Einsatz beenden"), { minutes: "95", summary: "Dichtung getauscht, Probelauf ok", follow_up_reason: "" });
  state = await settled(formIn("Einsatz beenden"), "save-status--error");
  check("Folgeeinsatz ohne Grund: Fehler, Bericht bleibt erhalten", Boolean(state) && state.values.summary === "Dichtung getauscht, Probelauf ok" && (await visitRow()).status === "in_progress", state?.status);
  await fillIn(formIn("Einsatz beenden"), { follow_up_reason: "Zweite Pumpe im Nachbarraum prüfen" });
  const completed = await waitFor(async () => (await visitRow()).status === "completed");
  const jobAfter = await dbRequest(job.id);
  const jobQueue = (await admin.from("dispatcher_queue").select("queue").eq("id", job.id).single()).data.queue;
  const finished = await visitRow();
  check("Einsatz beendet mit Bericht und 95 min", completed && finished.actual_work_minutes === 95 && finished.summary === "Dichtung getauscht, Probelauf ok");
  check("  Anfrage nicht abgeschlossen, Folgeeinsatz in der Planung", jobAfter.work_status === "not_planned" && jobAfter.completed_at === null && jobQueue === "planning", `${jobAfter.work_status} ${jobQueue}`);

  console.log("\nAnfrage abschließen und Rechnung");
  // The technician closes without any manager step; drafts have no PDF; the issued PDF is frozen
  const jobUrl = `${BASE}/dashboard/anfragen/${job.id}`;
  const techCookie = (await loginCookies(techEmail)).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  const pdfUrl = `${jobUrl}/rechnung/pdf`;
  const getPdf = async (cookie = techCookie) => {
    const response = await fetch(pdfUrl, { headers: cookie ? { cookie } : {}, redirect: "manual" });
    return { status: response.status, type: response.headers.get("content-type"), disposition: response.headers.get("content-disposition"), cache: response.headers.get("cache-control"), bytes: Buffer.from(await response.arrayBuffer()) };
  };
  const invoiceRow = async () => (await admin.from("invoices").select("*").eq("request_id", job.id).maybeSingle()).data;
  await page.open(jobUrl);
  check("Techniker sieht „Anfrage abschließen“ mit Bericht des letzten Einsatzes", await page.eval(`(() => { const host = ${actionForm("Anfrage abschließen")}; return Boolean(host) && host.querySelector("textarea[name=completion_summary]").value === "Dichtung getauscht, Probelauf ok"; })()`));
  if (SHOTS) {
    await page.eval(`document.getElementById("aktionen").scrollIntoView({ behavior: "instant" })`);
    await sleep(300);
    await writeFile(path.join(SHOTS, "abschluss-390.png"), Buffer.from((await page.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  }
  await fillIn(actionForm("Anfrage abschließen"), { completion_summary: "" });
  state = await settled(actionForm("Anfrage abschließen"), "save-status--error");
  check("Abschluss ohne Bericht abgelehnt", Boolean(state) && (await dbRequest(job.id)).work_status === "not_planned", state?.status);
  await fillIn(actionForm("Anfrage abschließen"), { completion_summary: "Pumpe instand gesetzt, Folgeprüfung nicht mehr nötig" });
  const closed = await waitFor(async () => (await dbRequest(job.id)).work_status === "completed");
  const closeEvents = (await admin.from("request_events").select("event_type, actor_id").eq("request_id", job.id).eq("event_type", "work_completed")).data;
  check("Techniker schließt ab (close_request), ohne Managerfreigabe", closed && closeEvents.length === 1 && closeEvents[0].actor_id === techId, JSON.stringify(closeEvents));
  check("PDF vor Rechnungserstellung: 404", (await getPdf()).status === 404);

  await page.open(jobUrl);
  await page.eval(`${formWithButton("Rechnungsentwurf erstellen")}.requestSubmit()`);
  check("Rechnungsentwurf erstellt (create_invoice)", await waitFor(async () => (await invoiceRow())?.status === "draft"));
  const draftPdf = await getPdf();
  check("PDF eines Entwurfs: 404", draftPdf.status === 404, String(draftPdf.status));
  await page.open(jobUrl);
  check("  Seite zeigt keinen PDF-Link für den Entwurf", await page.eval(`!document.querySelector(".invoice-download")`));

  await page.eval(`${formWithButton("Rechnung ausstellen")}.requestSubmit()`);
  const issued = await waitFor(async () => (await invoiceRow())?.status === "issued");
  const invoice = await invoiceRow();
  check(`Rechnung ausgestellt (${invoice?.invoice_number})`, issued && /^RE-\d{4}-\d{5}$/.test(invoice.invoice_number ?? ""), JSON.stringify(invoice));
  const items = (await admin.from("invoice_items").select("kind, quantity, unit_price, net_amount").eq("invoice_id", invoice.id).order("position")).data;
  check("  Positionen: Arbeitszeit und verbautes Teil", items.length === 2 && items.some((item) => item.kind === "labor") && items.some((item) => item.kind === "part" && Number(item.unit_price) === 48.9), JSON.stringify(items));
  await page.open(jobUrl);
  check("  PDF-Link auf der Anfrageseite, keine Rechnungsaktionen mehr", await page.eval(`Boolean(document.querySelector(".invoice-download a[href$='/rechnung/pdf']")) && !${actionForm("Rechnung ausstellen")} && !${actionForm("Anfrage abschließen")}`));

  const { PDFDocument } = await import("pdf-lib");
  const firstPdf = await getPdf();
  const parsed = firstPdf.status === 200 ? await PDFDocument.load(firstPdf.bytes) : null;
  check("PDF-Download: 200, application/pdf, Anhang, nicht cachebar", firstPdf.status === 200 && firstPdf.type === "application/pdf" && firstPdf.disposition?.includes(`Musterrechnung-${invoice.invoice_number}.pdf`) && firstPdf.cache?.includes("no-store"), `${firstPdf.status} ${firstPdf.type} ${firstPdf.disposition}`);
  check("  als Musterrechnung / Demodaten gekennzeichnet", parsed?.getTitle() === `Musterrechnung / Demodaten ${invoice.invoice_number}` && parsed?.getSubject() === "Musterrechnung / Demodaten", parsed?.getTitle());
  check("  ohne Anmeldung nicht abrufbar", (await getPdf("")).status === 401);
  const otherTechCookie = otherJar.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  check("  fremder Techniker erhält kein PDF (404)", (await getPdf(otherTechCookie)).status === 404);

  // Rate change after issuance must not change the PDF
  const { data: labor } = await admin.from("work_entries").select("service_rate_id").eq("request_id", job.id).eq("kind", "labor").single();
  const { data: rate } = await admin.from("service_rates").select("id, unit_price").eq("id", labor.service_rate_id).single();
  const { error: rateError } = await admin.from("service_rates").update({ unit_price: Number(rate.unit_price) + 50 }).eq("id", rate.id);
  try {
    const secondPdf = await getPdf();
    check("Tarifänderung ändert das ausgestellte PDF nicht (byte-identisch)", !rateError && secondPdf.status === 200 && Buffer.compare(firstPdf.bytes, secondPdf.bytes) === 0, rateError?.message ?? `${firstPdf.bytes.length} / ${secondPdf.bytes.length}`);
  } finally {
    await admin.from("service_rates").update({ unit_price: rate.unit_price }).eq("id", rate.id);
  }
  if (SHOTS) {
    for (const viewport of [{ width: 390, height: 844, mobile: true }, { width: 1440, height: 900, mobile: false }]) {
      await page.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
      await page.open(jobUrl);
      await page.eval(`document.getElementById("rechnung").scrollIntoView({ behavior: "instant" })`);
      await sleep(300);
      const shot = await page.send("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(SHOTS, `rechnung-${viewport.width}.png`), Buffer.from(shot.data, "base64"));
    }
    await writeFile(path.join(SHOTS, `${invoice.invoice_number}.pdf`), firstPdf.bytes);
  }
} catch (error) {
  console.error(error);
  failures += 1;
} finally {
  page?.socket.close();
  chrome.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failures === 0 ? "Alle UI-Prüfungen bestanden." : `${failures} Prüfung(en) fehlgeschlagen.`}`);
process.exit(failures === 0 ? 0 : 1);
