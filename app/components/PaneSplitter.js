"use client";
// Drag handle between two panes (mouse, touch and keyboard). Controlled: the parent owns the width.
import { useRef } from "react";
import { LIMITS, keyResize } from "../../lib/panes";

export default function PaneSplitter({ pane, width, label, onResize, onCommit, onReset }) {
  const drag = useRef(null);
  const start = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, w: width, last: width };
    document.body.classList.add("pane-dragging");
  };
  const move = (e) => {
    if (!drag.current) return;
    const w = drag.current.w + (e.clientX - drag.current.x);
    drag.current.last = onResize(w);
  };
  const end = (e) => {
    if (!drag.current) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    onCommit(drag.current.last);
    drag.current = null;
    document.body.classList.remove("pane-dragging");
  };
  const key = (e) => {
    const next = keyResize(pane, width, e.key, e.shiftKey);
    if (next === null) return;
    e.preventDefault();
    if (e.key === "Enter" || e.key === "Escape") onReset();
    else onCommit(onResize(next));
  };
  return (
    <div
      className="pane-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={`${label} width`}
      aria-valuemin={LIMITS[pane].min}
      aria-valuemax={LIMITS[pane].max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title="Drag to resize · double-click to reset · arrow keys adjust"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={key}
    />
  );
}
