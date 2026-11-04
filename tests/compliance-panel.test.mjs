import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MANDATORY_BLOCKS,
  EDITABLE_SLOT_KEYS,
  isMandatoryBlock,
  blockLabel,
  flagChip,
  statusChip,
  editableSlots,
  variantOptions,
  globalOptions,
  buildOverrides,
  buildRecomposeBody,
  errorMessage,
  unapprovedCount,
  unapprovedNote,
  summarizeAnalysis,
  normalizeDraftPayload,
  classifyComplianceError,
  langAttr,
  configStatusLine,
  groupErrors,
  omittedBlocksSummary,
  omittedBoxTitle,
  partialNote,
  PARTIAL_REVIEW_NOTE,
  SCENARIO_LABELS,
  CLAUSE_TITLES,
  STALE_CLAUSE_NOTE,
  isRefundDraft,
  scenarioLabel,
  clauseTitle,
  infoLabel,
  splitMissingInfo,
  refundFlags,
  maskRef,
  clauseChips,
  blockClauses,
  summarizeRefundAnalysis,
  shortSha,
  policySummary,
} from "../lib/compliance.js";

// Golden-ish fixture shaped like design doc §4/§5 (ticket #1019).
const analysis = {
  intents: ["af_refund"],
  secondary_intents: ["complaint_generic"],
  lang: "en",
  entities: { amount: 199, currency: "INR", utr: null, txn_date: null, loan_id: null, phone: null, pan_masked: null },
  demands: ["refund"],
  info_missing: ["phone", "utr"],
  signals: { fraud_accusation: true, legal_or_regulator_mention: false, harassment_claim: false, threat: true, distress: false, repeat_contact: false, abusive: false },
  customer_master_match: false,
  tone: "angry",
  confidence: 0.82,
  needs_review: false,
  source: { rules: ["amount"], llm: "qwen3:0.6b" },
};
const draft = {
  id: 7,
  ticket_id: 1019,
  version: 2,
  analysis,
  rules_fired: ["GRIEVANCE_ACK"],
  rules_version: "2026-10-17.1",
  blocks: [
    { id: "greeting", version: 1, variant: { lang: "en", tone: "neutral" }, slots: { name: null }, text: "Dear Customer," },
    { id: "issue_restatement", version: 1, variant: { lang: "en", tone: "neutral" }, slots: { demand_phrase: "a refund", amount: 199 }, text: "You asked for a refund of ₹199." },
    { id: "gro_contact", version: 1, variant: { lang: "en", tone: "neutral" }, slots: { gro_name: "X", gro_email: "g@x", gro_phone: "1", gro_hours: "9-6" }, text: "GRO: X" },
    { id: "signature", version: 1, variant: { lang: "hi", tone: "neutral" }, slots: {}, text: "सादर, क्विकमनी टीम" },
  ],
  text: "Dear Customer,\n\nYou asked for a refund of ₹199.\n\nGRO: X\n\nसादर, क्विकमनी टीम",
  lang: "en",
  tone: "firm_courteous",
  status: "draft",
  errors: [],
  needs_review: false,
  info_missing: ["phone", "utr"],
  flags: ["regulator_risk"],
  route: "grievance@rapidmoney.in",
  min_priority: "P2",
  unapproved_blocks: ["gro_contact", "rbi_ombudsman_path"],
  created_at: "2026-10-17T10:00:00Z",
};
const variants = {
  greeting: { langs: ["en", "hi", "hinglish"], tones: ["neutral", "firm_courteous", "distressed"] },
  issue_restatement: { langs: ["en"], tones: ["neutral"] },
  gro_contact: { langs: ["en", "hi"], tones: ["neutral"] },
};

test("isMandatoryBlock: regulatory ids only", () => {
  for (const id of MANDATORY_BLOCKS) assert.equal(isMandatoryBlock(id), true, id);
  assert.equal(isMandatoryBlock("greeting"), false);
  assert.equal(isMandatoryBlock("topic_af_refund"), false);
  assert.equal(isMandatoryBlock(undefined), false);
  assert.equal(isMandatoryBlock(null), false);
});

test("blockLabel + flagChip", () => {
  assert.equal(blockLabel("gro_contact"), "GRO contact");
  assert.equal(blockLabel("topic_af_refund"), "Topic: af_refund");
  assert.equal(blockLabel("some_new_block"), "some new block");
  assert.deepEqual(flagChip("regulator_risk"), { label: "Regulator risk", tone: "danger" });
  assert.deepEqual(flagChip("gro_notify"), { label: "Notify GRO", tone: "warn" });
  assert.deepEqual(flagChip("other_flag"), { label: "other flag", tone: "neutral" });
});

test("statusChip: precedence error > config missing > needs review > draft", () => {
  assert.equal(statusChip(null), null);
  assert.deepEqual(statusChip({ status: "draft" }), { label: "draft", tone: "ok" });
  assert.deepEqual(statusChip({ status: "draft", needs_review: true }), { label: "needs review", tone: "warn" });
  assert.deepEqual(statusChip({ status: "config_missing", needs_review: true }), { label: "config missing", tone: "warn" });
  assert.deepEqual(statusChip({ status: "error", needs_review: true }), { label: "error", tone: "danger" });
  assert.deepEqual(statusChip({}), { label: "draft", tone: "ok" });
});

