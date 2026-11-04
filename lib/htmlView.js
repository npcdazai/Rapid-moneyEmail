// Pure helpers for the sandboxed HTML email view (UI v2, docs/ui-v2.md
// "HTML view"). No React, no DOM: safe to import from node tests.
//
//   buildHtmlDoc({ html, csp, lang, theme })  → srcdoc string for the iframe
//   trustedSenders / isTrustedSender / trustSender / untrustSender
//                                              → localStorage "mh_trusted_senders"
//   getBodyView / setBodyView                  → localStorage "mh_body_view"
//   normalizeHtmlPayload, classifyHtmlError    → shape-check the endpoint
//   attachmentRefs / inlineAttachmentSources   → cid: images → data: URLs
//   blockedImagesLabel / inlineImagesLabel     → header strip text

export const TRUSTED_KEY = "mh_trusted_senders";
export const BODY_VIEW_KEY = "mh_body_view";
export const BODY_VIEWS = ["text", "html"];

// Used only if the server omits `csp` (it never should). Identical to the
// backend constant: no scripts, no frames, no fonts, no network except
// same-origin + data: images, inline styles only.
export const FALLBACK_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";

function storage(store) {
  if (store) return store;
  try {
    if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  } catch {
    /* privacy mode */
  }
  return null;
}

/** Escape a string for insertion inside a double-quoted HTML attribute. */
export function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\r\n\0]/g, " ");
}

/** Keep a CSP string on one line and free of characters that could break the meta tag. */
export function cleanCsp(csp) {
  const s = typeof csp === "string" ? csp.replace(/[\r\n\0]+/g, " ").trim() : "";
  return s || FALLBACK_CSP;
}

// The iframe document's own reset. Kept tiny: the mail's inline styles win
// for anything it sets explicitly; this only fixes the defaults.
const RESET_CSS = `
:root{color-scheme:light dark}
html,body{margin:0;padding:0}
body{margin:8px;font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,Roboto,"Noto Sans","Noto Sans Devanagari","Nirmala UI","Mangal",Helvetica,Arial,sans-serif;color:#323130;background:#ffffff;overflow-wrap:anywhere;word-break:break-word}
img{max-width:100%;height:auto}
table{max-width:100%}
pre{white-space:pre-wrap}
a{color:#00737e}
img[data-mh-src]{min-width:1px;min-height:1px;outline:1px dashed #cbd8db}
@media (prefers-color-scheme:dark){body{color:#dce4e9;background:#152028}a{color:#5fe0ec}img[data-mh-src]{outline-color:#3a4b55}}
`.replace(/\n/g, "");

// Explicit theme (the app's own mh_theme choice beats the OS preference).
const THEME_CSS = {
  light: ":root{color-scheme:light}body{color:#323130;background:#ffffff}a{color:#00737e}",
  dark: ":root{color-scheme:dark}body{color:#dce4e9;background:#152028}a{color:#5fe0ec}img[data-mh-src]{outline-color:#3a4b55}",
};

/**
 * Build the complete srcdoc for the sandboxed iframe.
 *
 * `html` is the server-sanitised fragment and is inserted as-is (the sandbox
 * + CSP are the second and third line of defence, the sanitiser the first).
 * `csp` is repeated as a <meta http-equiv> inside the document so the policy
 * holds even in browsers that ignore the iframe `csp` attribute.
 * No <base target>: with sandbox="" links cannot navigate anyway, and we want
 * them inert (agents copy the URL via the context menu). No scripts, ever.
 */
export function buildHtmlDoc({ html, csp, lang = "en", theme = null } = {}) {
  const body = typeof html === "string" ? html : "";
  const policy = escapeAttr(cleanCsp(csp));
  const language = escapeAttr(String(lang || "en").slice(0, 35));
  const extra = theme && THEME_CSS[theme] ? THEME_CSS[theme] : "";
  return (
    "<!doctype html>" +
    `<html lang="${language}">` +
    "<head>" +
    '<meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${policy}">` +
    '<meta name="referrer" content="no-referrer">' +
    `<style>${RESET_CSS}${extra}</style>` +
    "</head>" +
    `<body>${body}</body>` +
    "</html>"
  );
}

// ── Trusted senders ("Always show images for this sender") ──

export function normalizeEmail(email) {
  if (typeof email !== "string") return "";
  const s = email.trim().toLowerCase();
  // Accept "Name <a@b>" too; keep only the address part.
  const m = s.match(/<([^<>\s]+@[^<>\s]+)>/);
  return (m ? m[1] : s).replace(/^<|>$/g, "");
}

export function trustedSenders(store) {
  const s = storage(store);
  if (!s) return [];
  try {
    const raw = s.getItem(TRUSTED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const e of arr) {
      const n = normalizeEmail(e);
      if (n && !out.includes(n)) out.push(n);
    }
    return out;
  } catch {
    return [];
  }
}

export function isTrustedSender(email, store) {
  const n = normalizeEmail(email);
  if (!n) return false;
  return trustedSenders(store).includes(n);
}

