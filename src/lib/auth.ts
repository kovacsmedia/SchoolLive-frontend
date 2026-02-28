// src/lib/auth.ts
import { apiFetch, apiPost } from "./api";

export type LoginResponse = {
  ok: true;
  accessToken: string;
};

export type MeResponse = {
  ok: true;
  user: {
    id: string;
    email?: string | null;
    name?: string | null;
    role?: string | null;
    tenantId?: string | null;
    [k: string]: any;
  };
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

export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await apiPost<LoginResponse>("/auth/login", { email, password });
  if (res?.accessToken) setAccessToken(res.accessToken);
  return res;
}

export async function me(): Promise<MeResponse> {
  return apiFetch<MeResponse>("/auth/me");
}

export function logout() {
  setAccessToken(null);
}