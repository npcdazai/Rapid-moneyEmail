"use client";

// Compliance draft panel (UI v2 — docs/ui-v2.md "Compliance draft panel").
//
// SHADOW / review only. The panel shows the composer's assembled reply for the
// open ticket so agents and compliance can review it. It has no Send button,
// never writes into the reply editor, and never deletes or free-edits block
// text: agents may switch a block's language/tone variant, fill the few
// customer-fact slots (name, amount, txn_date, demand_phrase), re-run the
// analysis, record accept/reject feedback, or copy the text to the clipboard.
//
// Draft states: "draft" (complete), "partial" (review-only text; mandatory
// blocks omitted until Compliance supplies configuration — listed once each in
// an amber box, never sendable), "config_missing" (nothing composed; red banner
// with errors deduped per block) and "error".
//
// Visibility: rendered by ReadingPane only under uiV2() AND when the user has
// the "autoreply" module (the backend gate).
//
// Refund module (draft.module === "refund", backend docs/refund-module §3/§6/§7):
// adds a Scenario chip, a "Clauses cited" line (stale ids marked red), the
// late_claim / policy_gap notices, the missing-info list split into transaction
// vs bank details, a §3-shaped analysis table and per-block clause ids. For
// module === "compliance" nothing below changes. When the backend answers 404
// (route/flag off), 503 (migration missing), 403 or the network fails, the
// panel hides itself silently.

import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Lock, RefreshCw, ThumbsUp, ThumbsDown, Copy, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { api } from "../../lib/api";
import { shortcuts } from "../../lib/shortcuts";
import {
  statusChip,
  flagChip,
  blockLabel,
  isMandatoryBlock,
  editableSlots,
  variantOptions,
  globalOptions,
  buildRecomposeBody,
  groupErrors,
  omittedBlocksSummary,
  omittedBoxTitle,
  partialNote,
  summarizeAnalysis,
  normalizeDraftPayload,
  classifyComplianceError,
  langAttr,
  langLabel,
  toneLabel,
  unapprovedNote,
  isRefundDraft,
  scenarioLabel,
  clauseChips,
  blockClauses,
  refundFlags,
  splitMissingInfo,
  summarizeRefundAnalysis,
  STALE_CLAUSE_NOTE,
} from "../../lib/compliance";

// Collapsed/expanded survives ticket switches for the page lifetime (the pane
// remounts per ticket); it is deliberately not persisted.
let collapsedPref = false;

const SLOT_LABELS = { name: "Name", amount: "Amount", txn_date: "Txn date", demand_phrase: "Demand" };

