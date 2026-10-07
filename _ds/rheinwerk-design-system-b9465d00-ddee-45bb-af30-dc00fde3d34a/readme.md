# RheinWerk Industrieservice — Design System

**Version 0.1.0 · Phase 1 · Light mode only · German-language B2B**

RheinWerk Industrieservice GmbH is a 55-person industrial-service provider in Mannheim that inspects, maintains and repairs **pumps, compressors and industrial ventilation systems** for industrial, logistics and food-production companies in the Rhine-Neckar metropolitan region. The promise is narrow and operational: reliable operation, reduced downtime.

A visitor arrives with four questions — do you service my equipment, can you help with the situation I have right now, what price and timing framework should I expect, and what do you need from me to start. The brand's job is to answer those four faster than a larger competitor can, and to be visibly precise about its limits: service hours end at 18:00, target times are not guarantees, and the 24/7 channel exists only where an SLA says so. At this company size, credibility comes from stated boundaries, not from claimed scale.

> **Fiktives Portfolio-Projekt. RheinWerk Industrieservice GmbH ist kein reales Unternehmen.** This disclosure renders from `SiteFooter` on every page template and may not be abbreviated or removed.

## Sources

Everything here is derived from one attached codebase — a design-system-only deliverable, no production app:

| Source | Path in the attached folder | What it gave us |
|---|---|---|
| Brand direction | `RheinWerk-DS/BRAND_DIRECTION.md` | Positioning, visual thesis, the three RheinWerk-specific decisions, the rejected list |
| Token source of truth | `RheinWerk-DS/tokens.css`, `RheinWerk-DS/tokens.json` | Every colour, type, space, radius, shadow, z-index and motion value, with measured contrast ratios |
| Component specification | `RheinWerk-DS/COMPONENTS.md` | The full component inventory, anatomy, variants, states, content limits and testable a11y assertions |
| Developer handoff | `RheinWerk-DS/HANDOFF.md` | File structure, page-template hierarchy, content model, form-field schema and validation mapping, image art direction, icon policy, the three known palette corrections |
| Rendered specimen | `RheinWerk-DS/design-system.html` | The visual ground truth — every component rendered with literal values. All measurements in this system were lifted from it, not invented. |

Target stack named in the handoff: Next.js App Router + Tailwind CSS + TypeScript, `<html lang="de">`, no proprietary fonts, no proprietary component library. No Figma file, no repository URL and no photography were supplied.

## Rules that override everything else

1. `tokens/*.css` is the single source of truth. **No hex literal outside the token layer.** Never invent or alter a token value.
2. **Light mode only.** There is no `dark:` variant. Navy is a compositional block that chapters the page, not a theme.
3. **Radius stops at 8 px.** `--rw-radius-full` is reserved for status chips; nothing else in the system is pill-shaped.
4. **Lime is rationed** to roughly 5 % of any viewport — CTA fill, selected state, small accent rules. Navy text on lime, never lime text on a light surface.
5. **IBM Plex Mono is evidence, not styling.** Machine numbers, reference codes, SLA numbers, prices, timestamps, postal codes. Never headings, labels or atmosphere.
6. **All UI copy is German.**
7. **Never invent** a price, response time, KPI, testimonial, customer logo or certification. The approved figures are listed under *Content fundamentals*.
8. **WCAG 2.2 AA**, measured: one focus-ring token on both light and navy, status never conveyed by colour alone (icon **and** word), 44 px minimum touch targets, `prefers-reduced-motion` collapsing all durations to 0.
9. Components never set an outer margin. Vertical rhythm belongs to `Section`.

Deliberately rejected: gradients, glassmorphism, glows, pill buttons, 16 px card radii, a dark theme, a gear / wrench / droplet / cog mark, hero video, parallax, long entrance sequences, stock handshake photography, fake client logos, invented testimonials, certification badge walls, "24/7" as a headline figure, an icon-in-a-lime-circle card header, a third accent colour, any unquantified superlative.

---

## Content fundamentals

**Language.** German throughout, `lang="de"` on `<html>`, formal *Sie*. The company speaks as **wir**; the customer is **Sie**. Body copy sets `hyphens: auto`; headings do not — authors insert `&shy;` instead (`Anlagen&shy;verfügbarkeit`).

