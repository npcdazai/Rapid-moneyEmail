import { test } from "node:test";
import assert from "node:assert/strict";
import { uiV2, envEnabled, classicChosen, setClassic, CLASSIC_KEY } from "../lib/flags.js";
import {
  normalizeAppearance,
  loadAppearance,
  saveAppearance,
  appearanceAttrs,
  loadTheme,
  saveTheme,
  DEFAULT_APPEARANCE,
  APPEARANCE_KEY,
  THEME_KEY,
} from "../lib/appearance.js";

const memStore = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m,
  };
};

test("uiV2: env default ON, NEXT_PUBLIC_UI_V2=0 forces off, classic kill switch wins", () => {
  const store = memStore();
  assert.equal(envEnabled(undefined), true);
  assert.equal(envEnabled("1"), true);
  assert.equal(envEnabled("0"), false);
  assert.equal(uiV2({ env: undefined, store }), true);
  assert.equal(uiV2({ env: "0", store }), false);
  setClassic(true, store);
  assert.equal(store.getItem(CLASSIC_KEY), "1");
  assert.equal(classicChosen(store), true);
  assert.equal(uiV2({ env: "1", store }), false);
  setClassic(false, store);
  assert.equal(store.getItem(CLASSIC_KEY), null);
  assert.equal(uiV2({ env: "1", store }), true);
});

test("uiV2: no storage available (SSR/private mode) → env decides", () => {
  const broken = { getItem() { throw new Error("denied"); } };
  assert.equal(uiV2({ env: "1", store: broken }), true);
});

test("appearance: defaults are compact / 1 line / sender first; garbage normalises", () => {
  assert.deepEqual(normalizeAppearance(null), DEFAULT_APPEARANCE);
  assert.deepEqual(normalizeAppearance({ density: "huge", previewLines: 9, senderFirst: 0 }), {
    density: "compact",
    previewLines: 1,
    senderFirst: false,
  });
  assert.deepEqual(normalizeAppearance({ density: "comfortable", previewLines: "2" }), {
    density: "comfortable",
    previewLines: 2,
    senderFirst: true,
  });
});

test("appearance: round-trips through storage under mh_appearance", () => {
  const store = memStore();
  assert.deepEqual(loadAppearance(store), DEFAULT_APPEARANCE);
  saveAppearance({ density: "comfortable", previewLines: 2, senderFirst: false }, store);
  assert.equal(JSON.parse(store.getItem(APPEARANCE_KEY)).density, "comfortable");
  assert.deepEqual(loadAppearance(store), { density: "comfortable", previewLines: 2, senderFirst: false });
  store.setItem(APPEARANCE_KEY, "{not json");
  assert.deepEqual(loadAppearance(store), DEFAULT_APPEARANCE);
  assert.deepEqual(appearanceAttrs({ density: "compact", previewLines: 2, senderFirst: false }), {
    "data-density": "compact",
    "data-preview-lines": "2",
    "data-sender-first": "0",
  });
});

test("theme: only light/dark are stored under mh_theme; anything else clears the choice", () => {
  const store = memStore();
  assert.equal(loadTheme(store), null);
  saveTheme("dark", store);
  assert.equal(store.getItem(THEME_KEY), "dark");
  assert.equal(loadTheme(store), "dark");
  saveTheme("system", store);
  assert.equal(loadTheme(store), null);
  store.setItem(THEME_KEY, "purple");
  assert.equal(loadTheme(store), null);
});
