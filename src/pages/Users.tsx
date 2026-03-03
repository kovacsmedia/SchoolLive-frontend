import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";

/* ===========================
   TYPES
=========================== */

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
  role: BackendRole;
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
  createdAt: string;
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

/* ===========================
   API
=========================== */

const API = {
  USERS_LIST: "/admin/users",
  USER_MESSAGES: (userId: string) => `/admin/users/${userId}/messages`,
  COMMANDS_BY_MESSAGE: (messageId: string) =>
    `/admin/commands/by-message/${messageId}`,
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
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-4xl rounded-lg border border-white/10 bg-zinc-950 shadow-xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="text-sm font-semibold">{title}</div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm hover:bg-white/10"
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
   COMPONENT
=========================== */

export default function Users() {
  const [users, setUsers] = useState<UserDto[]>([]);
  const [loading, setLoading] = useState(false);

  const [messagesOpen, setMessagesOpen] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);

  const [selectedUser, setSelectedUser] = useState<UserDto | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [selectedMessage, setSelectedMessage] =
    useState<MessageDto | null>(null);

  const [commands, setCommands] = useState<CommandDto[]>([]);
  const [commandsLoading, setCommandsLoading] = useState(false);

  /* =======================
     LOAD USERS
  ======================= */

  async function loadUsers() {
    setLoading(true);
    try {
      const resp = await apiRequest<UsersListResponse>(API.USERS_LIST);
      setUsers(resp.users ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  /* =======================
     MESSAGES
  ======================= */

  async function openMessages(u: UserDto) {
    setSelectedUser(u);
    setMessagesOpen(true);

    try {
      const data = await apiRequest<{ ok: boolean; messages: MessageDto[] }>(
        API.USER_MESSAGES(u.id)
      );
      setMessages(data.messages ?? []);
    } catch {
      setMessages([]);
    }
  }

  /* =======================
     COMMANDS
  ======================= */

  async function openCommands(m: MessageDto) {
    setSelectedMessage(m);
    setCommandsOpen(true);
    setCommandsLoading(true);

    try {
      const resp = await apiRequest<CommandsResponse>(
        API.COMMANDS_BY_MESSAGE(m.id)
      );
      setCommands(resp.commands ?? []);
    } finally {
      setCommandsLoading(false);
    }
  }

  /* =======================
     RENDER
  ======================= */

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Felhasználók</h1>

      <div className="rounded-lg border border-white/10 bg-zinc-950">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-white/60">
              <tr className="border-b border-white/10">
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Utolsó belépés</th>
                <th className="px-4 py-3 text-right">Művelet</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-white/5">
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">
                    {formatDateTime(u.lastLoginAt ?? null)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openMessages(u)}
                      className="rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/15"
                    >
                      Üzenetek
                    </button>
                  </td>
                </tr>
              ))}
              {loading && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center">
                    Betöltés...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===========================
          MESSAGES MODAL
      =========================== */}

      {messagesOpen && selectedUser && (
        <Modal
          title={`Üzenetek: ${selectedUser.email}`}
          onClose={() => setMessagesOpen(false)}
        >
          <table className="min-w-full text-sm">
            <thead className="text-xs uppercase text-white/60">
              <tr>
                <th className="px-3 py-2">Időpont</th>
                <th className="px-3 py-2">Típus</th>
                <th className="px-3 py-2">Cím</th>
                <th className="px-3 py-2 text-right">Részletek</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {messages.map((m) => (
                <tr key={m.id} className="hover:bg-white/5">
                  <td className="px-3 py-2">
                    {formatDateTime(m.createdAt)}
                  </td>
                  <td className="px-3 py-2">{m.type}</td>
                  <td className="px-3 py-2">{m.title ?? "-"}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => openCommands(m)}
                      className="rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/15"
                    >
                      Device status
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}

      {/* ===========================
          COMMAND MODAL
      =========================== */}

      {commandsOpen && selectedMessage && (
        <Modal
          title={`Device parancsok: ${selectedMessage.title ?? selectedMessage.id}`}
          onClose={() => setCommandsOpen(false)}
        >
          {commandsLoading ? (
            <div>Betöltés...</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-white/60">
                <tr>
                  <th className="px-3 py-2">Eszköz</th>
                  <th className="px-3 py-2">Státusz</th>
                  <th className="px-3 py-2">Queued</th>
                  <th className="px-3 py-2">Sent</th>
                  <th className="px-3 py-2">Acked</th>
                  <th className="px-3 py-2">Retry</th>
                  <th className="px-3 py-2">Hiba</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {commands.map((c) => (
                  <tr key={c.id} className="hover:bg-white/5">
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {c.device?.name ?? c.deviceId}
                      </div>
                      <div className="text-xs text-white/50">
                        {c.device?.online ? "Online" : "Offline"} •{" "}
                        {formatDateTime(c.device?.lastSeenAt ?? null)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-3 py-2">
                      {formatDateTime(c.queuedAt)}
                    </td>
                    <td className="px-3 py-2">
                      {formatDateTime(c.sentAt ?? null)}
                    </td>
                    <td className="px-3 py-2">
                      {formatDateTime(c.ackedAt ?? null)}
                    </td>
                    <td className="px-3 py-2">
                      {c.retryCount}/{c.maxRetries}
                    </td>
                    <td className="px-3 py-2 text-red-300 text-xs">
                      {c.error ?? c.lastError ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}
    </div>
  );
}