import { apiFetch } from "./api";

export type Me = {
  id: string;
  email: string;
  role: "SUPER_ADMIN" | "TENANT_ADMIN" | "ORG_ADMIN" | "TEACHER" | "OPERATOR";
  tenantId: string | null;
  isActive?: boolean;
};

export type LoginResponse = {
  accessToken: string;
  user: {
    id: string;
    email: string;
    role: Me["role"];
    tenantId: string | null;
  };
};

const TOKEN_KEY = "accessToken";

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    json: { email, password }
  });

  setAccessToken(res.accessToken);
  return res;
}

export async function me(): Promise<Me> {
  // apiFetch automatikusan küldi az Authorization headert a localStorage token alapján
  return apiFetch<Me>("/auth/me", { method: "GET" });
}

export async function logout(): Promise<void> {
  // jelenleg nincs backend logout endpoint; kliens oldali session törlés
  clearSession();
}