// src/lib/api.ts

type ApiErrorData = {
  error?: string;
  message?: string;
  // Multi-node cluster: 409 "Tenant not hosted on this node" válaszoknál a
  // backend ezt is visszaadja, hogy a kliens azonnal tudja hova forduljon.
  correctNodeHostname?: string;
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

// Multi-node cluster: ha egy kérés 409-et kap "correctNodeHostname"-mel (a
// tenant időközben más node-ra került), ide kerül az override – a fül
// mostantól ezt a node-ot használja, amíg újra nem töltődik az oldal.
// SZÁNDÉKOSAN NEM localStorage-ba mentve: egy elavult, reload után is
// megmaradó override rosszabb (tévesen rossz node-hoz kötné a frissen
// újratöltött fület), mint egy plusz 409+retry kör minden reload után.
let _baseUrlOverride: string | null = null;

function getBaseUrl(): string {
  if (_baseUrlOverride) return _baseUrlOverride;
  const v = (import.meta as any)?.env?.VITE_API_BASE_URL as string | undefined;
  const base = (v ?? "").trim();
  if (!base) return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

/**
 * Az ÉPPEN érvényes API base URL (a 409-es node-átirányítás override-jával
 * együtt). A WebSocket-alapú részek (VirtualPlayer `/sync` és `/snap-stream`)
 * ezt használják, hogy ne essenek szét a HTTP-réteg node-tudatosságától –
 * korábban bedrótozott `wss://api.schoollive.hu` konstansaik voltak, így egy
 * rebalancing után örökre a régi node-hoz próbáltak csatlakozni.
 */
export function getApiBaseUrl(): string {
  return getBaseUrl();
}

/** `wss://…` / `ws://…` alak az aktuális API base-ből, adott path-fel. */
export function getWsUrl(path: string): string {
  const base = getBaseUrl();
  const ws = base.startsWith("https://")
    ? `wss://${base.slice("https://".length)}`
    : base.startsWith("http://")
      ? `ws://${base.slice("http://".length)}`
      : base;
  return `${ws}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Multi-node: a WS-oldal is átállíthatja a base URL-t, ha a backend
 * NODE_REASSIGNED üzenetet küld vagy 4009-cel bont. Ugyanaz az override,
 * amit a HTTP 409-es ág használ – így a HTTP és a WS mindig ugyanarra a
 * node-ra mutat.
 */
export function setApiBaseHost(hostname: string): void {
  if (!hostname) return;
  const next = `https://${hostname}`;
  if (_baseUrlOverride === next) return;
  _baseUrlOverride = next;
  console.log(`[api] node-váltás → ${next}`);
}

/** GET /cluster/locate – hitelesítés nélküli; ha a NODE_REASSIGNED push nem
 *  érkezett meg (pl. a régi node hirtelen halt meg), ebből derül ki, hova
 *  kell csatlakozni. Hibánál null. */
export async function locateNode(tenantId: string): Promise<string | null> {
  try {
    const res = await fetch(`${getBaseUrl()}/cluster/locate?tenantId=${encodeURIComponent(tenantId)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { hostname?: string };
    return typeof data?.hostname === "string" ? data.hostname : null;
  } catch {
    return null;
  }
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

/**
 * A webplayer (PLAYER szerepkör) SOSEM kerülhet magától a bejelentkező
 * képernyőre – egy teremben futó kijelzőt senki nem fog kézzel visszaléptetni.
 * Ha a szerver `session_revoked`-ot ad, a VirtualPlayer itt regisztrált
 * kezelője csendben újra bejelentkezik a localStorage-ban tárolt
 * hitelesítő adatokkal, és a felhasználó ebből semmit nem vesz észre.
 *
 * Ha nincs regisztrált kezelő (admin felület), marad a régi viselkedés:
 * token törlése + navigálás a /login-ra.
 */
type SessionRevokedHandler = () => void | Promise<void>;
let _sessionRevokedHandler: SessionRevokedHandler | null = null;

export function setSessionRevokedHandler(h: SessionRevokedHandler | null): void {
  _sessionRevokedHandler = h;
}

export async function apiFetch<T>(path: string, init?: RequestInit, _isRetry = false): Promise<T> {
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

      // Ez a munkamenet EXPLICIT megszűnt (a user maga jelentkeztette ki innen
      // egy másik eszközről, vagy admin force-logoutolta / deaktiválta a
      // fiókot) – FONTOS: ez a multi-session bevezetése óta NEM azt jelenti,
      // hogy "valaki más bejelentkezett" (több kliens egyszerre, egymást nem
      // kiütve maradhat bejelentkezve, ld. auth.service.ts login()), hanem
      // hogy EZ a konkrét session-sor lett törölve a szerveren. Bárhonnan
      // jöjjön is a kérés, azonnal töröljük a helyi auth-állapotot és
      // login-ra navigálunk – nem várjuk meg a köv. periodikus refresh-tick-et
      // (AuthContext), ami akár percekig is eltarthatna.
      if (res.status === 401 && d?.error === "session_revoked") {
        if (_sessionRevokedHandler) {
          // Webplayer: csendes újra-bejelentkezés, NINCS login-képernyő és
          // NINCS token-törlés (a relogin úgyis felülírja). Ld. a fenti
          // magyarázatot.
          try { void _sessionRevokedHandler(); } catch { /* ignore */ }
        } else {
          try {
            sessionStorage.removeItem("accessToken");
            localStorage.removeItem("accessToken");
            sessionStorage.removeItem("activeTenantId");
            localStorage.removeItem("activeTenantId");
          } catch { /* ignore */ }
          if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
            window.location.href = "/login";
          }
        }
      }

      // Multi-node cluster: a tenant időközben másik node-ra került. Egyetlen
      // automatikus retry az új host-tal – a _isRetry guard véd a végtelen
      // ciklustól, ha az új node is (átmenetileg) elutasítaná.
      if (res.status === 409 && typeof d?.correctNodeHostname === "string" && !_isRetry) {
        _baseUrlOverride = `https://${d.correctNodeHostname}`;
        return apiFetch<T>(path, init, true); // a `finally` lent úgyis clearTimeout-ol
      }

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

export async function apiPatch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return apiFetch<T>(path, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    body: typeof body === "undefined" ? undefined : JSON.stringify(body),
    ...init,
  });
}

// Lokalizáció: a bejelentkezett user UI-nyelv preferenciájának perzisztálása.
// Fire-and-forget hívásra szánva (a UI azonnal, hívás előtt vált nyelvet).
export async function setLocale(locale: string): Promise<{ ok: true; locale: string }> {
  return apiPatch<{ ok: true; locale: string }>("/auth/me/locale", { locale });
}