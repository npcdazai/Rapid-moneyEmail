// Compliance draft panel — pure helpers (no React, no DOM; node-testable).
//
// Shapes follow rapidmoney-email-backend/docs/compliance-composer/00-design.md
// §4 (compose result) and §5 (API). Everything here is SHADOW/review only: the
// panel never sends email and never pushes text into the reply editor.

/** Blocks that the rules mark as regulatory requirements when present. */
export const MANDATORY_BLOCKS = Object.freeze([
  "grievance_registered",
  "gro_contact",
  "resolution_timeline_30d",
  "rbi_ombudsman_path",
  "lender_identity",
  "recovery_conduct_assurance",
  "data_consent_and_deletion_path",
]);
const MANDATORY = new Set(MANDATORY_BLOCKS);

/** Slot keys an agent may fill inline. Config-sourced slots (gro_*, text) are never editable. */
export const EDITABLE_SLOT_KEYS = Object.freeze(["name", "amount", "txn_date", "demand_phrase"]);
const EDITABLE = new Set(EDITABLE_SLOT_KEYS);

export const LANGS = Object.freeze(["en", "hi", "hinglish"]);
export const TONES = Object.freeze(["neutral", "firm_courteous", "distressed"]);

export const LANG_LABELS = Object.freeze({ en: "English", hi: "Hindi", hinglish: "Hinglish" });
export const TONE_LABELS = Object.freeze({
  neutral: "Neutral",
  firm_courteous: "Firm, courteous",
  distressed: "Distressed",
});

const BLOCK_LABELS = {
  greeting: "Greeting",
  auto_ack_notice: "Automated acknowledgement notice",
  issue_restatement: "Issue restatement",
  grievance_registered: "Grievance registered",
  gro_contact: "GRO contact",
  resolution_timeline_30d: "30-day resolution timeline",
  rbi_ombudsman_path: "RBI Ombudsman path",
  lender_identity: "Lender identity",
  fee_wording_approved: "Approved fee wording",
  refund_review_pending: "Refund under review",
  duplicate_debit_path: "Duplicate debit path",
  failed_txn_reversal: "Failed transaction reversal",
  info_request: "Information request",
  next_steps: "Next steps",
  safety_note: "Safety note",
  recovery_conduct_assurance: "Recovery conduct assurance",
  data_consent_and_deletion_path: "Data consent / deletion path",
  signature: "Signature",
};

/** Longer names used when a block is *omitted* from a partial draft (what Compliance must supply). */
const OMITTED_BLOCK_LABELS = {
  gro_contact: "GRO contact (name, email, phone, hours)",
  rbi_ombudsman_path: "RBI Ombudsman path",
  lender_identity: "Lender identity",
  fee_wording_approved: "Approved fee wording",
};

const FLAG_LABELS = { regulator_risk: "Regulator risk", gro_notify: "Notify GRO", late_claim: "Late claim", policy_gap: "Policy gap" };

export function isMandatoryBlock(id) {
  return MANDATORY.has(String(id || ""));
}

export function langLabel(l) {
  return LANG_LABELS[l] || String(l || "");
}
export function toneLabel(t) {
  return TONE_LABELS[t] || String(t || "").replace(/_/g, " ");
}

/** Human label for a block id ("topic_af_refund" → "Topic: af_refund"). */
export function blockLabel(id) {
  const s = String(id || "");
  if (BLOCK_LABELS[s]) return BLOCK_LABELS[s];
  if (s.startsWith("topic_")) return `Topic: ${s.slice(6)}`;
  return s.replace(/_/g, " ");
}

/**
 * Chip for a rules flag; `regulator_risk` (and the refund module's `policy_gap`)
 * are the ones that must stand out; `gro_notify` / `late_claim` are amber.
 */
export function flagChip(flag) {
  const f = String(flag || "");
  const tone = f === "regulator_risk" || f === "policy_gap" ? "danger" : f === "gro_notify" || f === "late_claim" ? "warn" : "neutral";
  return { label: FLAG_LABELS[f] || f.replace(/_/g, " "), tone };
}

