import { useEffect, useState } from "react";
import { apiFetch } from "./lib/api";

type Health = { ok: boolean; time?: string; version?: string };

export default function App() {
  const [data, setData] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const apiBase =
    import.meta.env.VITE_API_BASE_URL ??
    import.meta.env.VITE_API_BASE ??
    "";

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch<Health>("/health", { method: "GET" });
        setData(res);
      } catch (e: any) {
        setErr(e?.message ?? "API error");
      }
    })();
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h1>SchoolLive Frontend (MVP)</h1>

      <p>
        API:{" "}
        {apiBase ? (
          <code>{apiBase}</code>
        ) : (
          <span style={{ color: "crimson" }}>
            NINCS beállítva (VITE_API_BASE_URL)
          </span>
        )}
      </p>

      {err && <pre style={{ color: "crimson" }}>{err}</pre>}
      {data && <pre>{JSON.stringify(data, null, 2)}</pre>}

      {!err && !data && <p>Loading…</p>}
    </div>
  );
}