// src/auth/AuthContext.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { fetchMe } from "../lib/auth";
import type { Me } from "../lib/auth";
import { clearToken, getStoredToken, storeToken } from "./token";

type AuthState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "authed"; me: Me; accessToken: string };

type AuthCtx = {
  state: AuthState;
  setToken: (token: string, persistRequested: boolean) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const refresh = async () => {
    const token = state.status === "authed" ? state.accessToken : getStoredToken();

    if (!token) {
      setState({ status: "guest" });
      return;
    }

    setState({ status: "loading" });
    try {
      const me = await fetchMe(token);
      setState({ status: "authed", me, accessToken: token });
    } catch {
      clearToken();
      setState({ status: "guest" });
    }
  };

  const setToken = async (token: string, persistRequested: boolean) => {
    // előbb lekérjük a usert, utána döntünk a persist-ről (adminnál tiltjuk)
    const me = await fetchMe(token);

    const isAdmin = me.role === "SUPER_ADMIN" || me.role === "TENANT_ADMIN" || me.role === "ADMIN";

    if (persistRequested && !isAdmin) {
      storeToken(token);
    } else {
      // adminnál biztosan ne maradjon tárolt token
      clearToken();
    }

    setState({ status: "authed", me, accessToken: token });
  };

  const logout = () => {
    clearToken();
    setState({ status: "guest" });
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(() => ({ state, setToken, logout, refresh }), [state]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}