test("editableSlots: only name/amount/txn_date/demand_phrase, never config-sourced slots", () => {
  assert.deepEqual(EDITABLE_SLOT_KEYS, ["name", "amount", "txn_date", "demand_phrase"]);
  assert.deepEqual(editableSlots(draft.blocks[0]), [{ key: "name", value: null }]);
  assert.deepEqual(editableSlots(draft.blocks[1]), [
    { key: "amount", value: 199 },
    { key: "demand_phrase", value: "a refund" },
  ]);
  assert.deepEqual(editableSlots(draft.blocks[2]), []); // gro_* are not editable
  assert.deepEqual(editableSlots(draft.blocks[3]), []);
  assert.deepEqual(editableSlots({ id: "x" }), []);
  assert.deepEqual(editableSlots(null), []);
});

test("variantOptions: limited to variants[id], always containing the current variant", () => {
  assert.deepEqual(variantOptions(variants, draft.blocks[0]), {
    langs: ["en", "hi", "hinglish"],
    tones: ["neutral", "firm_courteous", "distressed"],
  });
  assert.deepEqual(variantOptions(variants, draft.blocks[1]), { langs: ["en"], tones: ["neutral"] });
  // block missing from the map → just what it renders now
  assert.deepEqual(variantOptions(variants, draft.blocks[3]), { langs: ["hi"], tones: ["neutral"] });
  assert.deepEqual(variantOptions(undefined, { id: "q" }), { langs: [], tones: [] });
});

test("globalOptions: union across blocks, else documented vocab", () => {
  assert.deepEqual(globalOptions(variants, draft), {
    langs: ["en", "hi", "hinglish"],
    tones: ["neutral", "firm_courteous", "distressed"],
  });
  assert.deepEqual(globalOptions({}, { lang: "en", tone: "neutral" }), {
    langs: ["en", "hi", "hinglish"],
    tones: ["neutral", "firm_courteous", "distressed"],
  });
  const g = globalOptions({ a: { langs: ["en"], tones: ["neutral"] } }, { lang: "hi", tone: "distressed" });
  assert.deepEqual(g, { langs: ["en", "hi"], tones: ["neutral", "distressed"] });
});

test("buildOverrides: variants + editable slots only, blanks dropped, amount numeric", () => {
  const o = buildOverrides({
    variants: { greeting: { lang: "hi" }, gro_contact: { lang: "hi", tone: "neutral" }, empty: {} },
    slots: {
      issue_restatement: { amount: " 250 ", demand_phrase: "", txn_date: "12/10/2026", gro_name: "nope" },
      greeting: { name: "Asha" },
      blank: { name: "   " },
    },
  });
  assert.deepEqual(o, {
    greeting: { lang: "hi", slots: { name: "Asha" } },
    gro_contact: { lang: "hi", tone: "neutral" },
    issue_restatement: { slots: { amount: 250, txn_date: "12/10/2026" } },
  });
  assert.deepEqual(buildOverrides({}), {});
  assert.deepEqual(buildOverrides(), {});
  assert.deepEqual(buildOverrides({ variants: { a: null }, slots: { b: null } }), {});
  // non-numeric amount stays a trimmed string (server validates)
  assert.deepEqual(buildOverrides({ slots: { x: { amount: "₹199" } } }), { x: { slots: { amount: "₹199" } } });
});

test("buildRecomposeBody: omits empty keys", () => {
  assert.deepEqual(buildRecomposeBody({}), {});
  assert.deepEqual(buildRecomposeBody({ lang: "hi", tone: "" }), { lang: "hi" });
  assert.deepEqual(buildRecomposeBody({ lang: "en", tone: "neutral", variants: { greeting: { tone: "distressed" } } }), {
    lang: "en",
    tone: "neutral",
    overrides: { greeting: { tone: "distressed" } },
  });
});

test("errorMessage: agent-facing sentences", () => {
  assert.equal(errorMessage({ code: "config_missing", block: "gro_contact" }), "GRO contact not configured — ask Compliance");
  assert.equal(errorMessage({ code: "config_missing", block: "rbi_ombudsman_path" }), "RBI Ombudsman path not configured — ask Compliance");
  assert.equal(errorMessage({ code: "required_block_missing", block: "lender_identity" }), "Required block missing: Lender identity");
  assert.equal(errorMessage({ code: "forbidden_block_present", block: "refund_denied" }), "Forbidden block present: refund denied");
  assert.equal(errorMessage({ code: "slot_missing", block: "info_request", slot: "info_items" }), 'Missing value "info_items" in Information request');
  assert.equal(errorMessage({ code: "unknown_block", block: "zzz" }), "Unknown block: zzz");
  assert.equal(errorMessage({ code: "override_rejected", block: "greeting", slot: "text" }), "Change rejected for Greeting (text)");
  assert.equal(errorMessage({ code: "weird" }), "weird");
  assert.equal(errorMessage("plain"), "plain");
});

test("unapprovedCount / unapprovedNote", () => {
  assert.equal(unapprovedCount(draft), 2);
  assert.equal(unapprovedCount({ unapproved_blocks: 3 }), 3);
  assert.equal(unapprovedCount({}), 0);
  assert.equal(unapprovedCount(null), 0);
  assert.equal(unapprovedNote(draft), "2 blocks pending counsel approval");
  assert.equal(unapprovedNote({ unapproved_blocks: ["a"] }), "1 block pending counsel approval");
  assert.equal(unapprovedNote({ unapproved_blocks: [] }), "");
});

