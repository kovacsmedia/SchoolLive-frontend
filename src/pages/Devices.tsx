// src/pages/Devices.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, apiPost } from "../lib/api";

type DeviceHealthItem = {
  deviceId: string;
  name?: string | null;
  lastSeenAt?: string | null; // ISO
  isOnline: boolean;
  [k: string]: any;
};

type HealthResponseLoose = {
  ok: true;
  // különböző verziók / backend implementációk miatt:
  devices?: DeviceHealthItem[];
  rows?: DeviceHealthItem[];
  items?: DeviceHealthItem[];
  data?: DeviceHealthItem[];
  count?: number;
  total?: number;
  totalRegistered?: number;
};

type CreateCommandResponse = {
  ok: true;
  command: {
    id: string;
    tenantId: string;
    deviceId: string;
    status: "QUEUED" | "SENT" | "ACKED" | "FAILED" | "CANCELLED" | string;
    queuedAt?: string | null;
    sentAt?: string | null;
    ackedAt?: string | null;
    payload?: any;
  };
};

type GetCommandResponse = {
  ok: true;
  command: {
    id: string;
    tenantId: string;
    deviceId: string;
    status: "QUEUED" | "SENT" | "ACKED" | "FAILED" | "CANCELLED" | string;
    queuedAt?: string | null;
    sentAt?: string | null;
    ackedAt?: string | null;
    payload?: any;
    error?: string | null;
    lastError?: string | null;
    retryCount?: number;
    maxRetries?: number;
  };
};

function statusBadgeStyle(status: string): React.CSSProperties {
  switch (status) {
    case "ACKED":
      return { background: "#d1e7dd", borderColor: "#badbcc", color: "#0f5132" };
    case "SENT":
      return { background: "#cfe2ff", borderColor: "#b6d4fe", color: "#084298" };
    case "QUEUED":
      return { background: "#fff3cd", borderColor: "#ffecb5", color: "#664d03" };
    case "FAILED":
      return { background: "#f8d7da", borderColor: "#f5c2c7", color: "#842029" };
    default:
      return { background: "#e2e3e5", borderColor: "#d3d6d8", color: "#41464b" };
  }
}

function isTerminalStatus(status: string): boolean {
  return status === "ACKED" || status === "FAILED" || status === "CANCELLED";
}

function normalizeDevices(resp: HealthResponseLoose): DeviceHealthItem[] {
  const candidates = [
    resp.devices,
    resp.rows,
    resp.items,
    resp.data,
  ].find((x) => Array.isArray(x));

  return (candidates as DeviceHealthItem[] | undefined) ?? [];
}

