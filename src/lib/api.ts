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
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_BASE ?? "";

const ACCESS_TOKEN_KEY = "accessToken";
const ACTIVE_TENANT_KEY = "activeTenantId";

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
  const fromSession = safeGetItem(sessionStorage, ACCESS_TOKEN_KEY);
  if (fromSession) return fromSession;

  const fromLocal = safeGetItem(localStorage, ACCESS_TOKEN_KEY);
  if (fromLocal) return fromLocal;

  return null;
}

/**
 * Active tenant resolution order:
 * 1) sessionStorage (recommended for SUPER_ADMIN)
 * 2) localStorage (fallback)
 */
function getActiveTenantId(): string | null {
  const s = safeGetItem(sessionStorage, ACTIVE_TENANT_KEY);
  if (s) return s;

  const l = safeGetItem(localStorage, ACTIVE_TENANT_KEY);
  if (l) return l;

  return null;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const activeTenantId = getActiveTenantId();

  const headers = new Headers(init.headers ?? {});

  // Only set Content-Type when we actually send a JSON body
  // (prevents unnecessary preflight in some setups)
  const hasBody = typeof init.body === "string" || init.body instanceof Blob;
  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (token) headers.set("Authorization", `Bearer ${token}`);

  // SUPER_ADMIN tenant scoping (backend expects x-tenant-id)
  if (activeTenantId) headers.set("x-tenant-id", activeTenantId);

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
    const errMsg =
      (data && typeof data === "object" && (data.error || data.message)) ||
      `HTTP_${res.status}`;
    throw Object.assign(new Error(errMsg), { status: res.status, data });
  }

  return data as T;
}

export async function apiPost<TResponse>(path: string, body: any): Promise<TResponse> {
  return apiFetch<TResponse>(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
  });
}