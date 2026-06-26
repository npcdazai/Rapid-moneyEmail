"use client";

import { useRef, useState } from "react";
import { Send, Paperclip, X, FileText, PenSquare } from "lucide-react";
import { api } from "../../lib/api";
import RichTextEditor from "./RichTextEditor";

// New-email composer (To / Cc / Subject / rich-text body / attachments).
export default function ComposeModal({ onClose, onSent, flash }) {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [empty, setEmpty] = useState(true);
  const [busy, setBusy] = useState(false);
  const editorRef = useRef(null);
  const fileRef = useRef(null);

  const updateEmpty = () => setEmpty(!editorRef.current?.innerText.trim());

  const onFiles = (fileList) => {
    Array.from(fileList || []).forEach((file) => {
      if (file.size > 10 * 1024 * 1024) {
        flash(`"${file.name}" exceeds 10 MB — skipped`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = String(reader.result).split(",")[1] || "";
        setAttachments((prev) => [
          ...prev,
          {
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            content: b64,
            preview: file.type.startsWith("image/") ? reader.result : null,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  const send = async () => {
    if (!to.trim()) return flash("Recipient (To) is required");
    setBusy(true);
    try {
      await api.compose({
        to: to.trim(),
        cc: cc.trim() || undefined,
        subject: subject.trim() || "(no subject)",
        body: editorRef.current?.innerText.trim() || "",
        html: editorRef.current?.innerHTML || "",
        attachments: attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });
      flash("Email sent");
      onSent?.();
      onClose();
    } catch (e) {
      flash(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="compose-modal" role="dialog" aria-label="Compose email">
        <div className="compose-modal-head">
          <span><PenSquare size={16} /> New message</span>
          <button className="cm-close" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="cm-field">
          <label>To</label>
          <input
            type="text"
            value={to}
            placeholder="recipient@example.com"
            onChange={(e) => setTo(e.target.value)}
            autoFocus
          />
        </div>
        <div className="cm-field">
          <label>Cc</label>
          <input
            type="text"
            value={cc}
            placeholder="comma-separated (optional)"
            onChange={(e) => setCc(e.target.value)}
          />
        </div>
        <div className="cm-field">
          <label>Subject</label>
          <input
            type="text"
            value={subject}
            placeholder="Subject"
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        <div className="cm-body">
          <RichTextEditor ref={editorRef} onInput={updateEmpty} placeholder="Write your message…" />
        </div>

        {attachments.length > 0 && (
          <div className="attach-row">
            {attachments.map((a, i) => (
              <div className="attach-chip" key={i}>
                {a.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="attach-thumb" src={a.preview} alt={a.filename} />
                ) : (
                  <span className="attach-thumb file"><FileText size={16} /></span>
                )}
                <span className="attach-name" title={a.filename}>{a.filename}</span>
                <button
                  className="attach-x"
                  title="Remove"
                  onClick={() => setAttachments((p) => p.filter((_, idx) => idx !== i))}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <input ref={fileRef} type="file" multiple hidden onChange={(e) => onFiles(e.target.files)} />

        <div className="reply-row">
          <button
            className="btn primary"
            disabled={busy || (empty && attachments.length === 0) || !to.trim()}
            onClick={send}
          >
            <Send size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            Send
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()} title="Attach files">
            <Paperclip size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            Attach
          </button>
          <button className="btn" onClick={onClose}>Discard</button>
        </div>
      </div>
    </>
  );
}
