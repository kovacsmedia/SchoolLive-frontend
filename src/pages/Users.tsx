import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

/* ===========================
   TYPES
=========================== */

type UserDto = {
  id: string;
  email: string;
  role?: string;
  isActive?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
};

type UsersListResponse = {
  ok: boolean;
  users: UserDto[];
};

type MessageDto = {
  id: string;
  type: string;
  title?: string | null;
  scheduledAt?: string | null;
  targetType: string;
  targetId?: string | null;
  createdAt: string;
  status?: string;
};

type UserMessagesResponse = {
  ok: boolean;
  messages: MessageDto[];
};

type CommandDto = {
  id: string;
  deviceId: string;
  status: string;
  queuedAt: string;
  sentAt?: string | null;
  ackedAt?: string | null;
  error?: string | null;
  retryCount: number;
  maxRetries: number;
  lastError?: string | null;
  device?: {
    id: string;
    name?: string | null;
    online?: boolean;
    lastSeenAt?: string | null;
    ipAddress?: string | null;
  };
};

type CommandsResponse = {
  ok: boolean;
  commands: CommandDto[];
};

type ApiErrorShape = {
  message?: string;
  error?: string;
};

/* ===========================
   API
=========================== */

const API = {
  USERS_LIST: "/admin/users",
  USER_MESSAGES: (userId: string) => `/admin/users/${encodeURIComponent(userId)}/messages`,
  COMMANDS_BY_MESSAGE: (messageId: string) =>
    `/admin/commands/by-message/${encodeURIComponent(messageId)}`,
} as const;

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return apiFetch<T>(path, init);
}

/* ===========================
   HELPERS
=========================== */