test("summarizeAnalysis: compact rows, true signals, non-null entities", () => {
  const rows = summarizeAnalysis(analysis);
  const map = Object.fromEntries(rows);
  assert.deepEqual(
    rows.map(([k]) => k),
    ["Intents", "Secondary", "Language", "Tone", "Demands", "Info missing", "Signals", "Entities", "Confidence", "Customer master"]
  );
  assert.equal(map.Intents, "af_refund");
  assert.equal(map.Secondary, "complaint_generic");
  assert.equal(map.Language, "English");
  assert.equal(map.Tone, "angry");
  assert.equal(map.Demands, "refund");
  assert.equal(map["Info missing"], "phone, utr");
  assert.equal(map.Signals, "fraud_accusation, threat");
  assert.equal(map.Entities, "amount: 199, currency: INR");
  assert.equal(map.Confidence, "0.82");
  assert.equal(map["Customer master"], "no match");
  assert.deepEqual(summarizeAnalysis(null), []);
  const sparse = Object.fromEntries(summarizeAnalysis({}));
  assert.equal(sparse.Intents, "—");
  assert.equal(sparse.Signals, "—");
  assert.equal(sparse.Confidence, "—");
  assert.equal(sparse["Customer master"], "—");
});

test("normalizeDraftPayload: tolerant of missing arrays; null draft is valid; garbage is null", () => {
  const n = normalizeDraftPayload({ draft, variants, config_status: { complete: false, missing: ["gro.email"] } });
  assert.equal(n.draft.id, 7);
  assert.equal(n.draft.blocks.length, 4);
  assert.deepEqual(n.configStatus, { complete: false, missing: ["gro.email"] });
  assert.equal(n.variants, variants);

  const sparse = normalizeDraftPayload({ draft: { id: 1, status: "draft", blocks: [{ id: "a" }, null, {}] } });
  assert.deepEqual(sparse.draft.blocks, [{ id: "a" }]);
  assert.deepEqual(sparse.draft.rules_fired, []);
  assert.deepEqual(sparse.draft.flags, []);
  assert.deepEqual(sparse.draft.errors, []);
  assert.deepEqual(sparse.draft.info_missing, []);
  assert.deepEqual(sparse.configStatus, { complete: true, missing: [] });
  assert.deepEqual(sparse.variants, {});

  assert.equal(normalizeDraftPayload({ draft: null }).draft, null);
  assert.equal(normalizeDraftPayload({}), null);
  assert.equal(normalizeDraftPayload(null), null);
  assert.equal(normalizeDraftPayload("x"), null);
});

test("classifyComplianceError: 404/503/403/501/network hide; others show an error line", () => {
  const e = (status) => Object.assign(new Error("x"), { status });
  assert.equal(classifyComplianceError(e(404)), "hidden");
  assert.equal(classifyComplianceError(e(503)), "hidden");
  assert.equal(classifyComplianceError(e(403)), "hidden");
  assert.equal(classifyComplianceError(e(501)), "hidden");
  assert.equal(classifyComplianceError(new TypeError("Failed to fetch")), "hidden");
  assert.equal(classifyComplianceError(null), "hidden");
  assert.equal(classifyComplianceError(e(500)), "error");
  assert.equal(classifyComplianceError(e(400)), "error");
});

test("langAttr + configStatusLine", () => {
  assert.equal(langAttr("hi"), "hi");
  assert.equal(langAttr("hinglish"), "hi-Latn");
  assert.equal(langAttr("en"), "en");
  assert.equal(langAttr(undefined), "en");
  assert.equal(configStatusLine({ config: { complete: true, missing: [] } }), "");
  assert.equal(configStatusLine({ config: { complete: false, missing: ["a", "b", "c"] } }), "Compliance config incomplete (3 items)");
  assert.equal(configStatusLine({ config: { complete: false, missing: ["a"] } }), "Compliance config incomplete (1 item)");
  assert.equal(configStatusLine({ config: { complete: false } }), "Compliance config incomplete");
  assert.equal(configStatusLine(null), "");
  assert.equal(configStatusLine({}), "");
});

// ---- Partial drafts (backend "partial" state: review-only text, mandatory blocks omitted) ----

const partialDraft = {
  id: 9,
  ticket_id: 1019,
  version: 3,
  status: "partial",
  ok: false,
  needs_review: true,
  blocks: [
    { id: "greeting", version: 1, variant: { lang: "en", tone: "neutral" }, slots: { name: null }, text: "Dear Customer," },
    { id: "auto_ack_notice", version: 1, variant: { lang: "en", tone: "neutral" }, slots: {}, text: "This is an automated acknowledgement." },
    { id: "signature", version: 1, variant: { lang: "en", tone: "neutral" }, slots: {}, text: "Regards, RapidMoney" },
  ],
  text: "Dear Customer,\n\nThis is an automated acknowledgement.\n\nRegards, RapidMoney",
  omitted_blocks: [
    { id: "gro_contact", reason: "config_missing", missing: ["config.gro.name", "config.gro.email"] },
    { id: "rbi_ombudsman_path", reason: "config_missing", missing: ["config.rbi.ombudsman_url"] },
    // duplicate row for the same block (must collapse into one, paths merged)
    { id: "gro_contact", reason: "config_missing", missing: ["config.gro.phone", "config.gro.hours", "config.gro.email"] },
    { id: "lender_identity", reason: "config_missing", missing: ["config.lender.legal_name"] },
    { id: "fee_wording_approved", reason: "config_missing", missing: ["config.fees.approved_text"] },
  ],
  errors: [
    { code: "config_missing", block: "gro_contact", path: "config.gro.name" },
    { code: "config_missing", block: "gro_contact", path: "config.gro.email" },
    { code: "config_missing", block: "gro_contact", path: "config.gro.phone" },
    { code: "config_missing", block: "gro_contact", path: "config.gro.hours" },
    { code: "config_missing", block: "rbi_ombudsman_path", path: "config.rbi.ombudsman_url" },
    { code: "config_missing", block: "lender_identity", path: "config.lender.legal_name" },
    { code: "config_missing", block: "fee_wording_approved", path: "config.fees.approved_text" },
  ],
  errors_summary: [
    { block: "gro_contact", missing_count: 4, paths: ["config.gro.name", "config.gro.email", "config.gro.phone", "config.gro.hours"] },
    { block: "rbi_ombudsman_path", missing_count: 1, paths: ["config.rbi.ombudsman_url"] },
    { block: "lender_identity", missing_count: 1, paths: ["config.lender.legal_name"] },
    { block: "fee_wording_approved", missing_count: 1, paths: ["config.fees.approved_text"] },
  ],
};

