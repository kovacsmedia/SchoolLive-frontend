import { useState } from "react";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 420 }}>
      <h1>Bejelentkezés</h1>

      <label>Felhasználónév</label>
      <input
        style={{ width: "100%", padding: 8, margin: "6px 0 12px" }}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />

      <label>Jelszó</label>
      <input
        type="password"
        style={{ width: "100%", padding: 8, margin: "6px 0 12px" }}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <button style={{ padding: "8px 12px" }} disabled>
        (Következő lépésben kötjük be az API-t)
      </button>
    </div>
  );
}