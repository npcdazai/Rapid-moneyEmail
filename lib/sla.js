// SLA / TAT chip — render-only. Reads the backend's `sla_due_at` (and
// `tat_due_at` when present) and never recomputes a due time.
//
//   slaChip(ticket, now) → { label, tone, basis, dueAt }
//     tone: "running" (>1h left) | "amber" (<1h left) | "ruby" (overdue)
//           | "paused" (clock not running) | "none" (nothing to show)
//     basis: "sla" | "tat" | null — which due time produced the label.

const H = 3_600_000;
const M = 60_000;
const D = 24 * H;

function toMs(v) {
  if (v == null || v === "") return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/** "2h 10m", "1d 3h", "45m" — coarse, like a human would say it. */
export function fmtSpan(ms) {
  const abs = Math.max(0, Math.abs(ms));
  if (abs >= D) {
    const d = Math.floor(abs / D);
    const h = Math.floor((abs % D) / H);
    return h ? `${d}d ${h}h` : `${d}d`;
  }
  if (abs >= H) {
    const h = Math.floor(abs / H);
    const m = Math.floor((abs % H) / M);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.max(1, Math.floor(abs / M))}m`;
}

export function slaChip(ticket, now = Date.now()) {
  if (!ticket) return { label: "", tone: "none", basis: null, dueAt: null };
  const status = ticket.status || "";
  const nowMs = toMs(now) ?? Date.now();

  // Clock stops once the ticket is done — show nothing rather than a stale countdown.
  if (status === "Resolved" || status === "Closed")
    return { label: "", tone: "none", basis: null, dueAt: null };

  const sla = toMs(ticket.sla_due_at);
  const tat = toMs(ticket.tat_due_at);
  if (sla == null && tat == null) {
    if (ticket.sla_breached) return { label: "Overdue", tone: "ruby", basis: "sla", dueAt: null };
    return { label: "", tone: "none", basis: null, dueAt: null };
  }

  // The nearer deadline drives the chip; TAT is labelled so agents can tell them apart.
  let basis = "sla";
  let due = sla;
  if (tat != null && (sla == null || tat < sla)) {
    basis = "tat";
    due = tat;
  }
  const prefix = basis === "tat" ? "TAT " : "";
  const left = due - nowMs;

  if (left <= 0 || (basis === "sla" && ticket.sla_breached))
    return {
      label: `${prefix}Overdue by ${fmtSpan(left <= 0 ? -left : 0)}`.replace(/ by 0m$/, ""),
      tone: "ruby",
      basis,
      dueAt: new Date(due).toISOString(),
    };

  if (left < H)
    return { label: `${prefix}due in ${fmtSpan(left)}`, tone: "amber", basis, dueAt: new Date(due).toISOString() };

  return { label: `${prefix}due in ${fmtSpan(left)}`, tone: "running", basis, dueAt: new Date(due).toISOString() };
}
