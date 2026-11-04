// Message-list appearance + colour theme, persisted per browser (pure module).
//
//   localStorage "mh_appearance" → {"density":"compact","previewLines":1,"senderFirst":true}
//   localStorage "mh_theme"      → "light" | "dark"   (absent = follow the OS)
//
// The shell applies the appearance as data attributes:
//   <div class="outlook" data-density="compact" data-preview-lines="1" data-sender-first="1">
// and the theme as <html data-theme="dark|light"> (see layout.js for the pre-paint script).

export const APPEARANCE_KEY = "mh_appearance";
export const THEME_KEY = "mh_theme";

export const DEFAULT_APPEARANCE = Object.freeze({
  density: "compact", // agents asked for compact on 1366×768
  previewLines: 1,
  senderFirst: true,
});

const DENSITIES = new Set(["compact", "comfortable"]);
const THEMES = new Set(["light", "dark"]);

function store(s) {
  if (s) return s;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/** Coerce anything (parsed JSON, partial object, garbage) to a valid appearance. */
export function normalizeAppearance(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  return {
    density: DENSITIES.has(o.density) ? o.density : DEFAULT_APPEARANCE.density,
    previewLines: Number(o.previewLines) === 2 ? 2 : 1,
    senderFirst: o.senderFirst === undefined ? DEFAULT_APPEARANCE.senderFirst : !!o.senderFirst,
  };
}

export function loadAppearance(s) {
  const st = store(s);
  if (!st) return { ...DEFAULT_APPEARANCE };
  try {
    return normalizeAppearance(JSON.parse(st.getItem(APPEARANCE_KEY) || "null"));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveAppearance(a, s) {
  const st = store(s);
  const norm = normalizeAppearance(a);
  if (!st) return norm;
  try {
    st.setItem(APPEARANCE_KEY, JSON.stringify(norm));
  } catch {
    /* ignore */
  }
  return norm;
}

/** Data attributes for the shell element. */
export function appearanceAttrs(a) {
  const n = normalizeAppearance(a);
  return {
    "data-density": n.density,
    "data-preview-lines": String(n.previewLines),
    "data-sender-first": n.senderFirst ? "1" : "0",
  };
}

/** Stored theme choice or null (= system). */
export function loadTheme(s) {
  const st = store(s);
  if (!st) return null;
  try {
    const t = st.getItem(THEME_KEY);
    return THEMES.has(t) ? t : null;
  } catch {
    return null;
  }
}

/** `theme` = "light" | "dark" | null (null clears the choice → follow the OS). */
export function saveTheme(theme, s) {
  const st = store(s);
  if (!st) return;
  try {
    if (THEMES.has(theme)) st.setItem(THEME_KEY, theme);
    else st.removeItem(THEME_KEY);
  } catch {
    /* ignore */
  }
}

/** Apply the theme choice to <html>. */
export function applyTheme(theme, doc) {
  const d = doc || (typeof document !== "undefined" ? document : null);
  if (!d?.documentElement) return;
  if (THEMES.has(theme)) d.documentElement.setAttribute("data-theme", theme);
  else d.documentElement.removeAttribute("data-theme");
}
