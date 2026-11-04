// Quote-fold segment mapper (pure). Turns the backend's display-only
// GET /api/tickets/:id/thread payload into what ReadingPane renders:
//
//   { newest, folds: [{ text, lines }], byReply: Map<replyId, { newest, folds }> }
//
// Anything malformed (404, network error, odd shape) maps to the plain body so
// the UI can never show less than the classic view did.

export function lineCount(text) {
  if (typeof text !== "string") return 0;
  const t = text.replace(/\s+$/, "");
  if (!t) return 0;
  return t.split("\n").length;
}

function cleanSegments(segments) {
  if (!Array.isArray(segments)) return [];
  const out = [];
  for (const s of segments) {
    if (typeof s !== "string") continue;
    const text = s.trim();
    if (!text) continue;
    out.push({ text, lines: lineCount(text) });
  }
  return out;
}

/** One body → { newest, folds }. Falls back to `fallback` when nothing usable. */
export function foldOne(view, fallback = "") {
  const fb = typeof fallback === "string" ? fallback : "";
  if (!view || typeof view !== "object") return { newest: fb, folds: [] };
  const newest = typeof view.newest === "string" ? view.newest : "";
  const folds = cleanSegments(view.segments);
  // A parser miss (empty newest and nothing quoted) must not blank the pane.
  if (!newest.trim() && folds.length === 0) return { newest: fb, folds: [] };
  // Parser produced only quoted parts (e.g. forwarded mail): keep them visible as the newest.
  if (!newest.trim()) return { newest: folds.map((f) => f.text).join("\n\n"), folds: [] };
  return { newest, folds };
}

/** Whole payload → ticket body + per-reply map. */
export function mapThreadView(payload, ticket = {}) {
  const body = typeof ticket.body === "string" ? ticket.body : "";
  const base = foldOne(payload, body);
  const byReply = new Map();
  const list = Array.isArray(payload?.replies) ? payload.replies : [];
  const replyBodies = new Map((ticket.replies || []).map((r) => [String(r.id), r.body || ""]));
  for (const r of list) {
    if (!r || r.id == null) continue;
    byReply.set(String(r.id), foldOne(r, replyBodies.get(String(r.id)) || ""));
  }
  return { newest: base.newest, folds: base.folds, byReply, ok: true };
}

/** Summary text for a fold. */
export function foldSummary(fold) {
  const n = fold?.lines || 0;
  return `Quoted text (${n} line${n === 1 ? "" : "s"})`;
}

/** Total hidden lines — handy for the toolbar hint. */
export function hiddenLines(folds) {
  return (folds || []).reduce((a, f) => a + (f.lines || 0), 0);
}
