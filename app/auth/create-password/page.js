"use client";

import { useEffect, useState } from "react";
import { Lock, Check, KeyRound, Loader2 } from "lucide-react";
import { api } from "../../../lib/api";

const MIN = 8;

export default function CreatePasswordPage() {
  const [token, setToken] = useState(null); // null = still reading from URL
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Read ?token= on the client (avoids the useSearchParams Suspense requirement).
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") || "");
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (password.length < MIN) return setError(`Password must be at least ${MIN} characters.`);
    if (password !== confirm) return setError("Passwords do not match.");

    setBusy(true);
    try {
      await api.auth.setPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err.message || "Could not set password.");
      setBusy(false);
    }
  };

  const Shell = ({ children }) => (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/rapidmoney.png" alt="RapidMoney" />
          <span>Support</span>
        </div>
        {children}
      </div>
    </div>
  );

  if (token === null) {
    return (
      <Shell>
        <div style={{ display: "grid", placeItems: "center", padding: "20px 0", color: "var(--muted)" }}>
          <Loader2 size={24} className="spin" />
        </div>
      </Shell>
    );
  }

  if (!token) {
    return (
      <Shell>
        <h1>Invalid link</h1>
        <p className="login-sub">
          This page needs a valid set-password link. Ask an administrator to create your
          account or resend the link.
        </p>
        <a className="login-submit" href="/login" style={{ textDecoration: "none" }}>
          Go to sign in
        </a>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="cp-success">
          <Check size={26} />
        </div>
        <h1>Password set</h1>
        <p className="login-sub">Your account is ready. You can now sign in.</p>
        <a className="login-submit" href="/login" style={{ textDecoration: "none" }}>
          Continue to sign in
        </a>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1>Create your password</h1>
      <p className="login-sub">Choose a password to activate your account.</p>
      <form onSubmit={submit}>
        <label className="login-field">
          <Lock size={16} />
          <input
            type="password"
            placeholder={`New password (min ${MIN} characters)`}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label className="login-field">
          <KeyRound size={16} />
          <input
            type="password"
            placeholder="Confirm password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </label>

        {error && <div className="login-error">{error}</div>}

        <button className="login-submit" type="submit" disabled={busy}>
          {busy ? (
            <>
              <Loader2 size={16} className="spin" /> Saving…
            </>
          ) : (
            <>
              <Check size={16} /> Set password
            </>
          )}
        </button>
      </form>
    </Shell>
  );
}
