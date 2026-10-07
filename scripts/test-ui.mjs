// Browser checks of the dashboard UI in headless Chrome over the DevTools protocol (task-4-2):
// - no horizontal scrolling at 390×844, 768×1024 and 1440×900 for the dashboard areas of every role
// - a failed save keeps all inputs (validation error and simulated version conflict), success shows the save state
// Usage: npm run build && npm run start, then npm run test:ui
//   APP_URL (default http://localhost:3000), CHROME_PATH (default: Google Chrome on macOS),
//   UI_SCREENSHOTS=<dir> additionally stores a screenshot per page and width.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
    { email: "manager.demo@example.com", pages: ["/dashboard/planung", "/dashboard/anfragen", "detail:/dashboard/anfragen?arbeit=completed"] },
    { email: "dispo3.demo@example.com", pages: ["/dashboard/erstbearbeitung", "/dashboard/erstbearbeitung?tab=planung", "/dashboard/erstbearbeitung?tab=alle"] },
    { email: "technik1.demo@example.com", pages: ["/dashboard/heute", "/dashboard/kalender", "/dashboard/anfragen", "detail:/dashboard/anfragen?arbeit=scheduled"] },
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
        if (entry.startsWith("detail:")) {
          await page.open(`${BASE}${entry.slice(7)}`);
          pathname = await page.eval(`document.querySelector(".data-table tbody a")?.getAttribute("href") ?? ""`);
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
