import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";

type BellType = "MAIN" | "SIGNAL";

type BellEntry = {
  id: string;
  hour: number;
  minute: number;
  type: BellType;
  soundFile: string;
};

type BellTemplate = {
  id: string;
  name: string;
  isDefault: boolean;
  isLocked: boolean;
  bells: BellEntry[];
  createdAt: string;
};

type BellSoundFile = {
  id: string;
  filename: string;
  sizeBytes: number;
  isDefault: boolean;
};

type CalendarDay = {
  id: string;
  date: string;
  isHoliday: boolean;
  templateId: string | null;
  template: BellTemplate | null;
};

// Szerkesztés alatt lévő új sor (még nem lett "Kész"-szel elfogadva)
type PendingBell = {
  hour: number;
  minute: number;
  type: BellType;
  soundFile: string;
};

const MAX_TOTAL_BYTES = 500 * 1024;
const MONTHS_HU = [
  "Január", "Február", "Március", "Április", "Május", "Június",
  "Július", "Augusztus", "Szeptember", "Október", "November", "December",
];

function pad(n: number) { return String(n).padStart(2, "0"); }
function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  return `${Math.round(b / 1024)} KB`;
}
function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}
function toDateStr(year: number, month: number, day: number) {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}
function sortBells<T extends { hour: number; minute: number }>(bells: T[]): T[] {
  return [...bells].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
}

