import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { login } from "../lib/auth";
import { useAuth } from "../auth/AuthContext";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const nav = useNavigate();
  const loc = useLocation();
  const { setToken } = useAuth();

  const from = (loc.state as any)?.from ?? "/app/devices";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await login(email, password);
      await setToken(res.accessToken, remember);
      nav(from, { replace: true });
    } catch (e: any) {
      setErr(e?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 420 }}>
      <h1>Bejelentkezés</h1>

      <form onSubmit={onSubmit}>
        <label>Email</label>
        <input
          style={{ width: "100%", padding: 8, margin: "6px 0 12px" }}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
        />

        <label>Jelszó</label>
        <input
          type="password"
          style={{ width: "100%", padding: 8, margin: "6px 0 12px" }}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />

        <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Emlékezz rám (adminnál úgysem marad)
        </label>

        {err && <div style={{ color: "crimson", marginBottom: 12 }}>{err}</div>}

        <button style={{ padding: "8px 12px" }} disabled={busy}>
          {busy ? "Beléptetés..." : "Belépés"}
        </button>
      </form>
    </div>
  );
}