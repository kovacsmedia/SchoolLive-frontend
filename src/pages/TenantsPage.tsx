// src/pages/TenantsPage.tsx

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useNavigate } from "react-router-dom";

type TenantDto = {
  id: string;
  name: string;
  domain?: string | null;
  isActive: boolean;
  createdAt?: string | null;
  address?: string | null;
  directorName?: string | null;
  directorPhone?: string | null;
  directorEmail?: string | null;
  eduId?: string | null;
};

type TenantsListResponse = {
  ok: boolean;
  tenants: TenantDto[];
};

type TenantSingleResponse = {
  ok: boolean;
  tenant: TenantDto;
};

type FormState = {
  name: string;
  domain: string;
  isActive: boolean;
  address: string;
  directorName: string;
  directorPhone: string;
  directorEmail: string;
  eduId: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  domain: "",
  isActive: true,
  address: "",
  directorName: "",
  directorPhone: "",
  directorEmail: "",
  eduId: "",
};

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
      const d = anyE.data as { message?: string; error?: string };
      if (d.message) return d.message;
      if (d.error) return d.error;
    }
    if (typeof anyE?.status === "number") return `HTTP ${anyE.status}`;
  }
  return "Ismeretlen hiba";
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl rounded-lg border border-white/10 bg-zinc-950 shadow-xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="text-sm font-semibold">{title}</div>
          <button
            className="rounded-md px-2 py-1 text-sm hover:bg-white/10"
            type="button"
            onClick={onClose}
            aria-label="Bezárás"
          >
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function TenantForm({
  form,
  setForm,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  const field = (key: keyof FormState) => (
    <input
      className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-white/20"
      value={form[key] as string}
      onChange={(e) => setForm((s) => ({ ...s, [key]: e.target.value }))}
    />
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <div className="text-xs text-white/60">Intézménynév *</div>
          {field("name")}
        </label>
        <label className="space-y-1">
          <div className="text-xs text-white/60">Oktatási azonosító</div>
          {field("eduId")}
        </label>
      </div>

      <label className="space-y-1">
        <div className="text-xs text-white/60">Cím</div>
        {field("address")}
      </label>

      <label className="space-y-1">
        <div className="text-xs text-white/60">Domain (opcionális, pl. iskola.hu)</div>
        {field("domain")}
        <div className="text-xs text-white/40">Ha meg van adva, egyedinek kell lennie.</div>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <div className="text-xs text-white/60">Igazgató neve</div>
          {field("directorName")}
        </label>
        <label className="space-y-1">
          <div className="text-xs text-white/60">Igazgató telefonszáma</div>
          {field("directorPhone")}
        </label>
      </div>

      <label className="space-y-1">
        <div className="text-xs text-white/60">Igazgató e-mail</div>
        {field("directorEmail")}
      </label>

      <label className="space-y-1">
        <div className="text-xs text-white/60">Státusz</div>
        <div className="flex items-center gap-2 pt-1">
          <input
            id="tenant-active"
            type="checkbox"
            className="h-4 w-4"
            checked={form.isActive}
            onChange={(e) => setForm((s) => ({ ...s, isActive: e.target.checked }))}
          />
          <label htmlFor="tenant-active" className="text-sm">
            Aktív
          </label>
        </div>
      </label>
    </div>
  );
}

export default function TenantsPage() {
  const { state } = useAuth();
  const navigate = useNavigate();

  // SUPER_ADMIN guard
  useEffect(() => {
    if (state.status === "authed" && state.user?.role !== "SUPER_ADMIN") {
      navigate("/app", { replace: true });
    }
  }, [state, navigate]);

  const [tenants, setTenants] = useState<TenantDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selected, setSelected] = useState<TenantDto | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busyAction, setBusyAction] = useState<null | "create" | "update" | "delete">(null);

  async function loadTenants() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<TenantsListResponse>("/admin/tenants");
      setTenants(Array.isArray(res.tenants) ? res.tenants : []);
    } catch (e) {
      setError(safeErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (state.status === "authed" && state.user?.role === "SUPER_ADMIN") {
      void loadTenants();
    }
  }, [state]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tenants;
    return tenants.filter((t) =>
      [t.name, t.domain, t.address, t.directorName, t.directorEmail, t.eduId]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [q, tenants]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setIsCreateOpen(true);
  }

  function openEdit(t: TenantDto) {
    setSelected(t);
    setForm({
      name: t.name ?? "",
      domain: t.domain ?? "",
      isActive: t.isActive ?? true,
      address: t.address ?? "",
      directorName: t.directorName ?? "",
      directorPhone: t.directorPhone ?? "",
      directorEmail: t.directorEmail ?? "",
      eduId: t.eduId ?? "",
    });
    setIsEditOpen(true);
  }

  async function submitCreate() {
    if (!form.name.trim()) {
      setError("Az intézménynév megadása kötelező.");
      return;
    }
    setError(null);
    setBusyAction("create");
    try {
      const res = await apiFetch<TenantSingleResponse>("/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          domain: form.domain.trim() || null,
          isActive: form.isActive,
          address: form.address.trim() || null,
          directorName: form.directorName.trim() || null,
          directorPhone: form.directorPhone.trim() || null,
          directorEmail: form.directorEmail.trim() || null,
          eduId: form.eduId.trim() || null,
        }),
      });
      if (!res?.ok) throw new Error("A backend nem ok státusszal válaszolt.");
      setIsCreateOpen(false);
      await loadTenants();
    } catch (e) {
      setError(safeErrorMessage(e));
    } finally {
      setBusyAction(null);
    }
  }

  async function submitUpdate() {
    if (!selected) return;
    if (!form.name.trim()) {
      setError("Az intézménynév megadása kötelező.");
      return;
    }
    setError(null);
    setBusyAction("update");
    try {
      const res = await apiFetch<TenantSingleResponse>(`/admin/tenants/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          domain: form.domain.trim() || null,
          isActive: form.isActive,
          address: form.address.trim() || null,
          directorName: form.directorName.trim() || null,
          directorPhone: form.directorPhone.trim() || null,
          directorEmail: form.directorEmail.trim() || null,
          eduId: form.eduId.trim() || null,
        }),
      });
      if (!res?.ok) throw new Error("A backend nem ok státusszal válaszolt.");
      setIsEditOpen(false);
      setSelected(null);
      await loadTenants();
    } catch (e) {
      setError(safeErrorMessage(e));
    } finally {
      setBusyAction(null);
    }
  }

  async function doDeactivate(t: TenantDto) {
    if (!window.confirm(`Biztosan deaktiválod? (${t.name})`)) return;
    setError(null);
    setBusyAction("delete");
    try {
      const res = await apiFetch<{ ok: boolean }>(`/admin/tenants/${t.id}`, { method: "DELETE" });
      if (!res?.ok) throw new Error("A backend nem ok státusszal válaszolt.");
      await loadTenants();
    } catch (e) {
      setError(safeErrorMessage(e));
    } finally {
      setBusyAction(null);
    }
  }

  if (state.status === "loading") {
    return <div className="p-6 text-sm text-white/60">Betöltés…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Tenantok</h1>
          <p className="mt-1 text-sm text-white/70">
            Intézmények kezelése – csak SUPER_ADMIN látja ezt az oldalt.
          </p>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <input
            className="w-full rounded-md border border-white/10 bg-zinc-950 px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-white/20 sm:w-80"
            placeholder="Keresés (név, domain, igazgató…)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/15 disabled:opacity-60"
            onClick={openCreate}
            disabled={loading}
          >
            + Új tenant
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md bg-white/5 px-3 py-2 text-sm font-medium hover:bg-white/10 disabled:opacity-60"
            onClick={() => void loadTenants()}
            disabled={loading}
          >
            Frissítés
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-white/10 bg-zinc-950">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="text-sm font-semibold">Lista</div>
          <div className="text-xs text-white/60">
            {loading ? "Betöltés..." : `${filtered.length} / ${tenants.length} tenant`}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-white/60">
              <tr className="border-b border-white/10">
                <th className="px-4 py-3">Intézménynév</th>
                <th className="px-4 py-3">Oktatási azonosító</th>
                <th className="px-4 py-3">Domain</th>
                <th className="px-4 py-3">Igazgató</th>
                <th className="px-4 py-3">Státusz</th>
                <th className="px-4 py-3">Létrehozva</th>
                <th className="px-4 py-3 text-right">Műveletek</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {filtered.map((t) => (
                <tr key={t.id} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    <div className="font-medium">{t.name}</div>
                    {t.address && <div className="text-xs text-white/50">{t.address}</div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {t.eduId ?? <span className="text-white/30">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {t.domain ?? <span className="text-white/30">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {t.directorName ? (
                      <div>
                        <div className="text-sm">{t.directorName}</div>
                        {t.directorEmail && (
                          <div className="text-xs text-white/50">{t.directorEmail}</div>
                        )}
                        {t.directorPhone && (
                          <div className="text-xs text-white/50">{t.directorPhone}</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-white/30">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
                        t.isActive
                          ? "border-emerald-500/30 bg-emerald-600/20 text-emerald-200"
                          : "border-red-500/30 bg-red-600/20 text-red-200"
                      }`}
                    >
                      {t.isActive ? "Aktív" : "Inaktív"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">{formatDateTime(t.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="rounded-md bg-white/5 px-2 py-1 text-xs font-medium hover:bg-white/10 disabled:opacity-60"
                        onClick={() => openEdit(t)}
                        disabled={!!busyAction}
                      >
                        Szerkeszt
                      </button>
                      <button
                        type="button"
                        className="rounded-md bg-red-500/10 px-2 py-1 text-xs font-medium text-red-200 hover:bg-red-500/15 disabled:opacity-60"
                        onClick={() => void doDeactivate(t)}
                        disabled={!!busyAction || !t.isActive}
                        title={!t.isActive ? "Már inaktív" : "Deaktiválás"}
                      >
                        Deaktivál
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-sm text-white/60" colSpan={7}>
                    Nincs találat.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td className="px-4 py-6 text-center text-sm text-white/60" colSpan={7}>
                    Betöltés…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isCreateOpen && (
        <Modal title="Új tenant" onClose={() => setIsCreateOpen(false)}>
          <div className="space-y-4">
            <TenantForm form={form} setForm={setForm} />
            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
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
          </div>
        </Modal>
      )}

      {isEditOpen && selected && (
        <Modal
          title={`Tenant szerkesztése: ${selected.name}`}
          onClose={() => setIsEditOpen(false)}
        >
          <div className="space-y-4">
            <TenantForm form={form} setForm={setForm} />
            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            )}
            <div className="flex items-center justify-between">
              <div className="text-xs text-white/50">
                Létrehozva: {formatDateTime(selected.createdAt)}
              </div>
              <div className="flex gap-2">
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
          </div>
        </Modal>
      )}
    </div>
  );
}