import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";

type DeviceHealth = {
  id: string;
  name: string;
  status: "ONLINE" | "OFFLINE";
  secondsSinceLastSeen: number | null;
};

function StatusPill({ status }: { status: DeviceHealth["status"] }) {
  const cls =
    status === "ONLINE"
      ? "bg-green-100 text-green-800 border-green-200"
      : "bg-red-100 text-red-800 border-red-200";

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${cls}`}>
      {status}
    </span>
  );
}

function fmtLastSeen(seconds: number | null) {
  if (seconds === null) return "never";
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export default function Devices() {
  const [items, setItems] = useState<DeviceHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const onlineCount = useMemo(
    () => items.filter(i => i.status === "ONLINE").length,
    [items]
  );

  async function load() {
    setLoading(true);
    setErr(null);

    try {
      const data = await apiFetch<DeviceHealth[]>("/admin/devices/health");

      // ONLINE elöl, utána név szerint
      data.sort((a, b) => {
        if (a.status !== b.status) return a.status === "ONLINE" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      setItems(data);
    } catch (e: any) {
      setErr(e?.message || "Failed to load devices");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 10000); // 10 mp frissítés
    return () => clearInterval(t);
  }, []);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Devices</h1>
          <p className="text-sm text-gray-600">
            {loading ? "Loading…" : `${onlineCount}/${items.length} online`}
          </p>
        </div>

        <button
          onClick={load}
          className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {err}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-600">Loading device health…</div>
      ) : items.length === 0 ? (
        <div className="rounded-md border p-6 text-sm text-gray-700">
          Nincs aktivált eszköz.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {items.map(d => (
                <tr key={d.id} className="border-t">
                  <td className="px-4 py-3 font-medium">{d.name}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={d.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {fmtLastSeen(d.secondsSinceLastSeen)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}