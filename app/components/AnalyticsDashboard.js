"use client";

import { useEffect, useState } from "react";
import {
  Inbox,
  CheckCircle2,
  ShieldCheck,
  Timer,
  AlarmClock,
  MailOpen,
  TrendingUp,
  AlertTriangle,
  Zap,
  Send,
  Gauge,
} from "lucide-react";

const RANGES = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
  { id: "all", label: "All Time" },
];
import { api } from "../../lib/api";
import { initials, avatarColor, CATEGORIES, GROUPS } from "../../lib/format";

const CAT_COLOR = Object.fromEntries(
  Object.entries(CATEGORIES).map(([k, v]) => [k, v.color])
);
CAT_COLOR.U = "#b0b8a6"; // uncategorized
const PRIO_COLOR = { P1: "#d13438", P2: "#ca5010", P3: "#5d9e16" };

function fmtDuration(mins) {
  if (mins == null) return "—";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// ---- KPI card ----
function Kpi({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className={`kpi ${tone || ""}`}>
      <div className="kpi-ic">
        <Icon size={20} />
      </div>
      <div className="kpi-body">
        <div className="kpi-value">{value}</div>
        <div className="kpi-label">{label}</div>
        {sub && <div className="kpi-sub">{sub}</div>}
      </div>
    </div>
  );
}

// ---- Donut chart (SVG) ----
function Donut({ data }) {
  const total = data.reduce((s, d) => s + d.count, 0) || 1;
  const R = 60;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 160 160" className="donut">
        <circle cx="80" cy="80" r={R} fill="none" stroke="#eef1e7" strokeWidth="20" />
        {data.map((d, i) => {
          const frac = d.count / total;
          const len = frac * C;
          const seg = (
            <circle
              key={i}
              cx="80"
              cy="80"
              r={R}
              fill="none"
              stroke={d.color}
              strokeWidth="20"
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 80 80)"
              strokeLinecap="butt"
            />
          );
          offset += len;
          return seg;
        })}
        <text x="80" y="74" textAnchor="middle" className="donut-total">
          {total}
        </text>
        <text x="80" y="94" textAnchor="middle" className="donut-cap">
          tickets
        </text>
      </svg>
      <div className="legend">
        {data.map((d, i) => (
          <div className="legend-row" key={i}>
            <span className="dot" style={{ background: d.color }} />
            <span className="legend-label">{d.label}</span>
            <span className="legend-val">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Horizontal bars ----
function Bars({ data }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="bars">
      {data.map((d, i) => (
        <div className="bar-row" key={i}>
          <span className="bar-label">{d.label}</span>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${(d.count / max) * 100}%`, background: d.color }}
            />
          </div>
          <span className="bar-val">{d.count}</span>
        </div>
      ))}
    </div>
  );
}

// ---- Trend line/area chart (SVG) ----
function Trend({ daily }) {
  const W = 720;
  const H = 200;
  const pad = { l: 28, r: 12, t: 14, b: 22 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = Math.max(...daily.flatMap((d) => [d.received, d.resolved]), 1);
  const x = (i) => pad.l + (daily.length === 1 ? iw / 2 : (i / (daily.length - 1)) * iw);
  const y = (v) => pad.t + ih - (v / max) * ih;

  const line = (key) =>
    daily.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(d[key])}`).join(" ");
  const area = (key) =>
    `${line(key)} L ${x(daily.length - 1)} ${pad.t + ih} L ${x(0)} ${pad.t + ih} Z`;

  const ticks = [0, Math.round(max / 2), max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend" preserveAspectRatio="none">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#eef1e7" />
          <text x={4} y={y(t) + 4} className="axis">
            {t}
          </text>
        </g>
      ))}
      <defs>
        <linearGradient id="recvFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(143,212,46,.35)" />
          <stop offset="100%" stopColor="rgba(143,212,46,0)" />
        </linearGradient>
      </defs>
      <path d={area("received")} fill="url(#recvFill)" />
      <path d={line("received")} fill="none" stroke="#6cae1d" strokeWidth="2.5" />
      <path
        d={line("resolved")}
        fill="none"
        stroke="#0f9d8f"
        strokeWidth="2"
        strokeDasharray="4 4"
      />
      {daily.map((d, i) => {
        const step = Math.max(1, Math.ceil(daily.length / 8));
        return i % step === 0 ? (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="axis">
            {d.label}
          </text>
        ) : null;
      })}
    </svg>
  );
}

export default function AnalyticsDashboard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [range, setRange] = useState("today");

  // Restore / persist the selected range (sessionStorage).
  useEffect(() => {
    try {
      const r = sessionStorage.getItem("rpm.range");
      if (r && RANGES.some((x) => x.id === r)) setRange(r);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem("rpm.range", range);
    } catch {}
  }, [range]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const d = await api.analytics(range);
        if (active) setData(d);
      } catch (e) {
        if (active) setErr(e.message);
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [range]);

  const rangeLabel = RANGES.find((r) => r.id === range)?.label || "";

  if (err) return <div className="analytics"><div className="loading">Error: {err}</div></div>;
  if (!data) return <div className="analytics"><div className="loading">Loading analytics…</div></div>;

  const k = data.kpis;
  const catData = data.by_category
    .map((c) => ({ ...c, color: CAT_COLOR[c.key] || "#b0b8a6" }))
    .sort((a, b) => b.count - a.count);
  const prioData = ["P1", "P2", "P3"].map((p) => ({
    label: p,
    count: data.by_priority.find((x) => x.priority === p)?.count || 0,
    color: PRIO_COLOR[p],
  }));
  const statusData = data.by_status.map((s) => ({
    label: s.status,
    count: s.count,
    color: "#6cae1d",
  }));
  // QRC roll-up computed from the category breakdown
  const groupData = Object.entries(GROUPS).map(([g, meta]) => ({
    label: meta.label,
    color: meta.color,
    count: data.by_category
      .filter((c) => CATEGORIES[c.key]?.group === g)
      .reduce((s, c) => s + c.count, 0),
  }));

  // ── Auto-reply analysis ──
  const ar = data.auto_reply || {};
  const QRC_COLOR = { query: "#5d9e16", request: "#0f9d8f", complaint: "#d13438" };
  const titleCase = (s) =>
    (s || "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  const arGroupBars = (ar.by_group || []).map((d) => ({
    label: titleCase(d.key),
    count: d.count,
    color: QRC_COLOR[d.key] || "#6cae1d",
  }));
  const arRouteBars = (ar.by_route || []).map((d) => ({
    label: (d.key || "").split("@")[0],
    count: d.count,
    color: "#6cae1d",
  }));
  const arSubcatBars = (ar.by_subcat || []).map((d) => ({
    label: titleCase(d.key),
    count: d.count,
    color: "#0f9d8f",
  }));

  return (
    <div className="analytics">
      <div className="analytics-head">
        <div>
          <h1>Analytics</h1>
          <p className="muted">Support performance · {rangeLabel}</p>
        </div>
        <div className="range-tabs">
          {RANGES.map((r) => (
            <button
              key={r.id}
              className={range === r.id ? "on" : ""}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards — scoped to the selected window */}
      <div className="kpi-grid">
        <Kpi icon={Inbox} label="Tickets received" value={k.total} sub={rangeLabel} />
        <Kpi icon={CheckCircle2} label="Resolved" value={k.resolved} tone="green" />
        <Kpi icon={TrendingUp} label="Resolution rate" value={`${k.resolution_rate}%`} tone="green" />
        <Kpi icon={ShieldCheck} label="SLA compliance" value={`${k.sla_compliance}%`} tone={k.sla_compliance >= 90 ? "green" : "amber"} />
        <Kpi icon={Timer} label="Avg first response" value={fmtDuration(k.avg_first_response_mins)} />
        <Kpi icon={AlertTriangle} label="Complaints" value={k.complaints} tone={k.complaints > 0 ? "red" : "green"} />
        <Kpi icon={AlarmClock} label="SLA breached" value={k.breached} tone={k.breached > 0 ? "red" : "green"} />
        <Kpi icon={MailOpen} label="Unread" value={k.unread} tone="amber" />
      </div>

      {/* charts row */}
      <div className="chart-grid">
        <div className="card span2">
          <div className="card-head">
            <h3>
              Ticket volume —{" "}
              {range === "today" || range === "yesterday"
                ? "hourly"
                : range === "week"
                ? "last 7 days"
                : "last 30 days"}
            </h3>
            <div className="legend-inline">
              <span><i style={{ background: "#6cae1d" }} /> Received</span>
              <span><i style={{ background: "#0f9d8f" }} /> Resolved</span>
            </div>
          </div>
          <Trend daily={data.daily} />
        </div>

        <div className="card">
          <div className="card-head"><h3>By category</h3></div>
          <Donut data={catData} />
        </div>

        <div className="card">
          <div className="card-head"><h3>QRC framework</h3></div>
          <Bars data={groupData} />
        </div>

        <div className="card">
          <div className="card-head"><h3>By priority</h3></div>
          <Bars data={prioData} />
        </div>

        <div className="card">
          <div className="card-head"><h3>By status</h3></div>
          <Bars data={statusData} />
        </div>

        <div className="card">
          <div className="card-head"><h3>Top senders</h3></div>
          <div className="senders">
            {data.top_senders.map((s, i) => (
              <div className="sender-row" key={i}>
                <span className="avatar sm" style={{ background: avatarColor(s.from_email) }}>
                  {initials(s.from_name || s.from_email)}
                </span>
                <div className="sender-main">
                  <div className="sender-name">{s.from_name || s.from_email}</div>
                  <div className="sender-email">{s.from_email}</div>
                </div>
                <div className="sender-stat">
                  <b>{s.count}</b>
                  {s.complaints > 0 && <span className="sender-comp">{s.complaints} ⚠</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Auto-reply analysis ── */}
      <div className="ar-head">
        <h2>Auto-reply</h2>
        <p className="muted">Automated QRC replies · {rangeLabel}</p>
      </div>
      <div className="kpi-grid">
        <Kpi icon={Zap} label="Auto-replies sent" value={ar.sent ?? 0} sub={`of ${ar.received ?? 0} received`} />
        <Kpi icon={TrendingUp} label="Deflection rate" value={`${ar.deflection_rate ?? 0}%`} tone="green" />
        <Kpi icon={CheckCircle2} label="Auto-answered" value={ar.auto_answered ?? 0} sub={`${ar.auto_answer_rate ?? 0}% of replies`} tone="green" />
        <Kpi icon={Send} label="Acknowledged" value={ar.acknowledged ?? 0} sub="routed to a team" tone="blue" />
        <Kpi icon={Gauge} label="Avg confidence" value={ar.avg_confidence != null ? `${Math.round(ar.avg_confidence * 100)}%` : "—"} />
      </div>
      <div className="chart-grid">
        <div className="card">
          <div className="card-head"><h3>By QRC group</h3></div>
          {arGroupBars.length ? <Bars data={arGroupBars} /> : <div className="ar-empty">No auto-replies in this range yet.</div>}
        </div>
        <div className="card">
          <div className="card-head"><h3>Routed to team</h3></div>
          {arRouteBars.length ? <Bars data={arRouteBars} /> : <div className="ar-empty">—</div>}
        </div>
        <div className="card">
          <div className="card-head"><h3>Top sub-categories</h3></div>
          {arSubcatBars.length ? <Bars data={arSubcatBars} /> : <div className="ar-empty">—</div>}
        </div>
      </div>
    </div>
  );
}
