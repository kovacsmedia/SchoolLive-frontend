// src/auth/token.ts
export const KEY = "accessToken"; 

export function setToken(token: string): void {
  const t = (token ?? "").trim();
  if (!t) return;
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