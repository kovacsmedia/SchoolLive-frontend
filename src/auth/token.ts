// src/auth/token.ts

// Egységes kulcs: ezt olvassa a src/lib/api.ts is
export const KEY = "token";

export function setToken(token: string): void {
  const t = (token ?? "").trim();
  if (!t) return;

  // Biztos kompatibilitás: api.ts mindkettőt nézi
  sessionStorage.setItem(KEY, t);
  localStorage.setItem(KEY, t);
}

export function getToken(): string | null {
  return sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY);
}

export function clearToken(): void {
  sessionStorage.removeItem(KEY);
  localStorage.removeItem(KEY);
}