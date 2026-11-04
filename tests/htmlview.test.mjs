import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildHtmlDoc,
  escapeAttr,
  cleanCsp,
  FALLBACK_CSP,
  TRUSTED_KEY,
  BODY_VIEW_KEY,
  normalizeEmail,
  trustedSenders,
  isTrustedSender,
  trustSender,
  untrustSender,
  getBodyView,
  setBodyView,
  otherBodyView,
  normalizeHtmlPayload,
  classifyHtmlError,
  attachmentRefs,
  inlineAttachmentSources,
  blockedImagesLabel,
  inlineImagesLabel,
} from "../lib/htmlView.js";

const memStore = (init = {}) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m,
  };
};
const brokenStore = {
  getItem() {
    throw new Error("denied");
  },
  setItem() {
    throw new Error("denied");
  },
  removeItem() {
    throw new Error("denied");
  },
};

const CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";

// ── document builder ──

test("buildHtmlDoc: minimal document with charset, CSP meta, reset style and the raw body", () => {
  const doc = buildHtmlDoc({ html: "<p>Namaste <b>ji</b></p>", csp: CSP });
  assert.ok(doc.startsWith("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"));
  assert.ok(doc.includes(`<meta http-equiv="Content-Security-Policy" content="${CSP.replace(/'/g, "'")}">`));
  assert.ok(doc.includes('<meta name="referrer" content="no-referrer">'));
  assert.ok(doc.includes("<style>"));
  assert.ok(doc.includes("Noto Sans Devanagari"));
  assert.ok(doc.includes("img{max-width:100%"));
  assert.ok(doc.includes("prefers-color-scheme:dark"));
  assert.ok(doc.endsWith("<body><p>Namaste <b>ji</b></p></body></html>"));
  assert.ok(!doc.includes("<base"), "no <base target>: links are inert by design");
  assert.ok(!doc.includes("<script"));
});

test("buildHtmlDoc: csp and lang are attribute-escaped, csp falls back when missing", () => {
  const doc = buildHtmlDoc({ html: "", csp: 'x"><script>alert(1)</script>', lang: 'hi" onload="x' });
  assert.ok(!doc.includes("<script>"));
  assert.ok(doc.includes('content="x&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"'));
  assert.ok(doc.includes('<html lang="hi&quot; onload=&quot;x">'));
  const fb = buildHtmlDoc({ html: "<p>x</p>" });
  assert.ok(fb.includes(`content="${escapeAttr(FALLBACK_CSP)}"`));
  assert.equal(cleanCsp("  a;\nb  "), "a; b");
  assert.equal(cleanCsp(null), FALLBACK_CSP);
  assert.equal(cleanCsp(42), FALLBACK_CSP);
});

test("buildHtmlDoc: explicit theme adds overrides; non-string html renders an empty body", () => {
  const dark = buildHtmlDoc({ html: "<p>x</p>", csp: CSP, theme: "dark" });
  assert.ok(dark.includes(":root{color-scheme:dark}"));
  const light = buildHtmlDoc({ html: "<p>x</p>", csp: CSP, theme: "light" });
  assert.ok(light.includes(":root{color-scheme:light}"));
  const none = buildHtmlDoc({ html: null, csp: CSP, theme: "weird" });
  assert.ok(none.endsWith("<body></body></html>"));
  assert.ok(!none.includes("color-scheme:dark}body"));
});

// ── trusted senders ──

test("normalizeEmail: lower-cases, trims, unwraps Name <addr>", () => {
  assert.equal(normalizeEmail("  Ramesh@Example.COM "), "ramesh@example.com");
  assert.equal(normalizeEmail("Ramesh Kumar <R@EX.in>"), "r@ex.in");
  assert.equal(normalizeEmail("<a@b.c>"), "a@b.c");
  assert.equal(normalizeEmail(null), "");
  assert.equal(normalizeEmail(42), "");
});

test("trusted senders: add is idempotent and lower-cased, has/list read back, remove clears the key", () => {
  const s = memStore();
  assert.deepEqual(trustedSenders(s), []);
  assert.equal(isTrustedSender("a@b.c", s), false);
  assert.deepEqual(trustSender("A@B.C", s), ["a@b.c"]);
  assert.deepEqual(trustSender("a@b.c", s), ["a@b.c"]);
  assert.deepEqual(trustSender("Second <x@y.z>", s), ["a@b.c", "x@y.z"]);
  assert.equal(s.getItem(TRUSTED_KEY), JSON.stringify(["a@b.c", "x@y.z"]));
  assert.equal(isTrustedSender("  A@b.C", s), true);
  assert.equal(isTrustedSender("", s), false);
  assert.deepEqual(trustSender("", s), ["a@b.c", "x@y.z"]);
  assert.deepEqual(untrustSender("A@B.C", s), ["x@y.z"]);
  assert.deepEqual(untrustSender("x@y.z", s), []);
  assert.equal(s.getItem(TRUSTED_KEY), null);
});

