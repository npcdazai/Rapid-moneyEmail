// UI v2 feature flag.
//
//   uiV2() === true  ⇢  build-time env NEXT_PUBLIC_UI_V2 !== "0"  (default ON)
//                        AND localStorage "mh_ui_classic" !== "1" (per-user kill switch)
//
// Pure module: no React, safe to import from node tests. Callers that render
// must resolve the flag after mount (see page.js) so SSR and the first client
// render agree.

export const CLASSIC_KEY = "mh_ui_classic";

function storage(store) {
  if (store) return store;
  try {
    if (typeof globalThis !== "undefined" && globalThis.localStorage) return globalThis.localStorage;
  } catch {
    /* access denied (privacy mode) */
  }
  return null;
}

/** Build-time half of the flag (inlined by Next.js for NEXT_PUBLIC_*). */
export function envEnabled(env = process.env.NEXT_PUBLIC_UI_V2) {
  return env !== "0";
}

/** Per-user kill switch: true when the user chose the classic layout. */
export function classicChosen(store) {
  const s = storage(store);
  if (!s) return false;
  try {
    return s.getItem(CLASSIC_KEY) === "1";
  } catch {
    return false;
  }
}

/** The effective flag. `opts` exists for tests; production callers pass nothing. */
export function uiV2(opts = {}) {
  return envEnabled(opts.env) && !classicChosen(opts.store);
}

/** Persist the kill switch. `on === true` means "use the classic layout". */
export function setClassic(on, store) {
  const s = storage(store);
  if (!s) return;
  try {
    if (on) s.setItem(CLASSIC_KEY, "1");
    else s.removeItem(CLASSIC_KEY);
  } catch {
    /* ignore quota / privacy errors */
  }
}
