import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from "react";
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
const SUPERADMIN_IDLE_MS = 5 * 60 * 1000;

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
 * Login response token extractor.
 * Accepts common shapes:
 *  - { accessToken: "..." }
 *  - { token: "..." }
 *  - { jwt: "..." }
 *  - { ok: true, accessToken/token/jwt: "..." }
 *  - { data: { accessToken/token: "..." } } (just in case)
 */
function extractTokenFromLoginResponse(res: unknown): string | null {
  if (!res || typeof res !== "object") return null;
  const r = res as Record<string, unknown>;

  const candidates = [
    r.accessToken,
    r.token,
    r.jwt,
    r.access_token,
    r.id_token,
    r.accessTokenJwt,
    // nested fallback
    r.data && typeof r.data === "object" ? (r.data as any).accessToken : undefined,
    r.data && typeof r.data === "object" ? (r.data as any).token : undefined,
    r.data && typeof r.data === "object" ? (r.data as any).jwt : undefined,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }

  return null;
}

/**
 * Runtime guard: reject non-object / unexpected /auth/me responses
 * (e.g. when API_BASE is wrong and we get HTML instead of JSON user object)
 */
function assertValidMe(value: unknown): asserts value is Me {
  if (!value || typeof value !== "object") {
    throw new Error(
      "Auth hiba: hibás /auth/me válasz (nem objektum). Ellenőrizd a VITE_API_BASE_URL / VITE_API_BASE beállítást."
    );
  }

  const v = value as Record<string, unknown>;
  const hasRole = typeof v.role === "string" || v.role === null;
  const hasId = typeof v.id === "string" || typeof v.userId === "string";

  if (!hasId) {
    throw new Error(
      "Auth hiba: hibás /auth/me válasz (hiányzó id). Valószínűleg nem a backend válaszol."
    );
  }

  // role may be nullable in types; if backend always has it, we can tighten later
  if (!hasRole) {
    // not fatal
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
      safeGet(localStorage, ACCESS_TOKEN_KEY) ??
      safeGet(sessionStorage, ACCESS_TOKEN_KEY);

    if (token) {
      safeSet(sessionStorage, ACCESS_TOKEN_KEY, token);
      safeRemove(localStorage, ACCESS_TOKEN_KEY);
    }
    return;
  }

  // Non-superadmin: clear session token if any
  safeRemove(sessionStorage, ACCESS_TOKEN_KEY);
}

/**
 * Default write policy (before we know role):
 * - store in localStorage
 * - clear session storage
 * Later enforceTokenStoragePolicy() may move it for SUPER_ADMIN.
 */
function storeAccessToken(token: string) {
  safeRemove(sessionStorage, ACCESS_TOKEN_KEY);
  safeSet(localStorage, ACCESS_TOKEN_KEY, token);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    status: "loading",
  } as AuthState);

  const logout = useCallback(() => {
    clearSession();
    clearBothTokens();
    dispatch({ type: "GUEST" });
  }, []);

  const refresh = useCallback(async () => {
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
      logout();
    }
  }, [logout]);

  const login = useCallback(
    async (email: string, password: string) => {
      dispatch({ type: "LOADING" });

      try {
        // 1) login
        const res = await apiLogin(email, password);

        // 2) IMPORTANT: store token before calling /auth/me
        const token = extractTokenFromLoginResponse(res);
        if (token) {
          storeAccessToken(token);
        }

        // 3) fetch current user
        const userRaw = await fetchMe();
        assertValidMe(userRaw);

        // 4) role-based storage policy
        enforceTokenStoragePolicy(userRaw);

        dispatch({ type: "AUTHED", user: userRaw });
        return res;
      } catch (err: any) {
        logout();

        const status = err?.status;
        const data = err?.data;
        const msg =
          (data &&
            typeof data === "object" &&
            ((data as any).error || (data as any).message)) ||
          err?.message ||
          "Sikertelen bejelentkezés.";

        throw new Error(status ? `${msg} (HTTP ${status})` : msg);
      }
    },
    [logout]
  );

  // Initial refresh once
  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * SUPER_ADMIN idle timeout:
   * - Only when authed and role === SUPER_ADMIN
   * - Reset timer on typical user activity
   * - On timeout: logout (clears token + state -> guest)
   */
  useEffect(() => {
    if (state.status !== "authed") return;

    const role = (state.user as any)?.role;
    if (role !== "SUPER_ADMIN") return;

    let t: number | null = null;

    const reset = () => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => {
        logout();
      }, SUPERADMIN_IDLE_MS);
    };

    const onActivity = () => reset();
    const onVisibility = () => {
      if (!document.hidden) reset();
    };

    // Start timer immediately
    reset();

    // Typical activity signals
    window.addEventListener("mousemove", onActivity, { passive: true });
    window.addEventListener("mousedown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("scroll", onActivity, { passive: true });
    window.addEventListener("touchstart", onActivity, { passive: true });
    window.addEventListener("click", onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (t) window.clearTimeout(t);
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("mousedown", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("scroll", onActivity);
      window.removeEventListener("touchstart", onActivity);
      window.removeEventListener("click", onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [state, logout]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, refresh, login, logout }),
    [state, refresh, login, logout]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}