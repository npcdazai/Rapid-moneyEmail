"use client";

import { useState } from "react";
import {
  Inbox,
  Flag,
  AlarmClock,
  Layers,
  CircleDot,
  Loader,
  Hourglass,
  CheckCircle2,
  CheckCheck,
  AlertTriangle,
  ShoppingBag,
  Tag,
  LifeBuoy,
  Package,
  Handshake,
  Ban,
  HelpCircle,
  ClipboardList,
  Zap,
  ChevronRight,
  ChevronDown,
  PenSquare,
} from "lucide-react";

// Folder definitions. Categories roll up into the QRC framework:
// Queries / Requests / Complaints (each a collapsible group with child folders).
export const FOLDERS = [
  { id: "inbox", name: "Inbox", Icon: Inbox, params: { inbox: "true" }, countKey: "inbox_total", unreadKey: "inbox_unread", group: "main" },
  { id: "flagged", name: "Flagged", Icon: Flag, params: { flagged: "true" }, countKey: "flagged_total", group: "main" },
  { id: "breached", name: "SLA Breached", Icon: AlarmClock, params: { breached: "true" }, countKey: "breached_total", group: "main" },
  { id: "all", name: "All Tickets", Icon: Layers, params: {}, countKey: "all_total", group: "main" },

  { id: "open", name: "Open", Icon: CircleDot, params: { status: "Open" }, countKey: "open_total", unreadKey: "open_unread", group: "status" },
  { id: "in_progress", name: "In Progress", Icon: Loader, params: { status: "In Progress" }, countKey: "in_progress_total", group: "status" },
  { id: "pending", name: "Pending Customer", Icon: Hourglass, params: { status: "Pending Customer" }, countKey: "pending_total", group: "status" },
  { id: "resolved", name: "Resolved", Icon: CheckCircle2, params: { status: "Resolved" }, countKey: "resolved_total", group: "status" },
  { id: "closed", name: "Closed", Icon: CheckCheck, params: { status: "Closed" }, countKey: "closed_total", group: "status" },

  // QRC group parents
  { id: "grp_Q", name: "Queries", Icon: HelpCircle, params: { group: "Q" }, countKey: "grp_Q_total", unreadKey: "grp_Q_unread", group: "qrc", code: "Q" },
  { id: "grp_R", name: "Requests", Icon: ClipboardList, params: { group: "R" }, countKey: "grp_R_total", unreadKey: "grp_R_unread", group: "qrc", code: "R" },
  { id: "grp_C", name: "Complaints", Icon: AlertTriangle, params: { group: "C" }, countKey: "grp_C_total", unreadKey: "grp_C_unread", group: "qrc", code: "C" },

  // category children (nested under their QRC group)
  { id: "inquiry", name: "Product inquiries", Icon: ShoppingBag, params: { category: "inquiry" }, countKey: "cat_inquiry", unreadKey: "cat_inquiry_unread", group: "child", parent: "Q" },
  { id: "pricing", name: "Pricing requests", Icon: Tag, params: { category: "pricing" }, countKey: "cat_pricing", unreadKey: "cat_pricing_unread", group: "child", parent: "Q" },
  { id: "order", name: "Order status questions", Icon: Package, params: { category: "order" }, countKey: "cat_order", unreadKey: "cat_order_unread", group: "child", parent: "Q" },
  { id: "support", name: "Support tickets", Icon: LifeBuoy, params: { category: "support" }, countKey: "cat_support", unreadKey: "cat_support_unread", group: "child", parent: "R" },
  { id: "partnership", name: "Partnership requests", Icon: Handshake, params: { category: "partnership" }, countKey: "cat_partnership", unreadKey: "cat_partnership_unread", group: "child", parent: "R" },
  { id: "complaint", name: "Customer complaints", Icon: AlertTriangle, params: { category: "complaint" }, countKey: "cat_complaint", unreadKey: "cat_complaint_unread", group: "child", parent: "C" },

  // Automation — emails the bot has auto-replied to
  { id: "auto_replied", name: "Auto-replied", Icon: Zap, params: { auto_replied: "true" }, countKey: "auto_replied_total", unreadKey: "auto_replied_unread", group: "automation" },

  { id: "spam", name: "Spam/unimportant", Icon: Ban, params: { category: "spam" }, countKey: "cat_spam", group: "other" },
  { id: "uncategorized", name: "Uncategorized", Icon: Inbox, params: { uncategorized: "true" }, countKey: "uncategorized_total", group: "other" },
];

const MAIN = FOLDERS.filter((f) => f.group === "main");
const STATUS = FOLDERS.filter((f) => f.group === "status");
const QRC = FOLDERS.filter((f) => f.group === "qrc");
const AUTOMATION = FOLDERS.filter((f) => f.group === "automation");
const OTHER = FOLDERS.filter((f) => f.group === "other");
const childrenOf = (code) =>
  FOLDERS.filter((f) => f.group === "child" && f.parent === code);

export default function FolderNav({ active, onSelect, counts, modules, onCompose }) {
  const [open, setOpen] = useState({ Q: true, R: true, C: true });
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  // Allocation gating: when `modules` is provided, only show sections the user
  // has been allocated. `null`/undefined → show everything (back-compat).
  const can = (key) => !modules || modules.includes(key);
  const showMain = can("mail.main");
  const showStatus = can("mail.status");
  const showQrc = can("mail.qrc");
  const showAutomation = can("mail.automation");
  const showOther = can("mail.other");

  const badge = (f) => {
    const total = counts?.[f.countKey] ?? 0;
    const unread = f.unreadKey ? counts?.[f.unreadKey] ?? 0 : 0;
    return (
      <span className={`count ${unread > 0 ? "unread" : ""}`}>
        {unread > 0 ? unread : total > 0 ? total : ""}
      </span>
    );
  };

  const folderBtn = (f, extraClass = "") => (
    <button
      key={f.id}
      className={`folder ${extraClass} ${active === f.id ? "active" : ""}`}
      onClick={() => onSelect(f)}
    >
      <span className="ic">
        <f.Icon size={17} strokeWidth={2} />
      </span>
      <span className="name">{f.name}</span>
      {badge(f)}
    </button>
  );

  return (
    <nav className="folders">
      {onCompose && (
        <button className="new-mail-btn" onClick={onCompose} title="Compose a new email">
          <PenSquare size={17} strokeWidth={2.2} />
          New mail
        </button>
      )}

      {showMain && MAIN.map((f) => folderBtn(f))}

      {showStatus && <div className="group-label">By Status</div>}
      {showStatus && STATUS.map((f) => folderBtn(f))}

      {showQrc && <div className="group-label">Categories · QRC</div>}
      {showQrc &&
        QRC.map((g) => (
          <div key={g.id}>
            <div className={`folder qrc-parent ${active === g.id ? "active" : ""}`}>
              <span
                className="chev"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(g.code);
                }}
              >
                {open[g.code] ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </span>
              <button className="qrc-label" onClick={() => onSelect(g)}>
                <span className="ic">
                  <g.Icon size={17} strokeWidth={2} />
                </span>
                <span className="name">{g.name}</span>
                {badge(g)}
              </button>
            </div>
            {open[g.code] && childrenOf(g.code).map((c) => folderBtn(c, "child"))}
          </div>
        ))}

      {showAutomation && <div className="group-label">Automation</div>}
      {showAutomation && AUTOMATION.map((f) => folderBtn(f))}

      {showOther && <div className="group-label">Other</div>}
      {showOther && OTHER.map((f) => folderBtn(f))}
    </nav>
  );
}
