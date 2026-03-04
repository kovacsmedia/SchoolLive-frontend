// src/lib/api.ts

type ApiErrorData = {
  error?: string;
  message?: string;
};

export class ApiError extends Error {
  status: number;
  data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

function getBaseUrl(): string {
  const v = (import.meta as any)?.env?.VITE_API_BASE_URL as string | undefined;
  const base = (v ?? "").trim();
  if (!base) return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function joinUrl(base: string, path: string): string {
  if (!base) return path;
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

function safeText(x: unknown): string {
  if (typeof x === "string") return x;
  return "";
}

async function readJsonSafe(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    const txt = await res.text().catch(() => "");
    return txt ? { raw: txt } : undefined;
  }
  return res.json().catch(() => undefined);
}

/**
 * JWT payload dekódolása (csak base64, nem verifikálás).
 * TENANT_ADMIN esetén a tenantId a tokenben van.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(payload);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Tenant ID feloldása:
 * - SUPER_ADMIN: AppShell manuálisan választja ki → sessionStorage "activeTenantId"
 * - TENANT_ADMIN / ORG_ADMIN: a saját JWT payloadjában van → tenantId mező
 */
function resolveTenantId(token: string): string | null {
  // 1) SUPER_ADMIN: manuálisan kiválasztott tenant
  const active =
    sessionStorage.getItem("activeTenantId") ??
    localStorage.getItem("activeTenantId") ??
    null;
  if (active) return active;

  // 2) TENANT_ADMIN / ORG_ADMIN: JWT payloadból
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const tid = payload.tenantId;
  if (typeof tid === "string" && tid) return tid;

  return null;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    throw new ApiError(
      "Hiányzik a VITE_API_BASE_URL (üres). Ellenőrizd a .env.local/.env.production értékét és a deploy buildet.",
      0
    );
  }

  const url = joinUrl(baseUrl, path);

  const controller = new AbortController();
  const timeoutMs = 15000;
  const t = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const token =
      sessionStorage.getItem("accessToken") ??
      localStorage.getItem("accessToken") ??
      "";

    const tenantId = token ? resolveTenantId(token) : null;

    const headers = new Headers(init?.headers ?? {});
    if (!headers.has("Content-Type") && init?.body) {
      headers.set("Content-Type", "application/json");
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (tenantId) headers.set("x-tenant-id", tenantId);

    const res = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      const data = await readJsonSafe(res);
      const d = (data ?? {}) as ApiErrorData;
      const msg =
        d?.message ??
        d?.error ??
        `HTTP ${res.status} (${res.statusText})`;
      throw new ApiError(msg, res.status, data);
    }

    if (res.status === 204) return undefined as unknown as T;

    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      return (await res.json()) as T;
    }

    const txt = await res.text().catch(() => "");
    return txt as unknown as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const msg = safeText((e as any)?.message) || "Failed to fetch";
    throw new ApiError(
      `Hálózati hiba: ${msg}. URL: ${url}. (Tipikusan: rossz API host, CORS, vagy https/http mixed content)`,
      0,
      { url }
    );
  } finally {
    window.clearTimeout(t);
  }
}

export async function apiPost<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    body: typeof body === "undefined" ? undefined : JSON.stringify(body),
    ...init,
  });
}