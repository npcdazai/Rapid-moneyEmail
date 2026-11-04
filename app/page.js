"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, RefreshCw, X, AlertTriangle, Mail, BarChart3, Zap, LogOut, Loader2, Users, Lock, PenSquare, Contact, FileText, Keyboard } from "lucide-react";
import { api } from "../lib/api";
import { uiV2, envEnabled, setClassic } from "../lib/flags";
import { loadPanes, savePanes, resetPanes, normalizePanes, clampPane, DEFAULTS as PANE_DEFAULTS } from "../lib/panes";
import PaneSplitter from "./components/PaneSplitter";
import { shortcuts, installShortcuts, keyLabel } from "../lib/shortcuts";
import {
  DEFAULT_APPEARANCE,
  loadAppearance,
  saveAppearance,
  appearanceAttrs,
  loadTheme,
  saveTheme,
  applyTheme,
} from "../lib/appearance";
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
import CustomersPanel from "./components/CustomersPanel";
import TemplatesPanel from "./components/TemplatesPanel";
import { hasAnyMail, sectionForFolder } from "../lib/modules";
import { useLiveMail } from "../lib/live";
import { configStatusLine, policySummary } from "../lib/compliance";

const PAGE_SIZE_OPTIONS = [50, 100, 200];
const EMPTY_FILTERS = { status: "", priority: "", unread: false, from: "", to: "" };
// UI v2: keyboard-driven selection waits this long before fetching the ticket
// (arrowing through a queue must not load every row); clicks fetch at once.
const KEYBOARD_PREVIEW_DELAY_MS = 400;

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
  const [search, setSearch] = useState(""); // immediate input value
  const [debouncedSearch, setDebouncedSearch] = useState(""); // value used in queries
  const [toast, setToast] = useState(null);
  const [mode, setMode] = useState("mail"); // "mail" | "analytics"
  const [composing, setComposing] = useState(false);
  const [autoReply, setAutoReply] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const modeHydrated = useRef(false);
  const menuRef = useRef(null);

  // ── UI v2 (flag + appearance + keyboard) — resolved after mount so SSR and
  // the first client render agree; everything below is a no-op when v2 is off.
  const [v2, setV2] = useState(false);
  const [appearance, setAppearance] = useState(DEFAULT_APPEARANCE);
  const [theme, setTheme] = useState(null); // null = follow the OS
  // Resizable panes (UI v2): folder rail + list widths, persisted per browser.
  const [panes, setPanes] = useState(PANE_DEFAULTS);
  useEffect(() => {
    setPanes(loadPanes(null, { total: window.innerWidth }));
    const onWin = () => setPanes((p) => normalizePanes(p, { total: window.innerWidth }));
    window.addEventListener("resize", onWin);
    return () => window.removeEventListener("resize", onWin);
  }, []);
  const resizePane = (pane) => (w) => {
    const total = window.innerWidth;
    const v = clampPane(pane, w, { total, other: pane === "list" ? panes.folders : panes.list });
    setPanes((p) => ({ ...p, [pane]: v }));
    return v;
  };
  const commitPane = (pane) => (v) => savePanes({ ...panes, [pane]: v });
  const resetPane = (pane) => () => {
    const d = resetPanes();
    setPanes((p) => { const n = { ...p, [pane]: d[pane] }; savePanes(n); return n; });
  };
  const [cursorId, setCursorId] = useState(null); // keyboard cursor row
  const [helpOpen, setHelpOpen] = useState(false);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const previewTimer = useRef(null);
  const stateRef = useRef({}); // latest values for the shortcut handlers
  useEffect(() => {
    setV2(uiV2());
    setAppearance(loadAppearance());
    setTheme(loadTheme());
  }, []);
  useEffect(() => {
    try {
      if (v2) document.documentElement.setAttribute("data-ui", "v2");
      else document.documentElement.removeAttribute("data-ui");
    } catch {}
    applyTheme(v2 ? theme : null);
  }, [v2, theme]);
  const updateAppearance = (patch) => setAppearance((a) => saveAppearance({ ...a, ...patch }));
  const changeTheme = (t) => {
    const next = t === "dark" || t === "light" ? t : null;
    saveTheme(next);
    setTheme(next);
  };
  const toggleClassic = () => {
    const goClassic = v2; // currently v2 → switch to classic
    setClassic(goClassic);
    setV2(goClassic ? false : uiV2());
    setHelpOpen(false);
  };

  // Allocated app modules drive which tabs/controls/folders are visible.
  const modules = user?.modules || [];
  const has = (k) => modules.includes(k);
  const hasMail = hasAnyMail(modules);
  // Customer master is available to anyone who can view mail, run analytics, or
  // manage auto-reply (import is gated to autoreply, export to analytics below).
  const canCustomers = hasMail || has("analytics") || has("autoreply");
  const allowedModes = [
    ...(hasMail ? ["mail"] : []),
    ...(has("analytics") ? ["analytics"] : []),
    ...(canCustomers ? ["customers"] : []),
    ...(hasMail ? ["templates"] : []),
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

  // UI v2 + autoreply module: compliance-composer config status, fetched once
  // per page load (shown in the avatar menu when incomplete; hidden on error,
  // 404 = route/flag absent, 503 = migration missing).
  const [complianceLine, setComplianceLine] = useState("");
  const [complianceMissing, setComplianceMissing] = useState([]);
  const complianceProbed = useRef(false);
  const hasAutoreply = has("autoreply");
  useEffect(() => {
    if (!v2 || !hasAutoreply || complianceProbed.current) return;
    complianceProbed.current = true;
    api
      .complianceStatus()
      .then((s) => {
        setComplianceLine(configStatusLine(s));
        setComplianceMissing(Array.isArray(s?.config?.missing) ? s.config.missing : []);
      })
      .catch(() => {
        setComplianceLine("");
        setComplianceMissing([]);
      });
  }, [v2, hasAutoreply]);

  // Refund module: policy-page snapshot status (GET /api/compliance/policy),
  // fetched once per page load for autoreply users. Shows "Policy pages last
  // checked <date>" and, when a page changed, an amber "Policy change detected
  // (N) — review" that opens a small modal to mark reviews resolved. Hidden on
  // any error (404 while the backend route is absent).
  const [policy, setPolicy] = useState(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyNote, setPolicyNote] = useState("");
  const [policyBusy, setPolicyBusy] = useState(null); // review id being resolved
  const [policyError, setPolicyError] = useState("");
  const policyProbed = useRef(false);
  useEffect(() => {
    if (!v2 || !hasAutoreply || policyProbed.current) return;
    policyProbed.current = true;
    api
      .compliancePolicy()
      .then((p) => setPolicy(policySummary(p)))
      .catch(() => setPolicy(null));
  }, [v2, hasAutoreply]);
  const resolvePolicyReview = async (id) => {
    if (policyBusy != null) return;
    setPolicyBusy(id);
    setPolicyError("");
    try {
      await api.resolvePolicyReview(id, policyNote.trim());
      setPolicy((p) => {
        if (!p) return p;
        // Once the open reviews are resolved the item disappears; `status.changed`
        // only refreshes on the next policy check, so it is not counted again.
        const reviews = p.reviews.filter((r) => r.id !== id);
        const changeCount = reviews.length;
        return { ...p, reviews, changeCount, changeLine: changeCount ? `Policy change detected (${changeCount}) — review` : "" };
      });
      setPolicyNote("");
      flash("Policy review marked as reviewed");
    } catch (e) {
      setPolicyError(e?.message ? `Could not mark reviewed: ${e.message}` : "Could not mark reviewed");
    } finally {
      setPolicyBusy(null);
    }
  };

  // Manually fetch new mail from the inbox now, then refresh the list.
  const syncMail = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await api.syncMail();
      flash(
        r.busy
          ? "A sync is already running…"
          : r.queued
            ? `Fetching ${r.queued} new message${r.queued === 1 ? "" : "s"}…`
            : "No new mail found"
      );
      // give the worker a moment to ingest the queued mail, then refresh
      setTimeout(() => refresh(), 3500);
    } catch (e) {
      flash(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

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
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
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
  }, [folder, debouncedSearch, page, pageSize, filters, flash, user]);

  // Debounce the search box: 350ms after typing stops, commit the query value
  // (and reset to page 1). Using a committed value avoids the stale-closure bug
  // where a manual refresh() ran with an out-of-date search term.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  // Live push: the backend sends an event per new ticket. Coalesce bursts
  // (e.g. a backlog import) into one refresh, and toast only live mail.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const liveTimer = useRef(null);
  const live = useLiveMail(
    (ev) => {
      if (ev.type !== "ticket.new") return;
      if (ev.source === "live") flash(`New mail from ${ev.from_name || "a customer"}`);
      clearTimeout(liveTimer.current);
      liveTimer.current = setTimeout(() => refreshRef.current(), 800);
    },
    authChecked && hasMail
  );

  // HTTP polling (folder counts + current list). The WebSocket makes new mail
  // appear instantly; this is the safety net, so poll faster when the socket
  // is down (blocked by a proxy, reconnecting) than when it is live.
  useEffect(() => {
    const id = setInterval(refresh, live ? 60_000 : 15_000);
    return () => clearInterval(id);
  }, [refresh, live]);

  const onSearchChange = (v) => {
    setSearch(v); // the debounce effect commits this to the query + resets page
  };

  const selectFolder = (f) => {
    setFolder(f);
    setPage(0);
    setSelectedId(null);
    setCursorId(null);
    clearTimeout(previewTimer.current);
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
    clearTimeout(previewTimer.current); // a click wins over a pending keyboard preview
    setCursorId(t.id);
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

  const toggleRead = async (t) => {
    try {
      await api.setRead(t.id, !t.is_read);
      setTickets((list) =>
        list.map((x) => (x.id === t.id ? { ...x, is_read: !t.is_read } : x))
      );
      api.folders().then(setCounts).catch(() => {});
    } catch (e) {
      flash(`Error: ${e.message}`);
    }
  };

  // ── UI v2 keyboard model ──
  // The cursor (focused row) moves instantly; the ticket fetch follows after a
  // short delay so arrowing through a queue does not open every message.
  const focusRow = (id) => {
    const el = listRef.current?.querySelector?.(`[data-id="${id}"]`);
    if (el) el.focus({ preventScroll: false });
    return !!el;
  };
  const moveCursor = (delta) => {
    const { tickets: list, cursorId: cur, selectedId: sel } = stateRef.current;
    if (!list?.length) return;
    const curId = cur ?? sel;
    const idx = list.findIndex((x) => x.id === curId);
    let next;
    if (idx === -1) next = delta > 0 ? 0 : list.length - 1;
    else next = Math.min(list.length - 1, Math.max(0, idx + delta));
    const t = list[next];
    if (!t) return;
    setCursorId(t.id);
    focusRow(t.id);
    clearTimeout(previewTimer.current);
    if (t.id !== sel) previewTimer.current = setTimeout(() => selectTicket(t), KEYBOARD_PREVIEW_DELAY_MS);
  };
  const openCursor = () => {
    const { tickets: list, cursorId: cur, selectedId: sel } = stateRef.current;
    const t = list?.find((x) => x.id === (cur ?? sel));
    if (!t) return;
    selectTicket(t);
    setTimeout(() => document.getElementById("mh-reading-pane")?.focus(), 60);
  };
  const backToList = () => {
    const { cursorId: cur, selectedId: sel, tickets: list } = stateRef.current;
    const id = sel ?? cur ?? list?.[0]?.id;
    if (id == null || !focusRow(id)) listRef.current?.focus?.();
  };
  const currentTicket = () => {
    const { tickets: list, cursorId: cur, selectedId: sel } = stateRef.current;
    return list?.find((x) => x.id === (sel ?? cur)) || null;
  };
  const listHasFocus = () => !!document.activeElement?.closest?.(".list-pane");
  const paneOpen = () => !!document.getElementById("mh-reading-pane");
  stateRef.current = { tickets, cursorId, selectedId, helpOpen, mode, allowedFolders };

  // One document listener + the shell's bindings. ReadingPane adds its own
  // (r, s, b, f, u) while a message is open; later bindings win.
  useEffect(() => {
    if (!v2) return;
    const uninstall = installShortcuts(document);
    const inMail = () => stateRef.current.mode === "mail";
    const go = (id) => () => {
      const f = stateRef.current.allowedFolders?.find((x) => x.id === id);
      if (f) selectFolder(f);
    };
    const off = [
      shortcuts.bind("j", () => moveCursor(1), { description: "Next message", group: "List", when: inMail }),
      shortcuts.bind("k", () => moveCursor(-1), { description: "Previous message", group: "List", when: inMail }),
      shortcuts.bind("ArrowDown", () => moveCursor(1), { description: "Next message (list focused)", group: "List", when: () => inMail() && listHasFocus() }),
      shortcuts.bind("ArrowUp", () => moveCursor(-1), { description: "Previous message (list focused)", group: "List", when: () => inMail() && listHasFocus() }),
      shortcuts.bind("Enter", openCursor, { description: "Open message", group: "List", when: () => inMail() && listHasFocus() }),
      shortcuts.bind("o", openCursor, { description: "Open message", group: "List", when: inMail }),
      shortcuts.bind(
        "Escape",
        () => {
          if (stateRef.current.helpOpen) return setHelpOpen(false);
          if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
          backToList();
        },
        { description: "Back to the list (closes help)", group: "List", inInputs: true }
      ),
      shortcuts.bind(
        "/",
        () => {
          searchRef.current?.focus();
          searchRef.current?.select?.();
        },
        { description: "Search", group: "General", when: inMail }
      ),
      // While a message is open the pane binds f/u itself (and reloads its own state).
      shortcuts.bind("f", () => { const t = currentTicket(); if (t) toggleFlag(t); }, { description: "Flag / unflag", group: "Message", when: () => inMail() && !paneOpen() }),
      shortcuts.bind("u", () => { const t = currentTicket(); if (t) toggleRead(t); }, { description: "Mark read / unread", group: "Message", when: () => inMail() && !paneOpen() }),
      shortcuts.bind("g i", go("inbox"), { description: "Go to Inbox", group: "Go to" }),
      shortcuts.bind("g f", go("flagged"), { description: "Go to Flagged", group: "Go to" }),
      shortcuts.bind("g b", go("breached"), { description: "Go to SLA Breached", group: "Go to" }),
      shortcuts.bind("?", () => setHelpOpen((h) => !h), { description: "Keyboard shortcuts", group: "General" }),
    ];
    return () => {
      off.forEach((fn) => fn());
      uninstall();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v2]);

  // Cheat-sheet rows, grouped. Pane-only shortcuts are listed even when no
  // message is open (the placeholders above carry their descriptions).
  const shortcutGroups = (() => {
    const rows = helpOpen
      ? shortcuts.table().concat([
          { keys: "r", description: "Reply (focus the editor)", group: "Message" },
          { keys: "s", description: "Change status", group: "Message" },
          { keys: "b", description: "Show / hide quoted text", group: "Message" },
          { keys: "h", description: "Toggle Text / HTML view", group: "Message" },
          ...(hasAutoreply ? [{ keys: "c", description: "Show / hide compliance draft", group: "Message" }] : []),
        ])
      : [];
    const seen = new Set();
    const groups = new Map();
    for (const r of rows) {
      if (seen.has(r.keys)) continue;
      seen.add(r.keys);
      if (!groups.has(r.group)) groups.set(r.group, []);
      groups.get(r.group).push(r);
    }
    return Array.from(groups.entries());
  })();

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
    <div className="outlook" data-ui={v2 ? "v2" : undefined} {...(v2 ? appearanceAttrs(appearance) : {})}>
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
              ref={searchRef}
              aria-label="Search mail"
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
            {canCustomers && (
              <button className={mode === "customers" ? "on" : ""} onClick={() => setMode("customers")}>
                <Contact size={15} /> Customers
              </button>
            )}
            {hasMail && (
              <button className={mode === "templates" ? "on" : ""} onClick={() => setMode("templates")}>
                <FileText size={15} /> Templates
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
          {hasMail && (
            <button
              className="sync-btn"
              onClick={syncMail}
              disabled={syncing}
              title={
                live
                  ? "Live — new mail appears automatically. Click to force a sync now."
                  : "Sync mail — fetch newly-arrived emails from the inbox now"
              }
            >
              <span className={`live-dot ${live ? "on" : ""}`} />
              <RefreshCw size={15} className={syncing ? "spin" : ""} />
              {syncing ? "Syncing…" : "Sync Mail"}
            </button>
          )}
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
                {envEnabled() && (
                  <div className="me-menu-prefs">
                    <label className="me-menu-row">
                      <input type="checkbox" checked={!v2} onChange={toggleClassic} />
                      <span>Classic layout</span>
                    </label>
                    {v2 && (
                      <>
                        <label className="me-menu-row">
                          <span>Density</span>
                          <select
                            value={appearance.density}
                            onChange={(e) => updateAppearance({ density: e.target.value })}
                          >
                            <option value="compact">Compact</option>
                            <option value="comfortable">Comfortable</option>
                          </select>
                        </label>
                        <label className="me-menu-row">
                          <span>Preview lines</span>
                          <select
                            value={appearance.previewLines}
                            onChange={(e) => updateAppearance({ previewLines: Number(e.target.value) })}
                          >
                            <option value={1}>1</option>
                            <option value={2}>2</option>
                          </select>
                        </label>
                        <label className="me-menu-row">
                          <input
                            type="checkbox"
                            checked={appearance.senderFirst}
                            onChange={(e) => updateAppearance({ senderFirst: e.target.checked })}
                          />
                          <span>Sender above subject</span>
                        </label>
                        <label className="me-menu-row">
                          <span>Theme</span>
                          <select value={theme || "system"} onChange={(e) => changeTheme(e.target.value)}>
                            <option value="system">System</option>
                            <option value="light">Light</option>
                            <option value="dark">Dark</option>
                          </select>
                        </label>
                        <button
                          className="me-menu-item quiet"
                          onClick={() => {
                            setMenuOpen(false);
                            setHelpOpen(true);
                          }}
                        >
                          <Keyboard size={15} /> Keyboard shortcuts <kbd>?</kbd>
                        </button>
                        {hasAutoreply && complianceLine && (
                          <div
                            className="me-menu-note"
                            role="status"
                            title={complianceMissing.length ? `Missing: ${complianceMissing.join(", ")}` : undefined}
                          >
                            <AlertTriangle size={13} /> {complianceLine}
                          </div>
                        )}
                        {hasAutoreply && policy?.checkedLine && (
                          <div className="me-menu-note quiet" role="status" title={policy.checkedAt || undefined}>
                            <FileText size={13} /> {policy.checkedLine}
                          </div>
                        )}
                        {hasAutoreply && policy?.changeLine && (
                          <button
                            type="button"
                            className="me-menu-note as-button"
                            title={policy.changed.length ? `Changed: ${policy.changed.join(", ")}` : undefined}
                            onClick={() => {
                              setMenuOpen(false);
                              setPolicyError("");
                              setPolicyOpen(true);
                            }}
                          >
                            <AlertTriangle size={13} /> {policy.changeLine}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
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
      ) : mode === "customers" ? (
        <CustomersPanel
          flash={flash}
          canImport={has("autoreply")}
          canExport={has("analytics")}
        />
      ) : mode === "templates" ? (
        <TemplatesPanel flash={flash} />
      ) : (
      <div className="workspace" {...(v2 ? { "data-resizable": "1", style: { "--pane-folders": `${panes.folders}px`, "--pane-list": `${panes.list}px` } } : {})}>
        <FolderNav active={folder.id} onSelect={selectFolder} counts={counts} modules={modules} onCompose={() => setComposing(true)} />
        {v2 && <PaneSplitter pane="folders" label="Folder list" width={panes.folders} onResize={resizePane("folders")} onCommit={commitPane("folders")} onReset={resetPane("folders")} />}

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
          v2={v2}
          cursorId={v2 ? cursorId : null}
          scrollRef={v2 ? listRef : null}
          onCursor={v2 ? (t) => setCursorId(t.id) : undefined}
        />
        {v2 && <PaneSplitter pane="list" label="Mail list" width={panes.list} onResize={resizePane("list")} onCommit={commitPane("list")} onReset={resetPane("list")} />}

        {selectedId != null ? (
          <ReadingPane
            key={selectedId}
            ticketId={selectedId}
            v2={v2}
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

      {v2 && helpOpen && (
        <div className="modal-backdrop" onClick={() => setHelpOpen(false)}>
          <div
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mh-help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="help-head">
              <h2 id="mh-help-title">
                <Keyboard size={18} /> Keyboard shortcuts
              </h2>
              <button className="cm-close" aria-label="Close" onClick={() => setHelpOpen(false)} autoFocus>
                <X size={16} />
              </button>
            </div>
            <div className="help-grid">
              {shortcutGroups.map(([group, rows]) => (
                <section key={group} className="help-group">
                  <h3>{group}</h3>
                  <dl>
                    {rows.map((r) => (
                      <div key={r.keys} className="help-row">
                        <dt>
                          {r.keys.split(" ").map((k, i) => (
                            <span key={i}>
                              {i > 0 && <span className="help-then">then</span>}
                              <kbd>{keyLabel(k)}</kbd>
                            </span>
                          ))}
                        </dt>
                        <dd>{r.description}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
            <p className="help-foot">
              Shortcuts pause while you type in a field. Press <kbd>Esc</kbd> to return to the list.
              Turn this layout off under your avatar → “Classic layout”.
            </p>
          </div>
        </div>
      )}

      {v2 && policyOpen && policy && (
        <div className="modal-backdrop" onClick={() => setPolicyOpen(false)}>
          <div
            className="help-modal policy-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mh-policy-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setPolicyOpen(false);
            }}
          >
            <div className="help-head">
              <h2 id="mh-policy-title">
                <AlertTriangle size={18} /> Policy change detected
              </h2>
              <button className="cm-close" aria-label="Close" onClick={() => setPolicyOpen(false)} autoFocus>
                <X size={16} />
              </button>
            </div>
            <p className="policy-intro">
              A published policy page changed since the last snapshot. Blocks citing its clauses are stale and the
              composer refuses them until Compliance marks the change reviewed. Nothing here sends email.
            </p>
            {policy.checkedLine && <p className="policy-meta">{policy.checkedLine}</p>}
            {policy.staleBlocks.length > 0 && (
              <p className="policy-meta">Stale blocks: <code>{policy.staleBlocks.join(", ")}</code></p>
            )}
            {policy.reviews.length > 0 ? (
              <table className="policy-table">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Detected</th>
                    <th>Old → new</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {policy.reviews.map((r) => (
                    <tr key={r.id}>
                      <td><code>{r.slug || "—"}</code></td>
                      <td title={r.detected_at || undefined}>{r.detectedLabel || "—"}</td>
                      <td className="policy-sha">
                        <code>{r.old_sha || "—"}</code> → <code>{r.new_sha || "—"}</code>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn"
                          disabled={policyBusy != null}
                          onClick={() => resolvePolicyReview(r.id)}
                          title="Record that Compliance reviewed this change (PATCH); unblocks the stale blocks"
                        >
                          {policyBusy === r.id ? <Loader2 size={13} className="spin" /> : null} Mark reviewed
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : policy.changed.length > 0 ? (
              <p className="policy-meta">
                Changed pages: <code>{policy.changed.join(", ")}</code> — no open review row yet (the next policy check
                creates one).
              </p>
            ) : (
              <p className="policy-meta">All policy changes have been reviewed.</p>
            )}
            {policy.reviews.length > 0 && (
              <label className="policy-note">
                <span>Note (optional, stored with the review)</span>
                <input
                  type="text"
                  value={policyNote}
                  maxLength={500}
                  placeholder="e.g. clause 2.3 reworded; blocks re-read, no change needed"
                  onChange={(e) => setPolicyNote(e.target.value)}
                  disabled={policyBusy != null}
                />
              </label>
            )}
            {policyError && <p className="policy-error" role="alert">{policyError}</p>}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