/**
 * Status chip for the panel header. `null` when there is no draft.
 * Precedence: error > partial > config missing > needs review > draft.
 * "partial" = review-only text with mandatory blocks omitted until Compliance
 * supplies configuration (`ok` is false; never sendable).
 */
export function statusChip(draft) {
  if (!draft || typeof draft !== "object") return null;
  const s = String(draft.status || "");
  if (s === "error") return { label: "error", tone: "danger" };
  if (s === "partial") return { label: "partial · awaiting compliance config", tone: "warn" };
  if (s === "config_missing") return { label: "config missing", tone: "warn" };
  if (draft.needs_review) return { label: "needs review", tone: "warn" };
  return { label: s || "draft", tone: "ok" };
}

/** Editable slots of one block: [{ key, value }] in EDITABLE_SLOT_KEYS order. */
export function editableSlots(block) {
  const slots = block && block.slots && typeof block.slots === "object" ? block.slots : null;
  if (!slots) return [];
  return EDITABLE_SLOT_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(slots, k)).map((k) => ({
    key: k,
    value: slots[k],
  }));
}

/** Language/tone choices offered for a block (always include what it renders now). */
export function variantOptions(variants, block) {
  const v = (variants && block && variants[block.id]) || {};
  const cur = (block && block.variant) || {};
  const uniq = (arr, extra) => {
    const out = [];
    for (const x of [...(Array.isArray(arr) ? arr : []), extra]) if (x && !out.includes(x)) out.push(x);
    return out;
  };
  return { langs: uniq(v.langs, cur.lang), tones: uniq(v.tones, cur.tone) };
}

/** Global language/tone choices: the union across blocks, else the documented vocab. */
export function globalOptions(variants, draft) {
  const langs = new Set();
  const tones = new Set();
  for (const v of Object.values(variants || {})) {
    for (const l of v?.langs || []) langs.add(l);
    for (const t of v?.tones || []) tones.add(t);
  }
  if (!langs.size) LANGS.forEach((l) => langs.add(l));
  if (!tones.size) TONES.forEach((t) => tones.add(t));
  if (draft?.lang) langs.add(draft.lang);
  if (draft?.tone) tones.add(draft.tone);
  return { langs: Array.from(langs), tones: Array.from(tones) };
}

function cleanSlotValue(key, val) {
  if (val == null) return undefined;
  const str = String(val).trim();
  if (!str) return undefined;
  if (key === "amount" && /^\d+(\.\d+)?$/.test(str)) return Number(str);
  return str;
}

/**
 * Build the `overrides` object for POST …/recompose from the panel's state:
 *   { variants: { [block_id]: { lang?, tone? } }, slots: { [block_id]: { key: value } } }
 * Only editable slot keys survive; blank values are dropped; blocks with nothing left are omitted.
 */
export function buildOverrides(state = {}) {
  const out = {};
  for (const [id, v] of Object.entries(state.variants || {})) {
    if (!v || typeof v !== "object") continue;
    const o = {};
    if (v.lang) o.lang = v.lang;
    if (v.tone) o.tone = v.tone;
    if (Object.keys(o).length) out[id] = { ...(out[id] || {}), ...o };
  }
  for (const [id, s] of Object.entries(state.slots || {})) {
    if (!s || typeof s !== "object") continue;
    const clean = {};
    for (const [k, val] of Object.entries(s)) {
      if (!EDITABLE.has(k)) continue;
      const c = cleanSlotValue(k, val);
      if (c !== undefined) clean[k] = c;
    }
    if (Object.keys(clean).length) out[id] = { ...(out[id] || {}), slots: clean };
  }
  return out;
}

/** Body for POST …/recompose. Empty keys are omitted so the server applies its defaults. */
export function buildRecomposeBody(state = {}) {
  const body = {};
  if (state.lang) body.lang = state.lang;
  if (state.tone) body.tone = state.tone;
  const overrides = buildOverrides(state);
  if (Object.keys(overrides).length) body.overrides = overrides;
  return body;
}

