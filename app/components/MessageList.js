"use client";

import { RefreshCw, Flag, Zap } from "lucide-react";
import {
  listTime,
  initials,
  avatarColor,
  slaChip,
  catLabel,
  catStyle,
} from "../../lib/format";

export default function MessageList({
  title,
  subtitle,
  tickets,
  loading,
  selectedId,
  onSelect,
  onToggleFlag,
  onRefresh,
  refreshing,
}) {
  return (
    <section className="list-pane">
      <div className="list-head">
        <div>
          <h2>{title}</h2>
          <div className="sub">{subtitle}</div>
        </div>
        <div className="list-tools">
          <button title="Refresh" onClick={onRefresh}>
            <RefreshCw size={16} className={refreshing ? "spin" : ""} />
          </button>
        </div>
      </div>

      <div className="list-scroll">
        {loading ? (
          <div className="loading">Loading…</div>
        ) : tickets.length === 0 ? (
          <div className="empty-list">No messages in this folder.</div>
        ) : (
          tickets.map((t) => {
            const chip = slaChip(t);
            const name = t.from_name || t.from_email || "Unknown";
            return (
              <div
                key={t.id}
                className={`msg ${t.is_read ? "" : "unread"} ${
                  selectedId === t.id ? "selected" : ""
                }`}
                onClick={() => onSelect(t)}
              >
                <div
                  className="avatar"
                  style={{ background: avatarColor(t.from_email || name) }}
                >
                  {initials(name)}
                </div>
                <div className="msg-main">
                  <div className="msg-row1">
                    <span className="msg-from">{name}</span>
                    <span className="msg-time">{listTime(t.received_at)}</span>
                  </div>
                  <div className="msg-subject">
                    #{t.id} · {t.subject || "(no subject)"}
                  </div>
                  <div className="msg-snippet">{t.snippet || ""}</div>
                  <div className="msg-tags">
                    <span className={`chip prio ${t.priority}`}>
                      {t.priority}
                    </span>
                    <span
                      className={`chip status st-${(t.status || "")
                        .toLowerCase()
                        .replace(/\s+/g, "-")}`}
                    >
                      {t.status}
                    </span>
                    <span className="chip" style={catStyle(t.category)}>
                      {catLabel(t.category, true)}
                    </span>
                    {t.auto_replied && (
                      <span className="chip auto-replied" title="An automatic reply was sent for this email">
                        <Zap size={11} fill="currentColor" /> Auto-replied
                      </span>
                    )}
                    {(t.status === "Open" || t.status === "In Progress") && (
                      <span className={`sla ${chip.cls}`}>{chip.text}</span>
                    )}
                  </div>
                </div>
                <button
                  className={`flag-btn ${t.flagged ? "on" : ""}`}
                  title={t.flagged ? "Unflag" : "Flag for follow-up"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFlag(t);
                  }}
                >
                  <Flag size={15} fill={t.flagged ? "currentColor" : "none"} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
