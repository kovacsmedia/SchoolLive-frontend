import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";

// ─── Típusok ──────────────────────────────────────────────────────────────────

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

type LockInfo = {
  userId: string;
  lockedAt: string;
};

const MAX_TOTAL_BYTES = 500 * 1024;
const DAYS_HU = ["V", "H", "K", "Sz", "Cs", "P", "Sz"];
const MONTHS_HU = [
  "Január", "Február", "Március", "Április", "Május", "Június",
  "Július", "Augusztus", "Szeptember", "Október", "November", "December",
];

function pad(n: number) { return String(n).padStart(2, "0"); }
function fmtTime(h: number, m: number) { return `${pad(h)}:${pad(m)}`; }
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

// ─── Fő komponens ─────────────────────────────────────────────────────────────

export default function BellSchedule() {
  const [tab, setTab] = useState<"calendar" | "templates" | "sounds">("calendar");

  // Naptár
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calDays, setCalDays] = useState<CalendarDay[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editDay, setEditDay] = useState<{ isHoliday: boolean; templateId: string | null } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sablonok
  const [templates, setTemplates] = useState<BellTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<BellTemplate | null>(null);
  const [editTemplate, setEditTemplate] = useState<{ name: string; bells: Omit<BellEntry, "id">[] } | null>(null);
  const [templateSaving, setTemplateSaving] = useState(false);

  // Hangfájlok
  const [sounds, setSounds] = useState<BellSoundFile[]>([]);
  const [soundsLoading, setSoundsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Szerkesztési zár
  const [hasLock, setHasLock] = useState(false);
  const [lockInfo, setLockInfo] = useState<LockInfo | null>(null);
  const [lockLoading, setLockLoading] = useState(false);

  // Üzenetek
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ─── Adatlekérések ───────────────────────────────────────────────────────────

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

  // ─── Szerkesztési zár ────────────────────────────────────────────────────────

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
    try {
      await apiFetch("/bells/lock", { method: "DELETE" });
    } catch { /* ignore */ }
    setHasLock(false);
  }

  useEffect(() => {
    return () => { if (hasLock) releaseLock(); };
  }, [hasLock]);

  // ─── Naptár szerkesztés ──────────────────────────────────────────────────────

  function getDayData(dateStr: string): CalendarDay | undefined {
    return calDays.find(d => d.date.startsWith(dateStr));
  }

  function onDayClick(dateStr: string) {
    if (!hasLock) return;
    const existing = getDayData(dateStr);
    setSelectedDate(dateStr);
    setEditDay({
      isHoliday: existing?.isHoliday ?? false,
      templateId: existing?.templateId ?? null,
    });
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
      setSelectedDate(null);
      setEditDay(null);
      setDirty(false);
      setSuccess("Nap mentve!");
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e?.message ?? "Mentési hiba");
    } finally {
      setSaving(false);
    }
  }

  async function initHolidays() {
    if (!hasLock) return;
    if (!confirm(`Betöltöd a ${calYear}. évi munkaszüneti- és hétvégi napokat? Ez felülírja a meglévő ünnepnap-jelöléseket!`)) return;
    try {
      const r = await apiFetch<{ ok: boolean; imported: number }>("/bells/calendar/init", {
        method: "POST",
        body: JSON.stringify({ year: calYear }),
        headers: { "Content-Type": "application/json" },
      });
      await loadCalendar();
      setSuccess(`${r.imported} szünnap betöltve!`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e?.message ?? "Hiba az ünnepnapok betöltésekor");
    }
  }

  // ─── Sablon szerkesztés ──────────────────────────────────────────────────────

  function startNewTemplate() {
    setEditTemplate({ name: "", bells: [] });
    setSelectedTemplate(null);
  }

  function startEditTemplate(t: BellTemplate) {
    setSelectedTemplate(t);
    setEditTemplate({
      name: t.name,
      bells: t.bells.map(b => ({ hour: b.hour, minute: b.minute, type: b.type, soundFile: b.soundFile })),
    });
  }

  function addBellEntry() {
    if (!editTemplate) return;
    setEditTemplate({
      ...editTemplate,
      bells: [...editTemplate.bells, { hour: 8, minute: 0, type: "MAIN", soundFile: "kibecsengo.mp3" }],
    });
  }

  function removeBellEntry(idx: number) {
    if (!editTemplate) return;
    setEditTemplate({
      ...editTemplate,
      bells: editTemplate.bells.filter((_, i) => i !== idx),
    });
  }

  function updateBellEntry(idx: number, field: string, value: string | number) {
    if (!editTemplate) return;
    const bells = [...editTemplate.bells];
    bells[idx] = { ...bells[idx], [field]: value };
    setEditTemplate({ ...editTemplate, bells });
  }

  async function saveTemplate() {
    if (!editTemplate) return;
    if (!editTemplate.name.trim()) { setError("A sablon neve kötelező!"); return; }
    setTemplateSaving(true);
    try {
      if (selectedTemplate) {
        await apiFetch(`/bells/templates/${selectedTemplate.id}`, {
          method: "PUT",
          body: JSON.stringify(editTemplate),
          headers: { "Content-Type": "application/json" },
        });
      } else {
        await apiFetch("/bells/templates", {
          method: "POST",
          body: JSON.stringify(editTemplate),
          headers: { "Content-Type": "application/json" },
        });
      }
      await loadTemplates();
      setEditTemplate(null);
      setSelectedTemplate(null);
      setSuccess("Sablon mentve!");
      setTimeout(() => setSuccess(null), 3000);
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
      setSuccess("Sablon törölve!");
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e?.message ?? "Törlési hiba");
    }
  }

  // ─── Hangfájl feltöltés ──────────────────────────────────────────────────────

  const totalUsed = sounds.reduce((s, f) => s + f.sizeBytes, 0);
  const available = MAX_TOTAL_BYTES - totalUsed;

  async function uploadSound(file: File) {
    if (file.size > available) {
      setError(`Nincs elég hely! Elérhető: ${fmtBytes(available)}, szükséges: ${fmtBytes(file.size)}`);
      return;
    }
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
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? `HTTP ${res.status}`);
      }
      await loadSounds();
      setSuccess("Hangfájl feltöltve!");
      setTimeout(() => setSuccess(null), 3000);
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
      setSuccess("Hangfájl törölve!");
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e?.message ?? "Törlési hiba");
    }
  }

  // ─── Navigáció figyelés (dirty check) ───────────────────────────────────────

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty) { e.preventDefault(); e.returnValue = ""; }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // ─── Naptár renderelés ───────────────────────────────────────────────────────

  function renderCalendar() {
    const daysInMonth = getDaysInMonth(calYear, calMonth);
    const firstDay = (getFirstDayOfMonth(calYear, calMonth) + 6) % 7; // H=0
    const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
    while (cells.length % 7 !== 0) cells.push(null);

    return (
      <div style={{ overflowX: "auto" }}>
        {/* Naptár fejléc */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <button className="sl-btn" onClick={() => { if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); } else setCalMonth(m => m - 1); }}>◀</button>
          <span style={{ fontWeight: 700, fontSize: 18, minWidth: 180, textAlign: "center" }}>{MONTHS_HU[calMonth]} {calYear}</span>
          <button className="sl-btn" onClick={() => { if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); } else setCalMonth(m => m + 1); }}>▶</button>
          <button className="sl-btn sl-btn-secondary" onClick={() => { setCalYear(today.getFullYear()); setCalMonth(today.getMonth()); }}>Ma</button>
          <button className="sl-btn sl-btn-secondary" onClick={() => setCalYear(y => y - 1)}>◀ {calYear - 1}</button>
          <button className="sl-btn sl-btn-secondary" onClick={() => setCalYear(y => y + 1)}>{calYear + 1} ▶</button>
          {hasLock && <button className="sl-btn" onClick={initHolidays} style={{ marginLeft: "auto" }}>🗓 Ünnepnapok betöltése</button>}
        </div>

        {/* Hét napjai */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 2 }}>
          {["H", "K", "Sz", "Cs", "P", "Sz", "V"].map((d, i) => (
            <div key={i} style={{ textAlign: "center", fontWeight: 700, fontSize: 12, color: i >= 5 ? "#e55" : "#888", padding: "4px 0" }}>{d}</div>
          ))}
        </div>

        {/* Naptár cellák */}
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
              <div
                key={idx}
                onClick={() => onDayClick(dateStr)}
                style={{
                  background: bg,
                  border: isSelected ? "2px solid #6c8ebf" : "2px solid transparent",
                  borderRadius: 6,
                  padding: "6px 4px",
                  minHeight: 52,
                  cursor: hasLock ? "pointer" : "default",
                  position: "relative",
                  transition: "background 0.15s",
                }}
                title={data?.template?.name ?? (isHoliday ? "Szünnap" : "Normál rend")}
              >
                <div style={{ fontSize: 13, fontWeight: isToday ? 700 : 400, color: isToday ? "#6c8ebf" : isWeekend ? "#e55" : "#ccc" }}>{day}</div>
                {isHoliday && !isWeekend && <div style={{ fontSize: 9, color: "#e55", marginTop: 2 }}>SZÜNNAP</div>}
                {isWeekend && <div style={{ fontSize: 9, color: "#e55", marginTop: 2 }}>HÉTVÉGE</div>}
                {hasCustomTemplate && !isHoliday && <div style={{ fontSize: 9, color: "#6c6", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data?.template?.name?.slice(0, 10)}</div>}
              </div>
            );
          })}
        </div>

        {/* Nap szerkesztő panel */}
        {selectedDate && editDay && (
          <div style={{ marginTop: 20, background: "#1a1a2e", border: "1px solid #333", borderRadius: 8, padding: 16 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>📅 {selectedDate} szerkesztése</h3>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={editDay.isHoliday} onChange={e => { setEditDay({ ...editDay, isHoliday: e.target.checked, templateId: e.target.checked ? null : editDay.templateId }); setDirty(true); }} />
              <span>Csengetésmentes nap (szünnap)</span>
            </label>
            {!editDay.isHoliday && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, color: "#888", display: "block", marginBottom: 4 }}>Csengetési rend</label>
                <select
                  className="sl-select"
                  value={editDay.templateId ?? ""}
                  onChange={e => { setEditDay({ ...editDay, templateId: e.target.value || null }); setDirty(true); }}
                >
                  <option value="">Normál csengetési rend (alapértelmezett)</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="sl-btn sl-btn-primary" onClick={() => {
                if (!confirm("Biztosan mentod a változtatásokat?")) return;
                saveDay();
              }} disabled={saving}>{saving ? "Mentés..." : "💾 Mentés"}</button>
              <button className="sl-btn sl-btn-secondary" onClick={() => {
                if (dirty && !confirm("Biztosan elveted a változtatásokat?")) return;
                setSelectedDate(null); setEditDay(null); setDirty(false);
              }}>Mégse</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Sablon renderelés ───────────────────────────────────────────────────────

  function renderTemplates() {
    return (
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Csengetési rend sablonok</h3>
          {!editTemplate && templates.length < 6 && (
            <button className="sl-btn sl-btn-primary" onClick={startNewTemplate} style={{ marginLeft: "auto" }}>+ Új sablon</button>
          )}
        </div>

        {templatesLoading ? <div style={{ color: "#888" }}>Betöltés...</div> : (
          <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
            {templates.map(t => (
              <div key={t.id} style={{ background: "#1a1a2e", border: "1px solid #333", borderRadius: 8, padding: 12, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{t.name}
                    {t.isDefault && <span style={{ marginLeft: 8, fontSize: 11, background: "#2a3a6a", color: "#6c8ebf", borderRadius: 4, padding: "2px 6px" }}>Alapértelmezett</span>}
                    {t.isLocked && <span style={{ marginLeft: 8, fontSize: 11, background: "#3a2a1a", color: "#c86", borderRadius: 4, padding: "2px 6px" }}>🔒 Zárolt</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>{t.bells.length} jelzés</div>
                </div>
                <button className="sl-btn sl-btn-secondary" onClick={() => startEditTemplate(t)}>👁 Megtekint{!t.isLocked ? " / Szerkeszt" : ""}</button>
                {!t.isLocked && <button className="sl-btn sl-btn-danger" onClick={() => deleteTemplate(t)}>Töröl</button>}
              </div>
            ))}
          </div>
        )}

        {editTemplate && (
          <div style={{ background: "#111122", border: "1px solid #444", borderRadius: 8, padding: 16 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>
              {selectedTemplate ? `${selectedTemplate.isLocked ? "👁 " : "✏️ "}${selectedTemplate.name}` : "Új sablon"}
            </h3>
            {!selectedTemplate?.isLocked && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, color: "#888", display: "block", marginBottom: 4 }}>Sablon neve</label>
                <input className="sl-input" value={editTemplate.name} onChange={e => setEditTemplate({ ...editTemplate, name: e.target.value })} placeholder="pl. Rövidített nap" />
              </div>
            )}

            <div style={{ marginBottom: 8, fontSize: 13, color: "#888", display: "grid", gridTemplateColumns: "60px 70px 100px 1fr 40px", gap: 8, padding: "0 4px" }}>
              <span>Időpont</span><span>Típus</span><span>Hang</span><span></span><span></span>
            </div>

            {editTemplate.bells.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute)).map((bell, idx) => (
              <div key={idx} style={{ display: "grid", gridTemplateColumns: "60px 70px 1fr auto", gap: 8, marginBottom: 6, alignItems: "center" }}>
                <div style={{ display: "flex", gap: 2 }}>
                  <input type="number" className="sl-input" style={{ width: 28, padding: "4px 2px", textAlign: "center" }} min={0} max={23} value={bell.hour}
                    onChange={e => updateBellEntry(idx, "hour", parseInt(e.target.value) || 0)} disabled={selectedTemplate?.isLocked} />
                  <span style={{ alignSelf: "center" }}>:</span>
                  <input type="number" className="sl-input" style={{ width: 28, padding: "4px 2px", textAlign: "center" }} min={0} max={59} value={bell.minute}
                    onChange={e => updateBellEntry(idx, "minute", parseInt(e.target.value) || 0)} disabled={selectedTemplate?.isLocked} />
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

            {!selectedTemplate?.isLocked && (
              <button className="sl-btn sl-btn-secondary" onClick={addBellEntry} style={{ marginTop: 8, marginBottom: 12 }}>+ Jelzés hozzáadása</button>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {!selectedTemplate?.isLocked && (
                <button className="sl-btn sl-btn-primary" onClick={saveTemplate} disabled={templateSaving}>
                  {templateSaving ? "Mentés..." : "💾 Mentés"}
                </button>
              )}
              <button className="sl-btn sl-btn-secondary" onClick={() => { setEditTemplate(null); setSelectedTemplate(null); }}>Bezár</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Hangfájlok renderelés ───────────────────────────────────────────────────

  function renderSounds() {
    const pct = Math.round((totalUsed / MAX_TOTAL_BYTES) * 100);
    return (
      <div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#888", marginBottom: 4 }}>
            <span>Tárhelyhasználat</span>
            <span>{fmtBytes(totalUsed)} / {fmtBytes(MAX_TOTAL_BYTES)}</span>
          </div>
          <div style={{ background: "#333", borderRadius: 4, height: 8, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: pct > 80 ? "#e55" : "#6c8ebf", transition: "width 0.3s" }} />
          </div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>Elérhető: {fmtBytes(available)}</div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <input ref={fileInputRef} type="file" accept=".mp3,audio/mpeg" style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadSound(f); e.target.value = ""; }} />
          <button className="sl-btn sl-btn-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading || available <= 0}>
            {uploading ? "Feltöltés..." : "📤 MP3 feltöltése"}
          </button>
          {available <= 0 && <span style={{ marginLeft: 8, color: "#e55", fontSize: 13 }}>Nincs szabad hely!</span>}
        </div>

        {soundsLoading ? <div style={{ color: "#888" }}>Betöltés...</div> : (
          <div style={{ display: "grid", gap: 8 }}>
            {sounds.map(s => (
              <div key={s.id} style={{ background: "#1a1a2e", border: "1px solid #333", borderRadius: 8, padding: 12, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 20 }}>🔔</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{s.filename}
                    {s.isDefault && <span style={{ marginLeft: 8, fontSize: 11, background: "#2a3a6a", color: "#6c8ebf", borderRadius: 4, padding: "2px 6px" }}>Alapértelmezett</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "#888" }}>{fmtBytes(s.sizeBytes)}</div>
                </div>
                {!s.isDefault && (
                  <button className="sl-btn sl-btn-danger" onClick={() => deleteSound(s)}>Töröl</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>🔔 Csengetési rend</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {!hasLock ? (
            <button className="sl-btn sl-btn-primary" onClick={acquireLock} disabled={lockLoading}>
              {lockLoading ? "..." : "✏️ Szerkesztés"}
            </button>
          ) : (
            <button className="sl-btn sl-btn-secondary" onClick={releaseLock}>🔓 Szerkesztés vége</button>
          )}
          {hasLock && <span style={{ fontSize: 12, color: "#6c8", background: "#1a2a1a", padding: "4px 8px", borderRadius: 4 }}>✓ Szerkesztési zár aktív</span>}
        </div>
      </div>

      {error && (
        <div style={{ background: "#2a1a1a", border: "1px solid #e55", borderRadius: 8, padding: 12, marginBottom: 16, color: "#e88", display: "flex", justifyContent: "space-between" }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "#e88", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
      )}
      {success && (
        <div style={{ background: "#1a2a1a", border: "1px solid #6c8", borderRadius: 8, padding: 12, marginBottom: 16, color: "#6c8" }}>
          ✓ {success}
        </div>
      )}

      {/* Tabok */}
      <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "2px solid #333" }}>
        {(["calendar", "templates", "sounds"] as const).map((t, i) => {
          const labels = ["📅 Naptár", "📋 Sablonok", "🔊 Hangfájlok"];
          return (
            <button key={t} onClick={() => setTab(t)} style={{
              background: "none", border: "none", borderBottom: tab === t ? "2px solid #6c8ebf" : "2px solid transparent",
              marginBottom: -2, padding: "10px 20px", color: tab === t ? "#6c8ebf" : "#888",
              cursor: "pointer", fontWeight: tab === t ? 700 : 400, fontSize: 14, transition: "all 0.15s",
            }}>
              {labels[i]}
            </button>
          );
        })}
      </div>

      {calLoading && tab === "calendar" && <div style={{ color: "#888" }}>Naptár betöltése...</div>}
      {tab === "calendar" && renderCalendar()}
      {tab === "templates" && renderTemplates()}
      {tab === "sounds" && renderSounds()}
    </div>
  );
}