test("statusChip: partial → amber 'partial · awaiting compliance config'; error still wins; partial beats needs_review", () => {
  assert.deepEqual(statusChip({ status: "partial" }), { label: "partial · awaiting compliance config", tone: "warn" });
  assert.deepEqual(statusChip({ status: "partial", needs_review: true }), { label: "partial · awaiting compliance config", tone: "warn" });
  assert.deepEqual(statusChip({ status: "error", omitted_blocks: [{ id: "gro_contact" }] }), { label: "error", tone: "danger" });
  // existing chips are untouched
  assert.deepEqual(statusChip({ status: "config_missing" }), { label: "config missing", tone: "warn" });
  assert.deepEqual(statusChip({ status: "draft" }), { label: "draft", tone: "ok" });
});

test("blockLabel: auto_ack_notice has a friendly label (rendered like any other block)", () => {
  assert.equal(blockLabel("auto_ack_notice"), "Automated acknowledgement notice");
  assert.equal(isMandatoryBlock("auto_ack_notice"), false);
});

test("omittedBlocksSummary: friendly names, each block once, missing paths merged, order kept", () => {
  const rows = omittedBlocksSummary(partialDraft);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["gro_contact", "rbi_ombudsman_path", "lender_identity", "fee_wording_approved"]
  );
  assert.deepEqual(
    rows.map((r) => r.label),
    ["GRO contact (name, email, phone, hours)", "RBI Ombudsman path", "Lender identity", "Approved fee wording"]
  );
  assert.deepEqual(rows[0].missing, ["config.gro.name", "config.gro.email", "config.gro.phone", "config.gro.hours"]);
  assert.equal(rows[0].reason, "config_missing");
  assert.deepEqual(rows[1].missing, ["config.rbi.ombudsman_url"]);
  // unknown ids fall back to blockLabel; plain-string entries are accepted
  assert.deepEqual(omittedBlocksSummary({ status: "partial", omitted_blocks: ["some_new_block", { id: "topic_af_refund" }] }).map((r) => r.label), [
    "some new block",
    "Topic: af_refund",
  ]);
  assert.deepEqual(omittedBlocksSummary(null), []);
  assert.deepEqual(omittedBlocksSummary({ status: "draft", omitted_blocks: [] }), []);
  assert.equal(omittedBoxTitle(partialDraft), "Review draft — 4 mandatory blocks omitted until Compliance supplies configuration");
  assert.equal(omittedBoxTitle({ status: "partial", omitted_blocks: [{ id: "gro_contact" }] }), "Review draft — 1 mandatory block omitted until Compliance supplies configuration");
  assert.equal(omittedBoxTitle({ status: "draft" }), "");
});

test("omittedBlocksSummary: falls back to config_missing errors when omitted_blocks is absent", () => {
  const { omitted_blocks, errors_summary, ...noList } = partialDraft;
  const rows = omittedBlocksSummary(noList);
  assert.deepEqual(rows.map((r) => r.id), ["gro_contact", "rbi_ombudsman_path", "lender_identity", "fee_wording_approved"]);
  assert.deepEqual(rows[0].missing, ["config.gro.name", "config.gro.email", "config.gro.phone", "config.gro.hours"]);
  // a complete draft never invents omissions from stray errors
  assert.deepEqual(omittedBlocksSummary({ status: "draft", errors: [{ code: "config_missing", block: "gro_contact" }] }), []);
});

test("groupErrors: client-side fallback groups errors[] per block — GRO contact once with (4 fields)", () => {
  const { errors_summary, ...noSummary } = partialDraft;
  const g = groupErrors({ ...noSummary, status: "config_missing" });
  assert.equal(g.length, 4);
  assert.deepEqual(g[0], {
    code: "config_missing",
    block: "gro_contact",
    count: 4,
    paths: ["config.gro.name", "config.gro.email", "config.gro.phone", "config.gro.hours"],
    message: "GRO contact not configured — ask Compliance (4 fields)",
  });
  assert.equal(g[1].message, "RBI Ombudsman path not configured — ask Compliance");
  assert.equal(g[1].count, 1);
  // messages are deduped: no block label appears twice
  const blocks = g.map((x) => x.block);
  assert.equal(new Set(blocks).size, blocks.length);
  // other codes keep their own rows and sentences
  const mixed = groupErrors({
    status: "config_missing",
    errors: [
      { code: "config_missing", block: "gro_contact", slot: "gro_name" },
      { code: "config_missing", block: "gro_contact", slot: "gro_email" },
      { code: "required_block_missing", block: "lender_identity" },
      { code: "weird" },
      { code: "weird" },
    ],
  });
  assert.deepEqual(
    mixed.map((x) => x.message),
    ["GRO contact not configured — ask Compliance (2 fields)", "Required block missing: Lender identity", "weird (2 fields)"]
  );
  assert.deepEqual(mixed[0].paths, ["gro_name", "gro_email"]);
  assert.deepEqual(groupErrors(null), []);
  assert.deepEqual(groupErrors({ errors: [] }), []);
});

