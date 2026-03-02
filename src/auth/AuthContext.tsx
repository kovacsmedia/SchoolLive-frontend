import React, { createContext, useContext, useEffect, useMemo, useReducer } from "react";
import type { Me, LoginResponse } from "../lib/auth";
import { me as fetchMe, clearSession, login as apiLogin } from "../lib/auth";

type AuthState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "authed"; user: Me };

type AuthAction =
  | { type: "GUEST" }
  | { type: "AUTHED"; user: Me }
  | { type: "LOADING" };

function reducer(_state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "LOADING":
      return { status: "loading" };
    case "GUEST":
      return { status: "guest" };
    case "AUTHED":
      return { status: "authed", user: action.user };
    default:
      return { status: "guest" };
  }
}

type AuthContextValue = {
  state: AuthState;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<LoginResponse>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const ACCESS_TOKEN_KEY = "accessToken";

function safeGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    // ignore
  }
}

function safeRemove(storage: Storage, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

function clearBothTokens() {
  safeRemove(sessionStorage, ACCESS_TOKEN_KEY);
  safeRemove(localStorage, ACCESS_TOKEN_KEY);
}

/**
 * Token resolution order:
 * 1) sessionStorage (SUPER_ADMIN session-only)
 * 2) localStorage (persisted for normal users)
 */
function getAnyAccessToken(): string | null {
  const s = safeGet(sessionStorage, ACCESS_TOKEN_KEY);
  if (s) return s;

  const l = safeGet(localStorage, ACCESS_TOKEN_KEY);
  if (l) return l;

  return null;
}

/**
 * Runtime guard: reject non-object / unexpected /auth/me responses
 * (e.g. when API_BASE is wrong and we get HTML instead of JSON user object)
 */
function assertValidMe(value: unknown): asserts value is Me {
  if (!value || typeof value !== "object") {
    throw new Error("Auth hiba: hibás /auth/me válasz (nem objektum). Ellenőrizd a VITE_API_BASE beállítást.");
  }

  const v = value as Record<string, unknown>;

  // These fields are typical for a "me" payload; adjust later if your Me differs.
  // We keep it strict on purpose to prevent "HTML => authed" issues.
  const hasRole = typeof v.role === "string";
  const hasId = typeof v.id === "string" || typeof v.userId === "string";
  const hasEmail = typeof v.email === "string" || typeof v.username === "string";

  if (!hasRole || !hasId) {
    throw new Error("Auth hiba: hibás /auth/me válasz (hiányzó mezők). Valószínűleg nem a backend válaszol.");
  }

  // email not mandatory everywhere, but if you have it, it's a nice extra sanity check
  if (!hasEmail) {
    // do not fail hard if your backend truly doesn't include it; comment out if needed
    // throw new Error("Auth hiba: /auth/me válasz nem tartalmaz e-mailt/username-t.");
  }
}

/**
 * Enforce storage policy:
 * - SUPER_ADMIN: sessionStorage only (no persistence)
 * - others: localStorage (and clear any leftover session token)
 */
function enforceTokenStoragePolicy(user: Me) {
  const role = (user as any)?.role;

  if (role === "SUPER_ADMIN") {
    const token =
      safeGet(localStorage, ACCESS_TOKEN_KEY) ?? safeGet(sessionStorage, ACCESS_TOKEN_KEY);
    if (token) {
      safeSet(sessionStorage, ACCESS_TOKEN_KEY, token);
      safeRemove(localStorage, ACCESS_TOKEN_KEY);
    }
    return;
  }

  // Non-superadmin: clear session token if any
  safeRemove(sessionStorage, ACCESS_TOKEN_KEY);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { status: "loading" } as AuthState);

  async function refresh() {
    dispatch({ type: "LOADING" });

    const token = getAnyAccessToken();
    if (!token) {
      dispatch({ type: "GUEST" });
      return;
    }

    try {
      const userRaw = await fetchMe();
      assertValidMe(userRaw);
      enforceTokenStoragePolicy(userRaw);
      dispatch({ type: "AUTHED", user: userRaw });
    } catch {
      clearSession();
      clearBothTokens();
      dispatch({ type: "GUEST" });
    }
  }

  async function login(email: string, password: string) {
    dispatch({ type: "LOADING" });

    try {
      // 1) perform login (lib/auth is responsible for storing the token)
      const res = await apiLogin(email, password);

      // 2) verify immediately
      const userRaw = await fetchMe();
      assertValidMe(userRaw);

      // 3) enforce policy now that role is known
      enforceTokenStoragePolicy(userRaw);

      // 4) commit auth state
      dispatch({ type: "AUTHED", user: userRaw });

      return res;
    } catch (err: any) {
      clearSession();
      clearBothTokens();
      dispatch({ type: "GUEST" });

      const status = err?.status;
      const data = err?.data;
      const msg =
        (data && typeof data === "object" && (data.error || data.message)) ||
        err?.message ||
        "Sikertelen bejelentkezés.";

      throw new Error(status ? `${msg} (HTTP ${status})` : msg);
    }
  }

  function logout() {
    clearSession();
    clearBothTokens();
    dispatch({ type: "GUEST" });
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthContextValue>(() => ({ state, refresh, login, logout }), [state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}