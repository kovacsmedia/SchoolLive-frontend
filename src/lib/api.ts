// src/lib/api.ts
export type ApiError = {
  ok: false;
  error: string;
  details?: any;
};

export type ApiOk<T> = {
  ok: true;
} & T;

// Prefer VITE_API_BASE_URL, keep VITE_API_BASE as fallback for compatibility
const API_BASE =
  import.meta.env.VITE_API_BASE_URL ??
  import.meta.env.VITE_API_BASE ??
  "";

function safeGetItem(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Token resolution order:
 * 1) sessionStorage
 * 2) localStorage
 */
function getToken(): string | null {
  const fromSession = safeGetItem(sessionStorage, "accessToken");
  if (fromSession) return fromSession;

  const fromLocal = safeGetItem(localStorage, "accessToken");
  if (fromLocal) return fromLocal;

  return null;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();

  const headers = new Headers(init.headers ?? {});
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    // backend formátum: { ok:false, error:"...", ... }
    const errMsg =
      (data && typeof data === "object" && data.error) || `HTTP_${res.status}`;
    throw Object.assign(new Error(errMsg), { status: res.status, data });
  }

  return data as T;
}

export async function apiPost<TResponse>(path: string, body: any): Promise<TResponse> {
  return apiFetch<TResponse>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}