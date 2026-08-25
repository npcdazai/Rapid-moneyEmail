"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Upload, Download, Loader2, Users, RefreshCw, Trash2, X, Eye, Copy, Inbox, Plus, Pencil, Check } from "lucide-react";
import { api } from "../../lib/api";
import { fmtDate, CATEGORIES } from "../../lib/format";
import RichTextEditor from "./RichTextEditor";

// Date-only formatter (matches the Support sheet's date columns).
const fmtDay = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";

// Category code → "Types of Mail" label (Query / Request / Complaint).
const TYPE_LABEL = { Q: "Query", R: "Request", C: "Complaint" };
const typeOfMail = (cat) => TYPE_LABEL[CATEGORIES[cat]?.group] || "—";

// Preset customer-query options shown in the entry form.
const QUERY_PRESETS = [
  "Asking for Disbursement",
  "Asking For Assessment Fee Refund",
  "Account activation request",
  "Lead ID not found",
  "Double payment refund",
  "Loan application status – PAN verification",
  "Loan application rejected – PAN verification",
  "Loan application rejected – Address submission",
  "Selfie Error",
  "Loan application status – Address submission",
];

// Strip tags to compare a stored query against the presets.
const plainText = (html) => (html || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
// Decide the dropdown value when editing an existing entry.
const seedQueryChoice = (html) => {
  const p = plainText(html);
  if (QUERY_PRESETS.includes(p)) return p;
  return html ? "__custom__" : "";
};

// Earliest outbound reply = the date we responded to the mail.
const responseDate = (t) => {
  const outs = (t.replies || [])
    .filter((r) => r.direction === "outbound" && r.sent_at)
    .map((r) => r.sent_at)
    .sort();
  return outs[0] || null;
};

// Customer master workspace — import the sheet (#6), browse/search customers,
// and export the 13-column QRC workbook (#7).
export default function CustomersPanel({ flash, canImport = false, canExport = false }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [lender, setLender] = useState("");
  const [missing, setMissing] = useState("");
  const [lenders, setLenders] = useState([]);
  const [busy, setBusy] = useState(false);
  const [exportRange, setExportRange] = useState({ from: "", to: "" });
  const [detail, setDetail] = useState(null); // { customer, tickets } | null
  const [detailLoading, setDetailLoading] = useState(false);
  const [inbox, setInbox] = useState(null); // { email, messages, error } | null
  const [inboxLoading, setInboxLoading] = useState(false);
  const [entries, setEntries] = useState([]); // manual QRC entries
  const [form, setForm] = useState(null); // add/edit form | null
  const [formKey, setFormKey] = useState(0); // remounts the rich-text editors
  const [savingEntry, setSavingEntry] = useState(false);
  const fileRef = useRef(null);
  const queryRef = useRef(null);
  const respRef = useRef(null);

  // Open the add/edit form (seeded from an existing entry, or blank for a new one).
  const openForm = (seed) => {
    setForm(
      seed || { id: null, complain_date: "", type_of_mail: "Complaint", response_date: "", customer_query: "", responded_to_customer: "", query_choice: "" }
    );
    setFormKey((k) => k + 1);
  };

  // Populate the rich-text editors after the form (re)mounts.
  useEffect(() => {
    if (!form) return;
    if (queryRef.current) queryRef.current.innerHTML = form.customer_query || "";
    if (respRef.current) respRef.current.innerHTML = form.responded_to_customer || "";
  }, [formKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeDetail = () => {
    setDetail(null);
    setInbox(null);
    setEntries([]);
    setForm(null);
  };

  const saveEntry = async () => {
    if (!form) return;
    const htmlOrNull = (el) => {
      const h = (el?.innerHTML || "").trim();
      return h && h !== "<br>" ? h : null;
    };
    // Customer query: a preset value, or custom rich text.
    let customer_query = null;
    if (form.query_choice === "__custom__") customer_query = htmlOrNull(queryRef.current);
    else if (form.query_choice) customer_query = form.query_choice;
    const payload = {
      complain_date: form.complain_date || null,
      type_of_mail: form.type_of_mail || null,
      customer_query,
      response_date: form.response_date || null,
      responded_to_customer: htmlOrNull(respRef.current),
    };
    setSavingEntry(true);
    try {
      if (form.id) {
        const upd = await api.customers.updateEntry(form.id, payload);
        setEntries((list) => list.map((x) => (x.id === form.id ? upd : x)));
      } else {
        const created = await api.customers.createEntry(detail.customer.id, payload);
        setEntries((list) => [created, ...list]);
      }
      setForm(null);
      flash?.("Entry saved");
    } catch (e) {
      flash?.(`Error: ${e.message}`);
    } finally {
      setSavingEntry(false);
    }
  };

  const removeEntry = async (eid) => {
    try {
      await api.customers.deleteEntry(eid);
      setEntries((list) => list.filter((x) => x.id !== eid));
      flash?.("Entry deleted");
    } catch (e) {
      flash?.(`Error: ${e.message}`);
    }
  };

  // Copy a customer's whole row to the clipboard as labeled lines.
  const copyRow = async (c, e) => {
    e?.stopPropagation();
    const text = [
      ["Customer ID (LAN)", c.lan],
      ["Name", c.name],
      ["Contact No", c.phone],
      ["Email", c.email],
      ["Application Id", c.application_id],
      ["Loan Id", c.loan_id],
      ["Lender", c.lenders_name],
    ]
      .map(([k, v]) => `${k}: ${v ?? ""}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      flash?.("Row copied to clipboard");
    } catch {
      flash?.("Copy failed — clipboard not available");
    }
  };

  const openCustomer = async (c) => {
    setDetail({ customer: c, tickets: null });
    setDetailLoading(true);
    setEntries([]);
    setForm(null);
    // Live inbox check runs in parallel (independent of the logged tickets).
    setInbox(null);
    setInboxLoading(true);
    api.customers
      .inbox(c.id)
      .then((r) => setInbox(r))
      .catch((e) => setInbox({ messages: [], error: e.message }))
      .finally(() => setInboxLoading(false));
    try {
      const [t, e] = await Promise.all([api.customers.tickets(c.id), api.customers.entries(c.id)]);
      setDetail(t);
      setEntries(e.items || []);
    } catch (e) {
      flash?.(`Error: ${e.message}`);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.customers.list({
        search: debounced.trim() || undefined,
        lender: lender || undefined,
        missing: missing || undefined,
        limit: 200,
      });
      setItems(res.items || []);
      setTotal(res.total || 0);
    } catch (e) {
      flash?.(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [debounced, lender, missing, flash]);

  // Load the distinct lender list once for the filter dropdown.
  useEffect(() => {
    api.customers.lenders().then((r) => setLenders(r.lenders || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  const onFile = async (fileList) => {
    const file = (fileList || [])[0];
    if (!file) return;
    setBusy(true);
    try {
      // Stream the raw file to the backend (no base64 — handles large sheets).
      const res = await api.customers.importFile(file);
      flash?.(
        `Imported "${file.name}": ${res.inserted} new, ${res.updated} updated${
          res.skipped ? `, ${res.skipped} skipped` : ""
        }`
      );
      await load();
    } catch (e) {
      flash?.(`Import failed: ${e.message}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const doClear = async () => {
    // Two-step confirm — this permanently wipes the whole customer master.
    if (
      !window.confirm(
        `This permanently deletes ALL ${total} customer records from the master. ` +
          `Ticket history is kept, but every ticket's customer link is cleared. Continue?`
      )
    )
      return;
    if (
      window.prompt('Type DELETE to confirm clearing all customer data:')?.trim().toUpperCase() !==
      "DELETE"
    ) {
      flash?.("Clear cancelled");
      return;
    }
    setBusy(true);
    try {
      const res = await api.customers.clearAll();
      flash?.(`Cleared ${res.deleted} customer records`);
      await load();
    } catch (e) {
      flash?.(`Clear failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const doExport = async () => {
    setBusy(true);
    try {
      const blob = await api.customers.exportBlob(exportRange);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `QRC_Export_${stamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      flash?.("QRC export downloaded");
    } catch (e) {
      flash?.(`Export failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="customers-panel">
      <div className="cust-toolbar">
        <div className="cust-title">
          <Users size={18} /> Customer Master
          <span className="cust-count">{total}</span>
        </div>

        <div className="cust-search">
          <Search size={15} style={{ opacity: 0.7 }} />
          <input
            placeholder="Search LAN, name, phone, email, application / loan id…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="cust-filter"
          value={lender}
          onChange={(e) => setLender(e.target.value)}
          title="Filter by lender"
        >
          <option value="">All lenders</option>
          {lenders.map((l) => (
            <option key={l.lender} value={l.lender}>
              {l.lender} ({l.count})
            </option>
          ))}
        </select>

        <select
          className="cust-filter"
          value={missing}
          onChange={(e) => setMissing(e.target.value)}
          title="Show only rows missing a field"
        >
          <option value="">Any data</option>
          <option value="email">Missing email</option>
          <option value="phone">Missing phone</option>
          <option value="application_id">Missing application id</option>
          <option value="loan_id">Missing loan id</option>
        </select>

        {(lender || missing || search) && (
          <button
            className="btn"
            onClick={() => {
              setLender("");
              setMissing("");
              setSearch("");
            }}
            title="Clear all filters"
          >
            <X size={15} /> Clear
          </button>
        )}

        <button className="btn" onClick={load} title="Refresh" disabled={loading}>
          <RefreshCw size={15} className={loading ? "spin" : ""} />
        </button>

        {canImport && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              hidden
              onChange={(e) => onFile(e.target.files)}
            />
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              title="Import a customer-master Excel/CSV sheet"
            >
              {busy ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} Import sheet
            </button>
          </>
        )}

        {/* Clear data — available to everyone on the Customers panel */}
        <button
          className="btn danger"
          disabled={busy || total === 0}
          onClick={doClear}
          title="Permanently delete all customer records"
        >
          <Trash2 size={15} /> Clear data
        </button>

        {canExport && (
          <div className="cust-export">
            <input
              type="date"
              value={exportRange.from}
              max={exportRange.to || undefined}
              onChange={(e) => setExportRange((r) => ({ ...r, from: e.target.value }))}
              title="From (optional)"
            />
            <input
              type="date"
              value={exportRange.to}
              min={exportRange.from || undefined}
              onChange={(e) => setExportRange((r) => ({ ...r, to: e.target.value }))}
              title="To (optional)"
            />
            <button className="btn" disabled={busy} onClick={doExport} title="Export the 13-column QRC workbook">
              <Download size={15} /> Export QRC
            </button>
          </div>
        )}
      </div>

      <div className="cust-table-wrap">
        {loading ? (
          <div className="cust-empty">
            <Loader2 size={24} className="spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="cust-empty">
            <Users size={34} />
            <p>
              No customers{debounced ? " match your search" : " yet"}.
              {canImport && !debounced ? " Import a sheet to get started." : ""}
            </p>
          </div>
        ) : (
          <table className="cust-table">
            <thead>
              <tr>
                <th>Customer ID (LAN)</th>
                <th>Name</th>
                <th>Contact No</th>
                <th>Email</th>
                <th>Application Id</th>
                <th>Loan Id</th>
                <th>Lender</th>
                <th>Updated</th>
                <th className="cust-actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>{c.lan || "—"}</td>
                  <td>{c.name || "—"}</td>
                  <td>{c.phone || "—"}</td>
                  <td>{c.email || "—"}</td>
                  <td>{c.application_id || "—"}</td>
                  <td>{c.loan_id || "—"}</td>
                  <td>{c.lenders_name || "—"}</td>
                  <td>{fmtDate(c.updated_at)}</td>
                  <td className="cust-actions-col">
                    <div className="cust-row-actions">
                      <button
                        className="cust-act"
                        onClick={() => openCustomer(c)}
                        title="Open emails & responses"
                      >
                        <Eye size={15} /> Open
                      </button>
                      <button
                        className="cust-act"
                        onClick={(e) => copyRow(c, e)}
                        title="Copy this customer's details"
                      >
                        <Copy size={15} /> Copy
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detail && (
        <>
          <div className="modal-backdrop" onClick={closeDetail} />
          <div className="cust-modal">
            <div className="cust-modal-head">
              <div>
                <div className="cust-modal-name">
                  {detail.customer.name || detail.customer.lan || "Customer"}
                </div>
                <div className="cust-modal-sub">
                  {[detail.customer.lan, detail.customer.phone, detail.customer.email]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <button className="cm-close" onClick={closeDetail} title="Close">
                <X size={18} />
              </button>
            </div>

            <div className="cust-modal-body">
              {/* Live inbox presence (concise status, not the mail itself) */}
              <div className="inbox-status">
                <Inbox size={13} />
                {inboxLoading
                  ? "Checking the support inbox…"
                  : !inbox || inbox.email === null
                    ? inbox?.error
                      ? `Inbox check failed: ${inbox.error}`
                      : "No email on file to check the inbox."
                    : inbox.messages.length === 0
                      ? `No mail from ${inbox.email} currently in the inbox.`
                      : `${inbox.messages.length} message(s) from ${inbox.email} currently in the inbox.`}
              </div>

              {/* Add / edit form card */}
              {form && (
                <div className="entry-form" key={formKey}>
                  <div className="entry-form-title">{form.id ? "Edit entry" : "New entry"}</div>
                  <div className="entry-form-grid">
                    <label>
                      <span>Complain Date</span>
                      <input type="date" value={form.complain_date}
                        onChange={(e) => setForm({ ...form, complain_date: e.target.value })} />
                    </label>
                    <label>
                      <span>Types of Mail</span>
                      <select value={form.type_of_mail}
                        onChange={(e) => setForm({ ...form, type_of_mail: e.target.value })}>
                        <option>Query</option>
                        <option>Request</option>
                        <option>Complaint</option>
                      </select>
                    </label>
                    <label>
                      <span>Date of Response</span>
                      <input type="date" value={form.response_date}
                        onChange={(e) => setForm({ ...form, response_date: e.target.value })} />
                    </label>
                  </div>
                  <div className="rte-field">
                    <span className="rte-label">Customer Query</span>
                    <select
                      className="query-select"
                      value={form.query_choice}
                      onChange={(e) => setForm({ ...form, query_choice: e.target.value })}
                    >
                      <option value="">Select a query…</option>
                      {QUERY_PRESETS.map((q) => (
                        <option key={q} value={q}>{q}</option>
                      ))}
                      <option value="__custom__">✏️ Custom / other…</option>
                    </select>
                    {form.query_choice === "__custom__" && (
                      <div style={{ marginTop: 8 }}>
                        <RichTextEditor ref={queryRef} placeholder="Describe the customer's query…" />
                      </div>
                    )}
                  </div>
                  <div className="rte-field">
                    <span className="rte-label">Responded to Customer</span>
                    <RichTextEditor ref={respRef} placeholder="What we replied to the customer…" />
                  </div>
                  <div className="entry-form-actions">
                    <button className="btn primary" onClick={saveEntry} disabled={savingEntry}>
                      {savingEntry ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Save entry
                    </button>
                    <button className="btn" onClick={() => setForm(null)} disabled={savingEntry}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Complaint / query log */}
              <div className="entry-head">
                <div className="lbl" style={{ margin: 0 }}>Complaint / query log</div>
                <button className="cust-act primary-act" onClick={() => openForm()} disabled={!!form}>
                  <Plus size={15} /> Add entry
                </button>
              </div>

              {detailLoading || detail.tickets === null ? (
                <div className="cust-empty">
                  <Loader2 size={22} className="spin" />
                </div>
              ) : (
                <table className="cust-table modal-tk-table">
                  <thead>
                    <tr>
                      <th>Complain Date</th>
                      <th>Types of Mail</th>
                      <th>Customer Query</th>
                      <th>Date of Response</th>
                      <th>Responded to Customer</th>
                      <th className="cust-actions-col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Manual entries (editable) */}
                    {entries.map((en) => (
                      <tr key={`e${en.id}`}>
                        <td>{fmtDay(en.complain_date)}</td>
                        <td><span className={`type-badge ${(en.type_of_mail || "").toLowerCase()}`}>{en.type_of_mail || "—"}</span></td>
                        <td className="q-html" dangerouslySetInnerHTML={{ __html: en.customer_query || "—" }} />
                        <td>{en.response_date ? fmtDay(en.response_date) : <span className="muted">Not yet</span>}</td>
                        <td className="q-html" dangerouslySetInnerHTML={{ __html: en.responded_to_customer || "—" }} />
                        <td className="cust-actions-col">
                          <div className="cust-row-actions">
                            <button className="cust-act" title="Edit"
                              onClick={() => openForm({ id: en.id, complain_date: en.complain_date || "", type_of_mail: en.type_of_mail || "Complaint", response_date: en.response_date || "", customer_query: en.customer_query || "", responded_to_customer: en.responded_to_customer || "", query_choice: seedQueryChoice(en.customer_query) })}>
                              <Pencil size={14} />
                            </button>
                            <button className="cust-act" title="Delete" onClick={() => removeEntry(en.id)}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}

                    {/* Auto-matched mail (read-only) */}
                    {detail.tickets.map((t) => {
                      const rd = responseDate(t);
                      const q = t.query_summary || t.body || "—";
                      const resp = (t.replies || []).filter((r) => r.direction === "outbound").map((r) => r.body).join("\n\n") || "—";
                      return (
                        <tr key={`t${t.id}`}>
                          <td>{fmtDay(t.received_at)}</td>
                          <td><span className={`type-badge ${typeOfMail(t.category).toLowerCase()}`}>{typeOfMail(t.category)}</span></td>
                          <td className="q-html" title={q}>{q}</td>
                          <td>{rd ? fmtDay(rd) : <span className="muted">Not yet</span>}</td>
                          <td className="q-html">{resp}</td>
                          <td className="cust-actions-col"><span className="muted" style={{ fontSize: 11 }}>from mail</span></td>
                        </tr>
                      );
                    })}

                    {!form && entries.length === 0 && detail.tickets.length === 0 && (
                      <tr>
                        <td colSpan={6} className="muted" style={{ textAlign: "center", padding: "22px" }}>
                          No entries yet — click “Add entry” to log a complaint or query.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
