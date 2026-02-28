// src/lib/auth.ts
import { apiFetch, apiPost } from "./api";

/**
 * Backward-compatible exports for existing AuthContext usage:
 * - export type Me
 * - export function clearSession()
 * - export function getAccessToken()
 * - export function login()
 * - export function me()
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

export type MeResponse = {
  ok: true;
  user: Me;
};

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem("accessToken");
  } catch {
    return null;
  }
}

export function setAccessToken(token: string | null) {
  try {
    if (!token) localStorage.removeItem("accessToken");
    else localStorage.setItem("accessToken", token);
  } catch {
    // ignore
  }
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
 * Fetch current user
 */
export async function me(): Promise<MeResponse> {
  return apiFetch<MeResponse>("/auth/me");
}