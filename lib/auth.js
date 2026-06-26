// Client-side session store. The JWT lives in localStorage and is attached to
// every API call by lib/api.js; the cached user powers the avatar/menu without
// a round-trip on each render.
const TOKEN_KEY = "rpm.token";
const USER_KEY = "rpm.user";

export function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

export function setSession(token, user) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// Hard redirect to /login (avoids an extra render of the protected page).
export function redirectToLogin() {
  if (typeof window === "undefined") return;
  if (window.location.pathname !== "/login") window.location.assign("/login");
}

// Two initials for the avatar, from the user's name (falling back to email).
export function initials(user) {
  const src = (user?.name || user?.email || "?").trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2);
  return letters.toUpperCase();
}
