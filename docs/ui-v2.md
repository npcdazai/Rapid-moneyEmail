# MailHub UI v2 — agent-facing improvements (flagged)

Date: 2026-10-17. Scope: the six UI patterns from the backend's
`docs/research/synthesis.md` (#1, #4, #9, #13, #14, #20, #21), re-implemented in our own
code. No new npm dependency, no CDN, no web fonts, no telemetry, no Microsoft/Fluent assets.
The backend send path, auto-reply, `AUTO_REPLY_SHADOW` and auth are untouched; the UI adds
**no new way to send email** (the only new backend route is read-only).

## 1. Flag and kill switch

| Layer | Key | Meaning |
|-------|-----|---------|
| Build-time | `NEXT_PUBLIC_UI_V2` | `"0"` disables v2 for everyone (default: enabled). Inlined by Next.js — needs a rebuild to change. |
| Per user | `localStorage["mh_ui_classic"] = "1"` | "Classic layout" — the user's own kill switch. Toggle lives in the avatar menu (top right). |

`lib/flags.js` → `uiV2()` = `NEXT_PUBLIC_UI_V2 !== "0" && mh_ui_classic !== "1"`.
The shell (`app/page.js`) resolves it **after mount** (so SSR and the first client render
agree) and only then passes `v2` down to `MessageList` and `ReadingPane`. With the flag off,
every component renders its pre-v2 markup; the CSS additions are scoped to
`html[data-ui="v2"]` or to the `data-density` / `data-preview-lines` / `data-sender-first`
attributes the shell only sets when v2 is on. A tiny inline script in `app/layout.js` sets
`<html data-ui="v2" data-theme=…>` before first paint so the font slot and dark theme do not
flash.

### Rollback
* Everyone: set `NEXT_PUBLIC_UI_V2=0` in the frontend env (`.env.local` / pm2 env), rebuild
  (`npm run build`), restart `rapidmoney-email`.
* One user: avatar menu → tick **Classic layout** (writes `mh_ui_classic=1`; no rebuild).
* Backend half only: `THREAD_VIEW_ENABLED=0` makes `GET /api/tickets/:id/thread` return 404
  and the pane falls back to the plain body automatically.

## 2. What shipped (in order)

### #1 Quote folding
* Backend: **one new file** `src/routes/threadView.js` (`threadViewRouter`), mounted in
  `src/index.js` immediately before `ticketsRouter` on the same `/api/tickets` prefix with
  `authMiddleware` (+ `requireModule(...MAIL_SECTIONS)` inside the router).
  `GET /api/tickets/:id/thread` → `{ id, newest, segments[], replies: [{ id, newest, segments }] }`
  using the existing `parseThread` (`src/email/threadParser.js`). Display only; it does not
  mark the ticket read and never writes anything. Bodies stored as HTML-only are flattened
  via the same `htmlToPlain` the parser already uses. Env `THREAD_VIEW_ENABLED` (default `1`).
* Frontend: `api.getThread(id)` in `lib/api.js`; `lib/threadFold.js` maps the payload
  (malformed / 404 → the plain `ticket.body`, exactly as classic). `ReadingPane` renders
  `newest` as the visible text and each older segment in a native
  `<details class="quote-fold"><summary>Quoted text (N lines)</summary>…</details>`;
  replies are folded the same way. **`b`** toggles all folds; clicking a summary toggles one.
  Note: `newest` is the parser's normalised text (NFC, collapsed whitespace), so the visible
  body can differ from the raw stored text by whitespace only; the raw text is still what
  classic shows.

### #9 / #21 Keyboard shortcuts + listbox semantics
`lib/shortcuts.js` — a ~120-line registry (no dependency): ignores events whose target is an
`input` / `textarea` / `select` / `contentEditable` (Escape opts in), never handles
Ctrl/Meta/Alt combinations, supports `g` chords with a 900 ms window, later bindings win
(the pane overrides the shell while a message is open), `when()` scopes a binding, `table()`
feeds the `?` cheat-sheet. One `keydown` listener on `document` (`installShortcuts`).

| Keys | Action | Where |
|------|--------|-------|
| `j` / `k` | next / previous message (moves the focused row; see #13) | Mail tab |
| `↓` / `↑` | same, only while focus is inside the list | list |
| `Enter` / `o` | open the focused message and move focus to the reading pane | list / Mail tab |
| `Esc` | back to the list (focus returns to the previously selected row); closes the help dialog; works inside inputs and the reply editor | anywhere |
| `/` | focus the search box | Mail tab |
| `r` | open the reply editor and focus it | message open |
| `f` | flag / unflag the current message | Mail tab |
| `u` | mark read / unread | Mail tab |
| `s` | focus (and open, where the browser allows `showPicker`) the status select | message open |
| `b` | show / hide all quoted text | message open |
| `g` then `i` / `f` / `b` | go to Inbox / Flagged / SLA Breached (only folders the user is allocated) | anywhere |
| `?` | keyboard-shortcut cheat-sheet | anywhere |

A11y: the row container is `role="listbox"` labelled by a visually hidden heading
(`.sr-only`), rows are `role="option"` with `aria-selected`, roving `tabindex` (exactly one
row in the tab order: the cursor, else the selected row, else the first), `Space` on a focused
row opens it, the flag button has `aria-label` + `aria-pressed`, the reading pane is
`#mh-reading-pane` with `tabindex="-1"` so focus can be handed to it and back
(roundcube/tabster `memorizeCurrent` idea). No virtualisation (not in scope).

### #13 Preview delay
`KEYBOARD_PREVIEW_DELAY_MS = 400` in `app/page.js`: `j`/`k`/arrows move the cursor row and
focus it immediately, the ticket fetch (`setSelectedId`, which remounts `ReadingPane`) runs
after 400 ms of no further movement. A click, `Enter` or `o` cancels the timer and opens at once.

### #14 Density + appearance
`lib/appearance.js` — one object `{ density: "compact"|"comfortable", previewLines: 1|2,
senderFirst: bool }` persisted in `localStorage["mh_appearance"]`; defaults **compact / 1 /
sender-first**. Applied as `data-density`, `data-preview-lines`, `data-sender-first` on
`.outlook`; CSS at the end of `app/globals.css`. Compact equals today's ≤1440 px look at every
width (`.msg` 8px 10px, 32 px avatar); comfortable restores the wide-screen paddings. The
switches sit next to **Classic layout** in the avatar menu.

### #4 SLA / TAT chips
`lib/sla.js` → `slaChip(ticket, now)` → `{ label, tone, basis, dueAt }`, render-only on
`sla_due_at` / `tat_due_at` (nearer deadline wins; TAT-driven labels are prefixed "TAT").
Tones: `running` (>1 h, "due in 3h"), `amber` (<1 h, "due in 45m"), `ruby` ("Overdue by
2h 10m", also when the backend set `sla_breached`), `none` for Resolved/Closed or no due
time (nothing rendered). `paused` is styled but not produced yet — the backend has no
pause/hold column; it is there so a future `sla_paused_at` can light it without CSS work.
Rendered in `MessageList` rows and the `ReadingPane` header (title shows the due timestamp).

### #20 Tokens + dark mode
`app/theme.css` now defines `--mh-*` alias tokens (`--mh-bg`, `--mh-surface` +
`-hover/-selected/-read`, `--mh-text`, `--mh-muted`, `--mh-accent` + `-hover/-soft/-selected/
-border`, `--mh-danger` + `-text/-soft/-border`, `--mh-warn`, `--mh-ok`, `--mh-info-*`,
`--mh-focus`, `--mh-font`, `--mh-font-devanagari`). The legacy names (`--text`, `--panel`,
`--border`, …) now point at the aliases with **identical resolved values**, and the
hard-coded hex colours in `app/globals.css` were replaced by tokens whose light values are
the old hex, so classic renders the same (one exception: the two neutral chip texts
`#555`/`#605e5c` are unified on `#605e5c`). Analytics KPI gradients were left as literals.

* Dark: `:root[data-ui="v2"][data-theme="dark"]` and, when nothing is stored in
  `localStorage["mh_theme"]`, `@media (prefers-color-scheme: dark)` for
  `:root[data-ui="v2"]:not([data-theme="light"])`. `color-scheme` follows so native
  selects/scrollbars match. The ribbon stays dark in both themes (brand chrome).
* Font slot (v2 only): `system-ui, -apple-system, BlinkMacSystemFont, Roboto, "Noto Sans",
  "Noto Sans Devanagari", "Nirmala UI", "Mangal", Helvetica, Arial, sans-serif` — Latin from
  the system UI font, Devanagari glyphs from whichever of the three Devanagari faces the OS
  has (per-glyph fallback). Classic keeps the previous Segoe-first stack.
* `:focus-visible` outline (`2px solid var(--mh-focus)`) on every interactive element under
  v2; mouse clicks stay quiet.
* Layout dimensions unchanged apart from the chips and `<details>` blocks.

#### Contrast pairs checked (WCAG 2.x, computed; AA = ≥ 4.5:1 for body/small text)
Light (v2 values):

| Pair | Ratio |
|------|-------|
| `--mh-text #16232a` on `--mh-surface #fff` | 16.06 |
| `--mh-text` on `--mh-bg #f5f9fa` | 15.15 |
| email body `#323130` on `#fff` | 12.98 |
| `--mh-muted #56666c` on `#fff` / on read row `#fafcfc` | 5.98 / 5.81 |
| `--mh-muted-2 #66767c` (v2; classic keeps `#87969b` = 3.12) on `#fff` | 4.72 |
| `--mh-accent #00737e` (v2; classic `#00808c` = 4.70) on `#fff` / on `#d9fcff` | 5.59 / 5.15 |
| orange text `#a84a0a` (v2) on `#fdf1e8` | 5.19 |
| danger text `#b42121` on `#fff` / danger chip text on `#fdeeee` | 6.60 / 5.86 |
| warn chip `#7a6000` (v2) on `#fff4ce` | 5.45 |
| SLA running / resolved chip `#107c10` on `#e7f5e7`, `#15701a` (v2) on `#e3f6e0` | 4.76 / 5.51 |
| in-progress chip `#2563c9` on `#e7eefb` | 4.86 |
| neutral chip `#3d3d3d` (v2) on `#f3f2f1` | 9.71 |
| white on P1 chip `#d13438` · `#04232a` on cyan buttons · white on ribbon | 4.93 · 11.66 · 18.51 |

Dark:

| Pair | Ratio |
|------|-------|
| `--mh-text #e8eef1` on surface `#152028` / bg `#0e161c` | 14.13 / 15.59 |
| email body `#dce4e9` on `#152028` | 12.86 |
| `--mh-muted #aab8bf` on surface / read row `#121c23` | 8.13 / 8.48 |
| `--mh-muted-2 #9aa9b1` on surface | 6.84 |
| `--mh-accent #5fe0ec` on surface / on selected `#0f3a44` | 10.53 / 7.82 |
| orange `#f3a36e`, danger `#ff8f8f`, info `#8db6ff` text on surface | 8.10, 7.55, 7.45 |
| danger chip `#ff8f8f` on `#3a1b1d` · warn `#f2c14e` on `#332a10` · ok `#7ddc84` on `#14301a` | 7.07 · 8.46 · 8.48 |
| neutral chip `#d5dde2` on `#22323c` · toast `#0e161c` on `#e8eef1` · note text on `#2a2614` | 9.61 · 15.59 · 12.94 |

Not re-checked: category chip colours set in JS (`lib/format.js` `CATEGORIES`, e.g. pricing
`#b8860b` on `#fdf3d6` ≈ 3.9:1) — unchanged from classic and self-contained (both colours
set), so they read the same in dark; the auto-replied chip is 5.78:1.

## 3. Storage keys (all `localStorage`, per browser)

| Key | Values | Set by |
|-----|--------|--------|
| `mh_ui_classic` | `"1"` = classic | Classic layout toggle |
| `mh_appearance` | `{"density","previewLines","senderFirst"}` | Density / Preview lines / Sender above subject |
| `mh_theme` | `"light"` / `"dark"`; absent = follow the OS | Theme select |

## 4. Tests
`npm test` → `node --test tests/*.test.mjs` (plain node, no React, no DOM):
`shortcuts.test.mjs` (registry: typing targets, modifiers, chords + timeout, priority/when/
unbind, Escape-in-inputs, cheat-sheet table), `sla.test.mjs`, `threadFold.test.mjs`,
`flags-appearance.test.mjs` — **26 tests, all passing**. Backend gate
`scripts/verify.sh --no-contracts` stays green (the new router has no tests of its own; its
splitter is the already-tested `parseThread`).

## 5. Unverified (please check after the restart)
* **No browser on this host**: no screenshots, no axe run, no manual check of focus order,
  `<details>` rendering, dark theme or the 1366×768 fit. The contrast table above is computed
  from the token values, not measured on screen.
* `select.showPicker()` for `s` needs a user gesture in some browsers; focus always works.
* Whether the running pm2 process serves the rebuilt `.next` consistently — the build replaced
  the chunks on disk while the old server is still up; restart `rapidmoney-email` before judging.
* Hindi/Devanagari rendering depends on which of Noto Sans Devanagari / Nirmala UI / Mangal the
  agent's OS has installed.

## 6. Files
Frontend: `lib/flags.js`, `lib/shortcuts.js`, `lib/sla.js`, `lib/threadFold.js`,
`lib/appearance.js` (new); `lib/api.js` (+`getThread`), `app/layout.js` (pre-paint script),
`app/page.js`, `app/components/MessageList.js`, `app/components/ReadingPane.js`,
`app/theme.css`, `app/globals.css`, `package.json` (`test` script), `tests/*.test.mjs`,
this document. Backend: `src/routes/threadView.js` (new) and the two mount lines in
`src/index.js`.

## 7. HTML view (#11/#10)

Date: 2026-10-17. Frontend half of the Phase 4 fidelity chain (backend:
`rapidmoney-email-backend/docs/ecosystem/phase4-fidelity.md`, route
`GET /api/tickets/:id/html?images=1|0`). Read-only; no new way to send email; no new
dependency; nothing loads from outside the app origin unless the agent opts in to remote
images. Everything is behind `uiV2()` **and** the per-user `mh_body_view` preference, so the
classic path is unchanged (the classic render branch is the same JSX as before).

### What it does
* `lib/api.js` → `api.getTicketHtml(id, { images })`.
* `lib/htmlView.js` (pure, node-testable): `buildHtmlDoc`, trusted-sender list, body-view
  preference, payload/error classification, `cid:` inlining helpers, strip labels.
* `app/components/HtmlView.js`: `loadTicketHtml(id, { images })` (fetch → normalise → inline
  `cid:` images) and the `<HtmlView>` component (header strip + sandboxed iframe + Expand).
* `ReadingPane`: a **Text | HTML** segmented control at the right end of the toolbar
  (`role="group"`, `aria-pressed`), shortcut **`h`** (registered in the pane's shortcut table,
  listed by `?`), lazy fetch, fallback to the text/thread view on every failure (no toast).
  The HTML replaces only the original message body; replies, notes and attachments are
  unchanged.

### Storage keys (localStorage, per browser)

| Key | Values | Set by |
|-----|--------|--------|
| `mh_body_view` | `"html"`; absent = `"text"` (default) | Text / HTML control, `h` |
| `mh_trusted_senders` | JSON array of lower-cased addresses | "Always show for this sender" / "Stop trusting" |

### Fetch policy
* The HTML is requested when the ticket has loaded **and** the preference is HTML, or when
  the agent clicks HTML / presses `h`, plus **one probe per page lifetime** (the first ticket
  opened under v2) so a backend with `HTML_VIEW_ENABLED=0` hides the control everywhere
  after a single 404 rather than one request per ticket. `images=1` is sent when the sender
  (lower-cased `from_email`) is in `mh_trusted_senders`, or after "Show images".
* Responses: 404 `html view disabled` or 503 (migration 0008 missing) → control disappears
  for the session; 404 ticket / other 4xx or `{html:null}` → control hidden for that ticket;
  network/5xx → control stays, click retries. In every case the text view is what you see.
* `cid:` images: the server rewrites them to `/api/tickets/:id/attachments/:attId`, which
  needs the Bearer header an `<img>` inside the sandbox cannot send. `loadTicketHtml` fetches
  each referenced attachment of **this** ticket as a blob (`api.attachmentBlob`, image/* only,
  ≤ 4 MB) and inlines it as a `data:` URL before the document is built — the same pattern the
  pane already uses for the attachment thumbnails. Unresolvable ones stay inert.

### Sandbox / CSP decisions
* `<iframe sandbox="" referrerpolicy="no-referrer" csp={csp} srcDoc={doc}>`. **`sandbox=""`**
  (no `allow-scripts`, no `allow-same-origin`, no `allow-popups`, no `allow-forms`, no
  `allow-top-navigation`): the document runs in an opaque origin with no script, so it cannot
  read the parent, the session token, cookies or `localStorage`, cannot submit forms, open
  windows or navigate the app. `allow-same-origin` is never added — with `allow-scripts` it
  would let the frame remove its own sandbox.
* The server's `csp` (`default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'`)
  is applied twice: as the iframe `csp` attribute (Chromium embedded enforcement; applies
  directly to `srcdoc` documents) and as `<meta http-equiv="Content-Security-Policy">` inside
  the built document, so it holds in browsers that ignore the attribute. If the server ever
  omits `csp`, `FALLBACK_CSP` (the same string) is used. `<meta name="referrer"
  content="no-referrer">` duplicates the iframe attribute for the same reason.
* **Links are inert.** No `<base target="_blank">`: with an empty sandbox a link cannot
  navigate the frame, the parent or a new window, so the safe default is to intercept nothing
  and leave `<a>` unclickable. Agents copy a URL with the context menu ("Copy link address");
  the foot line under the frame says so. Opening links would need `allow-popups` +
  `allow-popups-to-escape-sandbox` and a click-through warning — deliberately not done.
* **`data:` images are allowed only via the server's allowlist.** The backend sanitiser drops
  every `data:` `src` from the mail (`sanitizeEmailHtml`: "no `data:` URLs") and only emits
  `cid:` resolutions it could map to a stored attachment; `img-src data:` in the CSP exists
  so the frontend can inline *those* attachments after fetching them with the Bearer header.
  A `data:` image therefore means "an attachment of this ticket", never "whatever the sender
  embedded" (which could carry oversized payloads or SVG with scripts — SVG attachments are
  served as octet-stream and are skipped by the inliner anyway).
* Remote images: default blocked (server moves `src` to `data-mh-src`; they render as a
  1 px dashed placeholder via the frame's reset CSS). Header strip: "N remote images blocked
  — Show images · Always show for this sender"; when a trusted sender's images are shown the
  strip offers "Stop trusting". "Inline images: N resolved, M missing" is shown when cids are
  present. Loading remote images is the one network path from the sandbox to the outside
  world, with `no-referrer`, and only on explicit opt-in.
* Height: the parent cannot read the sandboxed document, and there is no script in the frame
  to `postMessage` a height, so `.html-view-frame { height: clamp(240px, 60vh, 900px) }` with
  an **Expand** toggle (`max(1200px, 150vh)`); the frame scrolls internally beyond that.
* The built document (`buildHtmlDoc`) is `<!doctype html><html lang><head><meta charset>
  <meta CSP><meta referrer><style>reset</style></head><body>${html}</body></html>`. The reset
  sets `color-scheme: light dark`, body margin 8 px, the v2 font stack with the three Devanagari
  fallbacks, `img`/`table` `max-width: 100%`, `overflow-wrap: anywhere`, and
  `prefers-color-scheme: dark` colours; when the app has an explicit `data-theme` it is passed
  as `theme` and overrides the media query. `csp` and `lang` are attribute-escaped; `html` is
  inserted raw because the sanitiser already ran and the sandbox + CSP are the backstop.

### Keyboard
`h` — toggle Text / HTML (pane scope, `group: "Message"`, in the `?` cheat-sheet). It is a
no-op when the control is hidden (no HTML for this ticket / backend disabled).

### Rollback
* One user: pick **Text** (removes `mh_body_view`; that is also the default for everyone
  who never clicked HTML). Clear `mh_trusted_senders` to forget image opt-ins.
* Backend: `HTML_VIEW_ENABLED=0` (today's default) → 404 → the control disappears after the
  session's first probe; nothing else in the pane changes.
* Everyone: the existing v2 switches (`NEXT_PUBLIC_UI_V2=0` + rebuild, or Classic layout).

### Tests
`tests/htmlview.test.mjs` — 11 tests: document builder (structure, CSP/lang escaping,
fallback CSP, theme overrides, no `<base>`/`<script>`), trusted-sender add/has/remove with
malformed and denied storage, body-view get/set, payload normalisation, error
classification, attachment-ref extraction + `data:`-only inlining scoped to the ticket id,
strip labels. `npm test` → **37 tests, all passing**; `next build` succeeds.

### Unverified (no browser on this host)
* Actual rendering of the sandboxed `srcdoc` document, the iframe `csp` attribute behaviour
  across browsers (Chromium enforces it; Firefox/Safari rely on the in-document `<meta>`), and
  whether `img-src 'self'` matches anything from an opaque origin — which is why `cid:`
  images are inlined as `data:` instead of relying on `'self'`.
* The backend route end-to-end (it is behind `HTML_VIEW_ENABLED`, off today, and migration
  0008 has not been applied here), so the control has only been exercised through the
  pure-helper tests and the production build.
* Real-mail fidelity of the allowlisted HTML, dark-theme appearance of mails that set their
  own colours, the 60vh clamp on 1366×768, and the context-menu "copy link" claim.
* `?images=1` responses with large images and the 4 MB inline cap on real attachments.

### Files (this section)
New: `lib/htmlView.js`, `app/components/HtmlView.js`, `tests/htmlview.test.mjs`.
Modified: `lib/api.js` (+`getTicketHtml`), `app/components/ReadingPane.js` (control, `h`,
lazy fetch, `HtmlView` branch), `app/page.js` (one cheat-sheet row), `app/globals.css`
(`.body-seg`, `.html-view*`, `.hv-*` at the end of the v2 block), this document.

## 8. Compliance draft panel

Date: 2026-10-17. Frontend half of the compliance reply composer (backend:
`rapidmoney-email-backend/docs/compliance-composer/00-design.md`, §4 compose result, §5 API).
**SHADOW / review only**: the panel has no Send button, never writes into the reply editor and
never emails anything; "Accept" only records feedback. Rendered by `ReadingPane` below the
Conversation section, only under `uiV2()` **and** when the user holds the `autoreply` module
(the same gate as the backend routes). No new dependency, nothing loads from outside the app.

### What it shows
* Header **"Compliance draft · not sent"** with a status chip (`draft` / `partial · awaiting
  compliance config` (amber) / `config missing` / `error` / `needs review`; precedence error >
  partial > config missing > needs review), the draft version (`vN`) and the rules version; a
  chevron (or `c`) collapses it to the header line. The header label never changes with the
  state — it always reads **not sent**.
* Global **Language** / **Tone** selects (union of what the blocks offer) → `POST …/recompose
  { lang, tone }`; a global switch resets per-block variant picks.
* Buttons: **Re-analyse** (`POST …/analyze`, new version), **Accept** / **Reject**
  (`POST /api/compliance/drafts/:id/feedback { label }` — nothing is sent), **Copy text**
  (clipboard only).
* Route / min priority / info to request; **Rules fired** chips (rule ids) with the rules
  `flags` as coloured chips — `regulator_risk` red, `gro_notify` amber.
* Amber note "N blocks pending counsel approval" from `unapproved_blocks` (array or count).
* `status === "config_missing"` or `"error"`: a red banner listing the errors as sentences
  ("GRO contact not configured — ask Compliance", "Required block missing: …") replaces the
  composed text; the block list still renders (blocks without text show "not configured").
  Errors are **deduped per block** (`groupErrors`): `draft.errors_summary`
  (`[{ block, missing_count, paths }]`) is used when the backend sends it, otherwise `errors[]`
  is grouped by (code, block) client-side, so GRO contact reads once as "GRO contact not
  configured — ask Compliance (4 fields)" instead of four lines.
* `status === "partial"` (2026-10-17, backend partial mode): the composer rendered what it
  could (`draft.text` non-null, `draft.blocks` = rendered blocks only) and omitted the mandatory
  blocks whose config is missing (`draft.omitted_blocks: [{ id, reason: "config_missing",
  missing: ["config.gro.name", …] }]`); `draft.ok` is false — a partial draft is **never
  sendable**. The panel shows:
  * the amber chip above;
  * a muted line under the header: "Review only — the omitted blocks are mandatory for a
    complaint acknowledgement; this draft cannot be sent." (the existing blocks hint stays, plus
    one more hint that the list holds only the rendered blocks);
  * instead of the red banner, an amber box "Review draft — N mandatory blocks omitted until
    Compliance supplies configuration" listing each omitted block **once** by friendly name
    (`omittedBlocksSummary`: gro_contact → "GRO contact (name, email, phone, hours)",
    rbi_ombudsman_path → "RBI Ombudsman path", lender_identity → "Lender identity",
    fee_wording_approved → "Approved fee wording"; other ids fall back to `blockLabel`) with its
    missing config paths in a muted monospace sub-line. Duplicate rows for one block are merged;
    when `omitted_blocks` is absent the box falls back to the `config_missing` error groups.
    Non-config errors (if any) still appear in the soft amber list below it;
  * then the blocks and "Full text (review only — partial)" exactly as for a normal draft.
  Nothing else changes: no Send, no copy-to-editor, Accept only records feedback.
* New always-present block `auto_ack_notice` (right after the greeting) renders like any other
  block, label "Automated acknowledgement notice"; it is not in the mandatory set (no lock).
* **Analysis** `<details>`: compact table (intents, secondary, language, tone, demands, info
  missing, true signals, non-null entities, confidence, customer-master match) with the raw JSON
  in a nested `<details><pre>`.
* **Blocks** in composed order: label + id, block version, current variant, the rendered text
  (`lang="hi"` / `hi-Latn` / `en` so the browser picks a Devanagari face; the v2 font slot
  already carries the fallbacks), a lang select limited to `variants[id].langs` and a tone select
  limited to `variants[id].tones` (disabled when there is only one choice), and small inline
  inputs for editable slots only (`name`, `amount`, `txn_date`, `demand_phrase` — config-sourced
  slots such as `gro_*` are never editable). Mandatory blocks (grievance_registered,
  gro_contact, resolution_timeline_30d, rbi_ombudsman_path, lender_identity,
  recovery_conduct_assurance, data_consent_and_deletion_path) carry a lock icon. There is **no
  remove affordance for any block** and no free-text editing; the one-line hint under the
  heading says so.
* "Full text (as composed)" `<details>` with `draft.text`.

### What agents can and cannot change
Can: switch a block's language/tone, fill the four customer-fact slots, re-run the analysis,
record accept/reject, copy the text. Cannot: edit or delete block text, add blocks, send, or
push the draft into the reply editor (deliberately not offered in this iteration). Every change
calls `recompose` with cumulative `overrides` (`buildOverrides` in `lib/compliance.js`: only
editable slot keys, blanks dropped, numeric `amount` coerced) and replaces the panel with the new
version; after a successful recompose the panel also posts `variant_swap` / `slot_edit` feedback
against the new draft id with a short JSON `notes` ((removed: backend logs these on recompose) — drop this if the backend
logs those itself). Re-analyse clears the local overrides.

### Keyboard
`c` — show / hide the compliance draft (pane scope, group "Message"; listed by `?` only for
autoreply-module users). The collapsed state survives ticket switches for the page lifetime and
is not persisted.

### Header status line
`GET /api/compliance/status` is fetched **once per page load** when v2 is on and the user has
the `autoreply` module. When `config.complete === false` the avatar menu shows
"Compliance config incomplete (N items)" (title lists `config.missing`). Any error hides it.

### Hiding / rollback
* `GET /api/tickets/:id/compliance-draft` → 404 (route or `AI_COMPLIANCE_DRAFT` off), 503
  (migration 0009 missing), 403 (module) or a network failure → the panel renders nothing, no
  toast (`classifyComplianceError`). Other statuses (500/400) show one compact line with Retry.
  `{ draft: null }` shows "No compliance draft for this ticket yet" + an **Analyse** button.
* A failed recompose/analyze keeps the current version on screen with an inline error line.
* Everyone: the existing v2 switches (`NEXT_PUBLIC_UI_V2=0` + rebuild, or Classic layout);
  users without `autoreply` never see it.

### Tests
`tests/compliance-panel.test.mjs` — 21 tests over the pure helpers in `lib/compliance.js`
(`isMandatoryBlock`, `blockLabel`/`flagChip`, `statusChip` precedence, `editableSlots`,
`variantOptions`, `globalOptions`, `buildOverrides`, `buildRecomposeBody`, `errorMessage`,
`unapprovedCount`/`unapprovedNote`, `summarizeAnalysis`, `normalizeDraftPayload`,
`classifyComplianceError`, `langAttr`/`configStatusLine`, and for the partial state:
`statusChip` partial chip, `blockLabel("auto_ack_notice")`, `omittedBlocksSummary` names /
dedupe / fallback, `groupErrors` client-side fallback and `errors_summary` dedupe count,
`partialNote` + `normalizeDraftPayload` partial fields). `npm test` → **58 tests, all
passing**; `next build` succeeds.

### Unverified (no browser on this host; backend endpoints not live yet)
* The endpoints are being built concurrently: the panel has only been exercised against the
  documented shapes through the helper tests and the production build — no end-to-end call,
  so field names (`unapproved_blocks` on the draft row, `config_status`, feedback label
  handling, and the partial-state fields `omitted_blocks` / `errors_summary` — the panel
  tolerates `missing` or `paths` on both, and `path` / `slot` on plain `errors[]`) should be
  re-checked when the backend lands.
* Rendering: 1366×768 fit, dark theme, Devanagari glyphs in `.cd-text` (depends on the OS
  fonts), `<details>` nesting, select widths, `navigator.clipboard` (needs a secure context).
* Whether the backend also logs `variant_swap`/`slot_edit` on recompose (possible double
  logging — see above).

### Files (this section)
New: `lib/compliance.js`, `app/components/CompliancePanel.js`, `tests/compliance-panel.test.mjs`.
Partial state (2026-10-17): `lib/compliance.js` (`statusChip` partial, `omittedBlocksSummary`,
`omittedBoxTitle`, `groupErrors`, `partialNote`, `auto_ack_notice` label, `normalizeDraftPayload`
keeps `omitted_blocks` / `errors_summary`), `app/components/CompliancePanel.js`,
`app/globals.css` (`.cd-review-note`, `.cd-omitted*`), `tests/compliance-panel.test.mjs`.
Modified: `lib/api.js` (`getComplianceDraft`, `recomposeComplianceDraft`,
`analyzeComplianceDraft`, `complianceFeedback`, `complianceStatus`),
`app/components/ReadingPane.js` (one render line under v2 + `canAutoReply`), `app/page.js`
(status fetch + menu line, `c` cheat-sheet row), `app/globals.css` (`.cd-*`, `.me-menu-note` at
the end of the v2 block), this document.

### Refund drafts (2026-10-17, refund module)
Backend: `rapidmoney-email-backend/docs/refund-module/00-design.md` §3 (analysis), §6 (composer
result), §7 (storage/API/UI). Built against the documented shapes only — the backend was **not
live** when this shipped; every new field is optional and the panel degrades to the compliance
rendering when it is absent. Still SHADOW: nothing sends, no copy-to-editor, no new dependency,
no external URLs (policy pages are named by slug, never linked or fetched).

**Fields read** (GET/POST compliance-draft): `draft.module` (`"compliance"` | `"refund"`; anything
else normalises to `compliance`), `draft.scenario`, `draft.clause_ids[]`, `draft.stale[]` (stale
clause ids), `draft.flags` (+ `late_claim`, `policy_gap`), `blocks[].clause_ids[]`, and for
refund drafts `draft.analysis` per §3 (`scenario`, `candidates`, `duplicate`, `amount`, `currency`,
`txn_ref`, `txn_date`, `payment_mode`, `days_since_payment`, `info_present`, `info_missing`,
`signals`, `lang`, `tone`, `confidence`, `needs_review`, `source.scenario_from`).
`normalizeDraftPayload` defaults `module`/`scenario`/`clause_ids`/`stale`.

**Panel, only when `module === "refund"`** (`isRefundDraft`); compliance drafts render exactly as
before:
* header gains a small `refund` chip;
* **Scenario** row: chip with the friendly label (`scenarioLabel`: failed_txn_debited → "Failed
  transaction, amount debited", duplicate_emi → "Duplicate EMI", excess_payment → "Excess
  payment", cooling_off_exit → "Cooling-off exit", fee_in_kfs → "KFS-disclosed fee",
  assessment_fee_refund → "Assessment fee (₹199) refund", vas_fee → "Value-added service fee",
  wrong_account_credit → "Wrong account credit", unauthorised_debit → "Unauthorised debit",
  payment_not_reflected → "Payment not reflected"; unknown ids read as words; `title` = raw id),
  an amber `duplicate` badge when `analysis.duplicate === true`, the candidates muted when more
  than one, and "via rules|llm|fallback" from `source.scenario_from`. No scenario → amber
  "undetermined";
* **Clauses cited**: `clause_ids` as small monospace chips, `title` = clause heading from the
  static map (`clauseTitle` / `CLAUSE_TITLES`: RP-2.1…2.4, RP-3 (+ `RP-3.txn`/`RP-3.refund` → the
  parent heading), RP-4.3, RP-4.4, RP-5.1/5.2/5.3, TC-7.1, TC-7.2, TC-10.1/10.2/10.5,
  TC-26.1–26.4, GR-3, GR-5, GR-7, GR-8, PP-9.1/9.3; unknown ids fall back to "<Document> §n").
  Ids in `draft.stale` get a red border + a red "stale" marker (and are appended if missing from
  `clause_ids`); when any is stale a red line reads "Policy page changed — drafting with this
  block is blocked until Compliance reviews";
* **Flag notices** (`refundFlags`): `late_claim` → amber "Claim raised after the 7-day window —
  routed to a human, no refusal sent"; `policy_gap` → red "No published clause covers this —
  draft stopped after acknowledgement; routed to grievance@". Both also appear as chips in the
  Rules-fired row (`flagChip`: late_claim amber, policy_gap red); `regulator_risk`/`gro_notify`
  unchanged;
* **Missing information** (`splitMissingInfo(analysis)`, falling back to `draft.info_missing`)
  replaces the compliance "Info to request" text: **Transaction details** (merchant → "Merchant /
  payee", txn_ref → "Transaction reference (UTR / txn id)", txn_date_amount → "Transaction date
  and amount", reason → "Reason for the refund"), **Bank details (only when a credit is
  possible)** (beneficiary_name, account_number → "Bank account number", ifsc → "IFSC") and
  **Also** (registered_mobile → "Registered mobile number", unknown keys as words);
* **Analysis** table (`summarizeRefundAnalysis`): scenario, candidates, duplicate, amount,
  **masked** txn ref (`maskRef`: first 4 + last 2, middle → "…", ≤ 6 chars unchanged), txn date,
  payment mode, days since payment, info present / missing (friendly labels), true signals,
  language, tone, confidence, needs review, scenario from; raw JSON nested as before;
* **Blocks**: each block header is followed by its `clause_ids` chips (`blockClauses`); a block
  citing a stale clause gets a red left border and the stale line inline. Variant switcher,
  slots, lock icons and the no-edit/no-remove hint are unchanged.

**Policy status (avatar menu)**: `GET /api/compliance/policy` (`api.compliancePolicy()`) is
fetched **once per page load** under v2 for `autoreply` users, next to the "Compliance config
incomplete" line. `policySummary` turns `{ manifest, status, reviews }` into a muted "Policy pages
last checked <date>" (`status.checked_at`, else `manifest.fetched_at`) and, when `status.changed`
or `reviews` is non-empty, an amber button "Policy change detected (N) — review" (N = open reviews,
else changed slugs; `title` lists the changed slugs). The button opens a small modal
(`.policy-modal`, Esc/backdrop/× close) listing each review (slug, detected_at, old → new sha as
8-char prefixes), the stale block ids from `status.stale_blocks`, an optional note input and a
**Mark reviewed** button per row → `PATCH /api/compliance/policy/reviews/:id { notes }`
(`api.resolvePolicyReview`). A resolved row disappears; when none remain the amber item hides
(`status.changed` only refreshes on the next cron check). Any fetch error (404 while the route is
absent, 503, 403, network) hides both lines; a failed PATCH shows an inline error and keeps the row.

**Helpers** (`lib/compliance.js`): `SCENARIO_LABELS`, `CLAUSE_TITLES`, `INFO_LABELS`,
`STALE_CLAUSE_NOTE`, `isRefundDraft`, `scenarioLabel`, `clauseTitle`, `infoLabel`,
`splitMissingInfo`, `refundFlags`, `maskRef`, `clauseChips`, `blockClauses`,
`summarizeRefundAnalysis`, `shortSha`, `policySummary`.

**Tests**: `tests/compliance-panel.test.mjs` +8 (scenario labels, clause titles incl. sub-ids and
fallbacks, `splitMissingInfo`, `refundFlags` + `flagChip`, `maskRef` + refund analysis rows,
stale rendering data (`clauseChips`/`blockClauses`/normalised fields), compliance-module
unchanged path, `policySummary`) → `npm test` **66 tests, all passing**; `next build` succeeds.

**Unverified** (backend not live; no browser on this host): the exact field names once the
backend lands (`draft.module`/`scenario`/`clause_ids`/`stale`, `blocks[].clause_ids`,
`analysis.candidates`/`duplicate`/`payment_mode`/`days_since_payment`/`source.scenario_from`,
the `/api/compliance/policy` envelope and whether `reviews[]` carries `resolved_at` rows that
should be filtered client-side — the panel currently lists every row it is given, so the backend
should return open reviews only, as §1 says), whether `PATCH …/reviews/:id` accepts an empty body
when no note is typed, the rendering of the clause chips / notices / modal at 1366×768 and in the
dark theme, and the `title` hover on touch devices (no hover → heading not visible; acceptable for
a desktop review tool).

**Files**: `lib/api.js` (`compliancePolicy`, `resolvePolicyReview`), `lib/compliance.js`
(helpers above, `flagChip` + `normalizeDraftPayload` extended), `app/components/CompliancePanel.js`
(refund-only sections), `app/page.js` (policy fetch, two menu lines, review modal),
`app/globals.css` (`.cd-scenario`, `.cd-clause*`, `.cd-stale*`, `.cd-notice`, `.cd-missing*`,
`.cd-block.stale`, `.me-menu-note.quiet/.as-button`, `.policy-*`),
`tests/compliance-panel.test.mjs`, this section.
