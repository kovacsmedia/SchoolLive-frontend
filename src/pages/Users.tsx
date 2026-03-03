import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";

type BackendRole =
  | "SUPER_ADMIN"
  | "TENANT_ADMIN"
  | "ORG_ADMIN"
  | "TEACHER"
  | "OPERATOR"
  | "PLAYER"
  | string;

type UiRole = "ADMIN" | "EDITOR" | "CONTRIBUTOR" | "PLAYER";

type UserDto = {
  id: string;
  email: string;
  name?: string | null;
  role: BackendRole;

  // A backendedben lehet, hogy ezek más néven vannak.
  // Az UI mindkettőt támogatja; ha nincs, "-" jelenik meg.
  lastLoginAt?: string | null;
  lastSeenAt?: string | null;

  createdAt?: string;
  updatedAt?: string;
};

type UserMessageDto = {
  id: string;
  createdAt?: string;
  type?: string;
  title?: string;
  body?: string;
  status?: string;
};

type ApiErrorShape = {
  message?: string;
  error?: string;
};

const API = {
  USERS_LIST: "/admin/users",
  USERS_CREATE: "/admin/users",
  USERS_UPDATE: (userId: string) => `/admin/users/${encodeURIComponent(userId)}`,
  USERS_DELETE: (userId: string) => `/admin/users/${encodeURIComponent(userId)}`,

  // Nem ismert a backend végpont – itt egy helyen állítható.
  USER_MESSAGES: (userId: string) => `/admin/users/${encodeURIComponent(userId)}/messages`,
} as const;

/**
 * UI üzleti szerepkör → backend role mapping.
 * Ezt a mappinget a backend valós szerepköreihez igazítsd.
 *
 * Jelen kontextusban biztos backend role-ok: SUPER_ADMIN, TENANT_ADMIN, ORG_ADMIN, TEACHER, OPERATOR, PLAYER.
 * A kérésedben “admin/szerkesztő/közreműködő/player” van, ezért ezt külön UI szintként kezeljük.
 */
const UI_ROLE_OPTIONS: Array<{
  uiRole: UiRole;
  label: string;
  description: string;
  // A backend role érték, amit elküldünk a create/update kérésekben.
  // Alapeset: ADMIN → TENANT_ADMIN, EDITOR → ORG_ADMIN, CONTRIBUTOR → TEACHER, PLAYER → PLAYER
  backendRole: BackendRole;
}> = [
  {
    uiRole: "ADMIN",
    label: "Admin",
    description:
      "Tenant szintű admin: csak a saját intézményét látja, és mindent megtehet a lenti szerepkörökön felül.",
    backendRole: "TENANT_ADMIN",
  },
  {
    uiRole: "EDITOR",
    label: "Szerkesztő",
    description:
      "Módosíthatja az időzített rendszeres jelzéseket (csengetések), üzenetet küldhet eszközökre/csoportokra, időzített zenelejátszási listát készíthet.",
    backendRole: "ORG_ADMIN",
  },
  {
    uiRole: "CONTRIBUTOR",
    label: "Közreműködő",
    description:
      "Csak azonnali vagy időzített üzeneteket küldhet kiválasztott eszközökre/csoportokba, illetve nézetekhez fér hozzá.",
    backendRole: "TEACHER",
  },
  {
    uiRole: "PLAYER",
    label: "Player",
    description:
      "Ezzel belépve az eszköz Player oldalt használ (virtuális lejátszó). Az ilyen belépéssel használt eszközt eszközként is monitorozni kell.",
    backendRole: "PLAYER",
  },
];

function formatDateTime(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("hu-HU");
}

function getLastLogin(u: UserDto): string | null {
  // támogatjuk mindkét lehetséges mezőt
  return u.lastLoginAt ?? u.lastSeenAt ?? null;
}

function safeErrorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const anyE = e as { message?: string; status?: number; data?: unknown };
    if (anyE?.message) return anyE.message;
    if (anyE?.data && typeof anyE.data === "object") {
      const d = anyE.data as ApiErrorShape;
      if (d.message) return d.message;
      if (d.error) return d.error;
    }
    if (typeof anyE?.status === "number") return `HTTP ${anyE.status}`;
  }
  return "Ismeretlen hiba";
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  // apiFetch wrapper: feltételezzük, hogy az apiFetch dob hibát nem-2xx esetén
  return apiFetch<T>(path, init);
}