export default function Devices() {
  const [devices, setDevices] = useState<DeviceHealthItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // ha a backend külön ad "összes regisztrált eszköz" számot, itt el tudjuk tenni
  const [registeredCount, setRegisteredCount] = useState<number | null>(null);

  // per-device volume input
  const [volumeByDevice, setVolumeByDevice] = useState<Record<string, number>>(
    {}
  );

  // per-device command status UI
  const [cmdByDevice, setCmdByDevice] = useState<
    Record<
      string,
      {
        commandId: string;
        status: string;
        error?: string | null;
        lastError?: string | null;
      }
    >
  >({});

  const healthTimer = useRef<number | null>(null);
  const cmdTimers = useRef<Record<string, number>>({});

  async function loadHealth() {
    try {
      setErr(null);

      // Lazább típus: prod/stage eltérés ellen véd
      const data = await apiFetch<HealthResponseLoose>("/admin/devices/health");

      const list = normalizeDevices(data);
      setDevices(list);

      // próbáljuk meg okosan “regisztrált db”-ként kiírni,
      // de ha nincs ilyen adat, akkor a list hosszát használjuk.
      const rc =
        typeof data.totalRegistered === "number"
          ? data.totalRegistered
          : typeof data.total === "number"
            ? data.total
            : typeof data.count === "number"
              ? data.count
              : null;

      setRegisteredCount(rc);

      setLoading(false);
    } catch (e: any) {
      setLoading(false);
      setErr(e?.data?.error ?? e?.message ?? "Failed to load devices");
    }
  }

  useEffect(() => {
    loadHealth();
    healthTimer.current = window.setInterval(loadHealth, 10_000);
    return () => {
      if (healthTimer.current) window.clearInterval(healthTimer.current);
      Object.values(cmdTimers.current).forEach((t) => window.clearInterval(t));
      cmdTimers.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deviceRows = useMemo(() => {
    return devices.map((d) => {
      const v =
        volumeByDevice[d.deviceId] ??
        (typeof d.volume === "number" ? d.volume : 5);
      const cmd = cmdByDevice[d.deviceId];
      return { d, v, cmd };
    });
  }, [devices, volumeByDevice, cmdByDevice]);

  async function pollCommand(deviceId: string, commandId: string) {
    try {
      const data = await apiFetch<GetCommandResponse>(
        `/admin/commands/${commandId}`
      );
      const status = data.command.status;

      setCmdByDevice((prev) => ({
        ...prev,
        [deviceId]: {
          commandId,
          status,
          error: data.command.error ?? null,
          lastError: data.command.lastError ?? null,
        },
      }));

      if (isTerminalStatus(status)) {
        const t = cmdTimers.current[deviceId];
        if (t) window.clearInterval(t);
        delete cmdTimers.current[deviceId];
      }
    } catch (e: any) {
      setCmdByDevice((prev) => ({
        ...prev,
        [deviceId]: {
          commandId,
          status: "FAILED",
          error: e?.data?.error ?? e?.message ?? "Polling failed",
          lastError: e?.data?.details ?? null,
        },
      }));
      const t = cmdTimers.current[deviceId];
      if (t) window.clearInterval(t);
      delete cmdTimers.current[deviceId];
    }
  }

  function startPolling(deviceId: string, commandId: string) {
    const existing = cmdTimers.current[deviceId];
    if (existing) window.clearInterval(existing);

    pollCommand(deviceId, commandId);

    cmdTimers.current[deviceId] = window.setInterval(() => {
      pollCommand(deviceId, commandId);
    }, 2000);
  }

  async function sendSetVolume(deviceId: string) {
    const volume = volumeByDevice[deviceId];
    if (typeof volume !== "number" || volume < 0 || volume > 10) {
      setErr("Volume must be between 0 and 10");
      return;
    }

    try {
      setErr(null);

      const res = await apiPost<CreateCommandResponse>("/admin/commands", {
        deviceId,
        type: "SET_VOLUME",
        payload: { volume },
      });

      const cmd = res.command;

      setCmdByDevice((prev) => ({
        ...prev,
        [deviceId]: { commandId: cmd.id, status: cmd.status },
      }));

      startPolling(deviceId, cmd.id);
    } catch (e: any) {
      // UX: ha 409 conflict (van aktív command), próbáljunk ráállni annak a commandId-jára pollolni
      const status = e?.status;
      const data = e?.data;
      if (status === 409 && data?.active?.id && data?.active?.status) {
        const existingId = data.active.id as string;
        const existingStatus = data.active.status as string;
        setCmdByDevice((prev) => ({
          ...prev,
          [deviceId]: { commandId: existingId, status: existingStatus },
        }));
        startPolling(deviceId, existingId);
        return;
      }

      setErr(e?.data?.error ?? e?.message ?? "Failed to send command");
    }
  }

  const shownRegisteredCount =
    registeredCount !== null ? registeredCount : devices.length;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Devices</h1>
        <span style={{ fontSize: 13, opacity: 0.75 }}>
          {shownRegisteredCount} regisztrált eszköz
        </span>
      </div>

      {err && (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            border: "1px solid #f5c2c7",
            background: "#f8d7da",
            borderRadius: 8,
          }}
        >
          {err}
        </div>
      )}

      {loading ? (
        <div>Loading…</div>
      ) : deviceRows.length === 0 ? (
        <div
          style={{
            border: "1px dashed #cbd5e1",
            borderRadius: 12,
            padding: 16,
            background: "#f8fafc",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>0 regisztrált eszköz</div>
          <div style={{ fontSize: 13, opacity: 0.8 }}>
            Ha ez nem stimmel, akkor valószínűleg a <code>/admin/devices/health</code> válaszában
            más kulcs alatt jön a lista (pl. <code>rows</code>/<code>items</code>).
            A mostani kód ezeket is kezeli, szóval ha továbbra is üres, akkor tényleg nincs device a tenantban.
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {deviceRows.map(({ d, v, cmd }) => (
            <div
              key={d.deviceId}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 12,
                display: "grid",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontWeight: 700 }}>
                    {d.name ?? d.deviceId}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    Last seen: {d.lastSeenAt ?? "—"}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      padding: "4px 8px",
                      borderRadius: 999,
                      border: "1px solid",
                      fontSize: 12,
                      background: d.isOnline ? "#d1e7dd" : "#f8d7da",
                      borderColor: d.isOnline ? "#badbcc" : "#f5c2c7",
                      color: d.isOnline ? "#0f5132" : "#842029",
                    }}
                  >
                    {d.isOnline ? "ONLINE" : "OFFLINE"}
                  </span>

                  {cmd && (
                    <span
                      style={{
                        padding: "4px 8px",
                        borderRadius: 999,
                        border: "1px solid",
                        fontSize: 12,
                        ...statusBadgeStyle(cmd.status),
                      }}
                      title={cmd.commandId}
                    >
                      {cmd.status}
                    </span>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <label style={{ fontSize: 12, opacity: 0.8 }}>
                    Volume (0–10)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={1}
                    value={v}
                    onChange={(e) =>
                      setVolumeByDevice((prev) => ({
                        ...prev,
                        [d.deviceId]: Number(e.target.value),
                      }))
                    }
                    style={{
                      width: 90,
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: "1px solid #e5e7eb",
                    }}
                  />
                </div>

                <button
                  onClick={() => sendSetVolume(d.deviceId)}
                  disabled={!d.isOnline}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid #e5e7eb",
                    background: d.isOnline ? "white" : "#f3f4f6",
                    cursor: d.isOnline ? "pointer" : "not-allowed",
                    fontWeight: 600,
                  }}
                  title={!d.isOnline ? "Device is offline" : "Send SET_VOLUME"}
                >
                  Set volume
                </button>

                {cmd?.error && (
                  <div style={{ fontSize: 12, color: "#b91c1c" }}>
                    {cmd.error}
                  </div>
                )}
              </div>

              {cmd?.lastError && (
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  lastError: {String(cmd.lastError)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}