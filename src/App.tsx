import { useEffect, useState } from "react";
import { apiFetch } from "./lib/api";

type Health = { ok: boolean; time?: string; version?: string };

export default function App() {
  const [data, setData] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // állítsd majd arra az endpoint-ra, ami nálatok létezik
        // pl. /health, /status, /version
        const res = await apiFetch<Health>("/health", { method: "GET" });
        setData(res);
      } catch (e: any) {
        setErr(e?.message ?? "API error");
      }
    })();
  }, []);

  return (
    <div style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>SchoolLive Frontend (MVP)</h1>
      <p>API: {import.meta.env.VITE_API_BASE_URL</p>

      {err && <pre style={{ color: "crimson" }}>{err}</pre>}
      {data && <pre>{JSON.stringify(data, null, 2)}</pre>}

      {!err && !data && <p>Loading…</p>}
    </div>
  );
}