**Register.** Operational and specific, the way a dispatcher writes a job note. Sentences state what happens, in what order, with what limit. No marketing verbs, no superlatives, no exclamation marks, no rhetorical questions except the one hazard headline (*Produktionsstillstand oder Sicherheitsgefahr?*). Emoji are never used — not in UI, not in content, not in the icon set.

**Casing.** Sentence case everywhere, including buttons, labels and nav items. Only the mono eyebrows and group labels are uppercased, and those carry `letter-spacing: 0.04–0.06em`. German noun capitalisation is of course preserved.

**Headline pattern.** Outcome first, mechanism second:

- `Damit Ihre Anlagen zuverlässig laufen.` — the H1, a purpose clause, not a claim
- `Planmäßige Wartung nach festem Prüfumfang`
- `Drei Anlagentypen, kein vierter`

**Button labels.** Verb-first, ≤ 28 characters, always with an object: `Serviceanfrage starten`, `Leistungen ansehen`, `Dateien auswählen`, `Erneut versuchen`. Never `Mehr erfahren` on its own. Loading labels switch to present progressive: `Wird gesendet`.

**Card copy limits.** ServiceCard heading ≤ 24 characters, body ≤ 110. Hero body ≤ 220. FAQ question ≤ 80. Accordion answers get the 720 px measure. UtilityBar boundary note ≤ 60.

**Boundaries are typeset as content, not fine print.** These strings are invariants — copy them exactly, never paraphrase:

```
PRICE_FOOTNOTE  Individuelle Aufträge und vereinbarte SLA haben Vorrang. Preise verstehen sich netto zuzüglich 19 % Umsatzsteuer.
SLA_BOUNDARY    24/7-Notfallkanal nur mit vereinbartem Notfall-SLA.
SERVICE_HOURS   Mo–Fr 07:00–18:00
HOURS_NOTE      Ohne gesetzliche Feiertage in Baden-Württemberg.
FICTIONAL_NOTE  Fiktives Portfolio-Projekt. RheinWerk Industrieservice GmbH ist kein reales Unternehmen.
CRITICAL_NOTE   Dieser Fall wird als kritisch behandelt und muss durch einen Menschen geprüft werden. Bitte melden Sie ihn zusätzlich telefonisch unter +49 621 00000-0.
NO_ANSWER       Dazu liegen mir keine verlässlichen Informationen vor. Ich kann Ihre Anfrage an den Service Desk übergeben.
```

**The only approved figures.**

| Fact | Value |
|---|---|
| Inspektion | `290 EUR netto je Maschine` |
| Wartung | `ab 690 EUR netto je Maschine` |
| Fehlerdiagnose & Reparatur | `145 EUR netto je Technikerstunde`, min. `290 EUR netto` |
| Anfahrt | `1,20 EUR netto je gefahrenem Kilometer ab Mannheim und zurück`, min. `45 EUR netto` |
| Team | `30` Servicetechniker · `8` Personen in Service Desk und Einsatzplanung (55 total) |
| Named person | `Dr. Lena Hartmann`, Geschäftsführung — the only individual the system may name |
| Contact | `+49 621 00000-0` · `service@rheinwerk-industrieservice.example` · Rheinwerkstraße 12, 68169 Mannheim |

No percentage, no "Jahre Erfahrung", no measured customer outcome, no named customer. Reference projects carry a mandatory `Fiktives Referenzprojekt` band.

**Error and validation copy.** Name the field, state the expected format, confirm the input survived: *"Bitte geben Sie eine geschäftliche E-Mail-Adresse mit @ und Domain an, z. B. name@firma.de."* · *"Die PLZ besteht aus fünf Ziffern, z. B. 68169."* Required fields are marked with the word **Pflichtangabe** in mono, never an asterisk alone.

**Priority language.** P1–P4 describe intake classification, never a promise. A priority chip may not appear next to a time figure unless that figure is labelled *Zielwert* and carries the contractual boundary sentence. *Zielwert ist keine Garantie.*

---