export default function BellSchedule() {
  const [tab, setTab] = useState<"calendar" | "templates" | "sounds">("calendar");

  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calDays, setCalDays] = useState<CalendarDay[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editDay, setEditDay] = useState<{ isHoliday: boolean; templateId: string | null } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [templates, setTemplates] = useState<BellTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<BellTemplate | null>(null);
  const [editTemplate, setEditTemplate] = useState<{ name: string; bells: Omit<BellEntry, "id">[] } | null>(null);
  const [templateSaving, setTemplateSaving] = useState(false);

  // Szerkesztés alatt lévő új sor – null ha nincs folyamatban lévő hozzáadás
  const [pendingBell, setPendingBell] = useState<PendingBell | null>(null);

  const [sounds, setSounds] = useState<BellSoundFile[]>([]);
  const [soundsLoading, setSoundsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [hasLock, setHasLock] = useState(false);
  const [lockLoading, setLockLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const r = await apiFetch<{ ok: boolean; templates: BellTemplate[] }>("/bells/templates");
      setTemplates(r.templates);
    } catch (e: any) {
      setError(e?.message ?? "Hiba a sablonok betöltésekor");
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  const loadCalendar = useCallback(async () => {
    setCalLoading(true);
    try {
      const r = await apiFetch<{ ok: boolean; days: CalendarDay[] }>(`/bells/calendar?year=${calYear}`);
      setCalDays(r.days);
    } catch (e: any) {
      setError(e?.message ?? "Hiba a naptár betöltésekor");
    } finally {
      setCalLoading(false);
    }
  }, [calYear]);

  const loadSounds = useCallback(async () => {
    setSoundsLoading(true);
    try {
      const r = await apiFetch<{ ok: boolean; sounds: BellSoundFile[] }>("/bells/sounds");
      setSounds(r.sounds);
    } catch (e: any) {
      setError(e?.message ?? "Hiba a hangfájlok betöltésekor");
    } finally {
      setSoundsLoading(false);
    }
  }, []);

  useEffect(() => { loadTemplates(); loadSounds(); }, [loadTemplates, loadSounds]);
  useEffect(() => { loadCalendar(); }, [loadCalendar]);

  async function acquireLock() {
    setLockLoading(true);
    try {
      await apiFetch("/bells/lock", { method: "POST" });
      setHasLock(true);
      setError(null);
    } catch (e: any) {
      if (e?.status === 409) {
        setError("Egy másik felhasználó éppen szerkeszti a csengetési rendet. Próbáld meg 30 perc múlva.");
      } else {
        setError(e?.message ?? "Nem sikerült a szerkesztési zárat megszerezni");
      }
    } finally {
      setLockLoading(false);
    }
  }

  async function releaseLock() {
    try { await apiFetch("/bells/lock", { method: "DELETE" }); } catch { }
    setHasLock(false);
  }

  useEffect(() => {
    return () => { if (hasLock) releaseLock(); };
  }, [hasLock]);

  function getDayData(dateStr: string): CalendarDay | undefined {
    return calDays.find(d => d.date.startsWith(dateStr));
  }

  function onDayClick(dateStr: string) {
    if (!hasLock) return;
    const existing = getDayData(dateStr);
    setSelectedDate(dateStr);
    setEditDay({ isHoliday: existing?.isHoliday ?? false, templateId: existing?.templateId ?? null });
  }

  async function saveDay() {
    if (!selectedDate || !editDay) return;
    setSaving(true);
    try {
      await apiFetch(`/bells/calendar/${selectedDate}`, {
        method: "PUT",
        body: JSON.stringify(editDay),
        headers: { "Content-Type": "application/json" },
      });
      await loadCalendar();
      setSelectedDate(null); setEditDay(null); setDirty(false);
      setSuccess("Nap mentve!"); setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e?.message ?? "Mentési hiba");
    } finally {
      setSaving(false);
    }
  }

  async function initHolidays() {
    if (!hasLock) return;
    if (!confirm(`Betöltöd a ${calYear}. évi munkaszüneti- és hétvégi napokat?`)) return;
    try {
      const r = await apiFetch<{ ok: boolean; imported: number }>("/bells/calendar/init", {
        method: "POST", body: JSON.stringify({ year: calYear }), headers: { "Content-Type": "application/json" },
      });
      await loadCalendar();
      setSuccess(`${r.imported} szünnap betöltve!`); setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e?.message ?? "Hiba az ünnepnapok betöltésekor");
    }
  }

  function startNewTemplate() {
    setEditTemplate({ name: "", bells: [] });
    setSelectedTemplate(null);
    setPendingBell(null);
  }

  function startEditTemplate(t: BellTemplate) {
    setSelectedTemplate(t);
    setEditTemplate({ name: t.name, bells: t.bells.map(b => ({ hour: b.hour, minute: b.minute, type: b.type, soundFile: b.soundFile })) });
    setPendingBell(null);
  }

  // Új sor hozzáadása: pending módba kerül, a tetején jelenik meg
  function addBellEntry() {
    if (!editTemplate || pendingBell) return;
    const defaultSound = sounds.find(s => s.filename === "kibecsengo.mp3")?.filename ?? sounds[0]?.filename ?? "kibecsengo.mp3";
    setPendingBell({ hour: 8, minute: 0, type: "MAIN", soundFile: defaultSound });
  }

  // Pending sor elfogadása: bekerül a listába, rendezés megtörténik
  function commitPendingBell() {
    if (!editTemplate || !pendingBell) return;
    setEditTemplate({
      ...editTemplate,
      bells: sortBells([...editTemplate.bells, { ...pendingBell }]),
    });
    setPendingBell(null);
  }

  // Pending sor elvetése
  function discardPendingBell() {
    setPendingBell(null);
  }

  function removeBellEntry(idx: number) {
    if (!editTemplate) return;
    setEditTemplate({ ...editTemplate, bells: editTemplate.bells.filter((_, i) => i !== idx) });
  }

  function updateBellEntry(idx: number, field: string, value: string | number) {
    if (!editTemplate) return;
    const bells = [...editTemplate.bells];
    bells[idx] = { ...bells[idx], [field]: value };
    // Szándékosan NEM rendezünk itt – csak Kész gombra rendez
    setEditTemplate({ ...editTemplate, bells });
  }

  async function saveTemplate() {
    if (!editTemplate) return;
    if (pendingBell) { setError("Van egy befejezetlen sor! Nyomj Kész-t vagy Elvett-et."); return; }
    if (!editTemplate.name.trim()) { setError("A sablon neve kötelező!"); return; }
    setTemplateSaving(true);
    try {
      if (selectedTemplate) {
        await apiFetch(`/bells/templates/${selectedTemplate.id}`, {
          method: "PUT", body: JSON.stringify(editTemplate), headers: { "Content-Type": "application/json" },
        });
      } else {
        await apiFetch("/bells/templates", {
          method: "POST", body: JSON.stringify(editTemplate), headers: { "Content-Type": "application/json" },
        });
      }
      await loadTemplates();
      setEditTemplate(null); setSelectedTemplate(null); setPendingBell(null);
      setSuccess("Sablon mentve!"); setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e?.message ?? "Mentési hiba");
    } finally {
      setTemplateSaving(false);
    }
  }

  async function deleteTemplate(t: BellTemplate) {
    if (!confirm(`Törlöd a "${t.name}" sablont?`)) return;
    try {
      await apiFetch(`/bells/templates/${t.id}`, { method: "DELETE" });
      await loadTemplates();
      setSuccess("Sablon törölve!"); setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e?.message ?? "Törlési hiba");
    }
  }

  async function setDefaultTemplate(t: BellTemplate) {
    if (!confirm(`Az "${t.name}" lesz az alapértelmezett (offline is működő) csengetési rend?`)) return;
    try {
      await apiFetch(`/bells/templates/${t.id}/set-default`, { method: "PUT" });
      await loadTemplates();
      setSuccess(`"${t.name}" beállítva alapértelmezettként!`); setTimeout(() => setSuccess(null), 5000);
    } catch (e: any) {
      setError(e?.message ?? "Hiba az alapértelmezett beállításakor");
    }
  }

  const totalUsed = sounds.reduce((s, f) => s + f.sizeBytes, 0);
  const available = MAX_TOTAL_BYTES - totalUsed;

  async function uploadSound(file: File) {
    if (file.size > available) { setError(`Nincs elég hely! Elérhető: ${fmtBytes(available)}, szükséges: ${fmtBytes(file.size)}`); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = sessionStorage.getItem("accessToken") ?? localStorage.getItem("accessToken") ?? "";
      const tenantId = sessionStorage.getItem("activeTenantId") ?? localStorage.getItem("activeTenantId") ?? "";
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (tenantId) headers["x-tenant-id"] = tenantId;
      const baseUrl = ((import.meta as any)?.env?.VITE_API_BASE_URL ?? "").trim().replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/bells/sounds`, { method: "POST", headers, body: fd });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.error ?? `HTTP ${res.status}`); }
      await loadSounds();
      setSuccess("Hangfájl feltöltve!"); setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e?.message ?? "Feltöltési hiba");
    } finally {
      setUploading(false);
    }
  }

  async function deleteSound(s: BellSoundFile) {
    if (!confirm(`Törlöd a "${s.filename}" hangfájlt?`)) return;
    try {
      await apiFetch(`/bells/sounds/${s.id}`, { method: "DELETE" });
      await loadSounds();
      setSuccess("Hangfájl törölve!"); setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e?.message ?? "Törlési hiba");
    }
  }

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty) { e.preventDefault(); e.returnValue = ""; }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // ─── Naptár ──────────────────────────────────────────────────────────────────

  function renderCalendar() {
    const daysInMonth = getDaysInMonth(calYear, calMonth);
    const firstDay = (getFirstDayOfMonth(calYear, calMonth) + 6) % 7;
    const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
    while (cells.length % 7 !== 0) cells.push(null);

    return (
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <button className="sl-btn" onClick={() => { if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); } else setCalMonth(m => m - 1); }}>◀</button>
          <span style={{ fontWeight: 700, fontSize: 18, minWidth: 180, textAlign: "center" }}>{MONTHS_HU[calMonth]} {calYear}</span>
          <button className="sl-btn" onClick={() => { if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); } else setCalMonth(m => m + 1); }}>▶</button>
          <button className="sl-btn sl-btn-secondary" onClick={() => { setCalYear(today.getFullYear()); setCalMonth(today.getMonth()); }}>Ma</button>
          <button className="sl-btn sl-btn-secondary" onClick={() => setCalYear(y => y - 1)}>◀ {calYear - 1}</button>
          <button className="sl-btn sl-btn-secondary" onClick={() => setCalYear(y => y + 1)}>{calYear + 1} ▶</button>
          {hasLock && <button className="sl-btn" onClick={initHolidays} style={{ marginLeft: "auto" }}>🗓 Ünnepnapok betöltése</button>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 2 }}>
          {["H", "K", "Sz", "Cs", "P", "Sz", "V"].map((d, i) => (
            <div key={i} style={{ textAlign: "center", fontWeight: 700, fontSize: 12, color: i >= 5 ? "#e55" : "#888", padding: "4px 0" }}>{d}</div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
          {cells.map((day, idx) => {
            if (!day) return <div key={idx} />;
            const dateStr = toDateStr(calYear, calMonth, day);
            const data = getDayData(dateStr);
            const isToday = dateStr === toDateStr(today.getFullYear(), today.getMonth(), today.getDate());
            const isWeekend = ((idx % 7) >= 5);
            const isHoliday = data?.isHoliday || isWeekend;
            const hasCustomTemplate = data?.templateId != null;
            const isSelected = selectedDate === dateStr;
            let bg = "#1a1a2e";
            if (isHoliday) bg = "#2a1a1a";
            if (hasCustomTemplate) bg = "#1a2a1a";
            if (isToday) bg = "#1a1a3e";
            if (isSelected) bg = "#2a2a4e";
            return (
              <div key={idx} onClick={() => onDayClick(dateStr)} style={{ background: bg, border: isSelected ? "2px solid #3b82f6" : "2px solid transparent", borderRadius: 6, padding: "6px 4px", minHeight: 52, cursor: hasLock ? "pointer" : "default", position: "relative", transition: "background 0.15s" }} title={data?.template?.name ?? (isHoliday ? "Szünnap" : "Normál rend")}>
                <div style={{ fontSize: 13, fontWeight: isToday ? 700 : 400, color: isToday ? "#3b82f6" : isWeekend ? "#ef4444" : "var(--sl-text)" }}>{day}</div>
                {isHoliday && !isWeekend && <div style={{ fontSize: 9, color: "#ef4444", marginTop: 2 }}>SZÜNNAP</div>}
                {isWeekend && <div style={{ fontSize: 9, color: "#ef4444", marginTop: 2 }}>HÉTVÉGE</div>}
                {hasCustomTemplate && !isHoliday && <div style={{ fontSize: 9, color: "#16a34a", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data?.template?.name?.slice(0, 10)}</div>}
              </div>
            );
          })}
        </div>
        {selectedDate && editDay && (
          <div style={{ marginTop: 20, background: "var(--sl-surface)", border: "1px solid var(--sl-border)", borderRadius: 8, padding: 16 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>📅 {selectedDate} szerkesztése</h3>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={editDay.isHoliday} onChange={e => { setEditDay({ ...editDay, isHoliday: e.target.checked, templateId: e.target.checked ? null : editDay.templateId }); setDirty(true); }} />
              <span>Csengetésmentes nap (szünnap)</span>
            </label>
            {!editDay.isHoliday && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, color: "var(--sl-muted)", display: "block", marginBottom: 4 }}>Csengetési rend</label>
                <select className="sl-select" value={editDay.templateId ?? ""} onChange={e => { setEditDay({ ...editDay, templateId: e.target.value || null }); setDirty(true); }}>
                  <option value="">Normál csengetési rend (alapértelmezett)</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="sl-btn sl-btn-primary" onClick={() => { if (!confirm("Biztosan mentod?")) return; saveDay(); }} disabled={saving}>{saving ? "Mentés..." : "💾 Mentés"}</button>
              <button className="sl-btn sl-btn-secondary" onClick={() => { if (dirty && !confirm("Elveted a változtatásokat?")) return; setSelectedDate(null); setEditDay(null); setDirty(false); }}>Mégse</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Sablonok ─────────────────────────────────────────────────────────────────

  function renderTemplates() {
    return (
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Csengetési rend sablonok</h3>
          {!editTemplate && templates.length < 6 && (
            <button className="sl-btn sl-btn-primary" onClick={startNewTemplate} style={{ marginLeft: "auto" }}>+ Új sablon</button>
          )}
        </div>

        {!editTemplate && (
          <div style={{ fontSize: 12, color: "var(--sl-muted)", background: "var(--sl-bg)", border: "1px solid var(--sl-border)", borderRadius: 6, padding: "8px 12px", marginBottom: 12 }}>
            ⭐ Az <strong style={{ color: "var(--sl-text)" }}>alapértelmezett</strong> sablon töltődik le az eszközre offline fallbackként.
            {!templates.some(t => t.isDefault) && <span style={{ color: "#e8a", marginLeft: 6 }}>⚠ Nincs alapértelmezett sablon beállítva!</span>}
          </div>
        )}

        {templatesLoading ? <div style={{ color: "var(--sl-muted)" }}>Betöltés...</div> : (
          <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
            {templates.map(t => (
              <div key={t.id} style={{ background: t.isDefault ? "#f0fdf4" : "var(--sl-surface)", border: t.isDefault ? "1px solid #bbf7d0" : "1px solid var(--sl-border)", borderRadius: 8, padding: 12, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {t.name}
                    {t.isDefault && <span style={{ marginLeft: 8, fontSize: 11, background: "#dcfce7", color: "#15803d", borderRadius: 4, padding: "2px 6px" }}>⭐ Alapértelmezett</span>}
                    {t.isLocked && <span style={{ marginLeft: 8, fontSize: 11, background: "#fffbeb", color: "#d97706", borderRadius: 4, padding: "2px 6px" }}>🔒 Zárolt</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--sl-muted)", marginTop: 4 }}>{t.bells.length} jelzés</div>
                </div>
                <button className="sl-btn sl-btn-secondary" onClick={() => startEditTemplate(t)}>👁 Megtekint{!t.isLocked ? " / Szerkeszt" : ""}</button>
                {hasLock && !t.isDefault && (
                  <button className="sl-btn" style={{ background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0", whiteSpace: "nowrap" }} onClick={() => setDefaultTemplate(t)} title="Beállítás offline alapértelmezettként">⭐ Alapért.</button>
                )}
                {!t.isLocked && <button className="sl-btn sl-btn-danger" onClick={() => deleteTemplate(t)}>Töröl</button>}
              </div>
            ))}
          </div>
        )}

        {editTemplate && (
          <div style={{ background: "var(--sl-surface)", border: "1px solid #444", borderRadius: 8, padding: 16 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>
              {selectedTemplate ? `${selectedTemplate.isLocked ? "👁 " : "✏️ "}${selectedTemplate.name}` : "Új sablon"}
            </h3>

            {!selectedTemplate?.isLocked && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, color: "var(--sl-muted)", display: "block", marginBottom: 4 }}>Sablon neve</label>
                <input className="sl-input" value={editTemplate.name} onChange={e => setEditTemplate({ ...editTemplate, name: e.target.value })} placeholder="pl. Rövidített nap" />
              </div>
            )}

            {/* Fejléc */}
            <div style={{ marginBottom: 6, fontSize: 12, color: "var(--sl-muted)", display: "grid", gridTemplateColumns: "120px 80px 1fr 80px", gap: 8, padding: "0 4px" }}>
              <span>Időpont</span><span>Típus</span><span>Hang</span><span></span>
            </div>

            {/* Pending sor – a lista TETEJÉN, kiemelve */}
            {pendingBell && (
              <div style={{ display: "grid", gridTemplateColumns: "120px 80px 1fr auto", gap: 8, marginBottom: 8, alignItems: "center", background: "#1a2a1a", border: "1px solid #bbf7d0", borderRadius: 6, padding: "6px 8px" }}>
                <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
                  <input type="number" className="sl-input" style={{ width: 52, padding: "4px 2px", textAlign: "center" }} min={0} max={23} value={pendingBell.hour}
                    onChange={e => setPendingBell({ ...pendingBell, hour: Math.min(23, Math.max(0, parseInt(e.target.value) || 0)) })} />
                  <span style={{ alignSelf: "center", color: "var(--sl-muted)" }}>:</span>
                  <input type="number" className="sl-input" style={{ width: 52, padding: "4px 2px", textAlign: "center" }} min={0} max={59} value={pendingBell.minute}
                    onChange={e => setPendingBell({ ...pendingBell, minute: Math.min(59, Math.max(0, parseInt(e.target.value) || 0)) })} />
                </div>
                <select className="sl-select" style={{ fontSize: 12 }} value={pendingBell.type}
                  onChange={e => setPendingBell({ ...pendingBell, type: e.target.value as BellType })}>
                  <option value="MAIN">Fő</option>
                  <option value="SIGNAL">Jelző</option>
                </select>
                <select className="sl-select" style={{ fontSize: 12 }} value={pendingBell.soundFile}
                  onChange={e => setPendingBell({ ...pendingBell, soundFile: e.target.value })}>
                  {sounds.map(s => <option key={s.id} value={s.filename}>{s.filename}</option>)}
                </select>
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="sl-btn sl-btn-primary" style={{ padding: "2px 10px", fontSize: 12, whiteSpace: "nowrap" }} onClick={commitPendingBell} title="Sor elfogadása és berendezés">✓ Kész</button>
                  <button className="sl-btn sl-btn-secondary" style={{ padding: "2px 8px", fontSize: 12 }} onClick={discardPendingBell} title="Sor elvetése">✕</button>
                </div>
              </div>
            )}

            {/* Meglévő sorok – rendezett, nem ugrik */}
            {editTemplate.bells.map((bell, idx) => (
              <div key={idx} style={{ display: "grid", gridTemplateColumns: "120px 80px 1fr auto", gap: 8, marginBottom: 6, alignItems: "center" }}>
                <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
                  <input type="number" className="sl-input" style={{ width: 52, padding: "4px 2px", textAlign: "center" }} min={0} max={23} value={bell.hour}
                    onChange={e => updateBellEntry(idx, "hour", Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))} disabled={selectedTemplate?.isLocked} />
                  <span style={{ alignSelf: "center", color: "var(--sl-muted)" }}>:</span>
                  <input type="number" className="sl-input" style={{ width: 52, padding: "4px 2px", textAlign: "center" }} min={0} max={59} value={bell.minute}
                    onChange={e => updateBellEntry(idx, "minute", Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))} disabled={selectedTemplate?.isLocked} />
                </div>
                <select className="sl-select" style={{ fontSize: 12 }} value={bell.type}
                  onChange={e => updateBellEntry(idx, "type", e.target.value)} disabled={selectedTemplate?.isLocked}>
                  <option value="MAIN">Fő</option>
                  <option value="SIGNAL">Jelző</option>
                </select>
                <select className="sl-select" style={{ fontSize: 12 }} value={bell.soundFile}
                  onChange={e => updateBellEntry(idx, "soundFile", e.target.value)} disabled={selectedTemplate?.isLocked}>
                  {sounds.map(s => <option key={s.id} value={s.filename}>{s.filename}</option>)}
                </select>
                {!selectedTemplate?.isLocked && (
                  <button className="sl-btn sl-btn-danger" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => removeBellEntry(idx)}>✕</button>
                )}
              </div>
            ))}

            {!selectedTemplate?.isLocked && !pendingBell && (
              <button className="sl-btn sl-btn-secondary" onClick={addBellEntry} style={{ marginTop: 8, marginBottom: 12 }}>+ Jelzés hozzáadása</button>
            )}
            {pendingBell && (
              <div style={{ fontSize: 12, color: "#6a8", marginTop: 4, marginBottom: 12 }}>
                ↑ Állítsd be az időpontot, majd nyomj <strong>✓ Kész</strong>-t a beillesztéshez
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {!selectedTemplate?.isLocked && (
                <button className="sl-btn sl-btn-primary" onClick={saveTemplate} disabled={templateSaving}>
                  {templateSaving ? "Mentés..." : "💾 Mentés"}
                </button>
              )}
              <button className="sl-btn sl-btn-secondary" onClick={() => { setEditTemplate(null); setSelectedTemplate(null); setPendingBell(null); }}>Bezár</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Hangfájlok ──────────────────────────────────────────────────────────────

  function renderSounds() {
    const pct = Math.round((totalUsed / MAX_TOTAL_BYTES) * 100);
    return (
      <div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--sl-muted)", marginBottom: 4 }}>
            <span>Tárhelyhasználat</span><span>{fmtBytes(totalUsed)} / {fmtBytes(MAX_TOTAL_BYTES)}</span>
          </div>
          <div style={{ background: "#333", borderRadius: 4, height: 8, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: pct > 80 ? "#e55" : "#6c8ebf", transition: "width 0.3s" }} />
          </div>
          <div style={{ fontSize: 12, color: "var(--sl-muted)", marginTop: 4 }}>Elérhető: {fmtBytes(available)}</div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <input ref={fileInputRef} type="file" accept=".mp3,audio/mpeg" style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadSound(f); e.target.value = ""; }} />
          <button className="sl-btn sl-btn-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading || available <= 0}>
            {uploading ? "Feltöltés..." : "📤 MP3 feltöltése"}
          </button>
          {available <= 0 && <span style={{ marginLeft: 8, color: "#ef4444", fontSize: 13 }}>Nincs szabad hely!</span>}
        </div>
        {soundsLoading ? <div style={{ color: "var(--sl-muted)" }}>Betöltés...</div> : (
          <div style={{ display: "grid", gap: 8 }}>
            {sounds.map(s => (
              <div key={s.id} style={{ background: "var(--sl-surface)", border: "1px solid var(--sl-border)", borderRadius: 8, padding: 12, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 20 }}>🔔</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{s.filename}
                    {s.isDefault && <span style={{ marginLeft: 8, fontSize: 11, background: "#2a3a6a", color: "#3b82f6", borderRadius: 4, padding: "2px 6px" }}>Alapértelmezett</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--sl-muted)" }}>{fmtBytes(s.sizeBytes)}</div>
                </div>
                {!s.isDefault && <button className="sl-btn sl-btn-danger" onClick={() => deleteSound(s)}>Töröl</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, fontFamily: "'Nunito','Segoe UI',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
        :root{
          --sl-font:'Nunito','Segoe UI',sans-serif;
          --sl-blue:#3b82f6; --sl-blue-dark:#1d4ed8; --sl-blue-light:#eff6ff;
          --sl-indigo:#6366f1; --sl-green:#22c55e; --sl-red:#ef4444; --sl-amber:#f59e0b;
          --sl-bg:#f1f5fd; --sl-surface:#fff; --sl-border:#e2eaf8;
          --sl-text:#1e293b; --sl-text-2:#475569; --sl-muted:#94a3b8;
        }
        @media(prefers-color-scheme:dark){
          :root{
            --sl-bg:#07101f; --sl-surface:#0d1b2e; --sl-border:#1a2d47;
            --sl-text:#f0f6ff; --sl-text-2:#8da4c0; --sl-muted:#4a6280; --sl-blue-light:#0c2040;
          }
        }
        /* ── Button overrides ── */
        .sl-btn {
          display:inline-flex; align-items:center; gap:6px;
          padding:8px 16px; border-radius:11px; border:1.5px solid var(--sl-border);
          background:var(--sl-bg); color:var(--sl-text-2);
          font-size:13px; font-weight:700; cursor:pointer;
          transition:all 0.15s; font-family:var(--sl-font); white-space:nowrap;
        }
        .sl-btn:hover:not(:disabled){ background:var(--sl-border); color:var(--sl-text); }
        .sl-btn:disabled{ opacity:0.55; cursor:not-allowed; }
        .sl-btn-primary {
          background:linear-gradient(135deg,#3b82f6,#6366f1) !important;
          color:#fff !important; border-color:transparent !important;
          box-shadow:0 3px 10px rgba(99,102,241,0.28);
        }
        .sl-btn-primary:hover:not(:disabled){ transform:translateY(-1px); box-shadow:0 5px 14px rgba(99,102,241,0.36); }
        .sl-btn-secondary {
          background:var(--sl-blue-light) !important;
          color:var(--sl-blue-dark) !important; border-color:#bfdbfe !important;
        }
        .sl-btn-secondary:hover:not(:disabled){ background:#dbeafe !important; }
        .sl-btn-danger {
          background:#fff5f5 !important; color:#dc2626 !important; border-color:#fecaca !important;
        }
        .sl-btn-danger:hover:not(:disabled){ background:#fee2e2 !important; }
        /* ── Input / Select overrides ── */
        .sl-input, .sl-select {
          border:1.5px solid var(--sl-border); border-radius:11px;
          background:var(--sl-bg); color:var(--sl-text);
          font-size:13.5px; font-family:var(--sl-font); outline:none;
          padding:8px 12px; transition:all 0.15s;
        }
        .sl-input:focus, .sl-select:focus {
          border-color:#3b82f6; background:var(--sl-surface);
          box-shadow:0 0 0 3px rgba(59,130,246,0.11);
        }
        .sl-input::placeholder{ color:var(--sl-muted); }
        /* ── Calendar dark mode fix ── */
        .bs-cal-cell { border-radius:8px; padding:6px 4px; min-height:52px; position:relative; transition:background 0.12s; }
        .bs-cal-cell:hover { filter:brightness(1.08); }
      `}</style>

      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:24, flexWrap:"wrap" }}>
        <div>
          <h1 style={{ margin:0, fontSize:22, fontWeight:900, fontFamily:"var(--sl-font)", color:"var(--sl-text)", letterSpacing:"-0.5px" }}>🔔 Csengetési rend</h1>
          <div style={{ fontSize:13, color:"var(--sl-muted)", marginTop:3 }}>Naptár, sablonok és hangfájlok kezelése</div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center" }}>
          {!hasLock ? (
            <button className="sl-btn sl-btn-primary" onClick={acquireLock} disabled={lockLoading}>{lockLoading ? "⏳ …" : "✏️ Szerkesztés"}</button>
          ) : (
            <button className="sl-btn sl-btn-secondary" onClick={releaseLock}>🔓 Szerkesztés vége</button>
          )}
          {hasLock && (
            <span style={{ fontSize:12, color:"#15803d", background:"#f0fdf4", border:"1px solid #bbf7d0", padding:"4px 10px", borderRadius:20, fontWeight:700, fontFamily:"var(--sl-font)" }}>
              ✓ Szerkesztési zár aktív
            </span>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background:"#fef2f2", border:"1px solid #fecaca", borderRadius:11, padding:"10px 14px", marginBottom:16, color:"#dc2626", display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:13 }}>
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)} style={{ background:"none", border:"none", color:"#dc2626", cursor:"pointer", fontSize:18, lineHeight:1 }}>✕</button>
        </div>
      )}
      {success && (
        <div style={{ background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:11, padding:"10px 14px", marginBottom:16, color:"#15803d", fontSize:13, fontWeight:700 }}>✅ {success}</div>
      )}

      <div style={{ display:"flex", gap:4, marginBottom:20, background:"var(--sl-surface)", border:"1px solid var(--sl-border)", borderRadius:14, padding:4 }}>
        {(["calendar", "templates", "sounds"] as const).map((t, i) => {
          const labels = ["📅 Naptár", "📋 Sablonok", "🔊 Hangfájlok"];
          return (
            <button key={t} onClick={() => setTab(t)} style={{
              flex:1, background:tab===t?"linear-gradient(135deg,#eff6ff,#f5f3ff)":"transparent",
              border:tab===t?"1px solid #bfdbfe":"1px solid transparent",
              borderRadius:11, padding:"9px 16px",
              color:tab===t?"#1d4ed8":"var(--sl-muted)",
              cursor:"pointer", fontWeight:tab===t?800:600, fontSize:13.5,
              transition:"all 0.15s", fontFamily:"var(--sl-font)",
              boxShadow:tab===t?"0 1px 6px rgba(59,130,246,0.12)":"none",
            }}>
              {labels[i]}
            </button>
          );
        })}
      </div>

      {calLoading && tab === "calendar" && <div style={{ color: "var(--sl-muted)" }}>Naptár betöltése...</div>}
      {tab === "calendar" && renderCalendar()}
      {tab === "templates" && renderTemplates()}
      {tab === "sounds" && renderSounds()}
    </div>
  );
}