import React, { createContext, useContext, useEffect, useMemo, useReducer } from "react";
import type { Me, LoginResponse } from "../lib/auth";
import { me as fetchMe, clearSession, getAccessToken, login as apiLogin } from "../lib/auth";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { status: "loading" } as AuthState);

  async function refresh() {
    dispatch({ type: "LOADING" });

    const token = getAccessToken();
    if (!token) {
      dispatch({ type: "GUEST" });
      return;
    }

    try {
      const user = await fetchMe();
      dispatch({ type: "AUTHED", user });
    } catch {
      clearSession();
      dispatch({ type: "GUEST" });
    }
  }

  async function login(email: string, password: string) {
    const res = await apiLogin(email, password);
    await refresh();
    return res;
  }

  function logout() {
    clearSession();
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