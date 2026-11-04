// Tiny scoped keyboard-shortcut registry (no dependency, no React).
//
//   const reg = createShortcuts();
//   const off = reg.bind("j", () => next(), { description: "Next message", group: "List" });
//   reg.bind("g i", () => goInbox(), { description: "Go to Inbox", group: "Go to" });
//   document.addEventListener("keydown", (e) => reg.handle(e));
//
// Rules:
//   • Events whose target is typeable (input / textarea / select / contentEditable)
//     are ignored unless the binding was registered with { inInputs: true } (Escape).
//   • Ctrl / Meta / Alt combinations are never handled (browser shortcuts stay intact).
//   • Two-key chords ("g i") must complete within `chordTimeout` ms.
//   • Later bindings take priority over earlier ones for the same key; a binding
//     may carry `when()` so a component can scope it (e.g. only while the list has focus).
//   • `table()` returns the registered shortcuts for the "?" cheat-sheet.

const TYPEABLE = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** True when keyboard focus is somewhere the user is typing. */
export function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || "").toUpperCase();
  if (TYPEABLE.has(tag)) {
    // Buttons/checkboxes are <input> too, but not typeable.
    const type = (el.type || "").toLowerCase();
    if (tag === "INPUT" && ["button", "checkbox", "radio", "submit", "reset", "range", "file"].includes(type))
      return false;
    return true;
  }
  if (el.isContentEditable) return true;
  const ce = typeof el.getAttribute === "function" ? el.getAttribute("contenteditable") : null;
  return ce === "" || ce === "true" || ce === "plaintext-only";
}

/** Normalise an event to the key token used in binding strings. */
export function keyOf(event) {
  const k = event.key;
  if (k == null) return "";
  if (k === " ") return "Space";
  return k.length === 1 ? k : k; // "ArrowDown", "Enter", "Escape", "?" … unchanged
}

export function createShortcuts({ chordTimeout = 900 } = {}) {
  const bindings = []; // { keys, parts, handler, description, group, when, inInputs }
  const prefixes = new Set(); // first keys of chords, e.g. "g"
  let pending = null; // { key, at }

  function recomputePrefixes() {
    prefixes.clear();
    for (const b of bindings) if (b.parts.length === 2) prefixes.add(b.parts[0]);
  }

  function bind(keys, handler, meta = {}) {
    const parts = String(keys).trim().split(/\s+/);
    if (parts.length < 1 || parts.length > 2 || typeof handler !== "function")
      throw new Error(`shortcuts: bad binding "${keys}"`);
    const entry = {
      keys: parts.join(" "),
      parts,
      handler,
      description: meta.description || "",
      group: meta.group || "General",
      when: typeof meta.when === "function" ? meta.when : null,
      inInputs: !!meta.inInputs,
      hidden: !!meta.hidden,
    };
    bindings.push(entry);
    recomputePrefixes();
    return () => {
      const i = bindings.indexOf(entry);
      if (i >= 0) bindings.splice(i, 1);
      recomputePrefixes();
    };
  }

  // Latest matching binding wins (components mounted later override the shell).
  function find(keys, typing) {
    for (let i = bindings.length - 1; i >= 0; i--) {
      const b = bindings[i];
      if (b.keys !== keys) continue;
      if (typing && !b.inInputs) continue;
      if (b.when && !b.when()) continue;
      return b;
    }
    return null;
  }

  /**
   * Dispatch one keydown. Returns true when a handler ran (the event is then
   * preventDefault()-ed). `now` is injectable for tests.
   */
  function handle(event, now = Date.now()) {
    if (!event || event.defaultPrevented) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) {
      pending = null;
      return false;
    }
    const key = keyOf(event);
    if (!key || key === "Shift" || key === "Control" || key === "Meta" || key === "Alt") return false;
    const typing = isTypingTarget(event.target);

    // Second half of a chord?
    if (pending && now - pending.at <= chordTimeout) {
      const first = pending.key;
      pending = null;
      const chord = find(`${first} ${key}`, typing);
      if (chord) {
        chord.handler(event);
        if (typeof event.preventDefault === "function") event.preventDefault();
        return true;
      }
      // fall through: treat as a fresh single key
    } else {
      pending = null;
    }

    // Start of a chord (only outside inputs; typing "g" must still type).
    if (!typing && prefixes.has(key) && !event.repeat) {
      pending = { key, at: now };
      // A single-key binding on a prefix (none today) would be ambiguous; prefer the chord.
      return false;
    }

    const single = find(key, typing);
    if (!single) return false;
    single.handler(event);
    if (typeof event.preventDefault === "function") event.preventDefault();
    return true;
  }

  /** Rows for the cheat-sheet, de-duplicated by key (latest description wins). */
  function table() {
    const seen = new Map();
    for (const b of bindings) if (!b.hidden) seen.set(b.keys, { keys: b.keys, description: b.description, group: b.group });
    return Array.from(seen.values());
  }

  function reset() {
    bindings.length = 0;
    prefixes.clear();
    pending = null;
  }

  return { bind, handle, table, reset, get size() { return bindings.length; } };
}

/** App-wide singleton + one document listener (installed by the shell). */
export const shortcuts = createShortcuts();

export function installShortcuts(doc, registry = shortcuts) {
  if (!doc || typeof doc.addEventListener !== "function") return () => {};
  const onKey = (e) => registry.handle(e);
  doc.addEventListener("keydown", onKey);
  return () => doc.removeEventListener("keydown", onKey);
}

/** Human label for a key token (used by the cheat-sheet). */
export function keyLabel(token) {
  const map = { ArrowDown: "↓", ArrowUp: "↑", Enter: "Enter", Escape: "Esc", Space: "Space" };
  return token
    .split(" ")
    .map((t) => map[t] || t)
    .join(" then ");
}
