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
// SUPER_ADMIN tétlenségi timeout korábban itt volt:
//   const SUPERADMIN_IDLE_MS = 5 * 60 * 1000;
// A timeout-logika a useEffect-blokkban kikapcsolva (user kérés). Ha
// re-enable kell, a konstanst is visszailleszteni.

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
    // KRITIKUS: a backend `User.activeSessionId` mezőjét is törölni kell,
    // különben a felhasználó 60 sec-ig nem tud újra-bejelentkezni
    // (auth.service.ts 60 sec inaktivitási küszöb a single-session enforcement-en).
    //
    // A `/auth/logout` endpoint sendBeacon kompat – body-token-t is fogad.
    // Fire-and-forget POST (a re-login-t nem várjuk meg, a navigációt nem
    // blokkoljuk). Ha a kérés elveszik, a 60 sec timeout fallback-ként megy.
    try {
      const tok =
        sessionStorage.getItem(ACCESS_TOKEN_KEY) ??
        localStorage.getItem(ACCESS_TOKEN_KEY) ??
        "";
      if (tok) {
        const apiBase =
          ((import.meta as any)?.env?.VITE_API_BASE_URL ?? "")
            .toString().trim().replace(/\/$/, "")
          || "https://api.schoollive.hu";
        // sendBeacon: a böngésző akkor is elküldi, ha közben a felhasználó
        // bezárja a tabot vagy navigál (pl. tab-close → logout button).
        const payload = new Blob(
          [JSON.stringify({ token: tok })],
          { type: "application/json" }
        );
        const sent = navigator.sendBeacon?.(`${apiBase}/auth/logout`, payload);
        if (!sent) {
          // Fallback fetch keep-alive flag-gel
          void fetch(`${apiBase}/auth/logout`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ token: tok }),
            keepalive: true,
          }).catch(() => {});
        }
      }
    } catch {
      // a kliens-szintű cleanup-ot biztos lefuttatjuk akkor is
    }
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
   * SUPER_ADMIN idle timeout – KIKAPCSOLVA (user kérés).
   *
   * Korábban 5 perc tétlenség után auto-logoutolt SUPER_ADMIN-okat, de
   * zavaró volt hosszabb műveletek (pl. rádiólista szerkesztés, csengetési
   * rend tervezés) közben. A felhasználó kézzel logout-ol, ha akar.
   *
   * Visszakapcsoláshoz: aktiváld a `SUPERADMIN_IDLE_MS` konstanst, és
   * vedd ki a kikapcsolásra utaló kommentet az alábbi useEffect-ben.
   */
  useEffect(() => {
    // Idle-timeout disabled – semmi sem fut, a hook tisztán passzív marad.
    // Ha kell, az alábbi blokkot kell visszahozni:
    //
    //   const isSuperAdmin =
    //     state.status === "authed" && (state.user as any)?.role === "SUPER_ADMIN";
    //   if (!isSuperAdmin) return;
    //   let lastActivity = Date.now();
    //   const markActivity = () => { lastActivity = Date.now(); };
    //   const watchdog = window.setInterval(() => {
    //     if (Date.now() - lastActivity >= SUPERADMIN_IDLE_MS) logout();
    //   }, 1000);
    //   const opts: AddEventListenerOptions = { passive: true, capture: true };
    //   ["mousemove","mousedown","keydown","scroll","touchstart","click","wheel"]
    //     .forEach(e => window.addEventListener(e, markActivity, opts));
    //   const onVis = () => { if (!document.hidden) markActivity(); };
    //   document.addEventListener("visibilitychange", onVis);
    //   window.addEventListener("focus", markActivity);
    //   return () => { window.clearInterval(watchdog); ...removeEventListener-ek };
  }, []);

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