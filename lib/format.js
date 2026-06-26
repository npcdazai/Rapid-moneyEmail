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

// Manual-reply templates — one per QRC intent. Agents insert one, fill the
// remaining {{placeholders}}, and send. {{customer_name}} and the support /
// grievance contacts are auto-filled on insert (see ReadingPane.applyTemplate).
const SIGN = "Warm regards,\n{{agent_name}}\nRapidMoney Customer Support\n{{support_email}} · {{support_phone}}";
const ESC =
  "Not satisfied with the resolution? You can escalate to our Grievance Redressal Officer at {{grievance_email}}; we aim to address all grievances within {{grievance_sla}}.";

export const TEMPLATES = [
  // ── Queries ──
  {
    group: "Queries",
    label: "Q1 · Loan status",
    body: `Hi {{customer_name}},\n\nThanks for reaching out. Here's the latest on your application {{loan_id}}: {{status}}.\n\nIf it's still under review, you can typically expect an update within {{turnaround_time}}. Once approved, the amount is credited to your registered bank account, usually within a few hours of disbursal.\n\nYou can track your application anytime under "My Loans" in the app: {{app_link}}. Just reply here if you'd like us to check anything specific.\n\n${SIGN}`,
  },
  {
    group: "Queries",
    label: "Q2 · Interest rates & charges",
    body: `Hi {{customer_name}},\n\nHappy to explain how our pricing works. Your interest rate (ROI) is personalised based on your credit profile, loan amount, and tenure, and currently ranges from {{rate_min}}% to {{rate_max}}% per annum.\n\nOther charges that may apply:\n• Processing fee: {{processing_fee}}, deducted once at disbursal\n• GST on fees, as applicable\n\nThere are no hidden charges — the exact rate and fees for your loan are shown on the offer screen before you accept, and in your loan agreement. You can view them anytime under "My Loans → Loan details".\n\n${SIGN}`,
  },
  {
    group: "Queries",
    label: "Q3 · Eligibility",
    body: `Hi {{customer_name}},\n\nThanks for your interest in a RapidMoney loan. Our basic eligibility criteria are:\n• Indian citizen, aged {{min_age}}-{{max_age}} years\n• A steady source of income\n• A valid PAN and Aadhaar for KYC\n• Meeting our credit assessment at the time of applying\n\nThe quickest way to see your personalised offer is to start an application in the app — it takes a couple of minutes: {{app_link}}.\n\n${SIGN}`,
  },
  {
    group: "Queries",
    label: "Q4 · Documents required",
    body: `Hi {{customer_name}},\n\nGetting your loan ready is simple. Please keep these handy for KYC and verification:\n• PAN card\n• Aadhaar (linked to your mobile number for OTP verification)\n• A recent bank statement or salary slip as proof of income\n• A selfie for identity verification\n\nYou can upload everything under "Complete KYC" in the app — most documents are verified instantly. If anything needs a closer look, we'll let you know within {{turnaround_time}}.\n\n${SIGN}`,
  },
  {
    group: "Queries",
    label: "Q5 · Repayment information",
    body: `Hi {{customer_name}},\n\nRepaying your loan is easy and flexible. Your EMI of ₹{{emi_amount}} is due on the {{due_date}} of every month. You can pay using any of these:\n• Auto-debit (NACH) from your bank account — set it up once and never miss a date\n• UPI — pay instantly from the app\n• Net banking or debit card\n\nTo set up or change auto-debit, go to "Repayments" in the app: {{app_link}}. Paying on time helps build your credit score and can unlock higher limits.\n\n${SIGN}`,
  },
  // ── Requests ──
  {
    group: "Requests",
    label: "R1 · Statement request",
    body: `Hi {{customer_name}},\n\nAs requested, your account statement for {{loan_id}} covering {{period}} is attached to this email.\n\nYou can also download your statement and full repayment schedule anytime from "My Loans → Statements": {{app_link}}.\n\nNeed it for a different period or in a specific format? Just let us know.\n\n${SIGN}`,
  },
  {
    group: "Requests",
    label: "R2 · NOC request",
    body: `Hi {{customer_name}},\n\nCongratulations on closing your loan {{loan_id}}! Your No Objection Certificate (NOC) / closure certificate is attached for your records.\n\nThis confirms you have no outstanding dues with RapidMoney. If your closure is still being processed, your NOC will be emailed to you within {{turnaround_time}}.\n\nThank you for choosing RapidMoney.\n\n${SIGN}`,
  },
  {
    group: "Requests",
    label: "R3 · Foreclosure",
    body: `Hi {{customer_name}},\n\nThanks for reaching out about closing your loan early. Here are your foreclosure details as of {{date}}:\n• Outstanding principal: ₹{{principal}}\n• Foreclosure amount payable: ₹{{foreclosure_amount}}\n• Quote valid until {{valid_until}}\n\nYou can pay this directly under "My Loans → Close loan", or reply here and we'll guide you. Once the payment clears, your loan is closed and your NOC issued within {{turnaround_time}}.\n\n${SIGN}`,
  },
  {
    group: "Requests",
    label: "R4 · EMI reschedule",
    body: `Hi {{customer_name}},\n\nThanks for letting us know — we understand repayment timelines sometimes need to change, and we'll do our best to help.\n\nTo check the options available (such as changing your EMI date or tenure), could you confirm:\n• Your loan ID: {{loan_id}}\n• The new EMI date or change you'd like\n• A brief reason — it helps us find the best fit for you\n\nOnce we have this, we'll review and get back within {{turnaround_time}}. Any change is subject to eligibility and may affect the total interest payable.\n\n${SIGN}`,
  },
  {
    group: "Requests",
    label: "R5 · Profile update",
    body: `Hi {{customer_name}},\n\nHappy to help update your details. For your security, some changes need a quick verification:\n• Phone or email: we'll send an OTP to confirm the change\n• Address: please share a recent address proof (Aadhaar, utility bill, etc.)\n• Name correction: please share a supporting document (PAN / Aadhaar)\n\nYou can update most details yourself under "Profile → Edit details": {{app_link}}. For anything that needs a document, reply here and we'll sort it within {{turnaround_time}}.\n\n${SIGN}`,
  },
  {
    group: "Requests",
    label: "R6 · Callback request",
    body: `Hi {{customer_name}},\n\nThanks for reaching out — we'd be glad to call you. We've scheduled a callback on your registered number {{phone}} for {{callback_window}}.\n\nPrefer a different time or number? Just reply and let us know. You can also reach us at {{support_phone}}, Mon-Sat, {{support_hours}}.\n\n${SIGN}`,
  },
  // ── Complaints ──
  {
    group: "Complaints",
    label: "C1 · Payment not reflected",
    body: `Hi {{customer_name}},\n\nThank you for flagging this, and apologies for the worry it's caused. I understand a payment you made isn't yet showing against your loan {{loan_id}}.\n\nPayments usually reflect within {{reflect_tat}}; bank or UPI settlement can occasionally delay this. To help us trace it quickly, please share:\n• Amount paid (₹{{amount}}) and the date of payment\n• Payment mode (UPI / NACH / net banking) and the transaction or UTR reference\n\nWe've logged this under ticket {{ticket_id}} and will update you within {{turnaround_time}}. Once traced, your payment will be adjusted correctly and any late fee applied in error will be reversed.\n\n${SIGN}\n\n${ESC}`,
  },
  {
    group: "Complaints",
    label: "C2 · Extra / wrong charges",
    body: `Hi {{customer_name}},\n\nThank you for raising this, and I'm sorry for the concern. I understand a charge on loan {{loan_id}} doesn't look right to you.\n\nWe take this seriously and have opened ticket {{ticket_id}} to review your account in detail. We'll share a clear breakdown of all charges, and if anything has been applied incorrectly, we will refund it to your registered account. You can expect our findings within {{turnaround_time}}.\n\nIf you can, please share the charge amount and date you're referring to so we can prioritise the review.\n\n${SIGN}\n\n${ESC}`,
  },
  {
    group: "Complaints",
    label: "C3 · Agent behaviour",
    body: `Hi {{customer_name}},\n\nI'm truly sorry about your experience. The behaviour you've described is not acceptable and is not how RapidMoney expects anyone representing us to treat customers.\n\nWe've logged ticket {{ticket_id}} and will investigate, including reviewing call records where available. To help, please share the date and time of the interaction and the name or number of the person, if you have it.\n\nWe'll come back to you with the outcome within {{turnaround_time}} and take appropriate action. Thank you for giving us the chance to put this right.\n\n${SIGN}\n\n${ESC}`,
  },
  {
    group: "Complaints",
    label: "C4 · App / technical issue",
    body: `Hi {{customer_name}},\n\nSorry for the trouble — let's get this working for you. While we look into it (ticket {{ticket_id}}), here are a few steps that fix most app issues:\n• Update RapidMoney to the latest version from your app store\n• Close and reopen the app, and check your internet connection\n• For OTP issues: wait ~30 seconds, then tap "Resend OTP"\n• If it still fails, clear the app cache (Settings → Apps → RapidMoney → Storage)\n\nIf the problem continues, reply with your phone model, app version, and a screenshot of the error if possible. Our tech team will look into it and update you within {{turnaround_time}}.\n\n${SIGN}`,
  },
  {
    group: "Complaints",
    label: "C5 · Data privacy",
    body: `Hi {{customer_name}},\n\nThank you for writing in. I understand your concern about your personal data, and I want to assure you we handle your information in line with our Privacy Policy and applicable law.\n\nWe've registered ticket {{ticket_id}} to look into this. Could you confirm what you'd like us to do — for example, stop promotional messages, review access, or process a data-deletion request? We'll action it and respond within {{turnaround_time}}.\n\nYou can manage your communication preferences under "Profile → Privacy" in the app. To stop promotional messages right away, simply reply STOP.\n\n${SIGN}\n\n${ESC}`,
  },
  {
    group: "Complaints",
    label: "C6 · Mis-selling",
    body: `Hi {{customer_name}},\n\nThank you for raising this, and I'm sorry if the terms you received didn't match what you were told — that's not the experience we want for you.\n\nWe've opened ticket {{ticket_id}} to investigate, including reviewing the communication and your loan terms. To help us, please share what you were promised and how it differs from your agreement. We'll review everything and respond with our findings and next steps within {{turnaround_time}}.\n\n${SIGN}\n\n${ESC}`,
  },
];
