import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { fetchMe } from "../lib/auth";
import type { Me } from "../lib/auth";
import { getStoredToken, storeToken, clearToken } from "./token";

type AuthState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "authed"; me: Me; accessToken: string };

type AuthCtx = {
  state: AuthState;
  setToken: (token: string, persist: boolean) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const refresh = async () => {
    const token =
      state.status === "authed" ? state.accessToken : getStoredToken();

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

  const setToken = async (token: string, persist: boolean) => {
    // Ideiglenes: először lekérjük a usert, és csak utána döntünk persist-ről (admin tiltás miatt)
    const me = await fetchMe(token);

    const isAdmin = me.role === "SUPER_ADMIN" || me.role === "TENANT_ADMIN" || me.role === "ADMIN";
    if (persist && !isAdmin) storeToken(token);
    else clearToken(); // adminnál biztosan ne maradjon

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