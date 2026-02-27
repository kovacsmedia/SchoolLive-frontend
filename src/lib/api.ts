// src/lib/api.ts
export type ApiError = {
  status: number;
  message: string;
  details?: unknown;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

async function parseJsonSafe(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;

  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");

  let body = options.body;
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    body,
    // KRITIKUS: cross-subdomain cookie auth-hoz
    credentials: "include",
  });

  if (!res.ok) {
    const data = await parseJsonSafe(res);
    const message =
      (data && typeof data === "object" && "message" in data && typeof (data as any).message === "string")
        ? (data as any).message
        : `HTTP ${res.status}`;

    const err: ApiError = { status: res.status, message, details: data };
    throw err;
  }

  return (await parseJsonSafe(res)) as T;
}