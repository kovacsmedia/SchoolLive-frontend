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

function clearBothTokens() {
  safeRemove(sessionStorage, ACCESS_TOKEN_KEY);
  safeRemove(localStorage, ACCESS_TOKEN_KEY);
}

/**
 * Enforce storage policy:
 * - SUPER_ADMIN: sessionStorage only (no persistence)
 * - others: localStorage (and clear any leftover session token)
 */
function enforceTokenStoragePolicy(user: Me) {
  const role = (user as any)?.role;

  if (role === "SUPER_ADMIN") {
    const token = safeGet(localStorage, ACCESS_TOKEN_KEY) ?? safeGet(sessionStorage, ACCESS_TOKEN_KEY);
    if (token) {
      safeSet(sessionStorage, ACCESS_TOKEN_KEY, token);
      safeRemove(localStorage, ACCESS_TOKEN_KEY);
    }
    return;
  }

  // Non-superadmin: prefer persisted token; clear session token if any
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
      const user = await fetchMe();
      enforceTokenStoragePolicy(user);
      dispatch({ type: "AUTHED", user });
    } catch {
      // clearSession() is your existing helper, but we also clear sessionStorage explicitly
      clearSession();
      safeRemove(sessionStorage, ACCESS_TOKEN_KEY);
      dispatch({ type: "GUEST" });
    }
  }

  async function login(email: string, password: string) {
    // IMPORTANT: do not clear storages before apiLogin() here,
    // because lib/auth may rely on its own storage flow.
    const res = await apiLogin(email, password);
    await refresh();
    return res;
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