function RoleBadge({ role }: { role: BackendRole }) {
  const text =
    role === "TENANT_ADMIN"
      ? "TENANT_ADMIN"
      : role === "ORG_ADMIN"
        ? "ORG_ADMIN"
        : role === "TEACHER"
          ? "TEACHER"
          : role === "OPERATOR"
            ? "OPERATOR"
            : role === "PLAYER"
              ? "PLAYER"
              : role === "SUPER_ADMIN"
                ? "SUPER_ADMIN"
                : role;

  const cls =
    role === "TENANT_ADMIN"
      ? "bg-blue-600/20 text-blue-200 border-blue-500/30"
      : role === "ORG_ADMIN"
        ? "bg-emerald-600/20 text-emerald-200 border-emerald-500/30"
        : role === "TEACHER"
          ? "bg-amber-600/20 text-amber-200 border-amber-500/30"
          : role === "OPERATOR"
            ? "bg-purple-600/20 text-purple-200 border-purple-500/30"
            : role === "PLAYER"
              ? "bg-slate-600/20 text-slate-200 border-slate-500/30"
              : "bg-gray-600/20 text-gray-200 border-gray-500/30";

  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {text}
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
      <div className="w-full max-w-2xl rounded-lg border border-white/10 bg-zinc-950 shadow-xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="text-sm font-semibold">{title}</div>
          <button
            className="rounded-md px-2 py-1 text-sm hover:bg-white/10"
            type="button"
            onClick={onClose}
            aria-label="Bezárás"
            title="Bezárás"
          >
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

type UserFormState = {
  email: string;
  name: string;
  uiRole: UiRole;
  password: string; // csak create esetén kötelező (UI szinten)
};

function uiRoleToBackendRole(uiRole: UiRole): BackendRole {
  const found = UI_ROLE_OPTIONS.find((x) => x.uiRole === uiRole);
  return found?.backendRole ?? "TEACHER";
}

function guessUiRoleFromBackendRole(role: BackendRole): UiRole {
  if (role === "TENANT_ADMIN") return "ADMIN";
  if (role === "ORG_ADMIN") return "EDITOR";
  if (role === "PLAYER") return "PLAYER";
  // TEACHER / OPERATOR / ismeretlen → CONTRIBUTOR (később finomítható)
  return "CONTRIBUTOR";
}

export default function Users() {
  const [loading, setLoading] = useState<boolean>(false);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState<string>("");

  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [isEditOpen, setIsEditOpen] = useState<boolean>(false);
  const [isMessagesOpen, setIsMessagesOpen] = useState<boolean>(false);

  const [selectedUser, setSelectedUser] = useState<UserDto | null>(null);

  const [form, setForm] = useState<UserFormState>({
    email: "",
    name: "",
    uiRole: "CONTRIBUTOR",
    password: "",
  });

  const [busyAction, setBusyAction] = useState<null | "create" | "update" | "delete" | "messages">(null);

  const [messagesLoading, setMessagesLoading] = useState<boolean>(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [messages, setMessages] = useState<UserMessageDto[]>([]);

  async function loadUsers() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<UserDto[]>(API.USERS_LIST);
      setUsers(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(safeErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return users;

    return users.filter((u) => {
      const parts = [
        u.email ?? "",
        u.name ?? "",
        u.role ?? "",
        u.id ?? "",
        getLastLogin(u) ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return parts.includes(needle);
    });
  }, [q, users]);

  function openCreate() {
    setSelectedUser(null);
    setForm({ email: "", name: "", uiRole: "CONTRIBUTOR", password: "" });
    setIsCreateOpen(true);
  }

  function openEdit(u: UserDto) {
    setSelectedUser(u);
    setForm({
      email: u.email ?? "",
      name: u.name ?? "",
      uiRole: guessUiRoleFromBackendRole(u.role),
      password: "",
    });
    setIsEditOpen(true);
  }

  async function submitCreate() {
    setError(null);
    if (!form.email.trim()) {
      setError("E-mail megadása kötelező.");
      return;
    }
    if (!form.password.trim()) {
      setError("Jelszó megadása kötelező új felhasználó létrehozásához.");
      return;
    }

    setBusyAction("create");
    try {
      const payload = {
        email: form.email.trim(),
        name: form.name.trim() || null,
        role: uiRoleToBackendRole(form.uiRole),
        password: form.password,
      };

      // NOTE: Ha a backend más payloadot vár, itt kell igazítani.
      await apiRequest<unknown>(API.USERS_CREATE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      setIsCreateOpen(false);
      await loadUsers();
    } catch (e) {
      setError(
        [
          "Nem sikerült létrehozni a felhasználót.",
          safeErrorMessage(e),
          "Ha 404/405 a hiba: a backend create endpoint/method még nincs bekötve. Az endpointok a Users.tsx tetején, az API konstansban állíthatók.",
        ].join(" "),
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function submitUpdate() {
    if (!selectedUser) return;

    setError(null);
    if (!form.email.trim()) {
      setError("E-mail megadása kötelező.");
      return;
    }

    setBusyAction("update");
    try {
      const payload = {
        email: form.email.trim(),
        name: form.name.trim() || null,
        role: uiRoleToBackendRole(form.uiRole),
        // jelszó változtatás: csak ha megadták
        ...(form.password.trim() ? { password: form.password } : {}),
      };

      // NOTE: PATCH vs PUT kérdés. Ha a backend PUT-ot használ, itt át kell írni.
      await apiRequest<unknown>(API.USERS_UPDATE(selectedUser.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      setIsEditOpen(false);
      setSelectedUser(null);
      await loadUsers();
    } catch (e) {
      setError(
        [
          "Nem sikerült módosítani a felhasználót.",
          safeErrorMessage(e),
          "Ha 404/405 a hiba: a backend update endpoint/method még nincs bekötve. Az endpointok a Users.tsx tetején, az API konstansban állíthatók.",
        ].join(" "),
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function doDelete(u: UserDto) {
    const ok = window.confirm(`Biztos törlöd? (${u.email})`);
    if (!ok) return;

    setError(null);
    setBusyAction("delete");
    try {
      await apiRequest<unknown>(API.USERS_DELETE(u.id), { method: "DELETE" });
      await loadUsers();
    } catch (e) {
      setError(
        [
          "Nem sikerült törölni a felhasználót.",
          safeErrorMessage(e),
          "Ha 404/405 a hiba: a backend delete endpoint/method még nincs bekötve. Az endpointok a Users.tsx tetején, az API konstansban állíthatók.",
        ].join(" "),
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function openMessages(u: UserDto) {
    setSelectedUser(u);
    setMessages([]);
    setMessagesError(null);
    setIsMessagesOpen(true);

    setMessagesLoading(true);
    setBusyAction("messages");
    try {
      const data = await apiRequest<UserMessageDto[]>(API.USER_MESSAGES(u.id));
      setMessages(Array.isArray(data) ? data : []);
    } catch (e) {
      setMessagesError(
        [
          "Nem sikerült betölteni a felhasználó üzeneteit.",
          safeErrorMessage(e),
          "Valószínűleg a messages endpoint még nincs implementálva vagy más útvonalon van. Állítsd a Users.tsx tetején: API.USER_MESSAGES",
        ].join(" "),
      );
    } finally {
      setMessagesLoading(false);
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Felhasználók</h1>
          <p className="mt-1 text-sm text-white/70">
            Tenant-szintű felhasználók listája. Keresés, létrehozás, módosítás, törlés, és felhasználóhoz tartozó üzenetek megtekintése.
          </p>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <input
            className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-white/20 sm:w-80"
            placeholder="Keresés (email, név, role, id, last login)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/15 disabled:opacity-60"
            onClick={openCreate}
            disabled={loading}
            title="Új felhasználó"
          >
            + Új
          </button>

          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md bg-white/5 px-3 py-2 text-sm font-medium hover:bg-white/10 disabled:opacity-60"
            onClick={() => void loadUsers()}
            disabled={loading}
            title="Frissítés"
          >
            Frissítés
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
      ) : null}

      <div className="rounded-lg border border-white/10 bg-zinc-950">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="text-sm font-semibold">Lista</div>
          <div className="text-xs text-white/60">
            {loading ? "Betöltés..." : `${filtered.length} / ${users.length} felhasználó`}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-white/60">
              <tr className="border-b border-white/10">
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Név</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Utolsó belépés</th>
                <th className="px-4 py-3 text-right">Műveletek</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-white/10">
              {filtered.map((u) => (
                <tr key={u.id} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    <div className="font-medium">{u.email}</div>
                    <div className="text-xs text-white/50">{u.id}</div>
                  </td>
                  <td className="px-4 py-3">{u.name ? u.name : <span className="text-white/40">—</span>}</td>
                  <td className="px-4 py-3">
                    <RoleBadge role={u.role} />
                  </td>
                  <td className="px-4 py-3">{formatDateTime(getLastLogin(u))}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="rounded-md bg-white/5 px-2 py-1 text-xs font-medium hover:bg-white/10 disabled:opacity-60"
                        onClick={() => void openMessages(u)}
                        disabled={busyAction === "messages"}
                        title="Üzenetek"
                      >
                        Üzenetek
                      </button>

                      <button
                        type="button"
                        className="rounded-md bg-white/5 px-2 py-1 text-xs font-medium hover:bg-white/10 disabled:opacity-60"
                        onClick={() => openEdit(u)}
                        disabled={busyAction === "update" || busyAction === "delete"}
                        title="Szerkesztés"
                      >
                        Szerkeszt
                      </button>

                      <button
                        type="button"
                        className="rounded-md bg-red-500/10 px-2 py-1 text-xs font-medium text-red-200 hover:bg-red-500/15 disabled:opacity-60"
                        onClick={() => void doDelete(u)}
                        disabled={busyAction === "delete"}
                        title="Törlés"
                      >
                        Töröl
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {!loading && filtered.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-sm text-white/60" colSpan={5}>
                    Nincs találat.
                  </td>
                </tr>
              ) : null}

              {loading ? (
                <tr>
                  <td className="px-4 py-6 text-center text-sm text-white/60" colSpan={5}>
                    Betöltés…
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create modal */}
      {isCreateOpen ? (
        <Modal title="Új felhasználó" onClose={() => setIsCreateOpen(false)}>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <div className="text-xs text-white/60">E-mail</div>
                <input
                  className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-white/20"
                  value={form.email}
                  onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
                />
              </label>

              <label className="space-y-1">
                <div className="text-xs text-white/60">Név (opcionális)</div>
                <input
                  className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-white/20"
                  value={form.name}
                  onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                />
              </label>
            </div>

            <label className="space-y-1">
              <div className="text-xs text-white/60">Szerepkör</div>
              <select
                className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-white/20"
                value={form.uiRole}
                onChange={(e) => setForm((s) => ({ ...s, uiRole: e.target.value as UiRole }))}
              >
                {UI_ROLE_OPTIONS.map((r) => (
                  <option key={r.uiRole} value={r.uiRole}>
                    {r.label}
                  </option>
                ))}
              </select>
              <div className="text-xs text-white/50">
                {UI_ROLE_OPTIONS.find((r) => r.uiRole === form.uiRole)?.description ?? ""}
              </div>
              <div className="text-xs text-white/40">
                Backend role küldése: <span className="font-mono">{uiRoleToBackendRole(form.uiRole)}</span>
              </div>
            </label>

            <label className="space-y-1">
              <div className="text-xs text-white/60">Jelszó</div>
              <input
                type="password"
                className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-white/20"
                value={form.password}
                onChange={(e) => setForm((s) => ({ ...s, password: e.target.value }))}
              />
              <div className="text-xs text-white/50">Új felhasználónál kötelező.</div>
            </label>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-md bg-white/5 px-3 py-2 text-sm font-medium hover:bg-white/10"
                onClick={() => setIsCreateOpen(false)}
                disabled={busyAction === "create"}
              >
                Mégse
              </button>
              <button
                type="button"
                className="rounded-md bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/15 disabled:opacity-60"
                onClick={() => void submitCreate()}
                disabled={busyAction === "create"}
              >
                {busyAction === "create" ? "Létrehozás…" : "Létrehoz"}
              </button>
            </div>

            <div className="rounded-md border border-white/10 bg-white/5 p-3 text-xs text-white/70">
              <div className="font-semibold">Megjegyzés (backend integráció)</div>
              <div className="mt-1">
                A create hívás alapértelmezetten: <span className="font-mono">POST {API.USERS_CREATE}</span>
                <br />
                Payload: <span className="font-mono">{`{ email, name, role, password }`}</span>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* Edit modal */}
      {isEditOpen && selectedUser ? (
        <Modal title={`Felhasználó szerkesztése: ${selectedUser.email}`} onClose={() => setIsEditOpen(false)}>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <div className="text-xs text-white/60">E-mail</div>
                <input
                  className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-white/20"
                  value={form.email}
                  onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
                />
              </label>

              <label className="space-y-1">
                <div className="text-xs text-white/60">Név (opcionális)</div>
                <input
                  className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-white/20"
                  value={form.name}
                  onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                />
              </label>
            </div>

            <label className="space-y-1">
              <div className="text-xs text-white/60">Szerepkör</div>
              <select
                className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-white/20"
                value={form.uiRole}
                onChange={(e) => setForm((s) => ({ ...s, uiRole: e.target.value as UiRole }))}
              >
                {UI_ROLE_OPTIONS.map((r) => (
                  <option key={r.uiRole} value={r.uiRole}>
                    {r.label}
                  </option>
                ))}
              </select>
              <div className="text-xs text-white/50">
                {UI_ROLE_OPTIONS.find((r) => r.uiRole === form.uiRole)?.description ?? ""}
              </div>
              <div className="text-xs text-white/40">
                Backend role küldése: <span className="font-mono">{uiRoleToBackendRole(form.uiRole)}</span>
              </div>
            </label>

            <label className="space-y-1">
              <div className="text-xs text-white/60">Jelszó csere (opcionális)</div>
              <input
                type="password"
                className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-white/20"
                value={form.password}
                onChange={(e) => setForm((s) => ({ ...s, password: e.target.value }))}
              />
              <div className="text-xs text-white/50">Ha üresen hagyod, nem módosítjuk.</div>
            </label>

            <div className="flex items-center justify-between">
              <div className="text-xs text-white/60">
                Utolsó belépés: <span className="font-medium">{formatDateTime(getLastLogin(selectedUser))}</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-md bg-white/5 px-3 py-2 text-sm font-medium hover:bg-white/10"
                  onClick={() => setIsEditOpen(false)}
                  disabled={busyAction === "update"}
                >
                  Mégse
                </button>
                <button
                  type="button"
                  className="rounded-md bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/15 disabled:opacity-60"
                  onClick={() => void submitUpdate()}
                  disabled={busyAction === "update"}
                >
                  {busyAction === "update" ? "Mentés…" : "Mentés"}
                </button>
              </div>
            </div>

            <div className="rounded-md border border-white/10 bg-white/5 p-3 text-xs text-white/70">
              <div className="font-semibold">Megjegyzés (backend integráció)</div>
              <div className="mt-1">
                Az update hívás alapértelmezetten: <span className="font-mono">PATCH {API.USERS_UPDATE(":id")}</span>
                <br />
                Payload: <span className="font-mono">{`{ email, name, role, (optional) password }`}</span>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* Messages modal */}
      {isMessagesOpen && selectedUser ? (
        <Modal title={`Üzenetek: ${selectedUser.email}`} onClose={() => setIsMessagesOpen(false)}>
          <div className="space-y-3">
            <div className="rounded-md border border-white/10 bg-white/5 p-3 text-xs text-white/70">
              <div className="font-semibold">Megjegyzés</div>
              <div className="mt-1">
                Az üzenetek betöltése itt konfigurálható:
                <br />
                <span className="font-mono">GET {API.USER_MESSAGES(":id")}</span>
              </div>
            </div>

            {messagesError ? (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {messagesError}
              </div>
            ) : null}

            {messagesLoading ? (
              <div className="text-sm text-white/70">Betöltés…</div>
            ) : (
              <div className="rounded-lg border border-white/10 bg-zinc-950">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                  <div className="text-sm font-semibold">Lista</div>
                  <div className="text-xs text-white/60">{messages.length} üzenet</div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs uppercase text-white/60">
                      <tr className="border-b border-white/10">
                        <th className="px-4 py-3">Időpont</th>
                        <th className="px-4 py-3">Típus</th>
                        <th className="px-4 py-3">Cím</th>
                        <th className="px-4 py-3">Státusz</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {messages.map((m) => (
                        <tr key={m.id} className="hover:bg-white/5">
                          <td className="px-4 py-3">
                            <div className="text-sm">{formatDateTime(m.createdAt ?? null)}</div>
                            <div className="text-xs text-white/50 font-mono">{m.id}</div>
                          </td>
                          <td className="px-4 py-3">{m.type ?? <span className="text-white/40">—</span>}</td>
                          <td className="px-4 py-3">
                            <div className="font-medium">{m.title ?? <span className="text-white/40">—</span>}</div>
                            {m.body ? <div className="mt-1 text-xs text-white/60">{m.body}</div> : null}
                          </td>
                          <td className="px-4 py-3">{m.status ?? <span className="text-white/40">—</span>}</td>
                        </tr>
                      ))}

                      {messages.length === 0 ? (
                        <tr>
                          <td className="px-4 py-6 text-center text-sm text-white/60" colSpan={4}>
                            Nincs megjeleníthető üzenet (vagy az endpoint üres listát ad).
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                className="rounded-md bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/15"
                onClick={() => setIsMessagesOpen(false)}
              >
                Bezár
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}