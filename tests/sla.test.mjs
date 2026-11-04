import { test } from "node:test";
import assert from "node:assert/strict";
import { slaChip, fmtSpan } from "../lib/sla.js";

const NOW = Date.parse("2026-10-17T10:00:00Z");
const at = (h) => new Date(NOW + h * 3_600_000).toISOString();

test("fmtSpan: coarse human spans", () => {
  assert.equal(fmtSpan(3 * 3_600_000), "3h");
  assert.equal(fmtSpan(3 * 3_600_000 + 20 * 60_000), "3h 20m");
  assert.equal(fmtSpan(45 * 60_000), "45m");
  assert.equal(fmtSpan(30_000), "1m"); // never "0m"
  assert.equal(fmtSpan(26 * 3_600_000), "1d 2h");
  assert.equal(fmtSpan(48 * 3_600_000), "2d");
});

test("running: more than an hour left", () => {
  const c = slaChip({ status: "Open", sla_due_at: at(3) }, NOW);
  assert.equal(c.label, "due in 3h");
  assert.equal(c.tone, "running");
  assert.equal(c.basis, "sla");
  assert.equal(c.dueAt, at(3));
});

test("amber: under an hour left", () => {
  const c = slaChip({ status: "In Progress", sla_due_at: at(0.5) }, NOW);
  assert.equal(c.label, "due in 30m");
  assert.equal(c.tone, "amber");
});

test("overdue: past due, or flagged breached by the backend", () => {
  const c = slaChip({ status: "Open", sla_due_at: at(-2 - 10 / 60) }, NOW);
  assert.equal(c.label, "Overdue by 2h 10m");
  assert.equal(c.tone, "ruby");
  // backend says breached even though the clock reads ahead (clock skew) → still ruby
  const d = slaChip({ status: "Open", sla_due_at: at(1), sla_breached: true }, NOW);
  assert.equal(d.tone, "ruby");
  assert.match(d.label, /^Overdue/);
  // breached with no due time at all
  const e = slaChip({ status: "Open", sla_breached: true }, NOW);
  assert.deepEqual([e.label, e.tone], ["Overdue", "ruby"]);
});

test("none: Resolved / Closed never show a countdown; missing due time shows nothing", () => {
  assert.equal(slaChip({ status: "Resolved", sla_due_at: at(-5) }, NOW).tone, "none");
  assert.equal(slaChip({ status: "Closed", sla_due_at: at(2) }, NOW).label, "");
  assert.equal(slaChip({ status: "Open" }, NOW).tone, "none");
  assert.equal(slaChip(null, NOW).tone, "none");
  assert.equal(slaChip({ status: "Open", sla_due_at: "not a date" }, NOW).tone, "none");
});

test("tat_due_at: the nearer deadline drives the chip and is labelled", () => {
  const c = slaChip({ status: "Open", sla_due_at: at(5), tat_due_at: at(2) }, NOW);
  assert.equal(c.label, "TAT due in 2h");
  assert.equal(c.basis, "tat");
  const d = slaChip({ status: "Open", sla_due_at: at(1.5), tat_due_at: at(6) }, NOW);
  assert.equal(d.label, "due in 1h 30m");
  assert.equal(d.basis, "sla");
  const e = slaChip({ status: "Open", tat_due_at: at(-1) }, NOW);
  assert.equal(e.label, "TAT Overdue by 1h");
  assert.equal(e.tone, "ruby");
});

test("pure: never mutates the ticket and accepts Date or number for now", () => {
  const t = Object.freeze({ status: "Open", sla_due_at: at(3) });
  const a = slaChip(t, new Date(NOW));
  const b = slaChip(t, NOW);
  assert.deepEqual(a, b);
});
