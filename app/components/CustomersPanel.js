"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Upload, Download, Loader2, Users, RefreshCw } from "lucide-react";
import { api } from "../../lib/api";
import { fmtDate } from "../../lib/format";

// Customer master workspace — import the sheet (#6), browse/search customers,
// and export the 13-column QRC workbook (#7).
export default function CustomersPanel({ flash, canImport = false, canExport = false }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [busy, setBusy] = useState(false);
  const [exportRange, setExportRange] = useState({ from: "", to: "" });
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.customers.list({
        search: debounced.trim() || undefined,
        limit: 200,
      });
      setItems(res.items || []);
      setTotal(res.total || 0);
    } catch (e) {
      flash?.(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [debounced, flash]);

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
      const data_base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await api.customers.import(data_base64);
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
