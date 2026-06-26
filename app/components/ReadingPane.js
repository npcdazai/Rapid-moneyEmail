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
  TEMPLATES,
} from "../../lib/format";

const STATUSES = [
  "Open",
  "In Progress",
  "Pending Customer",
  "Resolved",
  "Closed",
];

export default function ReadingPane({ ticketId, onChanged, onPatch, flash, canAutoReply = true }) {
  const [ticket, setTicket] = useState(null);
  const [note, setNote] = useState("");
  const [showReply, setShowReply] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [replyEmpty, setReplyEmpty] = useState(true);
  const [cc, setCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const editorRef = useRef(null);
  const fileRef = useRef(null);

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

  if (!ticket) {
    return (
      <section className="reading empty">
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
    const filled = tpl.body
      .replaceAll("{{customer_name}}", first)
      .replaceAll("{name}", first)
      .replaceAll("{{support_email}}", "support@rapidmoney.in")
      .replaceAll("{{grievance_email}}", "grievance@rapidmoney.in")
      .replaceAll("{{app_link}}", "https://rapidmoney.in/help")
      .replaceAll("{{ticket_id}}", ticket.reference || "{{ticket_id}}");
    const html = filled.replace(/\n/g, "<br>");
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
    <section className="reading">
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
            {(ticket.status === "Open" || ticket.status === "In Progress") && (
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
        </div>

        <div className="email-body">{ticket.body}</div>

        {ticket.replies?.length > 0 && (
          <div className="section">
            <h3>Conversation</h3>
            {ticket.replies.map((r) => (
              <div key={r.id} className={`thread-item ${r.direction}`}>
                <div className="meta">
                  {r.direction === "outbound" ? "↗ Sent" : "↘ Received"} ·{" "}
                  {r.sent_by || r.from_email} · {fmtDate(r.sent_at)}
                </div>
                <div className="txt">{r.body}</div>
              </div>
            ))}
          </div>
        )}

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
                const tpl = TEMPLATES[Number(e.target.value)];
                if (tpl) applyTemplate(tpl);
                e.target.value = "";
              }}
            >
              <option value="">Insert template…</option>
              {["Queries", "Requests", "Complaints"].map((g) => (
                <optgroup key={g} label={g}>
                  {TEMPLATES.map((t, i) =>
                    t.group === g ? (
                      <option key={i} value={i}>
                        {t.label}
                      </option>
                    ) : null
                  )}
                </optgroup>
              ))}
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