test("groupErrors: config_missing dedupe uses errors_summary when present (count from missing_count)", () => {
  const g = groupErrors({ ...partialDraft, status: "config_missing" });
  assert.equal(g.length, 4);
  assert.equal(g[0].block, "gro_contact");
  assert.equal(g[0].count, 4);
  assert.equal(g[0].message, "GRO contact not configured — ask Compliance (4 fields)");
  assert.equal(g.filter((x) => x.block === "gro_contact").length, 1);
  // summary without missing_count → count falls back to the number of paths
  const noCount = groupErrors({ errors_summary: [{ block: "gro_contact", paths: ["a", "b", "c"] }], errors: [] });
  assert.equal(noCount[0].count, 3);
  assert.equal(noCount[0].message, "GRO contact not configured — ask Compliance (3 fields)");
  // non-config errors in errors[] are still appended after the summary rows
  const extra = groupErrors({
    errors_summary: [{ block: "gro_contact", missing_count: 4, paths: [] }],
    errors: [
      { code: "config_missing", block: "gro_contact", path: "config.gro.name" },
      { code: "required_block_missing", block: "lender_identity" },
    ],
  });
  assert.deepEqual(
    extra.map((x) => x.message),
    ["GRO contact not configured — ask Compliance (4 fields)", "Required block missing: Lender identity"]
  );
});

test("partialNote + normalizeDraftPayload keep the partial fields (and default them to [])", () => {
  assert.equal(partialNote(partialDraft), PARTIAL_REVIEW_NOTE);
  assert.equal(partialNote(partialDraft), "Review only — the omitted blocks are mandatory for a complaint acknowledgement; this draft cannot be sent.");
  assert.equal(partialNote(draft), "");
  assert.equal(partialNote(null), "");
  const n = normalizeDraftPayload({ draft: partialDraft, variants: {} });
  assert.equal(n.draft.status, "partial");
  assert.equal(n.draft.ok, false);
  assert.equal(n.draft.blocks.length, 3);
  assert.equal(n.draft.blocks[1].id, "auto_ack_notice");
  assert.equal(n.draft.omitted_blocks.length, 5);
  assert.equal(n.draft.errors_summary.length, 4);
  assert.equal(typeof n.draft.text, "string");
  const sparse = normalizeDraftPayload({ draft: { id: 1, status: "partial" } });
  assert.deepEqual(sparse.draft.omitted_blocks, []);
  assert.deepEqual(sparse.draft.errors_summary, []);
  assert.deepEqual(omittedBlocksSummary(sparse.draft), []);
});

// ---- Refund module (backend docs/refund-module/00-design.md §3, §6, §7) ----

const refundAnalysis = {
  scenario: "duplicate_emi",
  candidates: ["duplicate_emi", "excess_payment"],
  duplicate: false,
  amount: 2499,
  currency: "INR",
  txn_ref: "412345678901",
  txn_date: "2026-10-14",
  payment_mode: "auto_debit",
  loan_id: null,
  emi_due_date: null,
  days_since_payment: 3,
  info_present: ["txn_ref", "txn_date", "amount"],
  info_missing: ["registered_mobile", "beneficiary_name", "account_number", "ifsc", "reason"],
  signals: { fraud_accusation: false, legal_or_regulator_mention: false, repeat_contact: false, distress: true, abusive: false, threat: false },
  lang: "hinglish",
  tone: "neutral",
  confidence: 0.8,
  needs_review: false,
  source: { rules: ["dup_emi"], llm: "qwen3:0.6b", scenario_from: "rules" },
};
const refundDraft = {
  id: 11,
  ticket_id: 1020,
  version: 1,
  module: "refund",
  scenario: "duplicate_emi",
  analysis: refundAnalysis,
  rules_fired: ["REFUND_BASE", "DUP_IN_WINDOW", "DATA_USE"],
  rules_version: "2026-10-17.1",
  clause_ids: ["RP-5.1", "RP-2.2", "RP-2.3", "RP-3", "PP-9.1", "TC-7.2", "TC-26.1", "TC-26.2", "TC-26.4"],
  stale: ["RP-2.3", "GR-3"],
  blocks: [
    { id: "greeting", version: 1, variant: { lang: "hinglish", tone: "neutral" }, slots: { name: null }, text: "Namaste,", clause_ids: [] },
    { id: "ack_1wd", version: 1, variant: { lang: "hinglish", tone: "neutral" }, slots: {}, text: "Aapki request mil gayi hai.", clause_ids: ["RP-5.1", "TC-26.1"] },
    { id: "duplicate_claim_steps", version: 1, variant: { lang: "hinglish", tone: "neutral" }, slots: { claim_window_sentence: "…" }, text: "…", clause_ids: ["RP-2.2", "RP-2.3"] },
  ],
  text: "Namaste,\n\nAapki request mil gayi hai.\n\n…",
  lang: "hinglish",
  tone: "neutral",
  status: "draft",
  errors: [],
  needs_review: false,
  info_missing: ["registered_mobile", "beneficiary_name", "account_number", "ifsc", "reason"],
  flags: ["late_claim", "gro_notify"],
  route: "support@rapidmoney.in",
  min_priority: "P3",
};

