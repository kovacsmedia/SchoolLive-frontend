// src/pages/Devices.tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, apiPost } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

type DeviceHealthItem = {
  deviceId: string;
  name?: string | null;
  lastSeenAt?: string | null;
  isOnline: boolean;
  [k: string]: any;
};

type HealthResponseLoose = {
  ok: true;
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
    status: string;
  };
};

type GetCommandResponse = {
  ok: true;
  command: {
    id: string;
    tenantId: string;
    deviceId: string;
    status: string;
    error?: string | null;
    lastError?: string | null;
  };
};

function normalizeDevices(resp: HealthResponseLoose): DeviceHealthItem[] {
  const candidates = [resp.devices, resp.rows, resp.items, resp.data].find((x) =>
    Array.isArray(x)
  );

  return (candidates as DeviceHealthItem[] | undefined) ?? [];
}

function isTerminalStatus(status: string): boolean {
  return status === "ACKED" || status === "FAILED" || status === "CANCELLED";
}

export default function Devices() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [devices, setDevices] = useState<DeviceHealthItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [registeredCount, setRegisteredCount] = useState<number | null>(null);

  const [volumeByDevice, setVolumeByDevice] = useState<Record<string, number>>(
    {}
  );
  const [cmdByDevice, setCmdByDevice] = useState<
    Record<string, { commandId: string; status: string; error?: string | null }>
  >({});

  const healthTimer = useRef<number | null>(null);
  const cmdTimers = useRef<Record<string, number>>({});

  function handleAuthFailure(e: any) {
    if (e?.status === 401) {
      console.error("Auth failure on /devices:", e);
      logout();
      navigate("/login", { replace: true });
      return true;
    }
    return false;
  }

  async function loadHealth() {
    try {
      setErr(null);

      const data = await apiFetch<HealthResponseLoose>("/admin/devices/health");

      const list = normalizeDevices(data);
      setDevices(list);

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
      if (handleAuthFailure(e)) return;

      console.error("Device load error:", e);
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
        },
      }));

      if (isTerminalStatus(status)) {
        const t = cmdTimers.current[deviceId];
        if (t) window.clearInterval(t);
        delete cmdTimers.current[deviceId];
      }
    } catch (e: any) {
      if (handleAuthFailure(e)) return;

      setCmdByDevice((prev) => ({
        ...prev,
        [deviceId]: {
          commandId,
          status: "FAILED",
          error: e?.data?.error ?? e?.message ?? "Polling failed",
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
      if (handleAuthFailure(e)) return;

      console.error("Send command error:", e);
      setErr(e?.data?.error ?? e?.message ?? "Failed to send command");
    }
  }

  const shownRegisteredCount =
    registeredCount !== null ? registeredCount : devices.length;

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
        Devices ({shownRegisteredCount})
      </h1>

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
      ) : devices.length === 0 ? (
        <div>No devices found in this tenant.</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {devices.map((d) => (
            <div
              key={d.deviceId}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 12,
              }}
            >
              <div style={{ fontWeight: 700 }}>{d.name ?? d.deviceId}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                {d.isOnline ? "ONLINE" : "OFFLINE"}
              </div>

              <div style={{ marginTop: 8 }}>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={volumeByDevice[d.deviceId] ?? 5}
                  onChange={(e) =>
                    setVolumeByDevice((prev) => ({
                      ...prev,
                      [d.deviceId]: Number(e.target.value),
                    }))
                  }
                />
                <button
                  onClick={() => sendSetVolume(d.deviceId)}
                  disabled={!d.isOnline}
                  style={{ marginLeft: 8 }}
                >
                  Set volume
                </button>
              </div>

              {cmdByDevice[d.deviceId]?.status && (
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  Command status: {cmdByDevice[d.deviceId].status}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}