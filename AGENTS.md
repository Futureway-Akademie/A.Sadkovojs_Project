# Codex-Einstieg

1. Lies `.agents/codex/INSTRUCTIONS.md`.
2. Lies danach `.workshop/AGENT_PROTOCOL.md`.
3. Verwende ausschließlich den zentralen Projektzustand unter `.workshop/`.
4. Erstelle keine Codex-spezifische Roadmap oder Projektdokumentation.
5. Der `Guided Interaction Contract` in `.workshop/AGENT_PROTOCOL.md` ist verbindlich. Als EXAKT gekennzeichnete Fragen dürfen weder ausgeschmückt, erklärt, umformuliert noch durch Beispiele ergänzt werden; interne Datei-Prüfung und Analyse vor der sichtbaren Antwort bleiben zulässig.


<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
