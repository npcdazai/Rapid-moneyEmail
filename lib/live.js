// Live mail updates over WebSocket. The backend pushes an event whenever a new
// ticket is ingested; we reconnect with backoff if the socket drops.
import { useEffect, useRef, useState } from "react";
import { getToken } from "./auth";

function socketUrl(token) {
  // Same-origin by default (Next.js proxies /api/* incl. WebSocket upgrades);
  // NEXT_PUBLIC_WS_URL overrides it, e.g. ws://localhost:8000/api/ws.
  const base =
    process.env.NEXT_PUBLIC_WS_URL ||
    `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/ws`;
  return `${base}?token=${encodeURIComponent(token)}`;
}

/** Calls onEvent(event) for each pushed event; returns whether the socket is live. */
export function useLiveMail(onEvent, enabled = true) {
  const [live, setLive] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    let ws = null;
    let timer = null;
    let closed = false;
    let delay = 1000;

    const connect = () => {
      const token = getToken();
      if (!token || closed) return;
      ws = new WebSocket(socketUrl(token));
      ws.onopen = () => {
        delay = 1000;
        setLive(true);
      };
      ws.onmessage = (e) => {
        try {
          handler.current(JSON.parse(e.data));
        } catch {
          /* ignore malformed events */
        }
      };
      ws.onclose = () => {
        setLive(false);
        if (closed) return;
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30_000);
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [enabled]);

  return live;
}