test("refund: scenarioLabel covers the §2 taxonomy with friendly names; unknown ids read as words", () => {
  assert.equal(scenarioLabel("failed_txn_debited"), "Failed transaction, amount debited");
  assert.equal(scenarioLabel("duplicate_emi"), "Duplicate EMI");
  assert.equal(scenarioLabel("excess_payment"), "Excess payment");
  assert.equal(scenarioLabel("cooling_off_exit"), "Cooling-off exit");
  assert.equal(scenarioLabel("fee_in_kfs"), "KFS-disclosed fee");
  assert.equal(scenarioLabel("assessment_fee_refund"), "Assessment fee (₹199) refund");
  assert.equal(scenarioLabel("vas_fee"), "Value-added service fee");
  assert.equal(scenarioLabel("wrong_account_credit"), "Wrong account credit");
  assert.equal(scenarioLabel("unauthorised_debit"), "Unauthorised debit");
  assert.equal(scenarioLabel("payment_not_reflected"), "Payment not reflected");
  assert.equal(Object.keys(SCENARIO_LABELS).length, 10);
  assert.equal(scenarioLabel("some_new_case"), "some new case");
  assert.equal(scenarioLabel(null), "");
  assert.equal(scenarioLabel(""), "");
});

test("refund: clauseTitle static map, RP-3 sub-ids, TC-26.x / TC-10.x / RP-5.x / PP-9.x families, fallbacks", () => {
  assert.equal(clauseTitle("RP-2.1"), "Failed transaction with amount debited");
  assert.equal(clauseTitle("RP-2.4"), "Failed-transaction reversals are not subject to a claim window");
  assert.equal(clauseTitle("RP-3"), "Information required for processing a refund");
  assert.equal(clauseTitle("RP-3.txn"), "Information required for processing a refund");
  assert.equal(clauseTitle("RP-3.refund"), "Information required for processing a refund");
  assert.equal(clauseTitle("RP-4.3"), "Non-refundable items");
  assert.equal(clauseTitle("RP-4.4"), "Cooling-off period");
  for (const id of ["RP-5.1", "RP-5.2", "RP-5.3"]) assert.equal(clauseTitle(id), "Customer support and escalation", id);
  assert.equal(clauseTitle("TC-7.1"), "Platform role and LSP disclosures");
  assert.equal(clauseTitle("TC-7.2"), "Company not involved in lending decisions");
  for (const id of ["TC-10.1", "TC-10.2", "TC-10.5"]) assert.equal(clauseTitle(id), "Fees and charges", id);
  for (const id of ["TC-26.1", "TC-26.2", "TC-26.3", "TC-26.4"]) assert.equal(clauseTitle(id), "Grievance redressal", id);
  assert.equal(clauseTitle("GR-3"), "Step 1 — GRO");
  assert.equal(clauseTitle("GR-5"), "Step 3 — RBI Ombudsman");
  assert.equal(clauseTitle("GR-7"), "Consumer protection forums");
  assert.equal(clauseTitle("GR-8"), "Reporting fraud and cyber crime");
  assert.equal(clauseTitle("PP-9.1"), "Data retention");
  assert.equal(clauseTitle("PP-9.3"), "Data retention");
  assert.ok(Object.isFrozen(CLAUSE_TITLES));
  // unknown but well-formed → document + number; garbage → itself; empty → ""
  assert.equal(clauseTitle("GR-4"), "Grievance Redressal §4");
  assert.equal(clauseTitle("RP-1.2"), "Refund Policy §1.2");
  assert.equal(clauseTitle("XYZ"), "XYZ");
  assert.equal(clauseTitle(""), "");
  assert.equal(clauseTitle(null), "");
});

test("refund: splitMissingInfo splits RP-3 items into transaction vs bank (+ registered_mobile under other), friendly labels", () => {
  const s = splitMissingInfo(refundAnalysis);
  assert.deepEqual(s.transaction, [{ key: "reason", label: "Reason for the refund" }]);
  assert.deepEqual(s.bank, [
    { key: "beneficiary_name", label: "Beneficiary name" },
    { key: "account_number", label: "Bank account number" },
    { key: "ifsc", label: "IFSC" },
  ]);
  assert.deepEqual(s.other, [{ key: "registered_mobile", label: "Registered mobile number" }]);
  // full transaction group, order kept, duplicates dropped, arrays accepted directly
  const t = splitMissingInfo(["merchant", "txn_ref", "txn_date_amount", "reason", "txn_ref", "weird_key"]);
  assert.deepEqual(t.transaction.map((x) => x.key), ["merchant", "txn_ref", "txn_date_amount", "reason"]);
  assert.deepEqual(t.transaction.map((x) => x.label), [
    "Merchant / payee",
    "Transaction reference (UTR / txn id)",
    "Transaction date and amount",
    "Reason for the refund",
  ]);
  assert.deepEqual(t.bank, []);
  assert.deepEqual(t.other, [{ key: "weird_key", label: "weird key" }]);
  assert.equal(infoLabel("ifsc"), "IFSC");
  // a failed-transaction draft never lists bank details (backend rule) — the split just reflects the input
  assert.deepEqual(splitMissingInfo({ info_missing: ["txn_ref"] }).bank, []);
  assert.deepEqual(splitMissingInfo(null), { transaction: [], bank: [], other: [] });
  assert.deepEqual(splitMissingInfo({}), { transaction: [], bank: [], other: [] });
});