export default function CompliancePanel({ ticketId, flash }) {
  const [collapsed, setCollapsed] = useState(collapsedPref);
  // view: "loading" | "hidden" | "error" | "ready"
  const [view, setView] = useState({ status: "loading", draft: null, variants: {}, configStatus: null, http: null });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [recorded, setRecorded] = useState(null); // { draftId, label }
  // Cumulative agent changes, re-sent on every recompose so a new version keeps them.
  const [overrides, setOverrides] = useState({ variants: {}, slots: {} });
  const [typing, setTyping] = useState({}); // "<block>:<slot>" → text being edited
  const seq = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  const toggleCollapsed = () => {
    collapsedPref = !collapsedPref;
    setCollapsed(collapsedPref);
  };

  // `c` — show / hide the panel (listed in the "?" cheat-sheet by the shell).
  useEffect(() => {
    const off = shortcuts.bind("c", toggleCollapsed, { description: "Show / hide compliance draft", group: "Message" });
    return off;
  }, []);

  const apply = (mySeq, payload) => {
    if (mySeq !== seq.current) return false;
    const n = normalizeDraftPayload(payload);
    if (!n) {
      setView({ status: "hidden", draft: null, variants: {}, configStatus: null, http: null });
      return false;
    }
    setView({ status: "ready", draft: n.draft, variants: n.variants, configStatus: n.configStatus, http: null });
    return true;
  };

  const load = () => {
    const my = ++seq.current;
    setView((v) => ({ ...v, status: v.status === "ready" ? "ready" : "loading" }));
    api
      .getComplianceDraft(ticketId)
      .then((p) => apply(my, p))
      .catch((e) => {
        if (my !== seq.current) return;
        if (classifyComplianceError(e) === "hidden") {
          setView({ status: "hidden", draft: null, variants: {}, configStatus: null, http: null });
        } else {
          setView({ status: "error", draft: null, variants: {}, configStatus: null, http: e?.status || null });
        }
      });
  };

  useEffect(() => {
    setOverrides({ variants: {}, slots: {} });
    setTyping({});
    setRecorded(null);
    setActionError("");
    load();
    return () => {
      seq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  // One mutating call at a time; a failure keeps the current version on screen.
  const run = async (fn, { feedback } = {}) => {
    if (busy) return;
    setBusy(true);
    setActionError("");
    const my = ++seq.current;
    try {
      const p = await fn();
      const ok = apply(my, p);
      if (ok && feedback && p?.draft?.id != null) {
        // Audit trail only (feedback table); errors are irrelevant to the agent.
        api.complianceFeedback(p.draft.id, feedback).catch(() => {});
      }
    } catch (e) {
      if (my !== seq.current) return;
      if (classifyComplianceError(e) === "hidden") {
        setView({ status: "hidden", draft: null, variants: {}, configStatus: null, http: null });
      } else {
        setActionError(e?.message ? `Could not update the draft: ${e.message}` : "Could not update the draft");
      }
    } finally {
      if (my === seq.current) setBusy(false);
    }
  };

  // The backend records variant_swap / slot_edit feedback on recompose itself,
  // so the panel does not post it again (avoids double rows in `feedback`).
  const recompose = (next) =>
    run(() => api.recomposeComplianceDraft(ticketId, buildRecomposeBody(next)), {});

  const setGlobal = (patch) => {
    const d = viewRef.current.draft;
    // A global switch resets per-block variant picks (the agent wants the whole reply changed).
    const next = { lang: d?.lang, tone: d?.tone, ...patch, variants: {}, slots: overridesRef.current.slots };
    setOverrides({ variants: {}, slots: overridesRef.current.slots });
    recompose(next, { label: "variant_swap", notes: JSON.stringify({ scope: "all", ...patch }) });
  };

  const setBlockVariant = (block, patch) => {
    const d = viewRef.current.draft;
    const cur = overridesRef.current;
    const variants = { ...cur.variants, [block.id]: { ...(block.variant || {}), ...(cur.variants[block.id] || {}), ...patch } };
    const nextState = { variants, slots: cur.slots };
    setOverrides(nextState);
    recompose({ lang: d?.lang, tone: d?.tone, ...nextState }, {
      label: "variant_swap",
      notes: JSON.stringify({ block: block.id, from: block.variant || null, to: variants[block.id] }),
    });
  };

  const commitSlot = (block, key) => {
    const k = `${block.id}:${key}`;
    if (!(k in typing)) return;
    const value = typing[k];
    const current = overrides.slots[block.id]?.[key] ?? block.slots?.[key] ?? "";
    setTyping((t) => {
      const n = { ...t };
      delete n[k];
      return n;
    });
    if (String(value).trim() === String(current ?? "").trim()) return;
    const d = viewRef.current.draft;
    const cur = overridesRef.current;
    const slots = { ...cur.slots, [block.id]: { ...(cur.slots[block.id] || {}), [key]: value } };
    const nextState = { variants: cur.variants, slots };
    setOverrides(nextState);
    recompose({ lang: d?.lang, tone: d?.tone, ...nextState }, {
      label: "slot_edit",
      notes: JSON.stringify({ block: block.id, slot: key }),
    });
  };

  const reanalyse = () => {
    setOverrides({ variants: {}, slots: {} });
    setTyping({});
    run(() => api.analyzeComplianceDraft(ticketId));
  };

  const record = async (label) => {
    const d = viewRef.current.draft;
    if (!d || d.id == null || busy) return;
    setBusy(true);
    setActionError("");
    try {
      await api.complianceFeedback(d.id, { label });
      setRecorded({ draftId: d.id, label });
      flash?.(label === "accepted" ? "Recorded: accepted (nothing sent)" : "Recorded: rejected");
    } catch (e) {
      setActionError(e?.message ? `Could not record feedback: ${e.message}` : "Could not record feedback");
    } finally {
      setBusy(false);
    }
  };

  const copyText = async () => {
    const t = viewRef.current.draft?.text;
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      flash?.("Draft text copied (not sent)");
    } catch {
      flash?.("Copy failed — select the text and copy manually");
    }
  };

  if (view.status === "hidden" || view.status === "loading") return null;

  const { draft, variants } = view;
  const chip = statusChip(draft);
  const failed = draft && (draft.status === "config_missing" || draft.status === "error");
  const partial = draft?.status === "partial";
  // One row per (code, block): "GRO contact not configured — ask Compliance (4 fields)".
  const errorGroups = groupErrors(draft);
  const omitted = partial ? omittedBlocksSummary(draft) : [];
  const omittedIds = new Set(omitted.map((o) => o.id));
  // In a partial draft the omitted box already covers config_missing; only show the rest.
  const otherGroups = partial ? errorGroups.filter((gr) => !(gr.code === "config_missing" && omittedIds.has(gr.block))) : errorGroups;
  const reviewNote = partialNote(draft);
  const g = globalOptions(variants, draft);
  const note = unapprovedNote(draft);
  const refund = isRefundDraft(draft);
  const analysisRows = refund ? summarizeRefundAnalysis(draft?.analysis) : summarizeAnalysis(draft?.analysis);
  const recordedHere = recorded && draft && recorded.draftId === draft.id ? recorded.label : null;
  // Refund-only derived data (all empty for compliance drafts).
  const ra = refund && draft?.analysis && typeof draft.analysis === "object" ? draft.analysis : null;
  const scenario = refund ? draft.scenario || ra?.scenario || null : null;
  const candidates = refund && Array.isArray(ra?.candidates) ? ra.candidates.filter(Boolean) : [];
  const clauses = refund ? clauseChips(draft) : [];
  const staleCount = clauses.filter((c) => c.stale).length;
  const notices = refund ? refundFlags(draft) : [];
  const missing = refund ? splitMissingInfo(ra?.info_missing?.length ? ra : draft.info_missing) : null;
  const missingCount = missing ? missing.transaction.length + missing.bank.length + missing.other.length : 0;

  return (
    <section className={`section cd-panel${collapsed ? " collapsed" : ""}`} aria-label="Compliance draft" aria-busy={busy}>
      <div className="cd-head">
        <button type="button" className="cd-toggle" onClick={toggleCollapsed} aria-expanded={!collapsed} title="Show / hide (c)">
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <ShieldCheck size={14} />
          <span className="cd-title">Compliance draft</span>
          <span className="cd-sep">·</span>
          <span className="cd-notsent">not sent</span>
        </button>
        {chip && <span className={`cd-chip ${chip.tone}`}>{chip.label}</span>}
        {refund && <span className="cd-chip module" title="Refund-reply module">refund</span>}
        {draft?.version != null && <span className="cd-meta">v{draft.version}</span>}
        {draft?.rules_version && <span className="cd-meta" title="Rules version">rules {draft.rules_version}</span>}
        {busy && <RefreshCw size={13} className="spin cd-spin" aria-hidden="true" />}
      </div>

      {!collapsed && (
        <div className="cd-body">
          {view.status === "error" ? (
            <div className="cd-line">
              <span>Couldn&apos;t load the compliance draft{view.http ? ` (HTTP ${view.http})` : ""}.</span>
              <button type="button" className="hv-link" onClick={load}>Retry</button>
            </div>
          ) : !draft ? (
            <div className="cd-line">
              <span>No compliance draft for this ticket yet.</span>
              <button type="button" className="btn" disabled={busy} onClick={reanalyse}>
                <RefreshCw size={13} /> Analyse
              </button>
            </div>
          ) : (
            <>
              {reviewNote && <div className="cd-review-note">{reviewNote}</div>}
              <div className="cd-controls">
                <label className="cd-select">
                  <span>Language</span>
                  <select value={draft.lang || ""} disabled={busy} onChange={(e) => setGlobal({ lang: e.target.value })}>
                    {g.langs.map((l) => (
                      <option key={l} value={l}>{langLabel(l)}</option>
                    ))}
                  </select>
                </label>
                <label className="cd-select">
                  <span>Tone</span>
                  <select value={draft.tone || ""} disabled={busy} onChange={(e) => setGlobal({ tone: e.target.value })}>
                    {g.tones.map((t) => (
                      <option key={t} value={t}>{toneLabel(t)}</option>
                    ))}
                  </select>
                </label>
                <span className="cd-grow" />
                <button type="button" className="btn" disabled={busy} onClick={reanalyse} title="Re-run analysis and compose a new version">
                  <RefreshCw size={13} /> Re-analyse
                </button>
                <button
                  type="button"
                  className={`btn${recordedHere === "accepted" ? " cd-on" : ""}`}
                  disabled={busy || draft.id == null}
                  onClick={() => record("accepted")}
                  title="Record that this version is acceptable — nothing is sent"
                >
                  <ThumbsUp size={13} /> Accept
                </button>
                <button
                  type="button"
                  className={`btn${recordedHere === "rejected" ? " cd-on" : ""}`}
                  disabled={busy || draft.id == null}
                  onClick={() => record("rejected")}
                  title="Record that this version is not acceptable"
                >
                  <ThumbsDown size={13} /> Reject
                </button>
                <button type="button" className="btn" disabled={busy || !draft.text} onClick={copyText} title="Copy the composed text to the clipboard">
                  <Copy size={13} /> Copy text
                </button>
              </div>

              {actionError && <div className="cd-error" role="alert">{actionError}</div>}

              {refund && (scenario || candidates.length > 0 || ra?.duplicate === true) && (
                <div className="cd-scenario" data-testid="cd-scenario">
                  <span className="cd-label">Scenario</span>
                  {scenario ? (
                    <span className="cd-chip scenario" title={`scenario: ${scenario}`}>{scenarioLabel(scenario)}</span>
                  ) : (
                    <span className="cd-chip warn" title="No scenario detected">undetermined</span>
                  )}
                  {ra?.duplicate === true && (
                    <span className="cd-chip warn" title="The customer reports being charged twice">duplicate</span>
                  )}
                  {candidates.length > 1 && (
                    <span className="cd-candidates" title="Scenario candidates considered before the tie-break">
                      candidates: {candidates.map(scenarioLabel).join(" · ")}
                    </span>
                  )}
                  {ra?.source?.scenario_from && <span className="cd-meta">via {String(ra.source.scenario_from)}</span>}
                </div>
              )}

              {(draft.route || draft.min_priority || (!refund && draft.info_missing?.length > 0)) && (
                <div className="cd-meta-row">
                  {draft.route && <span>Route: <b>{draft.route}</b></span>}
                  {draft.min_priority && <span>Min priority: <b>{draft.min_priority}</b></span>}
                  {!refund && draft.info_missing?.length > 0 && <span>Info to request: <b>{draft.info_missing.join(", ")}</b></span>}
                </div>
              )}

              {refund && clauses.length > 0 && (
                <div className="cd-clauses" data-testid="cd-clauses">
                  <span className="cd-label">Clauses cited</span>
                  {clauses.map((c) => (
                    <span key={c.id} className={`cd-clause${c.stale ? " stale" : ""}`} title={c.stale ? `${c.title} — stale` : c.title}>
                      {c.id}
                      {c.stale && <span className="cd-stale-mark" aria-label="stale">stale</span>}
                    </span>
                  ))}
                </div>
              )}
              {refund && staleCount > 0 && (
                <div className="cd-stale-note" role="alert">
                  <AlertTriangle size={13} /> {STALE_CLAUSE_NOTE}
                </div>
              )}

              {notices.map((n) => (
                <div key={n.flag} className={`cd-notice ${n.tone}`} role="status" title={`flag: ${n.flag}`}>
                  <AlertTriangle size={14} />
                  <span><b>{n.label}</b> — {n.note}</span>
                </div>
              ))}

              {refund && missingCount > 0 && (
                <div className="cd-missing" data-testid="cd-missing">
                  <div className="cd-label">Missing information</div>
                  <div className="cd-missing-groups">
                    {missing.transaction.length > 0 && (
                      <div className="cd-missing-group">
                        <div className="cd-missing-title">Transaction details</div>
                        <ul>
                          {missing.transaction.map((m) => (
                            <li key={m.key} title={m.key}>{m.label}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {missing.bank.length > 0 && (
                      <div className="cd-missing-group">
                        <div className="cd-missing-title">Bank details <span className="cd-muted">(only when a credit is possible)</span></div>
                        <ul>
                          {missing.bank.map((m) => (
                            <li key={m.key} title={m.key}>{m.label}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {missing.other.length > 0 && (
                      <div className="cd-missing-group">
                        <div className="cd-missing-title">Also</div>
                        <ul>
                          {missing.other.map((m) => (
                            <li key={m.key} title={m.key}>{m.label}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {(draft.rules_fired.length > 0 || draft.flags.length > 0) && (
                <div className="cd-rules">
                  <span className="cd-label">Rules fired</span>
                  {draft.rules_fired.map((r) => (
                    <span key={r} className="cd-chip neutral">{r}</span>
                  ))}
                  {draft.flags.map((f) => {
                    const fc = flagChip(f);
                    return (
                      <span key={f} className={`cd-chip ${fc.tone}`} title={`flag: ${f}`}>
                        {fc.tone === "danger" && <AlertTriangle size={11} />} {fc.label}
                      </span>
                    );
                  })}
                </div>
              )}

              {note && <div className="cd-note">{note}</div>}

              {partial && omitted.length > 0 && (
                <div className="cd-omitted" role="status">
                  <AlertTriangle size={16} />
                  <div>
                    <b>{omittedBoxTitle(draft)}</b>
                    <ul>
                      {omitted.map((o) => (
                        <li key={o.id}>
                          <span className="cd-omitted-name" title={o.id}>{o.label}</span>
                          {o.missing.length > 0 && <div className="cd-omitted-paths">Missing: {o.missing.join(", ")}</div>}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {failed ? (
                <div className="cd-banner" role="status">
                  <AlertTriangle size={16} />
                  <div>
                    <b>{draft.status === "config_missing" ? "Cannot compose — compliance configuration missing" : "Composer error"}</b>
                    <ul>
                      {errorGroups.length ? (
                        errorGroups.map((gr) => <li key={`${gr.code}|${gr.block || ""}`}>{gr.message}</li>)
                      ) : (
                        <li>No details returned.</li>
                      )}
                    </ul>
                  </div>
                </div>
              ) : (
                otherGroups.length > 0 && (
                  <div className="cd-banner soft" role="status">
                    <ul>
                      {otherGroups.map((gr) => <li key={`${gr.code}|${gr.block || ""}`}>{gr.message}</li>)}
                    </ul>
                  </div>
                )
              )}

              {analysisRows.length > 0 && (
                <details className="cd-details">
                  <summary>Analysis</summary>
                  <table className="cd-table">
                    <tbody>
                      {analysisRows.map(([k, v]) => (
                        <tr key={k}>
                          <th scope="row">{k}</th>
                          <td>{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <details className="cd-details nested">
                    <summary>Raw JSON</summary>
                    <pre className="cd-pre">{JSON.stringify(draft.analysis, null, 2)}</pre>
                  </details>
                </details>
              )}

              {draft.blocks.length > 0 && (
                <div className="cd-blocks">
                  <div className="cd-label">Blocks ({draft.blocks.length})</div>
                  <div className="cd-hint">
                    Switch a block&apos;s language or tone, or fill the highlighted details. Block text cannot be edited or removed here, and nothing is sent.
                  </div>
                  {partial && (
                    <div className="cd-hint">
                      Only the rendered blocks are listed; the omitted mandatory blocks above are not part of this text.
                    </div>
                  )}
                  {draft.blocks.map((b) => {
                    const opts = variantOptions(variants, b);
                    const slots = editableSlots(b);
                    const mandatory = isMandatoryBlock(b.id);
                    const v = b.variant || {};
                    const bc = refund ? blockClauses(b, draft) : [];
                    const bStale = bc.some((c) => c.stale);
                    return (
                      <div key={b.id} className={`cd-block${mandatory ? " mandatory" : ""}${bStale ? " stale" : ""}`}>
                        <div className="cd-block-head">
                          {mandatory && <Lock size={12} aria-label="Required by rules" title="Required by rules — cannot be removed" />}
                          <span className="cd-block-id" title={b.id}>{blockLabel(b.id)}</span>
                          {b.version != null && <span className="cd-meta">v{b.version}</span>}
                          <span className="cd-meta">{langLabel(v.lang)} · {toneLabel(v.tone)}</span>
                          <span className="cd-grow" />
                          <select
                            aria-label={`Language for ${blockLabel(b.id)}`}
                            value={v.lang || ""}
                            disabled={busy || opts.langs.length < 2}
                            onChange={(e) => setBlockVariant(b, { lang: e.target.value })}
                          >
                            {opts.langs.map((l) => (
                              <option key={l} value={l}>{langLabel(l)}</option>
                            ))}
                          </select>
                          <select
                            aria-label={`Tone for ${blockLabel(b.id)}`}
                            value={v.tone || ""}
                            disabled={busy || opts.tones.length < 2}
                            onChange={(e) => setBlockVariant(b, { tone: e.target.value })}
                          >
                            {opts.tones.map((t) => (
                              <option key={t} value={t}>{toneLabel(t)}</option>
                            ))}
                          </select>
                        </div>
                        {bc.length > 0 && (
                          <div className="cd-block-clauses">
                            {bc.map((c) => (
                              <span key={c.id} className={`cd-clause${c.stale ? " stale" : ""}`} title={c.stale ? `${c.title} — stale` : c.title}>
                                {c.id}
                                {c.stale && <span className="cd-stale-mark" aria-label="stale">stale</span>}
                              </span>
                            ))}
                            {bStale && <span className="cd-stale-inline">{STALE_CLAUSE_NOTE}</span>}
                          </div>
                        )}
                        {slots.length > 0 && (
                          <div className="cd-slots">
                            {slots.map(({ key, value }) => {
                              const k = `${b.id}:${key}`;
                              const shown = k in typing ? typing[k] : overrides.slots[b.id]?.[key] ?? value ?? "";
                              return (
                                <label key={key} className="cd-slot">
                                  <span>{SLOT_LABELS[key] || key}</span>
                                  <input
                                    type="text"
                                    value={shown == null ? "" : String(shown)}
                                    inputMode={key === "amount" ? "decimal" : undefined}
                                    placeholder={value == null ? "not detected" : ""}
                                    disabled={busy}
                                    onChange={(e) => setTyping((t) => ({ ...t, [k]: e.target.value }))}
                                    onBlur={() => commitSlot(b, key)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        e.currentTarget.blur();
                                      }
                                    }}
                                  />
                                </label>
                              );
                            })}
                          </div>
                        )}
                        {b.text ? (
                          <div className="cd-text" lang={langAttr(v.lang)}>{b.text}</div>
                        ) : (
                          <div className="cd-text missing">— no text (not configured) —</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {!failed && draft.text && (
                <details className="cd-details">
                  <summary>{partial ? "Full text (review only — partial)" : "Full text (as composed)"}</summary>
                  <div className="cd-text full" lang={langAttr(draft.lang)}>{draft.text}</div>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