## Visual foundations

**The thesis.** A maintained technical document, not a brochure. Warm off-white content surfaces on a cool mist page, so the reading area feels like paper on a workbench rather than a card floating on grey. Type does the work; photography is not the budget.

**Colour.** Page `mist-100 #F2F5F7` · content `warm-white #FCFBF7` · cards `white`. Text `navy-950` (16.12:1), secondary `steel-700` (5.84:1), brand and links `blue-700` (8.98:1). Navy appears as full-bleed compositional blocks — one or two per page — that segment the document into chapters. Signal lime is the single accent. Three pairs are prohibited and documented rather than worked around: `blue-500` as body text (4.16:1), `steel-300` as a boundary (1.73:1), `warning-800` on its own tint (4.18:1).

**Type.** Manrope for display and headings (700 at Display/H1/H2, 600 at H3), Inter 400/500/600 for body and UI, IBM Plex Mono 500 for verifiable facts. Display and H1 are set tight — `-0.022em` and `-0.018em` — and left-aligned against a strict 12-column grid. Sizes are fluid: Display 44 → 72, H1 38 → 56, H2 32 → 40, H3 24 → 28. Body is 16/26 on a 720 px measure; nothing narrower than 45 characters.

**Der Zustandsstrich — the state rule.** Every card, section header and alert carries a 2 px rule on its leading edge, and its colour classifies the content: **navy** neutral information · **lime** an available action · **danger** a hazard or blocking state · **steel** metadata. At most one lime rule per card row. It is the technical line motif made functional — a scanning visitor learns the code in one screen and reads the page by rule colour before reading a word.

**Layout.** 12 / 8 / 4 columns, 24 px gap, gutters 64 / 40 / 24, container max 1280. Spacing base 4 px (4 → 128). Section rhythm is a separate scale — 48 / 72 / 96 / 128 — owned only by `Section`. Sticky elements: the header (`z 100`), `SectionNav` at ≥ 1024, `ContactRail` at ≥ 1280, `StickyActionBar` below 768 (never both rails), and the assistant at `z 400`.

**Backgrounds.** Flat colour only. No gradient, no glassmorphism, no blur, no transparency as decoration — the only semi-transparent values in the system are the four shadow rgba stops and the 1 px diagonal hairline in image placeholders (`repeating-linear-gradient(135deg, …0.05) 0 1px, transparent 1px 11px`). There is no background image, no texture, no pattern fill behind content.

**Cards.** `warm-white` or `white`, 1 px `steel-200` hairline, 6 px radius, no shadow at rest, a 2 px Zustandsstrich on the leading edge. Hover raises `shadow-sm` and darkens the border to `steel-500` — that is the whole hover vocabulary for cards.

**Elevation.** Four levels, navy-tinted, low opacity, no coloured glow: `sm` hovered cards · `md` dropdowns and the mobile action bar · `lg` drawer and assistant panel. Static page content uses hairline borders instead of shadow.

**Borders and radii.** 1 px dividers and inputs · 1.5 px icon stroke, emphasis, error borders · 2 px Zustandsstrich, focus ring, active tab. Radius 0 for rules and full-bleed blocks, 4 for controls, 6 for cards, 8 for large cards and panels, `full` for chips only.

**Interaction states.** Hover: primary CTA `lime-500 → lime-600`; secondary and tertiary tint to `blue-050`; nav items grow a `blue-700` underline; cards gain `shadow-sm`; navy surfaces lighten to `navy-800`. Press: one step darker — `lime-700`, `blue-100`, `danger-800`. Nothing scales, nothing lifts, nothing bounces; opacity is never used to signal a state. Focus is one token on every surface: 2 px `blue-500` ring at 2 px offset, never removed, never restyled per component. Disabled: `steel-100` fill, `steel-500` text, `steel-300` border, `cursor: not-allowed`, and a visible reason next to it.