function formatDateTime(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("hu-HU");
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

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "ACKED"
      ? "bg-emerald-600/20 text-emerald-200 border-emerald-500/30"
      : status === "SENT"
        ? "bg-blue-600/20 text-blue-200 border-blue-500/30"
        : status === "FAILED"
          ? "bg-red-600/20 text-red-200 border-red-500/30"
          : "bg-amber-600/20 text-amber-200 border-amber-500/30";

  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-5xl rounded-lg border border-white/10 bg-zinc-950 shadow-xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="text-sm font-semibold">{title}</div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm hover:bg-white/10"
            type="button"
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

/* ===========================
   PAGE
=========================== */

export default function Users() {
  const [users, setUsers] = useState<UserDto[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [messagesOpen, setMessagesOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserDto | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [commandsOpen, setCommandsOpen] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<MessageDto | null>(null);
  const [commands, setCommands] = useState<CommandDto[]>([]);
  const [loadingCommands, setLoadingCommands] = useState(false);
  const [commandsError, setCommandsError] = useState<string | null>(null);

  async function loadUsers() {
    setLoadingUsers(true);
    setUsersError(null);
    try {
      const resp = await apiRequest<UsersListResponse>(API.USERS_LIST);
      setUsers(Array.isArray(resp?.users) ? resp.users : []);
    } catch (e) {
      setUsersError(safeErrorMessage(e));
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function openMessages(u: UserDto) {
    setSelectedUser(u);
    setMessagesOpen(true);

    setMessages([]);
    setMessagesError(null);
    setLoadingMessages(true);

    try {
      const resp = await apiRequest<UserMessagesResponse>(API.USER_MESSAGES(u.id));
      if (!resp?.ok) throw new Error("A backend nem ok státusszal válaszolt.");
      setMessages(Array.isArray(resp.messages) ? resp.messages : []);
    } catch (e) {
      setMessagesError(safeErrorMessage(e));
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }

  async function openCommands(m: MessageDto) {
    setSelectedMessage(m);
    setCommandsOpen(true);

    setCommands([]);
    setCommandsError(null);
    setLoadingCommands(true);

    try {
      const resp = await apiRequest<CommandsResponse>(API.COMMANDS_BY_MESSAGE(m.id));
      if (!resp?.ok) throw new Error("A backend nem ok státusszal válaszolt.");
      setCommands(Array.isArray(resp.commands) ? resp.commands : []);
    } catch (e) {
      setCommandsError(safeErrorMessage(e));
      setCommands([]);
    } finally {
      setLoadingCommands(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Felhasználók</h1>
          <p className="mt-1 text-sm text-white/70">
            Üzenetek és eszköz-szintű command státuszok megtekintése.
          </p>
        </div>

        <button
          type="button"
          className="rounded-md bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/15 disabled:opacity-60"
          onClick={() => void loadUsers()}
          disabled={loadingUsers}
          title="Frissítés"
        >
          Frissítés
        </button>
      </div>

      {usersError ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {usersError}
        </div>
      ) : null}

      <div className="rounded-lg border border-white/10 bg-zinc-950">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-white/60">
              <tr className="border-b border-white/10">
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Utolsó belépés</th>
                <th className="px-4 py-3 text-right">Művelet</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    <div className="font-medium">{u.email}</div>
                    <div className="text-xs text-white/50">{u.id}</div>
                  </td>
                  <td className="px-4 py-3">{u.role ?? "-"}</td>
                  <td className="px-4 py-3">{formatDateTime(u.lastLoginAt ?? null)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => void openMessages(u)}
                      className="rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/15 disabled:opacity-60"
                      disabled={loadingMessages && selectedUser?.id === u.id}
                      type="button"
                    >
                      Üzenetek
                    </button>
                  </td>
                </tr>
              ))}

              {loadingUsers ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-white/70">
                    Betöltés…
                  </td>
                </tr>
              ) : null}

              {!loadingUsers && users.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-white/60">
                    Nincs megjeleníthető felhasználó.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Messages modal */}
      {messagesOpen && selectedUser ? (
        <Modal title={`Üzenetek: ${selectedUser.email}`} onClose={() => setMessagesOpen(false)}>
          <div className="space-y-3">
            {messagesError ? (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {messagesError}
              </div>
            ) : null}

            {loadingMessages ? (
              <div className="text-sm text-white/70">Betöltés…</div>
            ) : (
              <div className="rounded-lg border border-white/10 bg-zinc-950">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs uppercase text-white/60">
                      <tr className="border-b border-white/10">
                        <th className="px-4 py-3">Időpont</th>
                        <th className="px-4 py-3">Típus</th>
                        <th className="px-4 py-3">Cím</th>
                        <th className="px-4 py-3">Ütemezve</th>
                        <th className="px-4 py-3">Cél</th>
                        <th className="px-4 py-3">Státusz</th>
                        <th className="px-4 py-3 text-right">Részlet</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {messages.map((m) => (
                        <tr key={m.id} className="hover:bg-white/5">
                          <td className="px-4 py-3">
                            <div>{formatDateTime(m.createdAt ?? null)}</div>
                            <div className="text-xs text-white/50 font-mono">{m.id}</div>
                          </td>
                          <td className="px-4 py-3">{m.type}</td>
                          <td className="px-4 py-3">{m.title ?? "-"}</td>
                          <td className="px-4 py-3">{formatDateTime(m.scheduledAt ?? null)}</td>
                          <td className="px-4 py-3">
                            {m.targetType}
                            {m.targetId ? (
                              <div className="text-xs text-white/50 font-mono">{m.targetId}</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">{m.status ?? "-"}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              className="rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/15"
                              onClick={() => void openCommands(m)}
                            >
                              Device státusz
                            </button>
                          </td>
                        </tr>
                      ))}

                      {messages.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-6 text-center text-sm text-white/60">
                            Nincs üzenet.
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
                onClick={() => setMessagesOpen(false)}
              >
                Bezár
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* Commands modal */}
      {commandsOpen && selectedMessage ? (
        <Modal
          title={`Device parancsok: ${selectedMessage.title ?? selectedMessage.id}`}
          onClose={() => setCommandsOpen(false)}
        >
          <div className="space-y-3">
            {commandsError ? (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {commandsError}
              </div>
            ) : null}

            {loadingCommands ? (
              <div className="text-sm text-white/70">Betöltés…</div>
            ) : (
              <div className="rounded-lg border border-white/10 bg-zinc-950">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs uppercase text-white/60">
                      <tr className="border-b border-white/10">
                        <th className="px-4 py-3">Eszköz</th>
                        <th className="px-4 py-3">Státusz</th>
                        <th className="px-4 py-3">Queued</th>
                        <th className="px-4 py-3">Sent</th>
                        <th className="px-4 py-3">Acked</th>
                        <th className="px-4 py-3">Retry</th>
                        <th className="px-4 py-3">Hiba</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {commands.map((c) => (
                        <tr key={c.id} className="hover:bg-white/5">
                          <td className="px-4 py-3">
                            <div className="font-medium">{c.device?.name ?? c.deviceId}</div>
                            <div className="text-xs text-white/50">
                              {c.device?.online ? "Online" : "Offline"} • {formatDateTime(c.device?.lastSeenAt ?? null)}
                              {c.device?.ipAddress ? (
                                <>
                                  {" "}
                                  • <span className="font-mono">{c.device.ipAddress}</span>
                                </>
                              ) : null}
                            </div>
                            <div className="text-xs text-white/50 font-mono">{c.id}</div>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={c.status} />
                          </td>
                          <td className="px-4 py-3">{formatDateTime(c.queuedAt ?? null)}</td>
                          <td className="px-4 py-3">{formatDateTime(c.sentAt ?? null)}</td>
                          <td className="px-4 py-3">{formatDateTime(c.ackedAt ?? null)}</td>
                          <td className="px-4 py-3">
                            {c.retryCount}/{c.maxRetries}
                          </td>
                          <td className="px-4 py-3 text-xs text-red-200">
                            {c.error ?? c.lastError ?? "-"}
                          </td>
                        </tr>
                      ))}

                      {commands.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-6 text-center text-sm text-white/60">
                            Nincs parancs ehhez az üzenethez.
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
                onClick={() => setCommandsOpen(false)}
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