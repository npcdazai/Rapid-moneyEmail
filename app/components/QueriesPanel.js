"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Loader2, RefreshCw, MessageSquare, Mail, Reply, Eye, CheckCircle2, Circle, X } from "lucide-react";
import { api } from "../../lib/api";
import { fmtDate } from "../../lib/format";

// Customer Queries — every email query from a customer in the master, with the
// response we sent. Click "View" to see the full query + responses.
export default function QueriesPanel({ flash }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [responded, setResponded] = useState(""); // "" | "true" | "false"
  const [detail, setDetail] = useState(null); // full ticket (with replies) | null
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.customers.queries({
        search: debounced.trim() || undefined,
        responded: responded || undefined,
        limit: 200,
      });
      setItems(res.items || []);
      setTotal(res.total || 0);
    } catch (e) {
      flash?.(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [debounced, responded, flash]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  const openQuery = async (row) => {
    setDetail({ __loading: true, subject: row.subject });
    setDetailLoading(true);
    try {
      setDetail(await api.get(row.id));
    } catch (e) {
      flash?.(`Error: ${e.message}`);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const outbound = (detail?.replies || []).filter((r) => r.direction === "outbound");

  return (
    <section className="customers-panel">
      <div className="cust-toolbar">
        <div className="cust-title">
          <MessageSquare size={18} /> Customer Queries
          <span className="cust-count">{total}</span>
        </div>

        <div className="cust-search">
          <Search size={15} style={{ opacity: 0.7 }} />
          <input
            placeholder="Search subject, email, query, customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="cust-filter"
          value={responded}
          onChange={(e) => setResponded(e.target.value)}
          title="Filter by response status"
        >
          <option value="">All queries</option>
          <option value="true">Responded</option>
          <option value="false">Awaiting response</option>
        </select>

        {(responded || search) && (
          <button className="btn" onClick={() => { setResponded(""); setSearch(""); }} title="Clear filters">
            <X size={15} /> Clear
          </button>
        )}

        <button className="btn" onClick={load} title="Refresh" disabled={loading}>
          <RefreshCw size={15} className={loading ? "spin" : ""} />
        </button>
      </div>

      <div className="cust-table-wrap">
        {loading ? (
          <div className="cust-empty"><Loader2 size={24} className="spin" /></div>
        ) : items.length === 0 ? (
          <div className="cust-empty">
            <MessageSquare size={34} />
            <p>No customer queries{debounced || responded ? " match your filters" : " yet"}. Queries appear here once mail is matched to a customer in the master.</p>
          </div>
        ) : (
          <table className="cust-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Email</th>
                <th>Subject</th>
                <th>Query</th>
                <th>Status</th>
                <th>Response</th>
                <th>Received</th>
                <th className="cust-actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((q) => (
                <tr key={q.id}>
                  <td>{q.customer_name || q.lan || "—"}</td>
                  <td>{q.from_email}</td>
                  <td>{q.subject || "(no subject)"}</td>
                  <td className="q-summary">{q.query_summary || "—"}</td>
                  <td><span className="chip status">{q.status}</span></td>
                  <td>
                    {q.responded ? (
                      <span className="q-resp yes"><CheckCircle2 size={14} /> Responded</span>
                    ) : (
                      <span className="q-resp no"><Circle size={14} /> Awaiting</span>
                    )}
                  </td>
                  <td>{fmtDate(q.received_at)}</td>
                  <td className="cust-actions-col">
                    <button className="cust-act" onClick={() => openQuery(q)} title="View query & response">
                      <Eye size={15} /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detail && (
        <>
          <div className="modal-backdrop" onClick={() => setDetail(null)} />
          <div className="cust-modal">
            <div className="cust-modal-head">
              <div>
                <div className="cust-modal-name">{detail.subject || "(no subject)"}</div>
                <div className="cust-modal-sub">
                  {[detail.from_name, detail.from_email].filter(Boolean).join(" · ")}
                  {detail.received_at ? ` · ${fmtDate(detail.received_at)}` : ""}
                </div>
              </div>
              <button className="cm-close" onClick={() => setDetail(null)} title="Close">
                <X size={18} />
              </button>
            </div>

            <div className="cust-modal-body">
              {detailLoading || detail.__loading ? (
                <div className="cust-empty"><Loader2 size={22} className="spin" /></div>
              ) : (
                <div className="cust-tk">
                  <div className="tk-block">
                    <div className="lbl"><Mail size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} /> Customer query</div>
                    <div className="tk-msg">{detail.query_summary || detail.body || "(empty)"}</div>
                  </div>
                  {outbound.length ? (
                    <div className="tk-block">
                      <div className="lbl"><Reply size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} /> Response sent ({outbound.length})</div>
                      {outbound.map((r, i) => (
                        <div key={i}>
                          <div className="tk-meta">{r.sent_by || "—"} · {fmtDate(r.sent_at)}</div>
                          <div className="tk-msg out">{r.body}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="tk-block">
                      <div className="lbl"><Reply size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} /> Response sent</div>
                      <div className="muted" style={{ fontSize: 13 }}>No response has been sent yet.</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
