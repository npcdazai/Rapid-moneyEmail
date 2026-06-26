// All requests are same-origin; Next.js rewrites proxy /api/* to the backend.
import { getToken, clearSession, redirectToLogin } from "./auth";

const BASE = "";

// Backend `code`s that mean "this session is no longer valid" — when we see
// one we drop the stored session and bounce the user to /login.
const SESSION_DEAD = new Set(["INVALID_OR_EXPIRED_TOKEN", "ACCOUNT_INACTIVE"]);

async function req(path, { headers: extraHeaders, ...opts } = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    ...opts,
  });
  if (!res.ok) {
    let detail = res.statusText;
    let code = null;
    try {
      const body = await res.json();
      detail = body.detail || detail;
      code = body.code || null;
    } catch {
      /* ignore */
    }
    if (SESSION_DEAD.has(code)) {
      clearSession();
      redirectToLogin();
    }
    const err = new Error(detail);
    err.code = code;
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  // ── Auth ──
  auth: {
    login: (email, password) =>
      req("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    logout: () => req("/api/auth/logout", { method: "POST" }),
    me: () => req("/api/auth/me"),
    setPassword: (token, password) =>
      req("/api/auth/set-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      }),
    resetPassword: (token, newPassword) =>
      req("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, newPassword }),
      }),
  },

  // ── Admin: users + module allocation ──
  admin: {
    modules: () => req("/api/auth/admin/modules"),
    roles: () => req("/api/auth/role"),
    listUsers: (params = {}) => {
      const q = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== "" && v != null)
      ).toString();
      return req(`/api/auth/admin/users${q ? `?${q}` : ""}`);
    },
    getUser: (id) => req(`/api/auth/admin/users/${id}`),
    createUser: (payload) =>
      req("/api/auth/admin/create-user", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    setUserModules: (id, modules) =>
      req(`/api/auth/admin/users/${id}/modules`, {
        method: "PUT",
        body: JSON.stringify({ modules }),
      }),
    updateUser: (id, payload) =>
      req(`/api/auth/admin/users/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    forceLogout: (id) =>
      req(`/api/auth/admin/users/${id}/force-logout`, { method: "POST" }),
    resetPassword: (id) =>
      req(`/api/auth/admin/users/${id}/reset-password`, { method: "POST" }),
  },

  stats: () => req("/api/tickets/stats"),
  folders: () => req("/api/tickets/folders"),
  analytics: (range = "today") => req(`/api/tickets/analytics?range=${range}`),
  getSettings: () => req("/api/settings"),
  setAutoReply: (autoReplyEnabled) =>
    req("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ autoReplyEnabled }),
    }),
  autoReplyNow: (id) => req(`/api/tickets/${id}/autoreply`, { method: "POST" }),
  compose: (payload) =>
    req("/api/tickets/compose", {
      method: "POST",
      body: JSON.stringify({ sent_by: "Agent", ...payload }),
    }),
  list: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== "" && v != null)
    ).toString();
    return req(`/api/tickets${q ? `?${q}` : ""}`);
  },
  get: (id) => req(`/api/tickets/${id}`),
  setStatus: (id, status) =>
    req(`/api/tickets/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  setRead: (id, is_read) =>
    req(`/api/tickets/${id}/read`, {
      method: "PATCH",
      body: JSON.stringify({ is_read }),
    }),
  setFlag: (id, flagged) =>
    req(`/api/tickets/${id}/flag`, {
      method: "PATCH",
      body: JSON.stringify({ flagged }),
    }),
  setCategory: (id, payload) =>
    req(`/api/tickets/${id}/category`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  reply: (id, payload) =>
    req(`/api/tickets/${id}/reply`, {
      method: "POST",
      body: JSON.stringify({ sent_by: "Agent", ...payload }),
    }),
  addNote: (id, note, created_by = "Agent") =>
    req(`/api/tickets/${id}/notes`, {
      method: "POST",
      body: JSON.stringify({ note, is_internal: true, created_by }),
    }),
};
