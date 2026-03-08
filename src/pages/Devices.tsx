// src/pages/Devices.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

type DeviceClass = "SPEAKER" | "DISPLAY" | "MULTI";
type WifiSecurity = "OPEN" | "WPA2_PERSONAL" | "WPA2_ENTERPRISE" | "WPA3_PERSONAL";

type DeviceItem = {
  deviceId: string;
  name: string;
  deviceClass: DeviceClass;
  firmwareVersion?: string | null;
  ipAddress?: string | null;
  isOnline: boolean;
  secondsSinceLastSeen?: number | null;
  volume: number;
  muted: boolean;
  createdAt?: string | null;
  orgUnitId?: string | null;
  authType?: string;
};

type HealthResponse = {
  ok: true;
  devices: DeviceItem[];
  totalRegistered: number;
};

type PendingDevice = {
  id: string;
  mac: string;
  ipAddress?: string | null;
  firmwareVersion?: string | null;
  lastSeenAt: string;
};

type PendingResponse = {
  ok: true;
  pending: PendingDevice[];
};

type TenantItem = {
  id: string;
  name: string;
};

type TenantsResponse = {
  ok: true;
  tenants: TenantItem[];
};

const DEVICE_CLASS_OPTIONS: Array<{ value: DeviceClass; label: string; description: string }> = [
  { value: "SPEAKER", label: "Hangszóró", description: "TTS és audio lejátszás" },
  { value: "DISPLAY", label: "Kijelző", description: "Szöveges üzenetek megjelenítése" },
  { value: "MULTI", label: "Multi (tablet/player)", description: "Hang + kijelző, virtuális eszközök is" },
];

const WIFI_SECURITY_OPTIONS: Array<{ value: WifiSecurity; label: string }> = [
  { value: "OPEN",           label: "Nincs (nyílt hálózat)" },
  { value: "WPA2_PERSONAL",  label: "WPA2 Personal" },
  { value: "WPA3_PERSONAL",  label: "WPA3 Personal" },
  { value: "WPA2_ENTERPRISE", label: "WPA2 Enterprise (802.1X)" },
];

function formatDateTime(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("hu-HU");
}

function safeErrorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const anyE = e as { message?: string; data?: { error?: string; message?: string } };
    if (anyE?.data?.message) return anyE.data.message;
    if (anyE?.data?.error) return anyE.data.error;
    if (anyE?.message) return anyE.message;
  }
  return "Ismeretlen hiba";
}