**Motion.** `fast 160` hover, focus, chips · `base 200` buttons, inputs, accordion · `slow 240` drawer and assistant · `instant 0` for anything critical — a hazard notice never fades in. Easing `standard cubic-bezier(0.22, 0.61, 0.36, 1)`, plus `out` and `in-out`. Transitions animate colour, border-colour, box-shadow and width only. Under `prefers-reduced-motion` the duration tokens resolve to 0 ms, so no component needs its own media query; state changes remain, only interpolation goes. Banned regardless of preference: parallax, scroll-jacking, entrance sequences over 240 ms, animated hazard notices.

**Imagery.** Documentary, natural hall light, cool-neutral, no grain, no filter, no colour grade — technicians in PPE mid-task, no eye contact, no crossed arms, no posed handshakes. Ratios: hero 16:9 (min 1920, focal point in the outer third, scrim `navy-950 / 72 %` from the text side) · service card 3:2 · equipment detail 4:3 · portrait 4:5 · reference 3:2 with no identifiable customer branding. Alt text names equipment and activity — *"Servicetechnikerin prüft Lagerspiel an einer Kreiselpumpe"* — never mood. **No photography was supplied with the source**, so every image slot ships the marked `ImagePlaceholder`: hairline field, dashed border, icon, and the mono art-direction note, visible in staging so nobody mistakes it for a design decision.

---

## Iconography

One line family, **1.75 px stroke at every size**, `currentColor`, 20 / 24 / 32 px. Icons are redrawn per size, never scaled. Round caps and joins throughout, with one exception: the three equipment glyphs use square caps and miter joins, because they are RheinWerk drawings rather than library icons.

- **Source.** Lucide's construction covers everything except `pump`, `compressor` and `ventilation`, which the source project drew to the same grid. All 27 glyphs the specimen uses were copied out of it verbatim into `assets/icons/*.svg`; the same path data backs the `Icon` component, so nothing is redrawn or approximated here. No icon font, no sprite sheet, no CDN dependency — the set is small enough to inline.
- **Inventory.** `pump` `compressor` `ventilation` `wrench` `inspection` `calendar` `document` `file` `phone` `mail` `warning` `alert-circle` `info` `check` `close` `menu` `upload` `download` `location` `clock` `shield` `arrow-right` `arrow-left` `chevron` `chevron-right` `image` `spinner`.
- **Colour.** `blue-700` on light surfaces, `lime-500` on navy, the semantic hue inside an alert or chip. Icons never carry lime on a light surface.
- **Rules.** Decorative icons take `aria-hidden="true"`; an icon that is a control's only content takes `aria-label`. Equipment icons always appear with their text label — a customer should never have to guess whether a glyph means pump or compressor. Status is never an icon alone either: chips and messages pair the glyph with a word.
- **No emoji, ever**, and no Unicode characters used as icons. The only non-icon glyphs in the system are the `/` breadcrumb separator and the `·` middot used in mono metadata.

**Logo.** The mark is the **Strömungsschnitt** — three bars reading as stacked flow lines through a duct or pipe run, the middle one offset and carrying the signal accent to mark the point where RheinWerk intervenes. Geometry copied from the source; nothing was drawn from memory. Clear space is one bar height (25 % of the mark) on all four sides. Below 20 px the offset bar stops reading, so the wordmark is used alone. Never stretch, rotate or re-space the bars, never put lime on an outer bar, never add shadow, outline, gradient or a container, never place the lock-up on photography without a solid scrim, and never set the descriptor in Manrope. Files: `assets/logo-mark.svg`, `assets/logo-mark-inverse.svg`, `assets/logo-mark-mono.svg`, `assets/logo-lockup.svg`, `assets/logo-lockup-inverse.svg`.

---

## Components

47 components in eight directories, matching the inventory in `COMPONENTS.md` / `HANDOFF.md` §3. Each has a `.jsx`, a `.d.ts` props contract and a `.prompt.md` usage note; each directory has an `@dsCard` specimen.

**`components/brand/`** — `Logo`

**`components/icons/`** — `Icon`

**`components/primitives/`** — `Section` · `Container` · `Grid` · `Prose` · `VisuallyHidden`

**`components/navigation/`** — `UtilityBar` · `SiteHeader` · `MobileNavDrawer` · `Breadcrumb` · `SectionNav` · `SiteFooter`

