"use client";

import { useState } from "react";
import { RefreshCw, Flag, Zap, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  listTime,
  initials,
  avatarColor,
  slaChip,
  catLabel,
  catStyle,
} from "../../lib/format";

const STATUS_OPTIONS = ["Open", "In Progress", "Resolved", "Closed"];
const PRIORITY_OPTIONS = ["P1", "P2", "P3"];

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
  filters = {},
  onFilterChange,
  onClearFilters,
  filtersActive,
  statusLocked,
  page = 0,
  totalPages = 1,
  onPageChange,
  pageSize,
  pageSizeOptions = [50, 100, 200],
  onPageSizeChange,
}) {
  const [jump, setJump] = useState("");
  const goToJump = () => {
    const n = parseInt(jump, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= totalPages) onPageChange(n - 1);
    setJump("");
  };
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

      {onFilterChange && (
        <div className="list-filters">
          <select
            className="filter-select"
            value={filters.status || ""}
            onChange={(e) => onFilterChange({ status: e.target.value })}
            disabled={statusLocked}
            title={statusLocked ? "This folder already filters by status" : "Filter by status"}
          >
            <option value="">{statusLocked ? "Folder status" : "All statuses"}</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            className="filter-select"
            value={filters.priority || ""}
            onChange={(e) => onFilterChange({ priority: e.target.value })}
          >
            <option value="">All priorities</option>
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <label className="filter-date" title="From date (received on/after)">
            <span>From</span>
            <input
              type="date"
              value={filters.from || ""}
              max={filters.to || undefined}
              onChange={(e) => onFilterChange({ from: e.target.value })}
            />
          </label>
          <label className="filter-date" title="To date (received on/before)">
            <span>To</span>
            <input
              type="date"
              value={filters.to || ""}
              min={filters.from || undefined}
              onChange={(e) => onFilterChange({ to: e.target.value })}
            />
          </label>
          <button
            className={`filter-chip ${filters.unread ? "on" : ""}`}
            onClick={() => onFilterChange({ unread: !filters.unread })}
            title="Show only unread messages"
          >
            Unread only
          </button>
          {filtersActive && (
            <button className="filter-clear" onClick={onClearFilters} title="Clear filters">
              <X size={13} /> Clear
            </button>
          )}
        </div>
      )}

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
                className={`msg ${t.is_read ? "read" : "unread"} ${
                  selectedId === t.id ? "selected" : ""
                }`}
                onClick={() => onSelect(t)}
              >
                {!t.is_read && <span className="msg-ribbon">NEW</span>}
                <div
                  className="avatar"
                  style={{ background: avatarColor(t.from_email || name) }}
                >
                  {initials(name)}
                </div>
                <div className="msg-main">
                  <div className="msg-row1">
                    {!t.is_read && (
                      <span className="unread-dot" title="Unread" aria-label="Unread" />
                    )}
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

      {onPageChange && (
        <div className="list-pager">
          {onPageSizeChange && (
            <label className="pager-size" title="Messages per page">
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
              >
                {pageSizeOptions.map((n) => (
                  <option key={n} value={n}>{n} / page</option>
                ))}
              </select>
            </label>
          )}

          {totalPages > 1 && (
            <div className="pager-nav">
              <button
                className="pager-btn"
                disabled={page <= 0}
                onClick={() => onPageChange(page - 1)}
                title="Newer (previous page)"
              >
                <ChevronLeft size={16} /> Prev
              </button>
              <span className="pager-info">
                Page {page + 1} of {totalPages}
              </span>
              <button
                className="pager-btn"
                disabled={page >= totalPages - 1}
                onClick={() => onPageChange(page + 1)}
                title="Older (next page)"
              >
                Next <ChevronRight size={16} />
              </button>
              <span className="pager-jump">
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  placeholder="Go to"
                  value={jump}
                  onChange={(e) => setJump(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && goToJump()}
                />
                <button className="pager-btn" onClick={goToJump} disabled={!jump}>
                  Go
                </button>
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