function DeviceClassBadge({ cls }: { cls: DeviceClass }) {
  const map: Record<DeviceClass, string> = {
    SPEAKER: "bg-blue-600/20 text-blue-200 border-blue-500/30",
    DISPLAY: "bg-violet-600/20 text-violet-200 border-violet-500/30",
    MULTI: "bg-amber-600/20 text-amber-200 border-amber-500/30",
  };
  const label: Record<DeviceClass, string> = {
    SPEAKER: "Hangszóró",
    DISPLAY: "Kijelző",
    MULTI: "Multi",
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${map[cls] ?? ""}`}>
      {label[cls] ?? cls}
    </span>
  );
}

function OnlineBadge({ isOnline }: { isOnline: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${
      isOnline
        ? "bg-emerald-600/20 text-emerald-200 border-emerald-500/30"
        : "bg-zinc-600/20 text-zinc-400 border-zinc-500/30"
    }`}>
      <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-emerald-400" : "bg-zinc-500"}`} />
      {isOnline ? "Online" : "Offline"}
    </span>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-lg border border-white/10 bg-zinc-950 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sticky top-0 bg-zinc-950 z-10">
          <div className="text-sm font-semibold">{title}</div>
          <button className="rounded-md px-2 py-1 text-sm hover:bg-white/10" type="button" onClick={onClose}>✕</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

type ActivateForm = {
  pendingId: string;
  tenantId: string;
  name: string;
  deviceClass: DeviceClass;
  // WiFi
  wifiSsid: string;
  wifiHidden: boolean;
  wifiSecurity: WifiSecurity;
  wifiPassword: string;
  wifiUser: string;       // WPA2 Enterprise: login
  orgUnitId: string;
};

export default function Devices() {
  const { state } = useAuth();
  const role = state.status === "authed" ? state.user?.role ?? "" : "";
  const isSuperAdmin = role === "SUPER_ADMIN";
  const canWrite = role === "SUPER_ADMIN" || role === "TENANT_ADMIN";

  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const [pendingOpen, setPendingOpen] = useState(false);
  const [pending, setPending] = useState<PendingDevice[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);

  const [tenants, setTenants] = useState<TenantItem[]>([]);

  const [activateForm, setActivateForm] = useState<ActivateForm | null>(null);
  const [busyActivate, setBusyActivate] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [activateSuccess, setActivateSuccess] = useState<{ deviceKey: string; name: string } | null>(null);

  const healthTimer = useRef<number | null>(null);
  const pendingTimer = useRef<number | null>(null);

  async function loadDevices() {
    try {
      const data = await apiFetch<HealthResponse>("/admin/devices/health");
      setDevices(Array.isArray(data.devices) ? data.devices : []);
      setError(null);
    } catch (e) {
      setError(safeErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadPending() {
    setPendingLoading(true);
    try {
      const data = await apiFetch<PendingResponse>("/provision/pending");
      setPending(Array.isArray(data.pending) ? data.pending : []);
    } catch {
      setPending([]);
    } finally {
      setPendingLoading(false);
    }
  }

  async function loadTenants() {
    if (!isSuperAdmin) return;
    try {
      const data = await apiFetch<TenantsResponse>("/admin/tenants");
      setTenants(Array.isArray(data.tenants) ? data.tenants : []);
    } catch {
      setTenants([]);
    }
  }

  useEffect(() => {
    void loadDevices();
    healthTimer.current = window.setInterval(loadDevices, 10_000);
    if (canWrite) void loadTenants();
    return () => {
      if (healthTimer.current) window.clearInterval(healthTimer.current);
      if (pendingTimer.current) window.clearInterval(pendingTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openPending() {
    setPendingOpen(true);
    void loadPending();
    pendingTimer.current = window.setInterval(loadPending, 5_000);
  }

  function closePending() {
    setPendingOpen(false);
    if (pendingTimer.current) {
      window.clearInterval(pendingTimer.current);
      pendingTimer.current = null;
    }
  }

  function selectPending(p: PendingDevice) {
    // TENANT_ADMIN esetén az activeTenantId automatikusan kitöltődik
    // SUPER_ADMIN esetén manuálisan kell kiválasztani
    const activeTenantId = sessionStorage.getItem("activeTenantId")
      ?? localStorage.getItem("activeTenantId")
      ?? "";
    setActivateForm({
      pendingId: p.id,
      tenantId: activeTenantId,
      name: "",
      deviceClass: "SPEAKER",
      wifiSsid: "",
      wifiHidden: false,
      wifiSecurity: "WPA2_PERSONAL",
      wifiPassword: "",
      wifiUser: "",
      orgUnitId: "",
    });
    setActivateError(null);
    setActivateSuccess(null);
    closePending();
  }

  async function submitActivate() {
    if (!activateForm) return;
    const {
      pendingId, tenantId, name, deviceClass,
      wifiSsid, wifiHidden, wifiSecurity, wifiPassword, wifiUser,
    } = activateForm;

    if (!name.trim()) { setActivateError("Az eszköznév megadása kötelező."); return; }
    if (!tenantId) { setActivateError("Intézmény kiválasztása kötelező."); return; }
    if (!wifiSsid.trim()) { setActivateError("WiFi SSID megadása kötelező."); return; }
    if (wifiSecurity !== "OPEN" && !wifiPassword.trim()) {
      setActivateError("WiFi jelszó megadása kötelező a kiválasztott biztonsági típusnál."); return;
    }
    if (wifiSecurity === "WPA2_ENTERPRISE" && !wifiUser.trim()) {
      setActivateError("WPA2 Enterprise esetén a bejelentkezési név megadása kötelező."); return;
    }

    setActivateError(null);
    setBusyActivate(true);

    try {
      const res = await apiFetch<{ ok: true; device: { name: string }; deviceKey: string }>(
        "/provision/activate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pendingId,
            tenantId,
            name: name.trim(),
            deviceClass,
            wifiSsid: wifiSsid.trim(),
            wifiHidden,
            wifiSecurity,
            wifiPassword: wifiSecurity !== "OPEN" ? wifiPassword.trim() : "",
            wifiUser: wifiSecurity === "WPA2_ENTERPRISE" ? wifiUser.trim() : "",
            orgUnitId: activateForm.orgUnitId.trim() || undefined,
          }),
        }
      );

      setActivateSuccess({ deviceKey: res.deviceKey, name: res.device.name });
      setActivateForm(null);
      void loadDevices();
    } catch (e) {
      setActivateError(safeErrorMessage(e));
    } finally {
      setBusyActivate(false);
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return devices;
    return devices.filter((d) =>
      [d.name, d.deviceClass, d.ipAddress, d.firmwareVersion]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [q, devices]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Eszközök</h1>
          <p className="mt-1 text-sm text-white/70">
            Intézményi eszközök listája és kezelése.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <input
            className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-white/20 sm:w-72"
            placeholder="Keresés (név, típus, IP…)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {canWrite && (
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/15"
              onClick={openPending}
            >
              + Új eszköz
            </button>
          )}
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md bg-white/5 px-3 py-2 text-sm font-medium hover:bg-white/10"
            onClick={() => void loadDevices()}
            disabled={loading}
          >
            Frissítés
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {activateSuccess && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 space-y-1">
          <div className="font-medium">✓ Eszköz aktiválva: {activateSuccess.name}</div>
          <div className="text-xs">
            Device key (csak egyszer látható!):{" "}
            <span className="font-mono bg-white/10 px-1 rounded">{activateSuccess.deviceKey}</span>
          </div>
          <button className="text-xs underline opacity-70" onClick={() => setActivateSuccess(null)}>Bezár</button>
        </div>
      )}

      {/* Eszközlista */}
      <div className="rounded-lg border border-white/10 bg-zinc-950">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="text-sm font-semibold">Lista</div>
          <div className="text-xs text-white/60">
            {loading ? "Betöltés..." : `${filtered.length} / ${devices.length} eszköz`}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-white/60">
              <tr className="border-b border-white/10">
                <th className="px-4 py-3">Név</th>
                <th className="px-4 py-3">Típus</th>
                <th className="px-4 py-3">Státusz</th>
                <th className="px-4 py-3">IP cím</th>
                <th className="px-4 py-3">Firmware</th>
                <th className="px-4 py-3">Utolsó aktivitás</th>
                {canWrite && <th className="px-4 py-3 text-right">Műveletek</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {filtered.map((d) => (
                <tr key={d.deviceId} className="hover:bg-white/5">
                  <td className="px-4 py-3 font-medium">{d.name}</td>
                  <td className="px-4 py-3"><DeviceClassBadge cls={d.deviceClass} /></td>
                  <td className="px-4 py-3"><OnlineBadge isOnline={d.isOnline} /></td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {d.ipAddress ?? <span className="text-white/30">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {d.firmwareVersion ?? <span className="text-white/30">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {d.secondsSinceLastSeen !== null && d.secondsSinceLastSeen !== undefined
                      ? `${d.secondsSinceLastSeen}mp`
                      : "—"}
                  </td>
                  {canWrite && (
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="rounded-md bg-red-500/10 px-2 py-1 text-xs font-medium text-red-200 hover:bg-red-500/15"
                        onClick={async () => {
                          if (!window.confirm(`Törlöd? (${d.name})`)) return;
                          try {
                            await apiFetch(`/admin/devices/${d.deviceId}`, { method: "DELETE" });
                            void loadDevices();
                          } catch (e) {
                            setError(safeErrorMessage(e));
                          }
                        }}
                      >
                        Törlés
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-sm text-white/60" colSpan={canWrite ? 7 : 6}>
                    Nincs eszköz.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td className="px-4 py-6 text-center text-sm text-white/60" colSpan={canWrite ? 7 : 6}>
                    Betöltés…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending eszközök modal */}
      {pendingOpen && (
        <Modal title="Aktiválásra váró eszközök" onClose={closePending}>
          <div className="space-y-3">
            <p className="text-sm text-white/60">
              Az alábbi eszközök provisioning módban vannak és várják az aktiválást.
              Az eszköz kijelzőjén ellenőrizd a MAC és IP címet, majd kattints rá.
            </p>
            {pendingLoading && pending.length === 0 && (
              <div className="text-sm text-white/60">Keresés…</div>
            )}
            {!pendingLoading && pending.length === 0 && (
              <div className="rounded-md border border-white/10 bg-white/5 px-3 py-4 text-center text-sm text-white/50">
                Nincs aktiválásra váró eszköz. Győződj meg róla, hogy az ESP32 be van kapcsolva és
                provisioning módban van (szervíz WiFi-n).
              </div>
            )}
            <div className="space-y-2">
              {pending.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-3 text-left hover:bg-white/10 transition-colors"
                  onClick={() => selectPending(p)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-medium">{p.mac}</span>
                    <span className="text-xs text-white/50">
                      Utoljára látva: {formatDateTime(p.lastSeenAt)}
                    </span>
                  </div>
                  <div className="mt-1 flex gap-4 text-xs text-white/50">
                    {p.ipAddress && <span>IP: {p.ipAddress}</span>}
                    {p.firmwareVersion && <span>FW: {p.firmwareVersion}</span>}
                  </div>
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="rounded-md bg-white/5 px-3 py-2 text-sm font-medium hover:bg-white/10"
                onClick={() => void loadPending()}
                disabled={pendingLoading}
              >
                {pendingLoading ? "Frissítés…" : "Frissítés"}
              </button>
              <button
                type="button"
                className="rounded-md bg-white/5 px-3 py-2 text-sm font-medium hover:bg-white/10"
                onClick={closePending}
              >
                Mégse
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Aktiválás modal */}
      {activateForm && (
        <Modal title="Eszköz aktiválása" onClose={() => setActivateForm(null)}>
          <div className="space-y-4">
            <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
              Pending ID: <span className="font-mono">{activateForm.pendingId}</span>
            </div>

            {/* Alapadatok */}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <div className="text-xs text-white/60">Eszköznév *</div>
                <input
                  className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-white/20"
                  placeholder="pl. 14. terem"
                  value={activateForm.name}
                  onChange={(e) => setActivateForm((s) => s ? { ...s, name: e.target.value } : s)}
                />
              </label>
              <label className="space-y-1">
                <div className="text-xs text-white/60">Eszköz osztály *</div>
                <select
                  className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-white/20"
                  value={activateForm.deviceClass}
                  onChange={(e) => setActivateForm((s) => s ? { ...s, deviceClass: e.target.value as DeviceClass } : s)}
                >
                  {DEVICE_CLASS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <div className="text-xs text-white/40">
                  {DEVICE_CLASS_OPTIONS.find((o) => o.value === activateForm.deviceClass)?.description}
                </div>
              </label>
            </div>

            {/* Intézmény – csak SuperAdmin választja, TENANT_ADMIN-nál auto */}
            {isSuperAdmin && (
              <label className="space-y-1">
                <div className="text-xs text-white/60">Intézmény *</div>
                <select
                  className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-white/20"
                  value={activateForm.tenantId}
                  onChange={(e) => setActivateForm((s) => s ? { ...s, tenantId: e.target.value } : s)}
                >
                  <option value="">Válassz intézményt…</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>
            )}

            {/* WiFi konfiguráció */}
            <div className="rounded-md border border-white/10 bg-white/5 p-3 space-y-3">
              <div className="text-xs font-semibold text-white/70 uppercase tracking-wide">WiFi konfiguráció</div>

              {/* SSID + rejtett hálózat */}
              <div className="space-y-1">
                <div className="text-xs text-white/60">WiFi SSID *</div>
                <input
                  className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-white/20"
                  placeholder="pl. Iskola-WiFi"
                  value={activateForm.wifiSsid}
                  onChange={(e) => setActivateForm((s) => s ? { ...s, wifiSsid: e.target.value } : s)}
                />
                <label className="flex items-center gap-2 cursor-pointer mt-1">
                  <input
                    type="checkbox"
                    checked={activateForm.wifiHidden}
                    onChange={(e) => setActivateForm((s) => s ? { ...s, wifiHidden: e.target.checked } : s)}
                    className="rounded"
                  />
                  <span className="text-xs text-white/50">Rejtett hálózat (SSID nem sugárzott)</span>
                </label>
              </div>

              {/* Biztonság típusa */}
              <div className="space-y-1">
                <div className="text-xs text-white/60">WiFi biztonság</div>
                <select
                  className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-white/20"
                  value={activateForm.wifiSecurity}
                  onChange={(e) => setActivateForm((s) => s ? {
                    ...s,
                    wifiSecurity: e.target.value as WifiSecurity,
                    wifiPassword: "",
                    wifiUser: "",
                  } : s)}
                >
                  {WIFI_SECURITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* WPA2/WPA3 Personal: csak jelszó */}
              {(activateForm.wifiSecurity === "WPA2_PERSONAL" || activateForm.wifiSecurity === "WPA3_PERSONAL") && (
                <div className="space-y-1">
                  <div className="text-xs text-white/60">WiFi jelszó *</div>
                  <input
                    type="password"
                    className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-white/20"
                    placeholder="WiFi jelszó"
                    value={activateForm.wifiPassword}
                    onChange={(e) => setActivateForm((s) => s ? { ...s, wifiPassword: e.target.value } : s)}
                  />
                </div>
              )}

              {/* WPA2 Enterprise: felhasználónév + jelszó */}
              {activateForm.wifiSecurity === "WPA2_ENTERPRISE" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <div className="text-xs text-white/60">Bejelentkezési név *</div>
                    <input
                      className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-white/20"
                      placeholder="pl. felhasznalo@iskola.hu"
                      value={activateForm.wifiUser}
                      onChange={(e) => setActivateForm((s) => s ? { ...s, wifiUser: e.target.value } : s)}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-white/60">Jelszó *</div>
                    <input
                      type="password"
                      className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-white/20"
                      placeholder="Jelszó"
                      value={activateForm.wifiPassword}
                      onChange={(e) => setActivateForm((s) => s ? { ...s, wifiPassword: e.target.value } : s)}
                    />
                  </div>
                  <div className="sm:col-span-2 text-xs text-white/40">
                    WPA2 Enterprise (802.1X/PEAP) – tanúsítvány nélküli hitelesítés
                  </div>
                </div>
              )}

              {/* Nyílt hálózat tájékoztató */}
              {activateForm.wifiSecurity === "OPEN" && (
                <div className="text-xs text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1.5">
                  ⚠ Nyílt hálózat – nem javasolt éles környezetben
                </div>
              )}
            </div>

            {activateError && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {activateError}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md bg-white/5 px-3 py-2 text-sm font-medium hover:bg-white/10"
                onClick={() => setActivateForm(null)}
                disabled={busyActivate}
              >
                Mégse
              </button>
              <button
                type="button"
                className="rounded-md bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/15 disabled:opacity-60"
                onClick={() => void submitActivate()}
                disabled={busyActivate}
              >
                {busyActivate ? "Aktiválás…" : "Aktivál"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}