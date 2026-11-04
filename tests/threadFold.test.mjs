import { test } from "node:test";
import assert from "node:assert/strict";
import { lineCount, foldOne, mapThreadView, foldSummary, hiddenLines } from "../lib/threadFold.js";

test("lineCount ignores trailing whitespace and handles non-strings", () => {
  assert.equal(lineCount(""), 0);
  assert.equal(lineCount("one"), 1);
  assert.equal(lineCount("one\ntwo\n\n"), 2);
  assert.equal(lineCount(null), 0);
});

test("foldOne: newest + cleaned segments with line counts", () => {
  const v = foldOne({ newest: "Loan kab milega?", segments: ["Dear customer,\nYour loan is approved.", "  ", "Thanks"] });
  assert.equal(v.newest, "Loan kab milega?");
  assert.deepEqual(v.folds, [
    { text: "Dear customer,\nYour loan is approved.", lines: 2 },
    { text: "Thanks", lines: 1 },
  ]);
  assert.equal(foldSummary(v.folds[0]), "Quoted text (2 lines)");
  assert.equal(foldSummary(v.folds[1]), "Quoted text (1 line)");
  assert.equal(hiddenLines(v.folds), 3);
});

test("foldOne: malformed or empty payloads fall back to the plain body", () => {
  assert.deepEqual(foldOne(null, "raw body"), { newest: "raw body", folds: [] });
  assert.deepEqual(foldOne("nope", "raw body"), { newest: "raw body", folds: [] });
  assert.deepEqual(foldOne({ newest: "", segments: [] }, "raw body"), { newest: "raw body", folds: [] });
  assert.deepEqual(foldOne({ segments: [42, {}] }, "raw body"), { newest: "raw body", folds: [] });
});

test("foldOne: only-quoted (forwarded) mail keeps the history visible", () => {
  const v = foldOne({ newest: "   ", segments: ["Fwd part A", "Fwd part B"] }, "raw");
  assert.equal(v.newest, "Fwd part A\n\nFwd part B");
  assert.deepEqual(v.folds, []);
});

test("mapThreadView: ticket + replies by id, with per-reply fallback to the stored body", () => {
  const ticket = {
    body: "FULL BODY",
    replies: [
      { id: 7, body: "reply seven full" },
      { id: 8, body: "reply eight full" },
    ],
  };
  const payload = {
    newest: "newest text",
    segments: ["older"],
    replies: [
      { id: 7, newest: "seven newest", segments: ["seven quoted"] },
      { id: 8, newest: "", segments: [] }, // parser miss → stored body
      { id: 99, newest: "orphan", segments: [] }, // not in ticket.replies → still mapped, harmless
      null,
    ],
  };
  const v = mapThreadView(payload, ticket);
  assert.equal(v.ok, true);
  assert.equal(v.newest, "newest text");
  assert.equal(v.folds.length, 1);
  assert.equal(v.byReply.get("7").newest, "seven newest");
  assert.equal(v.byReply.get("7").folds[0].text, "seven quoted");
  assert.equal(v.byReply.get("8").newest, "reply eight full");
  assert.equal(v.byReply.get("99").newest, "orphan");
  assert.equal(v.byReply.has("null"), false);
});

test("mapThreadView: a 404/empty payload renders exactly the classic body", () => {
  const v = mapThreadView(undefined, { body: "classic", replies: [] });
  assert.equal(v.newest, "classic");
  assert.deepEqual(v.folds, []);
  assert.equal(v.byReply.size, 0);
});
