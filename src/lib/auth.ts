// src/lib/auth.ts
import { apiFetch, apiPost } from "./api";

/**
 * Backward-compatible exports for existing AuthContext usage:
 * - export type Me
 * - export function clearSession()
 * - export function getAccessToken()
 * - export function login()
 * - export function me()  --> returns Me
 */

export type LoginResponse = {
  ok: true;
  accessToken: string;
};

export type Me = {
  id: string;
  email?: string | null;
  name?: string | null;
  role?: string | null;
  tenantId?: string | null;
  [k: string]: any;
};

// Some deployments return: { ok:true, user: Me }
// Others return Me directly (or { ok:true, ...Me })
type MeApiResponseWrapped = {
  ok?: true;
  user: Me;
};

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
 * Access token lookup:
 * 1) sessionStorage
 * 2) localStorage
 */
export function getAccessToken(): string | null {
  const s = safeGet(sessionStorage, ACCESS_TOKEN_KEY);
  if (s) return s;

  const l = safeGet(localStorage, ACCESS_TOKEN_KEY);
  if (l) return l;

  return null;
}

/**
 * Default behavior: store into localStorage.
 * (SUPER_ADMIN will be moved to sessionStorage by AuthContext policy enforcement.)
 *
 * When token is null, remove from both storages for safety.
 */
export function setAccessToken(token: string | null) {
  if (!token) {
    safeRemove(localStorage, ACCESS_TOKEN_KEY);
    safeRemove(sessionStorage, ACCESS_TOKEN_KEY);
    return;
  }

  safeSet(localStorage, ACCESS_TOKEN_KEY, token);
}

/**
 * Keeps old name used by AuthContext
 */
export function clearSession() {
  setAccessToken(null);
}

/**
 * Login and store token
 */
export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await apiPost<LoginResponse>("/auth/login", { email, password });
  if (res?.accessToken) setAccessToken(res.accessToken);
  return res;
}

/**
 * Fetch current user (returns Me directly, supports multiple backend shapes)
 */
export async function me(): Promise<Me> {
  const res = await apiFetch<any>("/auth/me");

  // Shape A: { ok:true, user: {...} }
  if (res && typeof res === "object" && res.user && typeof res.user === "object") {
    return (res as MeApiResponseWrapped).user;
  }

  // Shape B: Me directly: { id, role, ... }
  // Shape C: { ok:true, id, role, ... }
  if (res && typeof res === "object") {
    return res as Me;
  }

  // If we ever get here, AuthContext guard will raise a clear error
  return res as Me;
}