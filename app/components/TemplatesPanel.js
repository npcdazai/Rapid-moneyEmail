"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Plus, Check, Trash2, Loader2 } from "lucide-react";
import { api } from "../../lib/api";
import RichTextEditor from "./RichTextEditor";

// Templates section — users create/edit/delete their own reply templates.
export default function TemplatesPanel({ flash }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // {id, name, subject, body} | null
  const [editKey, setEditKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.templates.list();
      setItems(r.items || []);
    } catch (e) {
      flash?.(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [flash]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setEditing({ id: null, name: "", subject: "", body: "" });
    setEditKey((k) => k + 1);
  };
  const openEdit = (t) => {
    setEditing({ id: t.id, name: t.name || "", subject: t.subject || "", body: t.body || "" });
    setEditKey((k) => k + 1);
  };

  // Populate the rich-text body after (re)mount.
  useEffect(() => {
    if (editing && bodyRef.current) bodyRef.current.innerHTML = editing.body || "";
  }, [editKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!editing.name.trim()) return flash?.("Template name is required");
    const payload = {
      name: editing.name.trim(),
      subject: editing.subject || null,
      body: bodyRef.current?.innerHTML || null,
    };
    setSaving(true);
    try {
      if (editing.id) {
        const upd = await api.templates.update(editing.id, payload);
        setItems((list) => list.map((x) => (x.id === editing.id ? upd : x)));
      } else {
        const created = await api.templates.create(payload);
        setItems((list) => [created, ...list]);
      }
      setEditing(null);
      flash?.("Template saved");
    } catch (e) {
      flash?.(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await api.templates.remove(id);
      setItems((list) => list.filter((x) => x.id !== id));
      if (editing?.id === id) setEditing(null);
      flash?.("Template deleted");
    } catch (e) {
      flash?.(`Error: ${e.message}`);
    }
  };

  return (
    <section className="customers-panel">
      <div className="cust-toolbar">
        <div className="cust-title">
          <FileText size={18} /> Reply Templates
          <span className="cust-count">{items.length}</span>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn primary" onClick={openNew}>
          <Plus size={15} /> New template
        </button>
      </div>

      <div className="tpl-layout">
        <div className="tpl-list">
          {loading ? (
            <div className="cust-empty"><Loader2 className="spin" size={22} /></div>
          ) : items.length === 0 ? (
            <div className="cust-empty">
              <FileText size={28} />
              <p>No templates yet. Click “New template”.</p>
            </div>
          ) : (
            items.map((t) => (
              <button
                key={t.id}
                className={`tpl-item ${editing?.id === t.id ? "active" : ""}`}
                onClick={() => openEdit(t)}
              >
                <div className="tpl-item-name">{t.name}</div>
                <div className="tpl-item-sub">{t.subject || "No subject"}</div>
              </button>
            ))
          )}
        </div>

        <div className="tpl-editor">
          {editing ? (
            <div key={editKey}>
              <div className="tpl-editor-title">{editing.id ? "Edit template" : "New template"}</div>
              <label className="tpl-field">
                <span>Template name</span>
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="e.g. Loan status update"
                  autoFocus
                />
              </label>
              <label className="tpl-field">
                <span>Subject (optional)</span>
                <input
                  value={editing.subject}
                  onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
                  placeholder="Email subject line"
                />
              </label>
              <div className="tpl-field">
                <span>Body</span>
                <RichTextEditor ref={bodyRef} placeholder="Write the template… use {{customer_name}} to personalize." />
              </div>
              <div className="entry-form-actions">
                <button className="btn primary" onClick={save} disabled={saving}>
                  {saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Save template
                </button>
                <button className="btn" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
                {editing.id != null && (
                  <button className="btn danger" onClick={() => remove(editing.id)} disabled={saving}>
                    <Trash2 size={15} /> Delete
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="cust-empty">
              <FileText size={30} />
              <p>Select a template to edit, or create a new one.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