/** One composer error → agent-facing sentence. */
export function errorMessage(err) {
  if (!err || typeof err !== "object") return String(err || "Unknown error");
  const block = err.block ? blockLabel(err.block) : null;
  switch (err.code) {
    case "config_missing":
      return `${block || "A compliance text"} not configured — ask Compliance`;
    case "required_block_missing":
      return `Required block missing: ${block || "unknown"}`;
    case "forbidden_block_present":
      return `Forbidden block present: ${block || "unknown"}`;
    case "slot_missing":
      return `Missing value "${err.slot || "?"}" in ${block || "a block"}`;
    case "unknown_block":
      return `Unknown block: ${err.block || "?"}`;
    case "override_rejected":
      return `Change rejected for ${block || "a block"}${err.slot ? ` (${err.slot})` : ""}`;
    default:
      return `${err.code || "error"}${block ? ` — ${block}` : ""}${err.slot ? ` (${err.slot})` : ""}`;
  }
}

const uniqStrings = (arr) => {
  const out = [];
  for (const x of Array.isArray(arr) ? arr : []) {
    if (x == null) continue;
    const str = String(x).trim();
    if (str && !out.includes(str)) out.push(str);
  }
  return out;
};

/** Config paths an error entry points at (`missing[]`, `paths[]`, `path` or `slot`). */
function errorPaths(er) {
  if (!er || typeof er !== "object") return [];
  if (Array.isArray(er.missing)) return uniqStrings(er.missing);
  if (Array.isArray(er.paths)) return uniqStrings(er.paths);
  return uniqStrings([er.path || er.slot]);
}

/**
 * Omitted blocks of a partial draft, each block ONCE:
 *   [{ id, label, reason, missing: [config paths] }]
 * Source: `draft.omitted_blocks` (`[{ id, reason, missing }]`, deduped by id with the
 * missing paths merged). Fallback when the list is absent: the `config_missing`
 * groups of `groupErrors`. Order follows first appearance.
 */
export function omittedBlocksSummary(draft) {
  if (!draft || typeof draft !== "object") return [];
  const out = [];
  const byId = new Map();
  const add = (id, reason, missing) => {
    const key = String(id || "").trim();
    if (!key) return;
    let row = byId.get(key);
    if (!row) {
      row = { id: key, label: OMITTED_BLOCK_LABELS[key] || blockLabel(key), reason: reason || "config_missing", missing: [] };
      byId.set(key, row);
      out.push(row);
    }
    for (const p of uniqStrings(missing)) if (!row.missing.includes(p)) row.missing.push(p);
  };
  if (Array.isArray(draft.omitted_blocks)) {
    for (const o of draft.omitted_blocks) {
      if (!o) continue;
      if (typeof o === "string") add(o, "config_missing", []);
      else if (typeof o === "object") add(o.id || o.block, o.reason, o.missing || o.paths);
    }
  }
  if (!out.length && draft.status === "partial") {
    for (const g of groupErrors(draft)) if (g.code === "config_missing" && g.block) add(g.block, "config_missing", g.paths);
  }
  return out;
}

/**
 * Composer errors grouped per (code, block) so one block reads once:
 *   [{ code, block, count, paths, message }]
 * `draft.errors_summary` (`[{ block, missing_count, paths }]`, grouped by the backend)
 * is used for the `config_missing` groups when present; otherwise `errors` is grouped
 * client-side. Other codes in `errors` are always grouped client-side. The message
 * carries "(N fields)" when a group covers more than one entry.
 */
