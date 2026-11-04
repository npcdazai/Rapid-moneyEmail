import { test } from "node:test";
import assert from "node:assert/strict";
import { createShortcuts, isTypingTarget, keyLabel } from "../lib/shortcuts.js";

const el = (tagName, extra = {}) => ({ tagName, getAttribute: () => null, ...extra });
const ev = (key, extra = {}) => {
  const e = { key, target: el("DIV"), prevented: false, ...extra };
  e.preventDefault = () => { e.prevented = true; };
  return e;
};

test("isTypingTarget: inputs, textareas, selects and contentEditable are typing targets", () => {
  assert.equal(isTypingTarget(el("INPUT", { type: "text" })), true);
  assert.equal(isTypingTarget(el("INPUT", { type: "search" })), true);
  assert.equal(isTypingTarget(el("TEXTAREA")), true);
  assert.equal(isTypingTarget(el("SELECT")), true);
  assert.equal(isTypingTarget(el("DIV", { isContentEditable: true })), true);
  assert.equal(isTypingTarget(el("DIV", { getAttribute: (n) => (n === "contenteditable" ? "true" : null) })), true);
  // not typing: buttons, checkboxes, plain rows, nothing
  assert.equal(isTypingTarget(el("INPUT", { type: "checkbox" })), false);
  assert.equal(isTypingTarget(el("BUTTON")), false);
  assert.equal(isTypingTarget(el("DIV", { tabIndex: 0 })), false);
  assert.equal(isTypingTarget(null), false);
});

test("single keys dispatch, preventDefault, and are ignored while typing", () => {
  const reg = createShortcuts();
  let hits = 0;
  reg.bind("j", () => hits++, { description: "next", group: "List" });
  const e = ev("j");
  assert.equal(reg.handle(e), true);
  assert.equal(hits, 1);
  assert.equal(e.prevented, true);
  // typing in an input: not handled, not prevented
  const typing = ev("j", { target: el("INPUT", { type: "text" }) });
  assert.equal(reg.handle(typing), false);
  assert.equal(hits, 1);
  assert.equal(typing.prevented, false);
  // contentEditable reply editor
  assert.equal(reg.handle(ev("j", { target: el("DIV", { isContentEditable: true }) })), false);
  assert.equal(hits, 1);
});

test("modifier combinations are never handled (browser shortcuts stay intact)", () => {
  const reg = createShortcuts();
  let hits = 0;
  reg.bind("f", () => hits++);
  assert.equal(reg.handle(ev("f", { ctrlKey: true })), false);
  assert.equal(reg.handle(ev("f", { metaKey: true })), false);
  assert.equal(reg.handle(ev("f", { altKey: true })), false);
  assert.equal(hits, 0);
  // shift is fine ("?" needs it)
  reg.bind("?", () => hits++);
  assert.equal(reg.handle(ev("?", { shiftKey: true })), true);
  assert.equal(hits, 1);
});

test("g chords: 'g i' fires, prefix alone does nothing, timeout resets", () => {
  const reg = createShortcuts({ chordTimeout: 500 });
  const seen = [];
  reg.bind("g i", () => seen.push("inbox"), { group: "Go to" });
  reg.bind("g f", () => seen.push("flagged"), { group: "Go to" });
  reg.bind("g b", () => seen.push("breached"), { group: "Go to" });
  reg.bind("i", () => seen.push("single-i"));

  assert.equal(reg.handle(ev("g"), 1000), false); // prefix: swallowed silently
  assert.equal(reg.handle(ev("i"), 1200), true);
  assert.deepEqual(seen, ["inbox"]);

  // too slow: the "i" is treated as a fresh single key
  reg.handle(ev("g"), 2000);
  assert.equal(reg.handle(ev("i"), 2700), true);
  assert.deepEqual(seen, ["inbox", "single-i"]);

  // unknown second key falls back to single-key lookup (none bound → false)
  reg.handle(ev("g"), 3000);
  assert.equal(reg.handle(ev("z"), 3100), false);

  reg.handle(ev("g"), 4000);
  reg.handle(ev("f"), 4100);
  reg.handle(ev("g"), 4200);
  reg.handle(ev("b"), 4300);
  assert.deepEqual(seen, ["inbox", "single-i", "flagged", "breached"]);

  // typing "g" in an input must not start a chord
  assert.equal(reg.handle(ev("g", { target: el("INPUT", { type: "text" }) }), 5000), false);
  assert.equal(reg.handle(ev("i"), 5100), true);
  assert.deepEqual(seen.at(-1), "single-i");
});

test("later bindings win, `when` scopes them, unbind restores the earlier one", () => {
  const reg = createShortcuts();
  const seen = [];
  reg.bind("f", () => seen.push("shell"));
  const off = reg.bind("f", () => seen.push("pane"));
  reg.handle(ev("f"));
  assert.deepEqual(seen, ["pane"]);
  off();
  reg.handle(ev("f"));
  assert.deepEqual(seen, ["pane", "shell"]);

  let listFocused = false;
  reg.bind("ArrowDown", () => seen.push("arrow"), { when: () => listFocused });
  assert.equal(reg.handle(ev("ArrowDown")), false);
  listFocused = true;
  assert.equal(reg.handle(ev("ArrowDown")), true);
  assert.equal(seen.at(-1), "arrow");
});

test("Escape can opt into inputs (inInputs) so it can return focus to the list", () => {
  const reg = createShortcuts();
  let hits = 0;
  reg.bind("Escape", () => hits++, { inInputs: true });
  assert.equal(reg.handle(ev("Escape", { target: el("TEXTAREA") })), true);
  assert.equal(reg.handle(ev("Escape", { target: el("DIV", { isContentEditable: true }) })), true);
  assert.equal(hits, 2);
});

test("table() lists shortcuts for the cheat-sheet (deduped, hidden ones omitted)", () => {
  const reg = createShortcuts();
  reg.bind("j", () => {}, { description: "Next", group: "List" });
  reg.bind("k", () => {}, { description: "Previous", group: "List" });
  reg.bind("g i", () => {}, { description: "Inbox", group: "Go to" });
  reg.bind("j", () => {}, { description: "Next (override)", group: "List" });
  reg.bind("x", () => {}, { hidden: true });
  const t = reg.table();
  assert.deepEqual(
    t.map((r) => r.keys).sort(),
    ["g i", "j", "k"]
  );
  assert.equal(t.find((r) => r.keys === "j").description, "Next (override)");
  assert.equal(keyLabel("g i"), "g then i");
  assert.equal(keyLabel("ArrowDown"), "↓");
  assert.equal(keyLabel("Escape"), "Esc");
});

test("bad bindings throw; already-handled events are skipped", () => {
  const reg = createShortcuts();
  assert.throws(() => reg.bind("a b c", () => {}));
  assert.throws(() => reg.bind("j", null));
  reg.bind("j", () => { throw new Error("should not run"); });
  assert.equal(reg.handle(ev("j", { defaultPrevented: true })), false);
});
