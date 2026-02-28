// src/lib/api.ts

export type ApiError = {
  status: number;
  message: string;
  details?: unknown;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

function parseJsonMaybe(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { json?: unknown; authToken?: string } = {}
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;

  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");

  if (options.authToken) {
    headers.set("Authorization", `Bearer ${options.authToken}`);
  }

  let body = options.body;
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    body,
  });

  const text = await res.text();
  const data = parseJsonMaybe(text);

  if (!res.ok) {
    const msg =
      data && typeof data === "object" && data !== null && "message" in (data as any)
        ? String((data as any).message)
        : `HTTP ${res.status}`;

    const err: ApiError = { status: res.status, message: msg, details: data };
    throw err;
  }

  return data as T;
}