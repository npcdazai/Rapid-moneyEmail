import { test } from "node:test";
import assert from "node:assert/strict";
import { clampPane, normalizePanes, loadPanes, savePanes, resetPanes, keyResize, LIMITS, DEFAULTS, MIN_READING, PANES_KEY } from "../lib/panes.js";

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test("clampPane respects min/max and leaves room for the reading pane", () => {
  assert.equal(clampPane("folders", 10), LIMITS.folders.min);
  assert.equal(clampPane("folders", 9999), LIMITS.folders.max);
  assert.equal(clampPane("list", 500, { total: 1366, other: 240 }), 500);
  assert.equal(clampPane("list", 700, { total: 1000, other: 240 }), 1000 - 240 - MIN_READING);
  assert.equal(clampPane("list", "abc"), DEFAULTS.list);
  assert.ok(Number.isNaN(clampPane("nope", 1)));
});
test("normalizePanes coerces garbage and keeps the reading pane viable on a small window", () => {
  assert.deepEqual(normalizePanes(null), { folders: DEFAULTS.folders, list: DEFAULTS.list });
  const n = normalizePanes({ folders: 360, list: 720 }, { total: 1100 });
  assert.ok(n.folders + n.list + MIN_READING <= 1100 || n.list === LIMITS.list.min);
});
test("save/load/reset round-trip and tolerate broken storage", () => {
  const s = mem();
  savePanes({ folders: 200, list: 450 }, s);
  assert.deepEqual(loadPanes(s, { total: 1920 }), { folders: 200, list: 450 });
  s.setItem(PANES_KEY, "{not json");
  assert.deepEqual(loadPanes(s), DEFAULTS);
  assert.deepEqual(resetPanes(s), DEFAULTS);
  assert.equal(s.getItem(PANES_KEY), null);
  assert.deepEqual(loadPanes({ getItem() { throw new Error("blocked"); } }), DEFAULTS);
});
test("keyResize: arrows ±16 (shift ×4), Home/End limits, Enter/Escape reset, others ignored", () => {
  assert.equal(keyResize("list", 400, "ArrowRight"), 416);
  assert.equal(keyResize("list", 400, "ArrowLeft", true), 336);
  assert.equal(keyResize("folders", 200, "Home"), LIMITS.folders.min);
  assert.equal(keyResize("folders", 200, "End"), LIMITS.folders.max);
  assert.equal(keyResize("list", 500, "Escape"), DEFAULTS.list);
  assert.equal(keyResize("list", 500, "a"), null);
});