test("refund: refundFlags returns late_claim (amber) / policy_gap (red) notices only; flagChip knows both", () => {
  const f = refundFlags(refundDraft);
  assert.equal(f.length, 1);
  assert.deepEqual(f[0], {
    flag: "late_claim",
    label: "Late claim",
    tone: "warn",
    note: "Claim raised after the 7-day window — routed to a human, no refusal sent",
  });
  const both = refundFlags({ flags: ["regulator_risk", "policy_gap", "late_claim", "policy_gap"] });
  assert.deepEqual(both.map((x) => x.flag), ["late_claim", "policy_gap"]);
  assert.equal(both[1].tone, "danger");
  assert.equal(both[1].note, "No published clause covers this — draft stopped after acknowledgement; routed to grievance@");
  assert.deepEqual(refundFlags({ flags: ["gro_notify"] }), []);
  assert.deepEqual(refundFlags({}), []);
  assert.deepEqual(refundFlags(null), []);
  assert.deepEqual(flagChip("late_claim"), { label: "Late claim", tone: "warn" });
  assert.deepEqual(flagChip("policy_gap"), { label: "Policy gap", tone: "danger" });
  // existing chips unchanged
  assert.deepEqual(flagChip("regulator_risk"), { label: "Regulator risk", tone: "danger" });
  assert.deepEqual(flagChip("gro_notify"), { label: "Notify GRO", tone: "warn" });
});

test("refund: maskRef keeps first 4 + last 2", () => {
  assert.equal(maskRef("412345678901"), "4123…01");
  assert.equal(maskRef("4123 4567 8901"), "4123…01"); // whitespace collapsed before masking
  assert.equal(maskRef("UTR412345678901"), "UTR4…01"); // a prefix is part of the ref, not stripped
  assert.equal(maskRef(412345678901), "4123…01");
  assert.equal(maskRef("ABCDEFG"), "ABCD…FG");
  // nothing hidden in a 6-char ref → returned as-is (no fake masking)
  assert.equal(maskRef("ABCDEF"), "ABCDEF");
  assert.equal(maskRef("12"), "12");
  assert.equal(maskRef(""), "");
  assert.equal(maskRef("   "), "");
  assert.equal(maskRef(null), "");
  assert.equal(maskRef(undefined), "");
  // the analysis table uses the masked value and the refund-specific rows
  const rows = Object.fromEntries(summarizeRefundAnalysis(refundAnalysis));
  assert.equal(rows["Txn ref"], "4123…01");
  assert.equal(rows["Days since payment"], "3");
  assert.equal(rows["Payment mode"], "auto debit");
  assert.equal(rows.Scenario, "Duplicate EMI (duplicate_emi)");
  assert.equal(rows.Candidates, "Duplicate EMI, Excess payment");
  assert.equal(rows.Duplicate, "no");
  assert.equal(rows.Amount, "₹2499");
  assert.equal(rows["Txn date"], "2026-10-14");
  assert.equal(rows["Info missing"], "Registered mobile number, Beneficiary name, Bank account number, IFSC, Reason for the refund");
  assert.equal(rows.Signals, "distress");
  assert.equal(rows.Language, "Hinglish");
  assert.equal(rows.Confidence, "0.80");
  assert.equal(rows["Scenario from"], "rules");
  const sparse = Object.fromEntries(summarizeRefundAnalysis({}));
  assert.equal(sparse.Scenario, "—");
  assert.equal(sparse["Txn ref"], "—");
  assert.equal(sparse["Days since payment"], "—");
  assert.deepEqual(summarizeRefundAnalysis(null), []);
});

test("refund: stale rendering data — clauseChips marks stale ids, appends stale ids missing from clause_ids, blockClauses per block", () => {
  const chips = clauseChips(refundDraft);
  assert.deepEqual(chips.map((c) => c.id), ["RP-5.1", "RP-2.2", "RP-2.3", "RP-3", "PP-9.1", "TC-7.2", "TC-26.1", "TC-26.2", "TC-26.4", "GR-3"]);
  assert.deepEqual(chips.filter((c) => c.stale).map((c) => c.id), ["RP-2.3", "GR-3"]);
  assert.equal(chips[2].title, "Refund timelines for duplicate/excess payments");
  assert.equal(chips[0].stale, false);
  assert.equal(STALE_CLAUSE_NOTE, "Policy page changed — drafting with this block is blocked until Compliance reviews");
  // per block: ids + titles, stale from the draft
  assert.deepEqual(blockClauses(refundDraft.blocks[0], refundDraft), []);
  assert.deepEqual(blockClauses(refundDraft.blocks[1], refundDraft), [
    { id: "RP-5.1", title: "Customer support and escalation", stale: false },
    { id: "TC-26.1", title: "Grievance redressal", stale: false },
  ]);
  const dup = blockClauses(refundDraft.blocks[2], refundDraft);
  assert.deepEqual(dup.map((c) => [c.id, c.stale]), [["RP-2.2", false], ["RP-2.3", true]]);
  // tolerant of absent fields
  assert.deepEqual(clauseChips({ module: "refund" }), []);
  assert.deepEqual(clauseChips(null), []);
  assert.deepEqual(blockClauses({ id: "x" }, null), []);
  assert.deepEqual(blockClauses(null, refundDraft), []);
  // normalizeDraftPayload keeps + defaults the refund fields
  const n = normalizeDraftPayload({ draft: refundDraft, variants: {} });
  assert.equal(n.draft.module, "refund");
  assert.equal(n.draft.scenario, "duplicate_emi");
  assert.deepEqual(n.draft.stale, ["RP-2.3", "GR-3"]);
  assert.equal(n.draft.clause_ids.length, 9);
  assert.equal(isRefundDraft(n.draft), true);
  const sparse = normalizeDraftPayload({ draft: { id: 2, module: "refund", status: "draft" } });
  assert.deepEqual(sparse.draft.clause_ids, []);
  assert.deepEqual(sparse.draft.stale, []);
  assert.equal(sparse.draft.scenario, null);
  assert.equal(isRefundDraft(sparse.draft), true);
});

