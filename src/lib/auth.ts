// src/lib/auth.ts
import { apiFetch } from "./api";

export type Role = "SUPER_ADMIN" | "TENANT_ADMIN" | "ADMIN" | "EDITOR" | "TEACHER";

export type Me = {
  id: string;
  email: string;
  role: Role;
  tenantId?: string | null;
  orgUnitId?: string | null;
};

export type LoginResponse = {
  accessToken: string;
  user: {
    id: string;
    email: string;
    role: Role;
    tenantId?: string | null;
    orgUnitId?: string | null;
  };
};

export async function login(email: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    json: { email, password },
  });
}

export async function fetchMe(accessToken: string): Promise<Me> {
  return apiFetch<Me>("/auth/me", {
    method: "GET",
    authToken: accessToken,
  });
}