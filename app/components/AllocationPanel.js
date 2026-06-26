"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, UserPlus, RefreshCw, Copy, Check, X, LogOut, KeyRound } from "lucide-react";
import { api } from "../../lib/api";

// Admin "allocation panel": list users and assign app modules/components to each.
export default function AllocationPanel({ flash, currentUserId }) {
  const [modules, setModules] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState({}); // `${userId}:${key}` -> true

  // Create-user form
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", modules: ["mail.main"] });
  const [creating, setCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const [resetInfo, setResetInfo] = useState(null); // { email, url } after a reset
  const [resetCopied, setResetCopied] = useState(false);

  // Preserve catalogue order while grouping (Mail sections, General).
  const groups = modules.reduce((acc, m) => {
    const g = m.group || "General";
    (acc[g] ||= []).push(m);
    return acc;
  }, {});
  const groupNames = Object.keys(groups);

  const loadUsers = useCallback(
    async (q = "") => {
      try {
        const { users: list } = await api.admin.listUsers({ search: q, limit: 100 });
        setUsers(list);
      } catch (e) {
        flash?.(`Error: ${e.message}`);
      } finally {
        setLoading(false);
      }
    },
    [flash]
  );

  useEffect(() => {
    api.admin.modules().then(({ modules: m }) => setModules(m)).catch(() => {});
    loadUsers();
  }, [loadUsers]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => loadUsers(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search, loadUsers]);

  // Toggle a module for a user — optimistic, with revert on failure.
  const toggleModule = async (user, key) => {
    const has = user.modules.includes(key);
    const next = has ? user.modules.filter((k) => k !== key) : [...user.modules, key];
    const savingKey = `${user.id}:${key}`;
    setSaving((s) => ({ ...s, [savingKey]: true }));
    setUsers((list) => list.map((u) => (u.id === user.id ? { ...u, modules: next } : u)));
    try {
      await api.admin.setUserModules(user.id, next);
    } catch (e) {
      // revert
      setUsers((list) => list.map((u) => (u.id === user.id ? { ...u, modules: user.modules } : u)));
      flash?.(`Error: ${e.message}`);
    } finally {
      setSaving((s) => {
        const c = { ...s };
        delete c[savingKey];
        return c;
      });
    }
  };

  const toggleFormModule = (key) =>
    setForm((f) => ({
      ...f,
      modules: f.modules.includes(key)
        ? f.modules.filter((k) => k !== key)
        : [...f.modules, key],
    }));

  const createUser = async (e) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreatedLink(null);
    try {
      const res = await api.admin.createUser({
        email: form.email.trim(),
        name: form.name.trim() || undefined,
        modules: form.modules,
      });
      setCreatedLink(res.setPasswordUrl);
      setForm({ email: "", name: "", modules: ["mail"] });
      flash?.(`User created${res.emailSent ? " — set-password email sent" : ""}`);
      loadUsers(search.trim());
    } catch (e) {
      flash?.(`Error: ${e.message}`);
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(createdLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      flash?.("Copy failed — select and copy manually");
    }
  };

  const resetPassword = async (user) => {
    try {
      const res = await api.admin.resetPassword(user.id);
      setResetInfo({ email: user.email, url: res.resetUrl });
      setResetCopied(false);
      flash?.(`Reset link generated${res.emailSent ? " — email also sent" : ""}`);
    } catch (e) {
      flash?.(`Error: ${e.message}`);
    }
  };

  const copyReset = async () => {
    try {
      await navigator.clipboard.writeText(resetInfo.url);
      setResetCopied(true);
      setTimeout(() => setResetCopied(false), 1500);
    } catch {
      flash?.("Copy failed — select and copy manually");
    }
  };

  const forceLogout = async (user) => {
    try {
      const { sessions_cleared } = await api.admin.forceLogout(user.id);
      flash?.(`Signed out ${user.email} (${sessions_cleared} session${sessions_cleared === 1 ? "" : "s"})`);
    } catch (e) {
      flash?.(`Error: ${e.message}`);
    }
  };

  return (
    <div className="alloc">
      <div className="alloc-head">
        <div>
          <h2>User Management</h2>
          <p>Allocate app components (modules) to each user.</p>
        </div>
        <div className="alloc-actions">
          <div className="alloc-search">
            <Search size={15} />
            <input
              placeholder="Search users…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && <X size={14} style={{ cursor: "pointer" }} onClick={() => setSearch("")} />}
          </div>
          <button className="alloc-btn" onClick={() => loadUsers(search.trim())} title="Refresh">
            <RefreshCw size={15} />
          </button>
          <button className="alloc-btn primary" onClick={() => setShowCreate((s) => !s)}>
            <UserPlus size={15} /> New user
          </button>
        </div>
      </div>

      {showCreate && (
        <form className="alloc-create" onSubmit={createUser}>
          <div className="alloc-create-row">
            <input
              type="email"
              placeholder="Email *"
              required
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
            <input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          {groupNames.map((g) => (
            <div key={g} className="alloc-create-group">
              <span className="alloc-group-name">{g}</span>
              <div className="alloc-create-modules">
                {groups[g].map((m) => (
                  <label key={m.key} className={form.modules.includes(m.key) ? "on" : ""} title={m.description}>
                    <input
                      type="checkbox"
                      checked={form.modules.includes(m.key)}
                      onChange={() => toggleFormModule(m.key)}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button className="alloc-btn primary" type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create user"}
          </button>

          {createdLink && (
            <div className="alloc-link">
              <div className="alloc-link-label">
                Set-password link (share directly — no email needed):
              </div>
              <div className="alloc-link-row">
                <input readOnly value={createdLink} onFocus={(e) => e.target.select()} />
                <button type="button" className="alloc-btn" onClick={copyLink}>
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </button>
              </div>
            </div>
          )}
        </form>
      )}

      {resetInfo && (
        <div className="alloc-link" style={{ marginBottom: 14 }}>
          <div className="alloc-link-label" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>
              Reset-password link for <b>{resetInfo.email}</b> (share directly — expires in 1 hour):
            </span>
            <X size={15} style={{ cursor: "pointer" }} onClick={() => setResetInfo(null)} />
          </div>
          <div className="alloc-link-row">
            <input readOnly value={resetInfo.url} onFocus={(e) => e.target.select()} />
            <button type="button" className="alloc-btn" onClick={copyReset}>
              {resetCopied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
        </div>
      )}

      <div className="alloc-table-wrap">
        <table className="alloc-table">
          <thead>
            <tr className="alloc-group-row">
              <th rowSpan={2}>User</th>
              <th rowSpan={2}>Status</th>
              {groupNames.map((g) => (
                <th key={g} colSpan={groups[g].length} className="alloc-group-th">
                  {g}
                </th>
              ))}
              <th rowSpan={2}></th>
            </tr>
            <tr>
              {groupNames.flatMap((g) =>
                groups[g].map((m) => (
                  <th key={m.key} className="alloc-mod-th" title={m.description}>
                    {m.label}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={modules.length + 3} className="alloc-empty">
                  Loading…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={modules.length + 3} className="alloc-empty">
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="alloc-user-name">{u.name || "—"}</div>
                    <div className="alloc-user-email">{u.email}</div>
                  </td>
                  <td>
                    <span className={`alloc-status ${u.status === "Active" ? "active" : "inactive"}`}>
                      {u.status}
                    </span>
                    {!u.password_set && <span className="alloc-pending" title="Has not set a password yet">pending</span>}
                  </td>
                  {groupNames.flatMap((g) =>
                    groups[g].map((m) => {
                      const selfAdminLock = u.id === currentUserId && m.key === "admin";
                      const busy = saving[`${u.id}:${m.key}`];
                      return (
                        <td key={m.key} className="alloc-cell">
                          <input
                            type="checkbox"
                            checked={u.modules.includes(m.key)}
                            disabled={busy || selfAdminLock}
                            title={selfAdminLock ? "You can't remove your own admin access" : ""}
                            onChange={() => toggleModule(u, m.key)}
                          />
                        </td>
                      );
                    })
                  )}
                  <td>
                    <div className="alloc-row-actions">
                      <button
                        className="alloc-icon"
                        title="Reset password (generate link)"
                        onClick={() => resetPassword(u)}
                      >
                        <KeyRound size={15} />
                      </button>
                      <button className="alloc-icon" title="Force sign-out" onClick={() => forceLogout(u)}>
                        <LogOut size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
