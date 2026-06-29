"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, RefreshCw, X, AlertTriangle, Mail, BarChart3, Zap, LogOut, Loader2, Users, Lock, PenSquare } from "lucide-react";
import { api } from "../lib/api";
import {
  getToken,
  getStoredUser,
  setSession,
  clearSession,
  redirectToLogin,
  initials,
} from "../lib/auth";
import FolderNav, { FOLDERS } from "./components/FolderNav";
import MessageList from "./components/MessageList";
import ReadingPane from "./components/ReadingPane";
import ComposeModal from "./components/ComposeModal";
import AnalyticsDashboard from "./components/AnalyticsDashboard";
import AllocationPanel from "./components/AllocationPanel";
import { hasAnyMail, sectionForFolder } from "../lib/modules";

const PAGE_SIZE_OPTIONS = [50, 100, 200];
const EMPTY_FILTERS = { status: "", priority: "", unread: false, from: "", to: "" };

export default function Dashboard() {
  const [folder, setFolder] = useState(FOLDERS[0]); // Inbox
  const [counts, setCounts] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0); // 0-based
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);
  const [mode, setMode] = useState("mail"); // "mail" | "analytics"
  const [composing, setComposing] = useState(false);
  const [autoReply, setAutoReply] = useState(false);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const modeHydrated = useRef(false);
  const searchTimer = useRef(null);
  const menuRef = useRef(null);

  // Allocated app modules drive which tabs/controls/folders are visible.
  const modules = user?.modules || [];
  const has = (k) => modules.includes(k);
  const hasMail = hasAnyMail(modules);
  const allowedModes = [
    ...(hasMail ? ["mail"] : []),
    ...(has("analytics") ? ["analytics"] : []),
    ...(has("admin") ? ["admin"] : []),
  ];
  // Folders the user may open (their section is allocated).
  const allowedFolders = FOLDERS.filter((f) => modules.includes(sectionForFolder(f)));

  // Once the user is known, snap the active tab + folder to allocated ones.
  useEffect(() => {
    if (!user) return;
    if (allowedModes.length && !allowedModes.includes(mode)) setMode(allowedModes[0]);
    if (allowedFolders.length && !allowedFolders.some((f) => f.id === folder.id))
      setFolder(allowedFolders[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Auth gate: require a token, then validate it (and refresh roles) via /me.
  // The api layer redirects to /login on an expired/invalid session.
  useEffect(() => {
    if (!getToken()) {
      redirectToLogin();
      return;
    }
    setUser(getStoredUser()); // optimistic from cache
    api.auth
      .me()
      .then(({ user: u, roles, permissions }) => {
        const full = { ...u, roles, permissions };
        setUser(full);
        setSession(null, full);
      })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, []);

  // Close the avatar menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const logout = async () => {
    setMenuOpen(false);
    try {
      await api.auth.logout();
    } catch {
      /* ignore — clear locally regardless */
    }
    clearSession();
    redirectToLogin();
  };

  // load the auto-reply toggle state once
  useEffect(() => {
    api.getSettings().then((s) => setAutoReply(!!s.autoReplyEnabled)).catch(() => {});
  }, []);

  const toggleAutoReply = async () => {
    try {
      const s = await api.setAutoReply(!autoReply);
      setAutoReply(!!s.autoReplyEnabled);
      flash(`Auto-reply ${s.autoReplyEnabled ? "enabled" : "disabled"}`);
    } catch (e) {
      flash(`Error: ${e.message}`);
    }
  };

  // restore the active tab from this session after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    const saved = sessionStorage.getItem("mode");
    if (saved) setMode(saved);
    modeHydrated.current = true;
  }, []);

  // persist the active tab for this session (skip the initial restore pass)
  useEffect(() => {
    if (!modeHydrated.current) return;
    sessionStorage.setItem("mode", mode);
  }, [mode]);

  const flash = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  // Restore persisted tabs (active mode + folder) after mount.
  useEffect(() => {
    try {
      const m = sessionStorage.getItem("rpm.mode");
      if (m === "mail" || m === "analytics") setMode(m);
      const fid = sessionStorage.getItem("rpm.folder");
      const f = fid && FOLDERS.find((x) => x.id === fid);
      if (f) setFolder(f);
    } catch {
      /* sessionStorage unavailable */
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem("rpm.mode", mode);
    } catch {}
  }, [mode]);

  useEffect(() => {
    try {
      sessionStorage.setItem("rpm.folder", folder.id);
    } catch {}
  }, [folder]);

  const refresh = useCallback(async () => {
    if (!hasMail) {
      setLoading(false);
      return;
    }
    setRefreshing(true);
    try {
      const params = { ...folder.params, limit: pageSize, offset: page * pageSize };
      if (search.trim()) params.search = search.trim();
      // Additive: a user filter only applies when the folder doesn't already
      // pin that field — so folder constraints are never overridden.
      if (filters.status && !folder.params.status) params.status = filters.status;
      if (filters.priority && !folder.params.priority) params.priority = filters.priority;
      if (filters.unread && folder.params.unread == null) params.unread = "true";
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
      const [c, res] = await Promise.all([api.folders(), api.list(params)]);
      setCounts(c);
      setTickets(res.items || []);
      setTotal(res.total || 0);
    } catch (e) {
      flash(`Error: ${e.message}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, search, page, pageSize, filters, flash, user]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  // periodic refresh (folder counts + current list)
  useEffect(() => {
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  const onSearchChange = (v) => {
    setSearch(v);
    setPage(0);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => refresh(), 350);
  };

  const selectFolder = (f) => {
    setFolder(f);
    setPage(0);
    setSelectedId(null);
  };

  const updateFilter = (patch) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPage(0);
  };
  const changePageSize = (n) => {
    setPageSize(n);
    setPage(0);
  };
  const filtersActive =
    filters.status || filters.priority || filters.unread || filters.from || filters.to;

  const selectTicket = (t) => {
    setSelectedId(t.id);
    // optimistic: mark read locally so the list updates immediately
    if (!t.is_read) {
      setTickets((list) =>
        list.map((x) => (x.id === t.id ? { ...x, is_read: true } : x))
      );
      // refresh folder unread badges shortly after
      setTimeout(() => api.folders().then(setCounts).catch(() => {}), 300);
    }
  };

  const toggleFlag = async (t) => {
    try {
      await api.setFlag(t.id, !t.flagged);
      setTickets((list) =>
        list.map((x) => (x.id === t.id ? { ...x, flagged: !x.flagged } : x))
      );
      api.folders().then(setCounts).catch(() => {});
    } catch (e) {
      flash(`Error: ${e.message}`);
    }
  };

  const breachCount = counts?.breached_total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = Math.min(total, (page + 1) * pageSize);
  const subtitle = total
    ? `${rangeStart}–${rangeEnd} of ${total}`
    : "0 items";

  // Hold the UI until the session is verified (or we're bouncing to /login).
  if (!authChecked) {
    return (
      <div className="auth-loading">
        <Loader2 size={28} className="spin" />
      </div>
    );
  }

  return (
    <div className="outlook">
      <header className="ribbon">
        <div className="app-name">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo" src="/images/rapidmoney.png" alt="RapidMoney" />
          <span className="logo-suffix">Support</span>
        </div>
        {mode === "mail" ? (
          <div className="search">
            <Search size={16} style={{ opacity: 0.85, flexShrink: 0 }} />
            <input
              placeholder="Search mail (sender, subject, body)…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
            {search && (
              <X
                size={16}
                style={{ cursor: "pointer", flexShrink: 0 }}
                onClick={() => onSearchChange("")}
              />
            )}
          </div>
        ) : (
          <div style={{ flex: 1 }} />
        )}

        {allowedModes.length > 1 && (
          <div className="mode-toggle">
            {hasMail && (
              <button className={mode === "mail" ? "on" : ""} onClick={() => setMode("mail")}>
                <Mail size={15} /> Mail
              </button>
            )}
            {has("analytics") && (
              <button className={mode === "analytics" ? "on" : ""} onClick={() => setMode("analytics")}>
                <BarChart3 size={15} /> Analytics
              </button>
            )}
            {has("admin") && (
              <button className={mode === "admin" ? "on" : ""} onClick={() => setMode("admin")}>
                <Users size={15} /> Users
              </button>
            )}
          </div>
        )}

        <div className="right">
          {mode === "mail" && (
            <button className="compose-btn" onClick={() => setComposing(true)} title="Compose a new email">
              <PenSquare size={15} /> Compose
            </button>
          )}
          {has("autoreply") && (
            <button
              className={`auto-toggle ${autoReply ? "on" : ""}`}
              onClick={toggleAutoReply}
              title={
                autoReply
                  ? "Auto-reply is ON — new emails get an automatic reply. Click to disable."
                  : "Auto-reply is OFF. Click to automate replies to new emails."
              }
            >
              <Zap size={15} fill={autoReply ? "currentColor" : "none"} />
              Auto-reply {autoReply ? "On" : "Off"}
            </button>
          )}
          {mode === "mail" && (
            <button className="icon-btn" title="Refresh" onClick={refresh}>
              <RefreshCw size={17} className={refreshing ? "spin" : ""} />
            </button>
          )}
          <div className="me-wrap" ref={menuRef}>
            <button
              className="me"
              title={user?.email || "Account"}
              onClick={() => setMenuOpen((o) => !o)}
            >
              {user ? initials(user) : <Loader2 size={14} className="spin" />}
            </button>
            {menuOpen && (
              <div className="me-menu">
                <div className="me-menu-head">
                  <div className="me-menu-avatar">{user ? initials(user) : "?"}</div>
                  <div className="me-menu-id">
                    <div className="me-menu-name">
                      {user?.name || user?.email || "Signed in"}
                    </div>
                    {user?.name && user?.email && (
                      <div className="me-menu-email">{user.email}</div>
                    )}
                    {user?.roles?.length > 0 && (
                      <div className="me-menu-roles">
                        {user.roles.map((r) => r.name).join(", ")}
                      </div>
                    )}
                  </div>
                </div>
                <button className="me-menu-item" onClick={logout}>
                  <LogOut size={15} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {mode === "mail" && breachCount > 0 && (
        <div className="alert-bar">
          <span className="alert-badge">
            <AlertTriangle size={18} />
          </span>
          <div className="alert-text">
            <div className="alert-title">
              {breachCount} ticket{breachCount === 1 ? "" : "s"} breached SLA
            </div>
            <div className="alert-sub">
              These need immediate attention to stay compliant.
            </div>
          </div>
          <button
            className="alert-action"
            onClick={() =>
              selectFolder(FOLDERS.find((f) => f.id === "breached"))
            }
          >
            View breached
          </button>
        </div>
      )}

      {allowedModes.length === 0 ? (
        <section className="reading empty" style={{ flex: 1 }}>
          <div className="empty-card">
            <div className="big">
              <Lock size={38} />
            </div>
            <h2>No components allocated</h2>
            <p>
              Your account doesn&apos;t have any app components assigned yet. Ask an
              administrator to allocate Mail, Analytics or other modules to you.
            </p>
          </div>
        </section>
      ) : mode === "admin" ? (
        <AllocationPanel flash={flash} currentUserId={user?.id} />
      ) : mode === "analytics" ? (
        <AnalyticsDashboard />
      ) : (
      <div className="workspace">
        <FolderNav active={folder.id} onSelect={selectFolder} counts={counts} modules={modules} onCompose={() => setComposing(true)} />

        <MessageList
          title={search.trim() ? `Search: "${search.trim()}"` : folder.name}
          subtitle={subtitle}
          tickets={tickets}
          loading={loading}
          selectedId={selectedId}
          onSelect={selectTicket}
          onToggleFlag={toggleFlag}
          onRefresh={refresh}
          refreshing={refreshing}
          filters={filters}
          onFilterChange={updateFilter}
          onClearFilters={clearFilters}
          filtersActive={filtersActive}
          statusLocked={!!folder.params.status}
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          pageSize={pageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageSizeChange={changePageSize}
        />

        {selectedId != null ? (
          <ReadingPane
            key={selectedId}
            ticketId={selectedId}
            canAutoReply={has("autoreply")}
            onChanged={refresh}
            onPatch={(id, patch) => {
              // instant: update the list item, then refresh folder counts
              setTickets((list) =>
                list.map((x) => (x.id === id ? { ...x, ...patch } : x))
              );
              api.folders().then(setCounts).catch(() => {});
            }}
            flash={flash}
          />
        ) : (
          <section className="reading empty">
            <div className="empty-card">
              <div className="big">
                <Mail size={38} />
              </div>
              <h2>Select a message to read</h2>
              <p>
                Pick a conversation from the list to view the full thread, reply
                to the customer, and manage the ticket.
              </p>
              <div className="empty-stats">
                <div className="es">
                  <span className="n">{counts?.inbox_unread ?? 0}</span>
                  <span className="l">Unread</span>
                </div>
                <div className="es">
                  <span className="n">{counts?.open_total ?? 0}</span>
                  <span className="l">Open</span>
                </div>
                <div className="es breach">
                  <span className="n">{counts?.breached_total ?? 0}</span>
                  <span className="l">Breached</span>
                </div>
                <div className="es">
                  <span className="n">{counts?.flagged_total ?? 0}</span>
                  <span className="l">Flagged</span>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
      )}

      {composing && (
        <ComposeModal
          onClose={() => setComposing(false)}
          onSent={refresh}
          flash={flash}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
