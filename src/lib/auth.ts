// src/lib/auth.ts
import { apiFetch, apiPost } from "./api";

/**
 * Backward-compatible exports for existing AuthContext usage:
 * - export type Me
 * - export function clearSession()
 * - export function getAccessToken()
 * - export function login()
 * - export function me()  --> returns Me (NOT wrapper object)
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

type MeApiResponse = {
  ok: true;
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
 * 1) sessionStorage (session-only, e.g. SUPER_ADMIN after policy enforcement)
 * 2) localStorage (persisted for normal users)
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
 * Fetch current user (returns Me directly, to match AuthContext expectations)
 */
export async function me(): Promise<Me> {
  const res = await apiFetch<MeApiResponse>("/auth/me");
  return res.user;
}