**`components/content/`** — `Hero` · `UrgentServiceStrip` · `ServiceCard` · `EquipmentCard` · `IndustryCard` · `ProofCard` · `ReferenceCard` · `PricingSummaryCard` · `NamedContactCard` · `ProcessStepper` · `Accordion` · `Tabs` · `Chip` · `TechnicalSpecList` · `ImagePlaceholder`

**`components/action/`** — `Button` · `TextLink` · `IconButton` · `ContactRail` · `StickyActionBar`

**`components/form/`** — `MultiStepFormShell` · `TextInput` · `Textarea` · `Select` · `DateInput` · `RadioCardGroup` · `Checkbox` · `UploadDropzone` · `InlineAlert` · `CriticalAlert` · `ErrorSummary` · `ReviewSummary` · `SuccessPanel`

**`components/assistant/`** — `AssistantLauncher` · `AssistantPanel` · `SourceChip`

### Intentional additions

Three things exist here that `COMPONENTS.md` describes but does not name as components:

- **`Icon`** — a wrapper over the 27-glyph set, so no screen ever pastes raw SVG.
- **`ImagePlaceholder`** — the marked placeholder specified in `HANDOFF.md` §7 (ratio, subject, art direction, dashed border). Every image slot uses it until photography exists.
- **`Field`** (`components/form/Field.jsx`, no `.d.ts`) — the internal label + required-marker + message shell shared by the four input components. Not a public API.

### Criticality rule

Encoded in `CriticalAlert` and used by the request flow:

```ts
isCritical = production_impact === "Produktionsstillstand"
          || safety_hazard === "Ja" || safety_hazard === "Unklar"
```

Consequences, all mandatory: render `CriticalAlert` with `CRITICAL_NOTE`, keep it visible for the rest of the flow and in `SuccessPanel`, flag the payload `requires_human_review: true`, and never derive or display a priority, arrival time or resolution time client-side.

---

## Index

| Path | What it is |
|---|---|
| `styles.css` | The entry point consumers link. Import list only. |
| `tokens/colors.css` `typography.css` `spacing.css` `shape.css` `motion.css` `layers.css` `fonts.css` | 179 tokens, values copied verbatim from the source `tokens.css`. |
| `base.css` | Element defaults, link colours, the focus ring, `rw-spin` / `rw-pulse` keyframes, reduced-motion handling. |
| `assets/logo-*.svg` | Mark and lock-up, five variants. |
| `assets/icons/*.svg` | The 27-glyph line set. |
| `components/<group>/` | 47 components — `.jsx`, `.d.ts`, `.prompt.md`, plus one `@dsCard` specimen per directory. |
| `guidelines/*.card.html` | 23 foundation specimen cards: Colors, Type, Spacing, Motion, Brand. |
| `ui_kits/website/` | Click-through recreation of the marketing site — see its own `README.md`. |
| `templates/website-page/` | Copy-and-edit page scaffold (`WebsitePage.dc.html`): utility bar, header, navy hero, service-card row, proof band, footer. Point the `base` line in its `ds-base.js` at the bound design system and edit the copy in place. |
| `thumbnail.html` | The homepage tile. |
| `SKILL.md` | Agent-skill entry point for using this system outside the workspace. |

## Caveats

- **Fonts are loaded from Google Fonts.** No binaries were supplied and none are needed — Manrope, Inter and IBM Plex Mono are exactly what `HANDOFF.md` §2 loads via `next/font/google`. `tokens/fonts.css` holds the CDN `@import`, so this system declares no `@font-face` rule of its own. Nothing was substituted.
- **Fluid type is split into parts.** Each fluid step keeps its computed value verbatim but is expressed as three tokens — `--rw-type-<role>-min`, `-fluid`, `-max` — which the size token composes with `clamp(var(…), var(…), var(…))`. Same result, and the size token no longer reads as a comma-separated list to tooling.
- **Destructive active state.** The source specimen rendered a pressed destructive button as `#8E241D`, a value that exists in no token. `Button` uses `--rw-action-destructive-bg-hover` (danger-800) for both hover and active rather than introduce an untokenised hex.
- **No photography.** Every image slot is a marked placeholder.
