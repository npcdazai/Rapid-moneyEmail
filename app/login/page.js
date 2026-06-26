"use client";

import { useEffect, useState } from "react";
import { Mail, Lock, LogIn, Loader2 } from "lucide-react";
import { api } from "../../lib/api";
import { setSession, getToken } from "../../lib/auth";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Already signed in → skip the form.
  useEffect(() => {
    if (getToken()) window.location.assign("/");
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const { token, user } = await api.auth.login(email.trim(), password);
      setSession(token, user);
      window.location.assign("/");
    } catch (err) {
      setError(err.message || "Login failed");
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/rapidmoney.png" alt="RapidMoney" />
          <span>Support</span>
        </div>
        <h1>Sign in</h1>
        <p className="login-sub">Use your RapidMoney CRM account to continue.</p>

        <label className="login-field">
          <Mail size={16} />
          <input
            type="email"
            placeholder="Email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>

        <label className="login-field">
          <Lock size={16} />
          <input
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <div className="login-error">{error}</div>}

        <button className="login-submit" type="submit" disabled={busy}>
          {busy ? (
            <>
              <Loader2 size={16} className="spin" /> Signing in…
            </>
          ) : (
            <>
              <LogIn size={16} /> Sign in
            </>
          )}
        </button>
      </form>
    </div>
  );
}
