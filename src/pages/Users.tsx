import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

type UserItem = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  tenantId?: string | null;
};

type UsersResponse = {
  ok: true;
  users: UserItem[];
};

export default function Users() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  function handleAuthFailure(e: any) {
    if (e?.status === 401) {
      console.error("Auth failure on /admin/users:", e);
      logout();
      navigate("/login", { replace: true });
      return true;
    }
    return false;
  }

  async function loadUsers() {
    try {
      setErr(null);
      const res = await apiFetch<UsersResponse>("/admin/users");
      setUsers(Array.isArray(res.users) ? res.users : []);
      setLoading(false);
    } catch (e: any) {
      if (handleAuthFailure(e)) return;

      console.error("Users load error:", e);
      setLoading(false);
      setErr(e?.data?.error ?? e?.message ?? "Failed to load users");
    }
  }

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
        Felhasználók
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
      ) : users.length === 0 ? (
        <div>Nincs felhasználó ebben a tenantban.</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {users.map((u) => (
            <div
              key={u.id}
              style={{
                border: "1px solid var(--sl-border)",
                borderRadius: 14,
                padding: 14,
                display: "grid",
                gap: 6,
                background: "rgba(127,127,127,0.04)",
              }}
            >
              <div style={{ fontWeight: 700 }}>
                {u.name || "Név nincs megadva"}
              </div>

              <div style={{ fontSize: 13, opacity: 0.85 }}>
                {u.email || "Email nincs megadva"}
              </div>

              <div
                style={{
                  fontSize: 12,
                  padding: "4px 8px",
                  borderRadius: 999,
                  display: "inline-block",
                  width: "fit-content",
                  border: "1px solid var(--sl-border)",
                  background: "rgba(127,127,127,0.08)",
                }}
              >
                {u.role || "—"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}