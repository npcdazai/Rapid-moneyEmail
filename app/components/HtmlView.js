"use client";

// Sandboxed HTML email view (UI v2 — docs/ui-v2.md "HTML view (#11/#10)").
//
// The server already sanitised the markup; here it is rendered inside
// <iframe sandbox="" referrerpolicy="no-referrer" csp=… srcdoc=…>:
//   • sandbox=""           — no scripts, no same-origin access, no forms, no
//                            popups, no top navigation. Links are therefore
//                            inert (agents copy them via the context menu).
//   • csp + <meta> inside  — default-src 'none'; img-src 'self' data:;
//                            style-src 'unsafe-inline' (from the server).
// Nothing is ever posted back from the frame (no scripts there to do it), so
// the height is a CSS clamp with an Expand toggle instead of auto-sizing.

import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import {
  buildHtmlDoc,
  normalizeHtmlPayload,
  classifyHtmlError,
  attachmentRefs,
  inlineAttachmentSources,
  blockedImagesLabel,
  inlineImagesLabel,
  isTrustedSender,
  trustSender,
  untrustSender,
} from "../../lib/htmlView";

// Session memo: once the backend answers "disabled" (404 flag off / 503
// migration missing) we stop asking for the rest of the page lifetime so the
// control disappears everywhere without a request per ticket.
let availability = null; // null = unknown, true = served once, false = disabled
export function htmlViewAvailable() {
  return availability;
}
export function resetHtmlViewAvailability() {
  availability = null;
}

const MAX_INLINE_BYTES = 4 * 1024 * 1024; // skip larger inline images (srcdoc size)

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error || new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

/**
 * Fetch + prepare the HTML for one ticket.
 * Resolves to { status: "ok", data } | { status: "none" } | { status: "disabled" } | { status: "error" }.
 * Never throws; never shows a toast (the text view is always there).
 */
export async function loadTicketHtml(ticketId, { images = false } = {}) {
  if (availability === false) return { status: "disabled" };
  let payload;
  try {
    payload = await api.getTicketHtml(ticketId, { images });
  } catch (e) {
    const kind = classifyHtmlError(e);
    if (kind === "disabled") availability = false;
    return { status: kind };
  }
  availability = true;
  const data = normalizeHtmlPayload(payload);
  if (!data) return { status: "none" };

  // cid: images → the server points them at the authenticated attachment
  // route; <img> inside the sandbox cannot send the Bearer header, so inline
  // them as data: URLs (allowed by the CSP). Failures leave the img inert.
  const refs = attachmentRefs(data.html, ticketId);
  if (refs.length > 0) {
    const sources = new Map();
    await Promise.all(
      refs.map(async (attId) => {
        try {
          const blob = await api.attachmentBlob(ticketId, attId);
          if (!blob || blob.size > MAX_INLINE_BYTES) return;
          const t = (blob.type || "").toLowerCase();
          if (!t.startsWith("image/") || t.includes("svg")) return; // never inline SVG, whatever the server says
          sources.set(attId, await blobToDataUrl(blob));
        } catch {
          /* leave the reference as-is */
        }
      })
    );
    if (sources.size > 0) data.html = inlineAttachmentSources(data.html, ticketId, sources);
  }
  return { status: "ok", data, images };
}

function currentTheme() {
  try {
    const t = document.documentElement.getAttribute("data-theme");
    return t === "dark" || t === "light" ? t : null;
  } catch {
    return null;
  }
}

/**
 * Props:
 *   ticketId, senderEmail
 *   data      — normalised payload (html, blockedRemote, cids*, csp)
 *   images    — whether this payload was fetched with images=1
 *   loading   — a refetch is in flight
 *   onImages(always: bool) — ask the pane to refetch with images=1
 */
export default function HtmlView({ ticketId, senderEmail, data, images = false, loading = false, onImages }) {
  const [expanded, setExpanded] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const [theme, setTheme] = useState(null);

  useEffect(() => {
    setExpanded(false);
  }, [ticketId]);

  useEffect(() => {
    setTrusted(isTrustedSender(senderEmail));
  }, [senderEmail, data]);

  // Follow the app theme (mh_theme / data-theme) so the frame's defaults match.
  useEffect(() => {
    setTheme(currentTheme());
    if (typeof MutationObserver === "undefined") return;
    const mo = new MutationObserver(() => setTheme(currentTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  const doc = useMemo(
    () =>
      buildHtmlDoc({
        html: data?.html,
        csp: data?.csp,
        lang: (typeof document !== "undefined" && document.documentElement.lang) || "en",
        theme,
      }),
    [data, theme]
  );

  if (!data) return null;

  const blocked = blockedImagesLabel(data.blockedRemote);
  const inline = inlineImagesLabel(data.cidsResolved, data.cidsUnresolved);

  const stopTrusting = () => {
    untrustSender(senderEmail);
    setTrusted(false);
  };
  const trustAndShow = () => {
    trustSender(senderEmail);
    setTrusted(true);
    onImages?.(true);
  };

  return (
    <div className={`html-view${expanded ? " expanded" : ""}`}>
      {(blocked || inline || (images && trusted)) && (
        <div className="html-view-strip" role="status">
          {blocked && (
            <span className="hv-item">
              <span className="hv-label">{blocked}</span>
              <button type="button" className="hv-link" disabled={loading} onClick={() => onImages?.(false)}>
                Show images
              </button>
              {senderEmail && !trusted && (
                <button type="button" className="hv-link" disabled={loading} onClick={trustAndShow}>
                  Always show for this sender
                </button>
              )}
            </span>
          )}
          {!blocked && images && trusted && senderEmail && (
            <span className="hv-item">
              <span className="hv-label">Remote images shown (trusted sender)</span>
              <button type="button" className="hv-link" onClick={stopTrusting}>
                Stop trusting
              </button>
            </span>
          )}
          {inline && <span className="hv-item hv-muted">{inline}</span>}
        </div>
      )}
      <iframe
        className="html-view-frame"
        title="Email (HTML, sandboxed)"
        sandbox=""
        referrerPolicy="no-referrer"
        csp={data.csp}
        srcDoc={doc}
        loading="lazy"
      />
      <div className="html-view-foot">
        <button type="button" className="hv-link" onClick={() => setExpanded((v) => !v)} aria-pressed={expanded}>
          {expanded ? "Collapse" : "Expand"}
        </button>
        <span className="hv-muted">Links are inactive in this view — right-click to copy a link.</span>
      </div>
    </div>
  );
}