test("trusted senders: malformed storage and denied storage degrade to empty", () => {
  assert.deepEqual(trustedSenders(memStore({ [TRUSTED_KEY]: "{not json" })), []);
  assert.deepEqual(trustedSenders(memStore({ [TRUSTED_KEY]: '{"a":1}' })), []);
  assert.deepEqual(trustedSenders(memStore({ [TRUSTED_KEY]: '[" A@b.c ", 7, null, "a@b.c"]' })), ["a@b.c"]);
  assert.deepEqual(trustedSenders(brokenStore), []);
  assert.deepEqual(trustSender("a@b.c", brokenStore), ["a@b.c"]); // returned, not persisted
  assert.equal(isTrustedSender("a@b.c", brokenStore), false);
});

// ── body view preference ──

test("body view: text by default, html persisted, unknown values ignored, text clears the key", () => {
  const s = memStore();
  assert.equal(getBodyView(s), "text");
  assert.equal(setBodyView("html", s), "html");
  assert.equal(s.getItem(BODY_VIEW_KEY), "html");
  assert.equal(getBodyView(s), "html");
  assert.equal(setBodyView("bogus", s), "text");
  assert.equal(s.getItem(BODY_VIEW_KEY), null);
  assert.equal(getBodyView(memStore({ [BODY_VIEW_KEY]: "pdf" })), "text");
  assert.equal(getBodyView(brokenStore), "text");
  assert.equal(setBodyView("html", brokenStore), "html");
  assert.equal(otherBodyView("text"), "html");
  assert.equal(otherBodyView("html"), "text");
});

// ── payload / errors ──

test("normalizeHtmlPayload: coerces counts, keeps csp, null for no_html or junk", () => {
  const ok = normalizeHtmlPayload({ html: "<p>x</p>", blockedRemote: "3", cidsResolved: 1.9, cidsUnresolved: -2, csp: CSP });
  assert.deepEqual(ok, { html: "<p>x</p>", blockedRemote: 3, cidsResolved: 1, cidsUnresolved: 0, csp: CSP });
  assert.equal(normalizeHtmlPayload({ html: "<p>x</p>" }).csp, FALLBACK_CSP);
  assert.equal(normalizeHtmlPayload({ html: null, reason: "no_html" }), null);
  assert.equal(normalizeHtmlPayload({ html: "   " }), null);
  assert.equal(normalizeHtmlPayload(null), null);
  assert.equal(normalizeHtmlPayload("string"), null);
});

test("classifyHtmlError: disabled / none / error", () => {
  assert.equal(classifyHtmlError({ status: 404, message: "html view disabled" }), "disabled");
  assert.equal(classifyHtmlError({ status: 503, message: "tickets.html column missing" }), "disabled");
  assert.equal(classifyHtmlError({ status: 404, message: "Ticket not found" }), "none");
  assert.equal(classifyHtmlError({ status: 403, message: "forbidden" }), "none");
  assert.equal(classifyHtmlError({ status: 500, message: "boom" }), "error");
  assert.equal(classifyHtmlError(new TypeError("Failed to fetch")), "error");
  assert.equal(classifyHtmlError(null), "error");
});

// ── inline images ──

test("attachmentRefs / inlineAttachmentSources: only this ticket's attachment URLs, data: only", () => {
  const html =
    '<img src="/api/tickets/12/attachments/5"><img src="/api/tickets/12/attachments/6" alt="a">' +
    '<img src="/api/tickets/12/attachments/5"><img src="/api/tickets/99/attachments/7">' +
    '<img data-mh-src="https://cdn.example/x.png">';
  assert.deepEqual(attachmentRefs(html, 12), ["5", "6"]);
  assert.deepEqual(attachmentRefs(html, "12"), ["5", "6"]);
  assert.deepEqual(attachmentRefs(html, 1), []);
  assert.deepEqual(attachmentRefs(null, 12), []);
  const out = inlineAttachmentSources(html, 12, new Map([["5", "data:image/png;base64,AAAA"], ["6", "https://evil/x"]]));
  assert.ok(out.includes('<img src="data:image/png;base64,AAAA"><img src="/api/tickets/12/attachments/6" alt="a">'));
  assert.ok(out.includes('<img src="data:image/png;base64,AAAA"><img src="/api/tickets/99/attachments/7">'));
  assert.ok(out.includes('data-mh-src="https://cdn.example/x.png"'));
  // plain-object sources and a quote inside a data URL are escaped
  const out2 = inlineAttachmentSources('<img src="/api/tickets/3/attachments/1">', 3, { 1: 'data:x,"' });
  assert.equal(out2, '<img src="data:x,&quot;">');
  assert.equal(inlineAttachmentSources(html, 12, null), html);
});

// ── labels ──

test("labels: blocked remote images and inline cid summary", () => {
  assert.equal(blockedImagesLabel(0), "");
  assert.equal(blockedImagesLabel(1), "1 remote image blocked");
  assert.equal(blockedImagesLabel(4), "4 remote images blocked");
  assert.equal(blockedImagesLabel("x"), "");
  assert.equal(inlineImagesLabel(0, 0), "");
  assert.equal(inlineImagesLabel(2, 0), "Inline images: 2 resolved, 0 missing");
  assert.equal(inlineImagesLabel(0, 1), "Inline images: 0 resolved, 1 missing");
});