export function groupErrors(draft) {
  if (!draft || typeof draft !== "object") return [];
  const summary = Array.isArray(draft.errors_summary) ? draft.errors_summary.filter((x) => x && typeof x === "object") : [];
  const errors = Array.isArray(draft.errors) ? draft.errors : [];
  const groups = new Map();
  const out = [];
  const bump = (code, block, paths, n) => {
    const key = `${code}|${block || ""}`;
    let g = groups.get(key);
    if (!g) {
      g = { code, block: block || null, count: 0, paths: [] };
      groups.set(key, g);
      out.push(g);
    }
    g.count += n;
    for (const p of paths) if (!g.paths.includes(p)) g.paths.push(p);
  };
  const useSummary = summary.length > 0;
  if (useSummary) {
    for (const row of summary) {
      const paths = uniqStrings(row.paths || row.missing);
      const n = Number(row.missing_count);
      bump("config_missing", String(row.block || ""), paths, Number.isFinite(n) && n > 0 ? n : Math.max(1, paths.length));
    }
  }
  for (const er of errors) {
    if (!er || typeof er !== "object") {
      if (er) bump(String(er), "", [], 1);
      continue;
    }
    const code = String(er.code || "error");
    if (useSummary && code === "config_missing") continue;
    const paths = errorPaths(er);
    bump(code, er.block ? String(er.block) : "", paths, 1);
  }
  for (const g of out) {
    const base = g.code === "config_missing" || g.block ? errorMessage({ code: g.code, block: g.block || undefined }) : errorMessage({ code: g.code });
    g.message = g.count > 1 ? `${base} (${g.count} fields)` : base;
  }
  return out;
}

/** Count of blocks still pending counsel approval (array or number from the backend). */
export function unapprovedCount(draft) {
  const u = draft?.unapproved_blocks;
  if (Array.isArray(u)) return u.length;
  if (typeof u === "number" && Number.isFinite(u)) return u;
  return 0;
}

const fmtList = (arr) => (Array.isArray(arr) && arr.length ? arr.join(", ") : "—");

/**
 * Compact rows for the "Analysis" table: [label, value] with values already
 * stringified. Signals only when true, entities only when non-null.
 */