function writeTrusted(list, store) {
  const s = storage(store);
  if (!s) return;
  try {
    if (list.length === 0) s.removeItem(TRUSTED_KEY);
    else s.setItem(TRUSTED_KEY, JSON.stringify(list));
  } catch {
    /* quota / privacy */
  }
}

/** Add a sender; returns the new list. Idempotent, lower-cased. */
export function trustSender(email, store) {
  const n = normalizeEmail(email);
  const list = trustedSenders(store);
  if (!n || list.includes(n)) return list;
  const next = list.concat(n);
  writeTrusted(next, store);
  return next;
}

/** Remove a sender; returns the new list. */
export function untrustSender(email, store) {
  const n = normalizeEmail(email);
  const next = trustedSenders(store).filter((e) => e !== n);
  writeTrusted(next, store);
  return next;
}

// ── Per-user default body view ──

export function getBodyView(store) {
  const s = storage(store);
  if (!s) return "text";
  try {
    const v = s.getItem(BODY_VIEW_KEY);
    return BODY_VIEWS.includes(v) ? v : "text";
  } catch {
    return "text";
  }
}

export function setBodyView(view, store) {
  const v = BODY_VIEWS.includes(view) ? view : "text";
  const s = storage(store);
  if (!s) return v;
  try {
    if (v === "text") s.removeItem(BODY_VIEW_KEY);
    else s.setItem(BODY_VIEW_KEY, v);
  } catch {
    /* ignore */
  }
  return v;
}

export function otherBodyView(view) {
  return view === "html" ? "text" : "html";
}

// ── Endpoint payload / error shapes ──

function count(n) {
  const x = Number(n);
  return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
}

/**
 * `{ html, blockedRemote, cidsResolved, cidsUnresolved, csp }` with numbers
 * coerced, or `null` when the ticket has no HTML (`html: null`) or the shape
 * is not what we expect — the caller then keeps the text view.
 */
export function normalizeHtmlPayload(p) {
  if (!p || typeof p !== "object") return null;
  if (typeof p.html !== "string" || !p.html.trim()) return null;
  return {
    html: p.html,
    blockedRemote: count(p.blockedRemote),
    cidsResolved: count(p.cidsResolved),
    cidsUnresolved: count(p.cidsUnresolved),
    csp: cleanCsp(p.csp),
  };
}

/**
 * Map a failed fetch to what the pane should do:
 *   "disabled" — backend flag off (404 "html view disabled") or migration
 *                missing (503): hide the control for the rest of the session.
 *   "none"     — this ticket only (404 not found, 4xx).
 *   "error"    — transient (network, 5xx other than 503): keep the control,
 *                allow a retry.
 */
export function classifyHtmlError(err) {
  const status = Number(err?.status) || 0;
  const msg = String(err?.message || "").toLowerCase();
  if (status === 503) return "disabled";
  if (status === 404) return msg.includes("disabled") ? "disabled" : "none";
  if (status >= 400 && status < 500) return "none";
  return "error";
}

// ── Inline (cid:) images ──
// The server rewrites cid: to /api/tickets/:id/attachments/:attId. That URL
// needs the Bearer header, which an <img> inside the iframe cannot send, so
// the pane fetches each attachment as a blob and inlines it as a data: URL
// (the CSP allows `img-src data:`). Both steps below are pure string work.

function refRe(ticketId) {
  const id = String(ticketId).replace(/[^\d]/g, "");
  return new RegExp(`src="(/api/tickets/${id}/attachments/(\\d+))"`, "g");
}

/** Distinct attachment ids referenced by <img src="/api/tickets/<ticketId>/attachments/N">. */
export function attachmentRefs(html, ticketId) {
  if (typeof html !== "string" || ticketId == null) return [];
  const re = refRe(ticketId);
  const out = [];
  let m;
  while ((m = re.exec(html))) if (!out.includes(m[2])) out.push(m[2]);
  return out;
}

/**
 * Replace those src values using `sources` (Map or object: attId → data URL).
 * Unknown ids are left untouched (the image simply fails to load, inert).
 */
export function inlineAttachmentSources(html, ticketId, sources) {
  if (typeof html !== "string" || ticketId == null || !sources) return html;
  const get = (k) => (sources instanceof Map ? sources.get(k) : sources[k]);
  return html.replace(refRe(ticketId), (whole, url, attId) => {
    const data = get(attId);
    return typeof data === "string" && data.startsWith("data:") ? `src="${escapeAttr(data)}"` : whole;
  });
}

// ── Labels ──

export function blockedImagesLabel(n) {
  const c = count(n);
  if (c === 0) return "";
  return `${c} remote image${c === 1 ? "" : "s"} blocked`;
}

export function inlineImagesLabel(resolved, unresolved) {
  const r = count(resolved);
  const u = count(unresolved);
  if (r === 0 && u === 0) return "";
  return `Inline images: ${r} resolved, ${u} missing`;
}
