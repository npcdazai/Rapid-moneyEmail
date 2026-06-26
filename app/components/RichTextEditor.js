"use client";

import { forwardRef } from "react";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Link2,
} from "lucide-react";

// Lightweight rich-text editor: a contentEditable surface + a formatting
// toolbar driven by document.execCommand (no external dependency).
// Parent reads `.innerHTML` / `.innerText` from the forwarded ref on send,
// and may set `.innerHTML` to insert a template.
const RichTextEditor = forwardRef(function RichTextEditor(
  { onInput, placeholder = "Type your reply…" },
  ref
) {
  const exec = (cmd, val = null) => {
    document.execCommand(cmd, false, val);
    ref?.current?.focus();
    onInput?.();
  };

  const addLink = () => {
    const url = window.prompt("Link URL:", "https://");
    if (url) exec("createLink", url);
  };

  // keep selection when clicking toolbar buttons
  const hold = (e) => e.preventDefault();

  const Btn = ({ cmd, val, title, children, onClick }) => (
    <button
      type="button"
      className="rte-btn"
      title={title}
      onMouseDown={hold}
      onClick={onClick || (() => exec(cmd, val))}
    >
      {children}
    </button>
  );

  return (
    <div className="rte">
      <div className="rte-toolbar">
        <Btn cmd="bold" title="Bold"><Bold size={15} /></Btn>
        <Btn cmd="italic" title="Italic"><Italic size={15} /></Btn>
        <Btn cmd="underline" title="Underline"><Underline size={15} /></Btn>
        <span className="rte-sep" />
        <Btn cmd="insertUnorderedList" title="Bulleted list"><List size={15} /></Btn>
        <Btn cmd="insertOrderedList" title="Numbered list"><ListOrdered size={15} /></Btn>
        <span className="rte-sep" />
        <Btn title="Insert link" onClick={addLink}><Link2 size={15} /></Btn>
      </div>
      <div
        ref={ref}
        className="rte-area"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={() => onInput?.()}
      />
    </div>
  );
});

export default RichTextEditor;
