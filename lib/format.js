export function fmtDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Ticket taxonomy — must mirror backend services/classifier.js codes.
export const CATEGORIES = {
  complaint:   { label: "Customer complaints",     short: "Complaint",   color: "#d13438", bg: "#fdeeee", group: "C" },
  inquiry:     { label: "Product inquiries",        short: "Inquiry",     color: "#5d9e16", bg: "#eef7e0", group: "Q" },
  pricing:     { label: "Pricing requests",         short: "Pricing",     color: "#b8860b", bg: "#fdf3d6", group: "Q" },
  support:     { label: "Support tickets",          short: "Support",     color: "#0f9d8f", bg: "#e0f5f2", group: "R" },
  order:       { label: "Order status questions",   short: "Order",       color: "#2563c9", bg: "#e7eefb", group: "Q" },
  partnership: { label: "Partnership requests",     short: "Partnership", color: "#8b5cf6", bg: "#f0eafd", group: "R" },
  spam:        { label: "Spam/unimportant emails",  short: "Spam",        color: "#8b9582", bg: "#f0f1ee", group: null },
};

// QRC framework: Queries / Requests / Complaints → member category codes.
export const GROUPS = {
  Q: { label: "Queries", color: "#5d9e16" },
  R: { label: "Requests", color: "#0f9d8f" },
  C: { label: "Complaints", color: "#d13438" },
};
export const GROUP_CODES = Object.keys(CATEGORIES).reduce((m, code) => {
  const g = CATEGORIES[code].group;
  if (g) (m[g] ||= []).push(code);
  return m;
}, {});
export const CATEGORY_CODES = Object.keys(CATEGORIES);

export function catLabel(code, short = false) {
  if (!code) return "Uncategorized";
  const c = CATEGORIES[code];
  return c ? (short ? c.short : c.label) : code;
}
export function catStyle(code) {
  const c = CATEGORIES[code];
  return c ? { background: c.bg, color: c.color } : { background: "#f0f1ee", color: "#8b9582" };
}

// Back-compat alias
export const CATEGORY_LABEL = Object.fromEntries(
  Object.entries(CATEGORIES).map(([k, v]) => [k, v.label])
);

// Outlook-style list timestamp: time today, weekday this week, else date.
export function listTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay)
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const diffDays = (now - d) / 86_400_000;
  if (diffDays < 7)
    return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic avatar colour from a string (Outlook persona colours).
const AVATAR_COLORS = [
  "#0f6cbd", "#107c10", "#a4262c", "#5c2e91", "#ca5010",
  "#038387", "#b146c2", "#486991", "#8764b8", "#c19c00",
];
export function avatarColor(seed = "") {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// SLA chip: time remaining vs. due, colour-coded. Mirrors green/amber/red logic.
export function slaChip(ticket) {
  if (ticket.status === "Resolved" || ticket.status === "Closed")
    return { cls: "green", text: "Done" };
  if (ticket.sla_breached) return { cls: "red", text: "Breached" };
  if (!ticket.sla_due_at) return { cls: "green", text: "—" };

  const ms = new Date(ticket.sla_due_at).getTime() - Date.now();
  if (ms <= 0) return { cls: "red", text: "Breached" };

  const hours = ms / 3_600_000;
  const text =
    hours >= 24
      ? `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h`
      : hours >= 1
      ? `${Math.floor(hours)}h ${Math.floor((hours % 1) * 60)}m`
      : `${Math.floor(hours * 60)}m`;

  // amber when under 25% of the P3 window (12h) remains, else green
  const cls = hours <= 6 ? "amber" : "green";
  return { cls, text: `${text} left` };
}

// Reply templates are now user-managed (created in the Templates section and
// stored in the DB). Kept as an empty export for backward compatibility.
export const TEMPLATES = [];