test("refund: compliance-module drafts are unchanged (module defaults to compliance, no refund data derived)", () => {
  const n = normalizeDraftPayload({ draft, variants });
  assert.equal(n.draft.module, "compliance");
  assert.equal(n.draft.scenario, null);
  assert.deepEqual(n.draft.clause_ids, []);
  assert.deepEqual(n.draft.stale, []);
  assert.equal(isRefundDraft(n.draft), false);
  assert.equal(isRefundDraft(draft), false);
  assert.equal(isRefundDraft({ module: "compliance" }), false);
  assert.equal(isRefundDraft({ module: "REFUND" }), false);
  assert.equal(isRefundDraft(null), false);
  // a stray module value never turns a draft into a refund draft
  assert.equal(normalizeDraftPayload({ draft: { id: 3, module: "other" } }).draft.module, "compliance");
  // the compliance analysis table and chips are exactly as before
  assert.deepEqual(summarizeAnalysis(analysis).map(([k]) => k), [
    "Intents", "Secondary", "Language", "Tone", "Demands", "Info missing", "Signals", "Entities", "Confidence", "Customer master",
  ]);
  assert.deepEqual(statusChip(n.draft), { label: "draft", tone: "ok" });
  assert.deepEqual(refundFlags(n.draft), []); // regulator_risk stays a chip, not a notice
  assert.deepEqual(clauseChips(n.draft), []);
  // the partial fixture is also untouched by the refund fields
  const p = normalizeDraftPayload({ draft: partialDraft, variants: {} });
  assert.equal(p.draft.module, "compliance");
  assert.equal(omittedBlocksSummary(p.draft).length, 4);
});

test("policySummary: menu lines from GET /api/compliance/policy; tolerant of nulls; hides when nothing is known", () => {
  const p = policySummary({
    manifest: { fetched_at: "2026-10-17T03:17:00+05:30", pages: { "refund-policy": { url: "u", sha256: "2d4a7affcb3f97a9aaaa", last_updated: "20 July 2026" } } },
    status: { checked_at: "2026-10-18T03:15:00+05:30", changed: ["refund-policy"], stale_blocks: ["duplicate_claim_steps", "failed_txn_explain"] },
    reviews: [
      { id: 4, slug: "refund-policy", detected_at: "2026-10-18T03:15:00+05:30", old_sha: "2d4a7affcb3f97a9aaaa", new_sha: "ffee00112233445566" },
      { id: 5, slug: "terms-and-conditions", detected_at: null, old_sha: null, new_sha: "abcdef0123" },
      null,
      { slug: "no-id" },
    ],
  });
  assert.equal(p.checkedAt, "2026-10-18T03:15:00+05:30");
  assert.match(p.checkedLine, /^Policy pages last checked .*2026/);
  assert.deepEqual(p.changed, ["refund-policy"]);
  assert.deepEqual(p.staleBlocks, ["duplicate_claim_steps", "failed_txn_explain"]);
  assert.equal(p.reviews.length, 2);
  assert.deepEqual(p.reviews[0], {
    id: 4,
    slug: "refund-policy",
    detected_at: "2026-10-18T03:15:00+05:30",
    detectedLabel: p.reviews[0].detectedLabel,
    old_sha: "2d4a7aff",
    new_sha: "ffee0011",
  });
  assert.ok(p.reviews[0].detectedLabel.length > 0);
  assert.deepEqual(p.reviews[1], { id: 5, slug: "terms-and-conditions", detected_at: null, detectedLabel: "", old_sha: "", new_sha: "abcdef01" });
  assert.equal(p.changeCount, 2); // open reviews win over changed slugs
  assert.equal(p.changeLine, "Policy change detected (2) — review");
  assert.equal(shortSha("2d4a7affcb3f97a9"), "2d4a7aff");
  assert.equal(shortSha(null), "");
  // changed but no review rows yet → count from status.changed
  const c = policySummary({ manifest: null, status: { checked_at: "2026-10-18T00:00:00Z", changed: ["privacy-policy", "grievance-redressal"], stale_blocks: [] }, reviews: [] });
  assert.equal(c.changeCount, 2);
  assert.equal(c.changeLine, "Policy change detected (2) — review");
  // nothing changed → no amber item; checked date falls back to manifest.fetched_at
  const q = policySummary({ manifest: { fetched_at: "2026-10-17T03:17:00+05:30", pages: {} }, status: null, reviews: [] });
  assert.equal(q.changeCount, 0);
  assert.equal(q.changeLine, "");
  assert.equal(q.checkedAt, "2026-10-17T03:17:00+05:30");
  assert.match(q.checkedLine, /^Policy pages last checked /);
  // nothing known at all → empty lines (menu shows nothing); garbage → null
  const e = policySummary({ manifest: null, status: null, reviews: [] });
  assert.equal(e.checkedLine, "");
  assert.equal(e.changeLine, "");
  assert.equal(policySummary(null), null);
  assert.equal(policySummary("x"), null);
});
