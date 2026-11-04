"use client";

import { useEffect, useRef, useState } from "react";
import {
  Reply,
  CheckCircle2,
  RotateCcw,
  Flag,
  MailOpen,
  Pencil,
  Send,
  Mail,
  Paperclip,
  X,
  FileText,
  Zap,
  UserCheck,
  UserX,
  AlertTriangle,
  Phone,
} from "lucide-react";
import { api } from "../../lib/api";
import RichTextEditor from "./RichTextEditor";
import {
  fmtDate,
  slaChip,
  initials,
  avatarColor,
  catLabel,
  catStyle,
  CATEGORIES,
  CATEGORY_CODES,
} from "../../lib/format";
import { slaChip as slaChipV2 } from "../../lib/sla";
import { mapThreadView, foldSummary } from "../../lib/threadFold";
import { shortcuts } from "../../lib/shortcuts";
import HtmlView, { loadTicketHtml, htmlViewAvailable } from "./HtmlView";
import { getBodyView, setBodyView, otherBodyView, isTrustedSender } from "../../lib/htmlView";

const STATUSES = [
  "Open",
  "In Progress",
  "Pending Customer",
  "Resolved",
  "Closed",
];

export default function ReadingPane({ ticketId, onChanged, onPatch, flash, canAutoReply = true, v2 = false }) {
  const [ticket, setTicket] = useState(null);
  const statusRef = useRef(null);
  const ticketRef = useRef(null);
  ticketRef.current = ticket;
  const [note, setNote] = useState("");
  const [showReply, setShowReply] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [replyEmpty, setReplyEmpty] = useState(true);
  const [cc, setCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [templates, setTemplates] = useState([]);
  const editorRef = useRef(null);
  const fileRef = useRef(null);

  // Load user-managed reply templates once.
  useEffect(() => {
    api.templates.list().then((r) => setTemplates(r.items || [])).catch(() => {});
  }, []);

  const updateEmpty = () =>
    setReplyEmpty(!editorRef.current?.innerText.trim());

  const load = async () => {
    try {
      setTicket(await api.get(ticketId));
    } catch (e) {
      flash(`Error: ${e.message}`);
    }
  };

  useEffect(() => {
    setTicket(null);
    setNote("");
    setShowReply(false);
    setShowNote(false);
    setAttachments([]);
    setReplyEmpty(true);
    setCc("");
    setShowCc(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  // Qwen shadow evaluation (AI prediction + unapproved draft; never sent).
  const [aiEval, setAiEval] = useState(null);
  useEffect(() => {
    setAiEval(null);
    api.aiEvaluation(ticketId).then((rows) => setAiEval(rows?.[0] || null)).catch(() => {});
  }, [ticketId]);

  // Inbound attachments (screenshots etc. the customer emailed). Images are
  // fetched as blobs (the <img> tag can't send the auth header) and shown
  // inline; other files get a download button.
  const [inboundAtts, setInboundAtts] = useState([]);
  useEffect(() => {
    const urls = [];
    let gone = false;
    setInboundAtts([]);
    api
      .attachments(ticketId)
      .then(async (list) => {
        const out = [];
        for (const a of list || []) {
          let url = null;
          if ((a.content_type || "").startsWith("image/")) {
            try {
              url = URL.createObjectURL(await api.attachmentBlob(ticketId, a.id));
              urls.push(url);
            } catch {
              /* show as file instead */
            }
          }
          out.push({ ...a, url });
        }
        if (!gone) setInboundAtts(out);
      })
      .catch(() => {});
    return () => {
      gone = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [ticketId]);

  const downloadAtt = async (a) => {
    try {
      const blob = await api.attachmentBlob(ticketId, a.id);
      const u = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = u;
      link.download = a.filename || "attachment";
      link.click();
      URL.revokeObjectURL(u);
    } catch (e) {
      flash(`Error: ${e.message}`);
    }
  };

  const guard = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await load();
      onChanged?.();
    } catch (e) {
      flash(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  // ── UI v2: display-only quote folding (GET /:id/thread) ──
  // The stored body is never changed; on any failure we fall back to it.
  const [thread, setThread] = useState(null);
  const [quotesOpen, setQuotesOpen] = useState({ value: false, n: 0 });
  useEffect(() => {
    setThread(null);
    setQuotesOpen({ value: false, n: 0 });
    if (!v2) return;
    let gone = false;
    api
      .getThread(ticketId)
      .then((p) => {
        if (!gone) setThread(p && typeof p === "object" ? p : null);
      })
      .catch(() => {
        if (!gone) setThread(null); // 404 (disabled) or network: plain body
      });
    return () => {
      gone = true;
    };
  }, [ticketId, v2]);

  // ── UI v2: sandboxed HTML view (GET /:id/html) — "Text | HTML" control ──
  // Preference is per user (localStorage mh_body_view, "text" by default) and
  // read after mount. The HTML is fetched lazily: when the ticket has loaded
  // AND the preference is HTML (or when the user clicks HTML), plus one probe
  // per session so a disabled backend hides the control everywhere. Any
  // failure keeps the text/thread view; no toast.
  const [bodyView, setBodyViewState] = useState("text");
  const bodyViewRef = useRef("text");
  bodyViewRef.current = bodyView;
  const [htmlState, setHtmlState] = useState({ status: "idle", data: null, images: false });
  const htmlReq = useRef(0);
  useEffect(() => {
    if (!v2) return;
    const v = getBodyView();
    setBodyViewState(v);
    bodyViewRef.current = v;
  }, [v2]);

  const fetchHtml = (images) => {
    const t = ticketRef.current;
    if (!t) return;
    const seq = ++htmlReq.current;
    const wantImages = !!images || isTrustedSender(t.from_email);
    setHtmlState((h) => ({ ...h, status: "loading" }));
    loadTicketHtml(t.id, { images: wantImages }).then((r) => {
      if (seq !== htmlReq.current) return; // ticket changed meanwhile
      if (r.status === "ok") setHtmlState({ status: "ok", data: r.data, images: wantImages });
      else setHtmlState({ status: r.status, data: null, images: wantImages });
    });
  };
  const fetchHtmlRef = useRef(fetchHtml);
  fetchHtmlRef.current = fetchHtml;

  useEffect(() => {
    htmlReq.current++;
    setHtmlState({ status: "idle", data: null, images: false });
    if (!v2 || !ticket) return;
    const avail = htmlViewAvailable();
    if (avail === false) return;
    if (bodyViewRef.current === "html" || avail === null) fetchHtmlRef.current(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v2, ticket?.id]);

  const chooseBodyView = (v) => {
    const next = setBodyView(v);
    setBodyViewState(next);
    bodyViewRef.current = next;
    if (next === "html") {
      setHtmlState((h) => {
        if (h.status === "idle" || h.status === "error") setTimeout(() => fetchHtmlRef.current(false), 0);
        return h;
      });
    }
  };
  const chooseBodyViewRef = useRef(chooseBodyView);
  chooseBodyViewRef.current = chooseBodyView;

  const htmlControlVisible = v2 && htmlViewAvailable() !== false && htmlState.status !== "none" && htmlState.status !== "disabled";
  const showHtml = htmlControlVisible && bodyView === "html" && htmlState.status === "ok" && htmlState.data;

  // ── UI v2: pane-scoped shortcuts (r reply, s status, b quotes, f flag, u read, h html) ──
  const guardRef = useRef(guard);
  guardRef.current = guard;
  useEffect(() => {
    if (!v2) return;
    const off = [
      shortcuts.bind(
        "h",
        () => chooseBodyViewRef.current(otherBodyView(bodyViewRef.current)),
        { description: "Toggle Text / HTML view", group: "Message" }
      ),
      shortcuts.bind(
        "r",
        () => {
          setShowReply(true);
          setTimeout(() => editorRef.current?.focus(), 0);
        },
        { description: "Reply (focus the editor)", group: "Message" }
      ),
      shortcuts.bind(
        "s",
        () => {
          const el = statusRef.current;
          if (!el) return;
          el.focus();
          try {
            if (typeof el.showPicker === "function") el.showPicker();
          } catch {
            /* showPicker needs a user gesture in some browsers — focus is enough */
          }
        },
        { description: "Change status", group: "Message" }
      ),
      shortcuts.bind(
        "b",
        () => setQuotesOpen((q) => ({ value: !q.value, n: q.n + 1 })),
        { description: "Show / hide quoted text", group: "Message" }
      ),
      shortcuts.bind(
        "f",
        () => {
          const t = ticketRef.current;
          if (!t) return;
          guardRef.current(async () => {
            await api.setFlag(t.id, !t.flagged);
            flash(t.flagged ? "Flag cleared" : "Flagged");
          });
        },
        { description: "Flag / unflag", group: "Message" }
      ),
      shortcuts.bind(
        "u",
        () => {
          const t = ticketRef.current;
          if (!t) return;
          guardRef.current(async () => {
            await api.setRead(t.id, !t.is_read);
            onPatch?.(t.id, { is_read: !t.is_read });
            flash(t.is_read ? "Marked unread" : "Marked read");
          });
        },
        { description: "Mark read / unread", group: "Message" }
      ),
    ];
    return () => off.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v2, ticketId]);

  const paneAttrs = v2 ? { id: "mh-reading-pane", tabIndex: -1, "aria-label": "Message" } : {};

  if (!ticket) {
    return (
      <section className="reading empty" {...paneAttrs}>
        <div className="empty-card">
          <div className="big">
            <Mail size={38} />
          </div>
          <h2>Loading message…</h2>
        </div>
      </section>
    );
  }

  const chip = slaChip(ticket);
  const chip2 = v2 ? slaChipV2(ticket) : null;
  const view = v2 && thread ? mapThreadView(thread, ticket) : null;
  const name = ticket.from_name || ticket.from_email || "Unknown";
  const isResolved = ticket.status === "Resolved" || ticket.status === "Closed";

  const sendReply = () =>
    guard(async () => {
      const html = editorRef.current?.innerHTML || "";
      const text = editorRef.current?.innerText.trim() || "";
      const res = await api.reply(ticketId, {
        body: text,
        html,
        cc: cc.trim() || undefined,
        attachments: attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });
      if (editorRef.current) editorRef.current.innerHTML = "";
      setAttachments([]);
      setReplyEmpty(true);
      setCc("");
      setShowCc(false);
      setShowReply(false);
      flash(`Reply sent · status: ${res.ticket_status}`);
    });

  const onFiles = (fileList) => {
    const files = Array.from(fileList || []);
    files.forEach((file) => {
      if (file.size > 10 * 1024 * 1024) {
        flash(`"${file.name}" exceeds 10 MB — skipped`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = String(reader.result).split(",")[1] || "";
        setAttachments((prev) => [
          ...prev,
          {
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
            content: b64,
            preview: file.type.startsWith("image/") ? reader.result : null,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeAttachment = (i) =>
    setAttachments((prev) => prev.filter((_, idx) => idx !== i));

  const addNote = () =>
    guard(async () => {
      await api.addNote(ticketId, note);
      setNote("");
      setShowNote(false);
      flash("Note added");
    });

  const applyTemplate = (tpl) => {
    const first = name.split(" ")[0] || "Customer";
    // Auto-fill the placeholders we know; leave the rest as {{...}} for the agent.
    const filled = (tpl.body || "")
      .replaceAll("{{customer_name}}", first)
      .replaceAll("{name}", first)
      .replaceAll("{{support_email}}", "support@rapidmoney.in")
      .replaceAll("{{grievance_email}}", "grievance@rapidmoney.in")
      .replaceAll("{{app_link}}", "https://rapidmoney.in/help")
      .replaceAll("{{ticket_id}}", ticket.reference || "{{ticket_id}}");
    // User templates are stored as HTML; only convert newlines for plain text.
    const html = /<[a-z][\s\S]*>/i.test(filled) ? filled : filled.replace(/\n/g, "<br>");
    setShowReply(true);
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.innerHTML = html;
        editorRef.current.focus();
        updateEmpty();
      }
    }, 0);
  };

  return (
    <section className="reading" {...paneAttrs}>
      <div className="read-toolbar">
        <button
          className="tool primary"
          disabled={busy}
          onClick={() => setShowReply((v) => !v)}
        >
          <Reply size={16} /> Reply
        </button>
        <button
          className="tool"
          disabled={busy}
          onClick={() =>
            guard(async () => {
              const next = isResolved ? "In Progress" : "Resolved";
              await api.setStatus(ticketId, next);
              onPatch?.(ticketId, { status: next });
              flash(isResolved ? "Reopened" : "Marked resolved");
            })
          }
        >
          {isResolved ? (
            <>
              <RotateCcw size={16} /> Reopen
            </>
          ) : (
            <>
              <CheckCircle2 size={16} /> Resolve
            </>
          )}
        </button>
        <button
          className="tool"
          disabled={busy}
          onClick={() =>
            guard(async () => {
              await api.setFlag(ticketId, !ticket.flagged);
              flash(ticket.flagged ? "Flag cleared" : "Flagged");
            })
          }
        >
          <Flag size={16} fill={ticket.flagged ? "currentColor" : "none"} />{" "}
          {ticket.flagged ? "Unflag" : "Flag"}
        </button>
        <button
          className="tool"
          disabled={busy}
          onClick={() =>
            guard(async () => {
              await api.setRead(ticketId, false);
              flash("Marked unread");
            })
          }
        >
          <MailOpen size={16} /> Mark unread
        </button>
        <button className="tool" disabled={busy} onClick={() => setShowNote((v) => !v)}>
          <Pencil size={16} /> Note
        </button>
        {canAutoReply && (
          <button
            className="tool"
            disabled={busy}
            title="Send the auto-generated, website-grounded reply to this customer now"
            onClick={() =>
              guard(async () => {
                await api.autoReplyNow(ticketId);
                flash("Auto-reply sent");
              })
            }
          >
            <Zap size={16} /> Auto-reply
          </button>
        )}

        <span className="tool-sep" />

        <select
          ref={statusRef}
          aria-label="Status"
          value={ticket.status}
          disabled={busy}
          onChange={(e) =>
            guard(async () => {
              await api.setStatus(ticketId, e.target.value);
              onPatch?.(ticketId, { status: e.target.value });
              flash(`Status → ${e.target.value}`);
            })
          }
        >
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          value={ticket.category || ""}
          disabled={busy}
          onChange={(e) =>
            guard(async () => {
              await api.setCategory(ticketId, { category: e.target.value });
              flash("Category updated");
            })
          }
        >
          <option value="" disabled>
            Category…
          </option>
          {CATEGORY_CODES.map((code) => (
            <option key={code} value={code}>
              {CATEGORIES[code].label}
            </option>
          ))}
        </select>
        <select
          value={ticket.priority}
          disabled={busy}
          onChange={(e) =>
            guard(async () => {
              await api.setCategory(ticketId, {
                category: ticket.category || "inquiry",
                priority: e.target.value,
              });
              flash(`Priority → ${e.target.value}`);
            })
          }
        >
          <option value="P1">P1 · 4h</option>
          <option value="P2">P2 · 24h</option>
          <option value="P3">P3 · 48h</option>
        </select>
        {htmlControlVisible && (
          <div className="body-seg" role="group" aria-label="Body view" aria-busy={htmlState.status === "loading"}>
            <button
              type="button"
              className={bodyView === "text" ? "on" : ""}
              aria-pressed={bodyView === "text"}
              onClick={() => chooseBodyView("text")}
            >
              Text
            </button>
            <button
              type="button"
              className={bodyView === "html" ? "on" : ""}
              aria-pressed={bodyView === "html"}
              title="Sandboxed HTML view (h)"
              onClick={() => chooseBodyView("html")}
            >
              HTML
            </button>
          </div>
        )}
      </div>

      <div className="read-body">
        <h1 className="read-subject">{ticket.subject || "(no subject)"}</h1>

        <div className="read-from">
          <div
            className="avatar"
            style={{ background: avatarColor(ticket.from_email || name) }}
          >
            {initials(name)}
          </div>
          <div className="who">
            <div className="nm">{name}</div>
            <div className="em">{ticket.from_email}</div>
          </div>
          <div className="when">
            {fmtDate(ticket.received_at)}
            <br />
            {v2
              ? chip2.label && (
                  <span
                    className={`sla ${chip2.tone}`}
                    title={chip2.dueAt ? `${chip2.basis === "tat" ? "TAT" : "SLA"} due ${new Date(chip2.dueAt).toLocaleString()}` : undefined}
                  >
                    {chip2.label}
                  </span>
                )
              : (ticket.status === "Open" || ticket.status === "In Progress") && (
                  <span className={`sla ${chip.cls}`}>{chip.text}</span>
                )}
          </div>
        </div>

        <div className="msg-tags" style={{ marginBottom: 14 }}>
          <span className={`chip prio ${ticket.priority}`}>{ticket.priority}</span>
          <span className="chip" style={catStyle(ticket.category)}>
            {catLabel(ticket.category)}
          </span>
          <span className="chip status">{ticket.status}</span>
          {ticket.sub_category && (
            <span className="chip status">{ticket.sub_category}</span>
          )}
          {ticket.matched_phone && (
            <span className="chip status" title="10-digit number detected in this email">
              <Phone size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
              {ticket.matched_phone}
            </span>
          )}
        </div>

        {ticket.needs_manual_review && (
          <div className="review-banner">
            <AlertTriangle size={18} />
            <div>
              <b>Flagged for manual review</b>
              <div className="review-reason">
                {ticket.manual_review_reason ||
                  "No approved template confidently matched — handle manually."}
              </div>
            </div>
          </div>
        )}

        {/* Customer master match (QRC Email Automation) */}
        <div className={`cust-card ${ticket.customer ? "matched" : "unmatched"}`}>
          <div className="cust-head">
            {ticket.customer ? <UserCheck size={16} /> : <UserX size={16} />}
            <span>
              {ticket.customer
                ? "Matched to customer master"
                : "No customer-master match"}
            </span>
          </div>
          {ticket.customer ? (
            <div className="cust-grid">
              <div><label>Customer ID (LAN)</label><span>{ticket.customer.lan || "—"}</span></div>
              <div><label>Name</label><span>{ticket.customer.name || "—"}</span></div>
              <div><label>Contact No</label><span>{ticket.customer.phone || ticket.matched_phone || "—"}</span></div>
              <div><label>Email</label><span>{ticket.customer.email || "—"}</span></div>
              <div><label>Application Id</label><span>{ticket.customer.application_id || "—"}</span></div>
              <div><label>Loan Id</label><span>{ticket.customer.loan_id || "—"}</span></div>
              <div><label>Lender</label><span>{ticket.customer.lenders_name || "—"}</span></div>
            </div>
          ) : (
            <div className="muted" style={{ padding: "2px 0 0" }}>
              {ticket.matched_phone
                ? `Detected number ${ticket.matched_phone} was not found in the customer master.`
                : "No 10-digit number detected and the sender's email isn't in the master."}
            </div>
          )}
          {ticket.query_summary && (
            <div className="cust-summary">
              <label>Customer query</label>
              <span>{ticket.query_summary}</span>
            </div>
          )}
        </div>

        {showHtml ? (
          <HtmlView
            ticketId={ticket.id}
            senderEmail={ticket.from_email}
            data={htmlState.data}
            images={htmlState.images}
            loading={htmlState.status === "loading"}
            onImages={() => fetchHtml(true)}
          />
        ) : view ? (
          <>
            <div className="email-body">{view.newest}</div>
            {view.folds.length > 0 && (
              <div className="quote-folds">
                {view.folds.map((f, i) => (
                  <QuotedBlock key={i} fold={f} all={quotesOpen} />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="email-body">{ticket.body}</div>
        )}

        {/* {aiEval && !aiEval.error && (
          <div className="section ai-eval">
            <h3>
               <span className="ai-tag">NOT sent</span>
            </h3>
            <div className="ai-meta">
              Predicts <b>{aiEval.intent}/{aiEval.category}</b>
              {aiEval.production_category
                ? aiEval.matches_production
                  ? " — agrees with production"
                  : ` — production said ${aiEval.production_category}`
                : ""}
              {" · "}confidence {Number(aiEval.confidence ?? 0).toFixed(2)}
              {aiEval.requires_human ? " · needs human" : ""}
              {aiEval.duration_ms ? ` · ${(aiEval.duration_ms / 1000).toFixed(1)}s` : ""}
            </div>
            {aiEval.summary && <div className="ai-summary">{aiEval.summary}</div>}
            {aiEval.proposed_answer && (
              <div className="ai-draft">
                <div className="ai-draft-label">
                  Unapproved AI draft (grounded in KB: {aiEval.kb_intent}) — review before any use
                </div>
                <div className="txt">{aiEval.proposed_answer}</div>
              </div>
            )}
          </div>
        )} */}

        {inboundAtts.length > 0 && (
          <div className="section">
            <h3>Attachments from customer ({inboundAtts.length})</h3>
            <div className="inbound-atts">
              {inboundAtts.map((a) =>
                a.url ? (
                  <a
                    key={a.id}
                    className="att-thumb"
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    title={a.filename || "image"}
                  >
                    <img src={a.url} alt={a.filename || "attachment"} />
                  </a>
                ) : (
                  <button key={a.id} className="att-file" onClick={() => downloadAtt(a)}>
                    📎 {a.filename || "attachment"}
                    {a.size_bytes ? ` (${Math.max(1, Math.round(a.size_bytes / 1024))} KB)` : ""}
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {ticket.replies?.length > 0 && (
          <div className="section">
            <h3>Conversation</h3>
            {ticket.replies.map((r) => {
              const rv = view?.byReply.get(String(r.id));
              return (
                <div key={r.id} className={`thread-item ${r.direction}`}>
                  <div className="meta">
                    {r.direction === "outbound" ? "↗ Sent" : "↘ Received"} ·{" "}
                    {r.sent_by || r.from_email} · {fmtDate(r.sent_at)}
                  </div>
                  {rv ? (
                    <>
                      <div className="txt">{rv.newest}</div>
                      {rv.folds.map((f, i) => (
                        <QuotedBlock key={i} fold={f} all={quotesOpen} />
                      ))}
                    </>
                  ) : (
                    <div className="txt">{r.body}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* UI v2 + autoreply module: compliance composer draft (SHADOW — review only,
            never sent, never copied into the reply editor). Hides itself when the
            backend route/flag/migration is absent. */}

        <div className="section">
          <h3>Internal notes</h3>
          {ticket.notes?.length > 0 ? (
            ticket.notes.map((n) => (
              <div key={n.id} className="note-item">
                <div className="meta">
                  {n.created_by} · {fmtDate(n.created_at)}
                </div>
                {n.note}
              </div>
            ))
          ) : (
            <div className="muted">No notes yet.</div>
          )}
          {showNote && (
            <div style={{ marginTop: 8 }}>
              <textarea
                value={note}
                placeholder="Internal note (not sent to customer)…"
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="reply-row">
                <button
                  className="btn"
                  disabled={busy || !note.trim()}
                  onClick={addNote}
                >
                  Add note
                </button>
                <button className="btn" onClick={() => setShowNote(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showReply && (
        <div className="compose">
          <div className="compose-head">
            <div className="to">
              To: {ticket.from_email}
              {!showCc && (
                <button className="cc-toggle" onClick={() => setShowCc(true)}>
                  Add Cc
                </button>
              )}
            </div>
            <select
              defaultValue=""
              onChange={(e) => {
                const tpl = templates.find((t) => String(t.id) === e.target.value);
                if (tpl) applyTemplate(tpl);
                e.target.value = "";
              }}
            >
              <option value="">Insert template…</option>
              {templates.length === 0 ? (
                <option value="" disabled>No templates — create them in the Templates tab</option>
              ) : (
                templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))
              )}
            </select>
          </div>
          {showCc && (
            <div className="cc-row">
              <label>Cc:</label>
              <input
                type="text"
                value={cc}
                placeholder="comma-separated emails"
                onChange={(e) => setCc(e.target.value)}
                autoFocus
              />
            </div>
          )}

          <RichTextEditor ref={editorRef} onInput={updateEmpty} />

          {attachments.length > 0 && (
            <div className="attach-row">
              {attachments.map((a, i) => (
                <div className="attach-chip" key={i}>
                  {a.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="attach-thumb" src={a.preview} alt={a.filename} />
                  ) : (
                    <span className="attach-thumb file">
                      <FileText size={16} />
                    </span>
                  )}
                  <span className="attach-name" title={a.filename}>
                    {a.filename}
                  </span>
                  <button
                    className="attach-x"
                    title="Remove"
                    onClick={() => removeAttachment(i)}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => onFiles(e.target.files)}
          />

          <div className="reply-row">
            <button
              className="btn primary"
              disabled={busy || (replyEmpty && attachments.length === 0)}
              onClick={sendReply}
            >
              <Send size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />
              Send
            </button>
            <button
              className="btn"
              onClick={() => fileRef.current?.click()}
              title="Attach files or images"
            >
              <Paperclip size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />
              Attach
            </button>
            <button className="btn" onClick={() => setShowReply(false)}>
              Discard
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// Native <details> fold for one quoted-history segment. Each block keeps its
// own open state (click the summary); the `b` shortcut flips all of them via
// the shared `all` token from the pane.
function QuotedBlock({ fold, all }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(all.value);
  }, [all]);
  return (
    <details
      className="quote-fold"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>{foldSummary(fold)}</summary>
      <div className="quote-text">{fold.text}</div>
    </details>
  );
}
