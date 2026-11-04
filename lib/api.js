// All requests are same-origin; Next.js rewrites proxy /api/* to the backend.
import { getToken, clearSession, redirectToLogin } from "./auth";

const BASE = "";

// Backend `code`s that mean "this session is no longer valid" — when we see
// one we drop the stored session and bounce the user to /login.
const SESSION_DEAD = new Set(["INVALID_OR_EXPIRED_TOKEN", "ACCOUNT_INACTIVE"]);

// Fetch a binary response (e.g. an .xlsx export) as a Blob, applying the same
// auth header + session-expiry handling as req().
async function reqBlob(path, { headers: extraHeaders, ...opts } = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
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
  return res.blob();
}

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
  syncMail: () => req("/api/tickets/sync", { method: "POST" }),
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
  // Display-only quote folding: newest text + quoted-history segments for the
  // ticket body and each reply (UI v2). 404 when the backend has it disabled.
  getThread: (id) => req(`/api/tickets/${id}/thread`),
  // Sanitised HTML view of the received mail (UI v2, rendered in a sandboxed
  // iframe). `images: true` asks the server to keep remote <img src>; otherwise
  // they come back as data-mh-src with `blockedRemote` counted. 404 when the
  // backend has HTML_VIEW_ENABLED off, 503 before migration 0008, or
  // { html: null, reason: "no_html" } when nothing is stored for the ticket.
  getTicketHtml: (id, { images = false } = {}) =>
    req(`/api/tickets/${id}/html${images ? "?images=1" : ""}`),
  // Qwen shadow evaluation for a ticket (AI draft — never sent).
  aiEvaluation: (id) => req(`/api/tickets/${id}/ai`),
  // Compliance reply composer (UI v2, autoreply module, SHADOW — nothing here
  // is ever emailed). Shapes: backend docs/compliance-composer/00-design.md §4/§5.
  // GET → { draft, variants: { [block_id]: { langs, tones } }, config_status };
  // 404 when the route/flag is absent, 503 before migration 0009.
  getComplianceDraft: (id) => req(`/api/tickets/${id}/compliance-draft`),
  // body { lang?, tone?, overrides?: { [block_id]: { lang?, tone?, slots? } } } → new version
  recomposeComplianceDraft: (id, body = {}) =>
    req(`/api/tickets/${id}/compliance-draft/recompose`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // Re-run analysis + compose → new version
  analyzeComplianceDraft: (id) =>
    req(`/api/tickets/${id}/compliance-draft/analyze`, { method: "POST" }),
  // body { label: "accepted"|"rejected"|"variant_swap"|"slot_edit", notes? }
  complianceFeedback: (draftId, body) =>
    req(`/api/compliance/drafts/${draftId}/feedback`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // → { rules_version, config: { complete, missing }, blocks: { total, approved, draft } }
  complianceStatus: () => req("/api/compliance/status"),
  // Refund module (backend docs/refund-module/00-design.md §1/§7). Policy-page
  // snapshot manifest + change status + open reviews:
  // → { manifest: { fetched_at, pages: { slug: { url, sha256, last_updated } } } | null,
  //     status: { checked_at, changed: [slug], stale_blocks: [block_id] } | null,
  //     reviews: [{ id, slug, detected_at, old_sha, new_sha }] }
  // 404 while the route is absent — callers hide the item on any error.
  compliancePolicy: () => req("/api/compliance/policy"),
  // Mark a policy-change review resolved (unblocks the stale blocks). body { notes }.
  resolvePolicyReview: (id, notes) =>
    req(`/api/compliance/policy/reviews/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(notes ? { notes } : {}),
    }),
  // Inbound attachments the customer sent with the email.
  attachments: (id) => req(`/api/tickets/${id}/attachments`),
  attachmentBlob: (id, attId) => reqBlob(`/api/tickets/${id}/attachments/${attId}`),
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

  // ── User-managed reply templates ──
  templates: {
    list: () => req("/api/templates"),
    create: (payload) => req("/api/templates", { method: "POST", body: JSON.stringify(payload) }),
    update: (id, payload) => req(`/api/templates/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
    remove: (id) => req(`/api/templates/${id}`, { method: "DELETE" }),
  },

  // ── Customer master (QRC Email Automation) ──
  customers: {
    list: (params = {}) => {
      const q = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== "" && v != null)
      ).toString();
      return req(`/api/customers${q ? `?${q}` : ""}`);
    },
    get: (id) => req(`/api/customers/${id}`),
    // A customer's email correspondence — their queries + the responses sent.
    tickets: (id) => req(`/api/customers/${id}/tickets`),
    // Live IMAP check — recent mail from this customer in the support inbox.
    inbox: (id) => req(`/api/customers/${id}/inbox`),
    // Manual QRC entries (agent-typed rows in the customer modal).
    entries: (id) => req(`/api/customers/${id}/entries`),
    createEntry: (id, payload) =>
      req(`/api/customers/${id}/entries`, { method: "POST", body: JSON.stringify(payload) }),
    updateEntry: (eid, payload) =>
      req(`/api/customers/entries/${eid}`, { method: "PATCH", body: JSON.stringify(payload) }),
    deleteEntry: (eid) => req(`/api/customers/entries/${eid}`, { method: "DELETE" }),
    // Distinct lender values (with counts) for the table filter.
    lenders: () => req("/api/customers/lenders"),
    // Email queries from customers in the master (+ response status).
    queries: (params = {}) => {
      const q = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== "" && v != null)
      ).toString();
      return req(`/api/customers/queries${q ? `?${q}` : ""}`);
    },
    // Import an .xlsx/.xls/.csv customer-master sheet (small files, base64 JSON).
    import: (data_base64) =>
      req("/api/customers/import", {
        method: "POST",
        body: JSON.stringify({ data_base64 }),
      }),
    // Import by streaming the raw file bytes — no base64 inflation, no JSON
    // buffering. Preferred for large customer-master workbooks.
    importFile: (file) =>
      req("/api/customers/import", {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      }),
    // Import one chunk of already-parsed rows (client-side chunking + progress).
    importRows: (rows) =>
      req("/api/customers/import", { method: "POST", body: JSON.stringify({ rows }) }),
    // Clear the entire customer master (destructive). Ticket history is kept.
    clearAll: () =>
      req("/api/customers?confirm=true", { method: "DELETE" }),
    // Download the 13-column QRC workbook for a date window as a Blob.
    exportBlob: ({ from, to } = {}) => {
      const q = new URLSearchParams(
        Object.entries({ from, to }).filter(([, v]) => v !== "" && v != null)
      ).toString();
      return reqBlob(`/api/customers/export.xlsx${q ? `?${q}` : ""}`);
    },
  },
};
