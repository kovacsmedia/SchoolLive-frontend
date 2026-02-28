import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { fetchMe } from "../lib/auth";
import type { Me } from "../lib/auth";

type AuthState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "authed"; me: Me };

type AuthCtx = {
  state: AuthState;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const refresh = async () => {
    setState({ status: "loading" });
    try {
      const me = await fetchMe();
      setState({ status: "authed", me });
    } catch {
      setState({ status: "guest" });
    }
  };

  const logout = async () => {
    // ezt később a backend logout endpointjára kötjük
    setState({ status: "guest" });
  };

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo(() => ({ state, refresh, logout }), [state]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}