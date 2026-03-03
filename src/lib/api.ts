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

  // Ha üres, az NEM OK: inkább dobjunk értelmes hibát,
  // mint hogy a fetch relatív /auth/login-ra menjen ismeretlen originre.
  if (!base) return "";

  // Lehet valaki "/"-ra végződőt ad meg; normalizáljuk
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function joinUrl(base: string, path: string): string {
  if (!base) return path; // majd a fetch dob; mi inkább előtte dobunk lent
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

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    // Ez a legjobb hely megfogni: ha itt vagyunk, a build/runtime env nincs rendben,
    // vagy rossz .env.* ment ki prodba.
    throw new ApiError(
      "Hiányzik a VITE_API_BASE_URL (üres). Ellenőrizd a .env.local/.env.production értékét és a deploy buildet.",
      0
    );
  }

  const url = joinUrl(baseUrl, path);

  // Timeout, hogy ne “fagyjon”
  const controller = new AbortController();
  const timeoutMs = 15000;
  const t = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const token =
    sessionStorage.getItem("accessToken") ??
    localStorage.getItem("accessToken") ??
    "";

    const headers = new Headers(init?.headers ?? {});
    if (!headers.has("Content-Type") && init?.body) {
      headers.set("Content-Type", "application/json");
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);

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

    // 204 / üres body kezelése
    if (res.status === 204) return undefined as unknown as T;

    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      return (await res.json()) as T;
    }

    // ha nem json, visszaadjuk textként
    const txt = await res.text().catch(() => "");
    return txt as unknown as T;
  } catch (e) {
    // Itt jön a “Failed to fetch” is: CORS/mixed content/DNS/connection refused
    if (e instanceof ApiError) throw e;

    const msg = safeText((e as any)?.message) || "Failed to fetch";
    // Kibővítjük a hibaüzenetet a kulcs infóval:
    // - milyen URL-t próbált hívni
    // - ez tipikusan CORS/mixed content/rossz host
    throw new ApiError(
      `Hálózati hiba: ${msg}. URL: ${url}. (Tipikusan: rossz API host, CORS, vagy https/http mixed content)`,
      0,
      { url }
    );
  } finally {
    window.clearTimeout(t);
  }
}
// src/lib/api.ts

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