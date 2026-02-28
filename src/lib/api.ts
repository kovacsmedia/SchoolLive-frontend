const API_BASE =
  (import.meta as any).env?.VITE_API_BASE?.toString()?.replace(/\/+$/, "") ||
  "https://api.schoollive.hu";

type ApiFetchOptions = RequestInit & {
  json?: unknown;
};

/**
 * API fetch wrapper:
 * - automatikusan hozzáad Authorization: Bearer <token> ha van
 * - JSON body-t küld, ha options.json meg van adva
 * - JSON választ parse-ol, ha lehet
 */
export async function apiFetch<T = any>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;

  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");

  const token = localStorage.getItem("accessToken");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let body: BodyInit | undefined = options.body as any;

  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    body
  });

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && "error" in data && (data as any).error) ||
      (typeof data === "string" && data) ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data as T;
}

export { API_BASE };