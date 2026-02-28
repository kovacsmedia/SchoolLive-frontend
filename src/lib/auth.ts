import { apiFetch } from "./api";

export type Role = "SUPER_ADMIN" | "TENANT_ADMIN" | "ADMIN" | "EDITOR" | "TEACHER";

export type Me = {
  id: string;
  username: string;
  role: Role;
  tenantId?: string | null;
  orgUnitId?: string | null;
};

export async function fetchMe(): Promise<Me> {
  // ezt lehet, hogy át kell írni a backendedhez
  return apiFetch<Me>("/auth/me", { method: "GET" });
}