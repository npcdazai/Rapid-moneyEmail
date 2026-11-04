// Resizable three-pane layout (folders | list | reading). Pure helpers; widths persist per browser.
//   localStorage "mh_panes" → {"folders":240,"list":410}
export const PANES_KEY = "mh_panes";
export const LIMITS = Object.freeze({ folders: { min: 150, max: 360 }, list: { min: 260, max: 720 } });
export const MIN_READING = 380; // the reading pane never gets narrower than this
export const DEFAULTS = Object.freeze({ folders: 220, list: 380 });
export const KEY_STEP = 16;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);

/** Clamp one pane width to its limits and to what leaves MIN_READING for the reading pane. */
export function clampPane(pane, value, { total = Infinity, other = 0 } = {}) {
  const lim = LIMITS[pane];
  if (!lim) return NaN;
  let v = num(value);
  if (!Number.isFinite(v)) v = DEFAULTS[pane];
  const room = Number.isFinite(total) ? total - other - MIN_READING : Infinity;
  return Math.round(Math.max(lim.min, Math.min(lim.max, room, v)));
}

/** Coerce anything (parsed JSON, partial object, garbage) to valid widths. */
export function normalizePanes(raw, ctx = {}) {
  const o = raw && typeof raw === "object" ? raw : {};
  const folders = clampPane("folders", o.folders, { ...ctx, other: 0 });
  const list = clampPane("list", o.list, { ...ctx, other: folders });
  return { folders, list };
}

function store(s) {
  if (s) return s;
  try { return globalThis.localStorage || null; } catch { return null; }
}
export function loadPanes(s, ctx) {
  try { return normalizePanes(JSON.parse(store(s)?.getItem(PANES_KEY) || "null"), ctx); } catch { return normalizePanes(null, ctx); }
}
export function savePanes(panes, s) {
  try { store(s)?.setItem(PANES_KEY, JSON.stringify(normalizePanes(panes))); } catch { /* storage unavailable */ }
}
export function resetPanes(s) {
  try { store(s)?.removeItem(PANES_KEY); } catch { /* ignore */ }
  return { ...DEFAULTS };
}

/** Keyboard step for a splitter: Arrow keys ±16px, Home/End → min/max, Enter/Escape → reset. Returns a new width or null. */
export function keyResize(pane, current, key, shift = false) {
  const lim = LIMITS[pane];
  const step = shift ? KEY_STEP * 4 : KEY_STEP;
  if (key === "ArrowLeft") return current - step;
  if (key === "ArrowRight") return current + step;
  if (key === "Home") return lim.min;
  if (key === "End") return lim.max;
  if (key === "Enter" || key === "Escape") return DEFAULTS[pane];
  return null;
}