export function summarizeAnalysis(analysis) {
  if (!analysis || typeof analysis !== "object") return [];
  const rows = [];
  rows.push(["Intents", fmtList(analysis.intents)]);
  rows.push(["Secondary", fmtList(analysis.secondary_intents)]);
  rows.push(["Language", analysis.lang ? langLabel(analysis.lang) : "—"]);
  rows.push(["Tone", analysis.tone ? String(analysis.tone) : "—"]);
  rows.push(["Demands", fmtList(analysis.demands)]);
  rows.push(["Info missing", fmtList(analysis.info_missing)]);
  const signals = Object.entries(analysis.signals || {})
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  rows.push(["Signals", fmtList(signals)]);
  const entities = Object.entries(analysis.entities || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${v}`);
  rows.push(["Entities", fmtList(entities)]);
  const conf = Number(analysis.confidence);
  rows.push(["Confidence", Number.isFinite(conf) ? conf.toFixed(2) : "—"]);
  rows.push([
    "Customer master",
    analysis.customer_master_match === true ? "matched" : analysis.customer_master_match === false ? "no match" : "—",
  ]);
  return rows;
}

/**
 * GET payload → { draft, variants, configStatus } | null when malformed.
 * `draft: null` is a valid answer ("nothing composed yet").
 */
export function normalizeDraftPayload(p) {
  if (!p || typeof p !== "object") return null;
  if (!("draft" in p)) return null;
  const draft = p.draft && typeof p.draft === "object" ? { ...p.draft } : null;
  if (draft) {
    draft.blocks = Array.isArray(draft.blocks) ? draft.blocks.filter((b) => b && typeof b === "object" && b.id) : [];
    draft.rules_fired = Array.isArray(draft.rules_fired) ? draft.rules_fired : [];
    draft.flags = Array.isArray(draft.flags) ? draft.flags : [];
    draft.errors = Array.isArray(draft.errors) ? draft.errors : [];
    draft.errors_summary = Array.isArray(draft.errors_summary) ? draft.errors_summary : [];
    draft.omitted_blocks = Array.isArray(draft.omitted_blocks) ? draft.omitted_blocks : [];
    draft.info_missing = Array.isArray(draft.info_missing) ? draft.info_missing : [];
    // Refund module fields (docs/refund-module §6/§7); absent on compliance drafts.
    draft.module = draft.module === "refund" ? "refund" : "compliance";
    draft.scenario = typeof draft.scenario === "string" && draft.scenario ? draft.scenario : null;
    draft.clause_ids = uniqStrings(draft.clause_ids);
    draft.stale = uniqStrings(draft.stale);
  }
  const variants = p.variants && typeof p.variants === "object" ? p.variants : {};
  const cs = p.config_status && typeof p.config_status === "object" ? p.config_status : null;
  const configStatus = cs
    ? { complete: cs.complete !== false, missing: Array.isArray(cs.missing) ? cs.missing : [] }
    : { complete: true, missing: [] };
  return { draft, variants, configStatus };
}

/**
 * How the panel reacts to a failed request:
 *   "hidden" — the feature is not there (404 route/flag, 503 migration, 403 module, 501) or
 *              the network failed: hide the panel, no toast.
 *   "error"  — anything else (500, 400…): show a compact retry line.
 */
export function classifyComplianceError(e) {
  const s = Number(e && e.status);
  if (!Number.isFinite(s) || s === 0) return "hidden";
  if (s === 404 || s === 503 || s === 403 || s === 501) return "hidden";
  return "error";
}

/** BCP-47 value for a block's `lang` attribute (lets the browser pick a Devanagari face). */
export function langAttr(lang) {
  if (lang === "hi") return "hi";
  if (lang === "hinglish") return "hi-Latn";
  return "en";
}

/** Title of the amber "review draft" box for a partial draft; "" when nothing is omitted. */
export function omittedBoxTitle(draft) {
  const n = omittedBlocksSummary(draft).length;
  if (!n) return "";
  return `Review draft — ${n} mandatory block${n === 1 ? "" : "s"} omitted until Compliance supplies configuration`;
}

/** One-line note under the header for a partial draft; "" otherwise. */
export const PARTIAL_REVIEW_NOTE =
  "Review only — the omitted blocks are mandatory for a complaint acknowledgement; this draft cannot be sent.";
export function partialNote(draft) {
  return draft && draft.status === "partial" ? PARTIAL_REVIEW_NOTE : "";
}

/** Label for the "N blocks pending counsel approval" note; "" when none. */
export function unapprovedNote(draft) {
  const n = unapprovedCount(draft);
  if (!n) return "";
  return `${n} block${n === 1 ? "" : "s"} pending counsel approval`;
}

/** Label for the header status line; "" when config is complete or unknown. */
export function configStatusLine(status) {
  const missing = status?.config?.missing ?? status?.missing;
  const complete = status?.config?.complete ?? status?.complete;
  if (complete !== false) return "";
  const n = Array.isArray(missing) ? missing.length : 0;
  return n ? `Compliance config incomplete (${n} item${n === 1 ? "" : "s"})` : "Compliance config incomplete";
}

// ---------------------------------------------------------------------------
// Refund module (backend docs/refund-module/00-design.md §2, §3, §6, §7).
// Drafts carry `module: "refund"`, `scenario`, `clause_ids`, `stale` and an
// analysis shaped like §3; blocks carry `clause_ids`. Everything below is pure
// and tolerant of absent fields (the backend is being built concurrently).
// ---------------------------------------------------------------------------

/** Friendly names for the §2 scenario taxonomy. */
export const SCENARIO_LABELS = Object.freeze({
  failed_txn_debited: "Failed transaction, amount debited",
  duplicate_emi: "Duplicate EMI",
  excess_payment: "Excess payment",
  cooling_off_exit: "Cooling-off exit",
  fee_in_kfs: "KFS-disclosed fee",
  assessment_fee_refund: "Assessment fee (₹199) refund",
  vas_fee: "Value-added service fee",
  wrong_account_credit: "Wrong account credit",
  unauthorised_debit: "Unauthorised debit",
  payment_not_reflected: "Payment not reflected",
});

/** Static clause headings (policy/clauses.json ids → heading), used as chip titles. */
export const CLAUSE_TITLES = Object.freeze({
  "RP-2.1": "Failed transaction with amount debited",
  "RP-2.2": "Duplicate / excess payment",
  "RP-2.3": "Refund timelines for duplicate/excess payments",
  "RP-2.4": "Failed-transaction reversals are not subject to a claim window",
  "RP-3": "Information required for processing a refund",
  "RP-4.3": "Non-refundable items",
  "RP-4.4": "Cooling-off period",
  "RP-5.1": "Customer support and escalation",
  "RP-5.2": "Customer support and escalation",
  "RP-5.3": "Customer support and escalation",
  "TC-7.1": "Platform role and LSP disclosures",
  "TC-7.2": "Company not involved in lending decisions",
  "TC-10.1": "Fees and charges",
  "TC-10.2": "Fees and charges",
  "TC-10.5": "Fees and charges",
  "TC-26.1": "Grievance redressal",
  "TC-26.2": "Grievance redressal",
  "TC-26.3": "Grievance redressal",
  "TC-26.4": "Grievance redressal",
  "GR-3": "Step 1 — GRO",
  "GR-5": "Step 3 — RBI Ombudsman",
  "GR-7": "Consumer protection forums",
  "GR-8": "Reporting fraud and cyber crime",
  "PP-9.1": "Data retention",
  "PP-9.3": "Data retention",
});

const CLAUSE_DOCS = { RP: "Refund Policy", TC: "Terms and Conditions", PP: "Privacy Policy", GR: "Grievance Redressal" };

/** RP-3 information items (§3) → agent-facing labels. */
export const INFO_LABELS = Object.freeze({
  merchant: "Merchant / payee",
  txn_ref: "Transaction reference (UTR / txn id)",
  txn_date_amount: "Transaction date and amount",
  reason: "Reason for the refund",
  beneficiary_name: "Beneficiary name",
  account_number: "Bank account number",
  ifsc: "IFSC",
  registered_mobile: "Registered mobile number",
  // legacy compliance-analysis keys, in case the backend reuses them
  phone: "Registered mobile number",
  utr: "Transaction reference (UTR / txn id)",
});
const TXN_INFO = ["merchant", "txn_ref", "txn_date_amount", "reason", "utr"];
const BANK_INFO = ["beneficiary_name", "account_number", "ifsc"];

export const STALE_CLAUSE_NOTE = "Policy page changed — drafting with this block is blocked until Compliance reviews";

/** Refund-specific flag notices (`late_claim` amber, `policy_gap` red). */
const REFUND_FLAG_NOTES = Object.freeze({
  late_claim: { tone: "warn", note: "Claim raised after the 7-day window — routed to a human, no refusal sent" },
  policy_gap: { tone: "danger", note: "No published clause covers this — draft stopped after acknowledgement; routed to grievance@" },
});

export function isRefundDraft(draft) {
  return !!draft && typeof draft === "object" && draft.module === "refund";
}

/** Friendly scenario label; unknown ids read as words ("some_new_case" → "some new case"). */
export function scenarioLabel(scenario) {
  const s = String(scenario || "").trim();
  if (!s) return "";
  return SCENARIO_LABELS[s] || s.replace(/_/g, " ");
}

/**
 * Heading for a clause id. Sub-ids (`RP-3.txn`, `RP-3.refund`) resolve to their
 * parent; unknown ids fall back to "<Document> §<number>" or the id itself.
 */
export function clauseTitle(id) {
  const s = String(id || "").trim();
  if (!s) return "";
  if (CLAUSE_TITLES[s]) return CLAUSE_TITLES[s];
  const m = /^([A-Z]{2})-(.+)$/.exec(s);
  if (!m) return s;
  const parent = m[2].split(".")[0];
  const parentId = `${m[1]}-${parent}`;
  if (CLAUSE_TITLES[parentId]) return CLAUSE_TITLES[parentId];
  // "TC-26.3" style: try the first two numeric parts
  const two = m[2].split(".").slice(0, 2).join(".");
  if (CLAUSE_TITLES[`${m[1]}-${two}`]) return CLAUSE_TITLES[`${m[1]}-${two}`];
  const doc = CLAUSE_DOCS[m[1]];
  return doc ? `${doc} §${m[2]}` : s;
}

/** Friendly label for an RP-3 info item key. */
export function infoLabel(key) {
  const k = String(key || "").trim();
  return INFO_LABELS[k] || k.replace(/_/g, " ");
}

/**
 * Split `analysis.info_missing` into the two RP-3 groups the panel renders:
 *   { transaction: [{ key, label }], bank: [{ key, label }], other: [{ key, label }] }
 * `bank` holds the credit-only items (beneficiary_name, account_number, ifsc);
 * `other` carries registered_mobile and anything unrecognised. Accepts the
 * analysis object or a plain array. Order within a group follows the input.
 */
export function splitMissingInfo(analysis) {
  const list = Array.isArray(analysis) ? analysis : analysis && typeof analysis === "object" ? analysis.info_missing : null;
  const out = { transaction: [], bank: [], other: [] };
  for (const k of uniqStrings(list)) {
    const row = { key: k, label: infoLabel(k) };
    if (TXN_INFO.includes(k)) out.transaction.push(row);
    else if (BANK_INFO.includes(k)) out.bank.push(row);
    else out.other.push(row);
  }
  return out;
}

/**
 * Refund flag notices present on a draft, in a fixed order:
 *   [{ flag: "late_claim", tone: "warn", label, note }, { flag: "policy_gap", tone: "danger", … }]
 * Other flags (regulator_risk, gro_notify) are chips, not notices, and are not returned.
 */
export function refundFlags(draft) {
  const flags = uniqStrings(draft && draft.flags);
  const out = [];
  for (const f of Object.keys(REFUND_FLAG_NOTES)) {
    if (!flags.includes(f)) continue;
    out.push({ flag: f, label: flagChip(f).label, ...REFUND_FLAG_NOTES[f] });
  }
  return out;
}

/** Mask a transaction reference: first 4 + last 2 kept, the middle collapsed to "…". */
export function maskRef(txn_ref) {
  if (txn_ref == null) return "";
  const s = String(txn_ref).replace(/\s+/g, "");
  if (!s) return "";
  if (s.length <= 6) return s;
  return `${s.slice(0, 4)}…${s.slice(-2)}`;
}

/**
 * Chips for the "Clauses cited" line: [{ id, title, stale }] — `draft.clause_ids`
 * in order, with any `draft.stale` id not already listed appended (so a stale
 * clause is never silently dropped).
 */
export function clauseChips(draft) {
  if (!draft || typeof draft !== "object") return [];
  const stale = new Set(uniqStrings(draft.stale));
  const ids = uniqStrings(draft.clause_ids);
  for (const s of stale) if (!ids.includes(s)) ids.push(s);
  return ids.map((id) => ({ id, title: clauseTitle(id), stale: stale.has(id) }));
}

/** Clause ids a block cites (`block.clause_ids`), each marked stale when the draft says so. */
export function blockClauses(block, draft) {
  const stale = new Set(uniqStrings(draft && draft.stale));
  return uniqStrings(block && block.clause_ids).map((id) => ({ id, title: clauseTitle(id), stale: stale.has(id) }));
}

/** Rows for the "Analysis" table of a refund draft (§3), values already stringified. */
export function summarizeRefundAnalysis(analysis) {
  if (!analysis || typeof analysis !== "object") return [];
  const rows = [];
  rows.push(["Scenario", analysis.scenario ? `${scenarioLabel(analysis.scenario)} (${analysis.scenario})` : "—"]);
  const cands = uniqStrings(analysis.candidates);
  rows.push(["Candidates", cands.length ? cands.map(scenarioLabel).join(", ") : "—"]);
  rows.push(["Duplicate", analysis.duplicate === true ? "yes" : analysis.duplicate === false ? "no" : "—"]);
  const amt = analysis.amount;
  rows.push(["Amount", amt == null || amt === "" ? "—" : `${analysis.currency === "INR" || !analysis.currency ? "₹" : `${analysis.currency} `}${amt}`]);
  rows.push(["Txn ref", analysis.txn_ref ? maskRef(analysis.txn_ref) : "—"]);
  rows.push(["Txn date", analysis.txn_date ? String(analysis.txn_date) : "—"]);
  rows.push(["Payment mode", analysis.payment_mode ? String(analysis.payment_mode).replace(/_/g, " ") : "—"]);
  const days = Number(analysis.days_since_payment);
  rows.push(["Days since payment", analysis.days_since_payment == null || !Number.isFinite(days) ? "—" : String(days)]);
  rows.push(["Info present", fmtList(uniqStrings(analysis.info_present).map(infoLabel))]);
  rows.push(["Info missing", fmtList(uniqStrings(analysis.info_missing).map(infoLabel))]);
  const signals = Object.entries(analysis.signals || {})
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  rows.push(["Signals", fmtList(signals)]);
  rows.push(["Language", analysis.lang ? langLabel(analysis.lang) : "—"]);
  rows.push(["Tone", analysis.tone ? String(analysis.tone) : "—"]);
  const conf = Number(analysis.confidence);
  rows.push(["Confidence", Number.isFinite(conf) ? conf.toFixed(2) : "—"]);
  rows.push(["Needs review", analysis.needs_review === true ? "yes" : analysis.needs_review === false ? "no" : "—"]);
  const src = analysis.source || {};
  rows.push(["Scenario from", src.scenario_from ? String(src.scenario_from) : "—"]);
  return rows;
}

// ---------------------------------------------------------------------------
// Policy status (GET /api/compliance/policy) for the avatar-menu status area.
// ---------------------------------------------------------------------------

/** First 8 characters of a sha; "" when absent. */
export function shortSha(sha) {
  const s = String(sha || "").trim();
  return s ? s.slice(0, 8) : "";
}

function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  try {
    return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return d.toISOString();
  }
}

/**
 * GET /api/compliance/policy payload → what the menu renders, or null when malformed:
 *   { checkedAt, checkedLine, changed: [slug], staleBlocks: [id], reviews: [{ id, slug, detected_at, old_sha, new_sha }],
 *     changeCount, changeLine }
 * `checkedLine` = "Policy pages last checked <date>" (status.checked_at, else manifest.fetched_at;
 * "" when neither). `changeCount` = open reviews, else the number of changed slugs; `changeLine`
 * = "Policy change detected (N) — review" or "" when nothing changed.
 */
export function policySummary(p) {
  if (!p || typeof p !== "object") return null;
  const manifest = p.manifest && typeof p.manifest === "object" ? p.manifest : null;
  const status = p.status && typeof p.status === "object" ? p.status : null;
  const reviews = (Array.isArray(p.reviews) ? p.reviews : [])
    .filter((r) => r && typeof r === "object" && r.id != null)
    .map((r) => ({
      id: r.id,
      slug: String(r.slug || ""),
      detected_at: r.detected_at || null,
      detectedLabel: fmtDateTime(r.detected_at),
      old_sha: shortSha(r.old_sha),
      new_sha: shortSha(r.new_sha),
    }));
  const checkedAt = status?.checked_at || manifest?.fetched_at || null;
  const checkedLabel = fmtDateTime(checkedAt);
  const changed = uniqStrings(status?.changed);
  const staleBlocks = uniqStrings(status?.stale_blocks);
  const changeCount = reviews.length || changed.length;
  return {
    checkedAt,
    checkedLine: checkedLabel ? `Policy pages last checked ${checkedLabel}` : "",
    changed,
    staleBlocks,
    reviews,
    changeCount,
    changeLine: changeCount ? `Policy change detected (${changeCount}) — review` : "",
  };
}
