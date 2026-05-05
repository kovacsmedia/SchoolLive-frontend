import { useEffect, useRef, useState } from "react";
import { apiFetch, apiPost } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

type MessageItem = {
  id:string; title:string|null; text:string|null; type:string; voice:string|null; fileUrl:string|null;
  targetType:string; targetId:string|null; scheduledAt:string|null; playedAt:string|null; createdAt:string;
  createdBy:{ id:string; displayName:string|null; email:string };
};
type Template     = { id:string; name:string; text:string; voice:string; createdAt:string };
type Device       = { id:string; name:string; online:boolean; deviceClass:string };
type DeviceGroup  = { id:string; name:string };
type ScheduleType = "immediate"|"next_bell"|"custom";
type BellEntry    = { hour: number; minute: number; type: string };
type ComposerMode = "tts" | "record";
type RecordState  = "idle" | "recording" | "recorded";

function getNextBreakTime(bells: BellEntry[]): Date | null {
  const sorted = [...bells].sort((a,b) => a.hour*60+a.minute - (b.hour*60+b.minute));
  const now = new Date();
  const todayMin = now.getHours()*60 + now.getMinutes();
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i+1];
    const gap = (b.hour*60+b.minute) - (a.hour*60+a.minute);
    if (gap >= 40 && gap <= 55) {
      const breakMin = b.hour*60+b.minute;
      if (breakMin > todayMin) {
        const d = new Date(); d.setHours(b.hour, b.minute, 5, 0);
        return d;
      }
    }
  }
  return null;
}
function checkLessonOverlap(scheduledAt: Date, bells: BellEntry[]): boolean {
  const sorted = [...bells].sort((a,b) => a.hour*60+a.minute - (b.hour*60+b.minute));
  const sm = scheduledAt.getHours()*60 + scheduledAt.getMinutes();
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i+1];
    const gap = (b.hour*60+b.minute) - (a.hour*60+a.minute);
    if (gap >= 40 && gap <= 55) {
      if (sm > a.hour*60+a.minute && sm < b.hour*60+b.minute) return true;
    }
  }
  return false;
}
function formatDate(iso:string|null) {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("hu-HU",{ year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit" });
}
function excerpt(text:string|null,n=60) {
  if (!text) return "–";
  return text.length > n ? text.slice(0,n)+"…" : text;
}
function messageExcerpt(m: MessageItem): string {
  if (!m.text && m.fileUrl && m.fileUrl.includes("/rec_")) return "🎙️ Hangüzenet";
  if (!m.text) return "–";
  return excerpt(m.text);
}
const VOICE_LABELS:Record<string,string> = { anna:"Anna (női)", berta:"Berta (női)", imre:"Imre (férfi)" };
const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "https://api.schoollive.hu";

const CSS = `
  .ms-page{max-width:860px;font-family:'Nunito','Segoe UI',sans-serif}
  .ms-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;gap:12px;flex-wrap:wrap}
  .ms-title{font-size:22px;font-weight:900;color:var(--sl-text);letter-spacing:-0.5px}
  .ms-subtitle{font-size:13px;color:var(--sl-muted);margin-top:3px}
  .ms-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border-radius:11px;border:none;font-size:13.5px;font-weight:700;cursor:pointer;transition:all 0.15s;font-family:inherit;white-space:nowrap}
  .ms-btn:disabled{opacity:0.55;cursor:not-allowed}
  .ms-btn-primary{background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;box-shadow:0 3px 10px rgba(99,102,241,0.28)}
  .ms-btn-primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 5px 14px rgba(99,102,241,0.36)}
  .ms-btn-ghost{background:var(--sl-bg);border:1.5px solid var(--sl-border);color:var(--sl-text-2)}
  .ms-btn-ghost:hover:not(:disabled){background:var(--sl-border)}
  .ms-btn-danger{background:#fff5f5;border:1.5px solid #fecaca;color:#dc2626}
  .ms-btn-danger:hover:not(:disabled){background:#fee2e2}
  .ms-btn-rec{background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;box-shadow:0 3px 10px rgba(220,38,38,0.32)}
  .ms-btn-rec:hover:not(:disabled){transform:translateY(-1px)}
  .ms-btn-sm{padding:5px 11px;font-size:12px;border-radius:8px}
  .ms-card{background:var(--sl-surface);border:1px solid var(--sl-border);border-radius:18px;overflow:hidden;box-shadow:0 2px 12px rgba(59,130,246,0.07);margin-bottom:8px}
  .ms-msg-row{display:grid;grid-template-columns:auto 1fr auto auto auto auto;align-items:center;gap:14px;padding:14px 18px;border-bottom:1px solid var(--sl-border);transition:background 0.12s}
  .ms-msg-row:last-child{border-bottom:none}
  .ms-msg-row:hover{background:rgba(59,130,246,0.03)}
  .ms-msg-excerpt{font-size:14px;font-weight:600;color:var(--sl-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ms-msg-meta{font-size:12px;color:var(--sl-muted);white-space:nowrap}
  .ms-msg-time{font-size:12px;color:var(--sl-muted);white-space:nowrap}
  .ms-pagination{display:flex;align-items:center;gap:10px;margin-top:16px;font-size:13px;color:var(--sl-muted);justify-content:center}
  .ms-alert{padding:10px 14px;border-radius:11px;font-size:13px;display:flex;align-items:flex-start;gap:8px;margin-bottom:14px}
  .ms-alert-error{background:#fef2f2;border:1px solid #fecaca;color:#dc2626}
  .ms-alert-success{background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d}
  .ms-empty{text-align:center;padding:52px 20px;color:var(--sl-muted)}
  .ms-empty-icon{font-size:44px;margin-bottom:12px}
  .ms-empty-txt{font-size:15px;font-weight:700;font-family:'Nunito',sans-serif;color:var(--sl-text-2)}
  .ms-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.44);backdrop-filter:blur(4px);z-index:100;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto;animation:msFade 0.15s ease}
  .ms-modal{background:var(--sl-surface);border:1px solid var(--sl-border);border-radius:22px;padding:0;width:100%;max-width:660px;box-shadow:0 24px 64px rgba(0,0,0,0.18);animation:msSlide 0.2s ease}
  .ms-modal-hdr{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--sl-border)}
  .ms-modal-title{font-family:'Nunito',sans-serif;font-size:17px;font-weight:900;color:var(--sl-text);display:flex;align-items:center;gap:8px}
  .ms-modal-body{padding:20px 22px;display:flex;flex-direction:column;gap:18px}
  .ms-modal-footer{padding:14px 22px;border-top:1px solid var(--sl-border);display:flex;justify-content:flex-end;gap:10px}
  .ms-close{width:32px;height:32px;border-radius:8px;border:1.5px solid var(--sl-border);background:var(--sl-bg);color:var(--sl-muted);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s}
  .ms-close:hover{background:var(--sl-border);color:var(--sl-text)}
  .ms-label{display:block;font-size:11.5px;font-weight:800;color:var(--sl-text-2);margin-bottom:5px;letter-spacing:0.3px;text-transform:uppercase;font-family:'Nunito',sans-serif}
  .ms-textarea{width:100%;min-height:110px;padding:11px 13px;border:1.5px solid var(--sl-border);border-radius:12px;background:var(--sl-bg);color:var(--sl-text);font-size:14px;line-height:1.65;resize:vertical;font-family:inherit;outline:none;transition:all 0.15s}
  .ms-textarea:focus{border-color:#3b82f6;background:var(--sl-surface);box-shadow:0 0 0 3px rgba(59,130,246,0.11)}
  .ms-input{width:100%;height:38px;padding:0 12px;border:1.5px solid var(--sl-border);border-radius:11px;background:var(--sl-bg);color:var(--sl-text);font-size:13.5px;font-family:inherit;outline:none;transition:all 0.15s}
  .ms-input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,0.11)}
  .ms-select{height:38px;padding:0 12px;border:1.5px solid var(--sl-border);border-radius:11px;background:var(--sl-bg);color:var(--sl-text);font-size:13.5px;font-family:inherit;outline:none;cursor:pointer;min-width:160px}
  .ms-select:focus{border-color:#3b82f6}
  .ms-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .ms-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:20px;border:1.5px solid var(--sl-border);background:var(--sl-bg);font-size:13px;font-weight:600;font-family:'Nunito',sans-serif;color:var(--sl-text-2);cursor:pointer;transition:all 0.15s}
  .ms-chip.active{background:linear-gradient(135deg,#eff6ff,#f5f3ff);border-color:#bfdbfe;color:#1d4ed8;font-weight:800}
  .ms-chip:hover:not(.active){border-color:#bfdbfe;color:var(--sl-text)}
  .ms-tpl-bar{display:flex;gap:8px;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--sl-border);border-radius:12px;background:var(--sl-bg)}
  .ms-tpl-chip{height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--sl-border);background:var(--sl-surface);font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:6px;color:var(--sl-text-2);transition:all 0.12s;font-family:inherit}
  .ms-tpl-chip:hover{background:#f0f7ff;border-color:#bfdbfe;color:#1d4ed8}
  .ms-tpl-del{color:var(--sl-muted);font-size:10px;cursor:pointer}
  .ms-tpl-del:hover{color:#ef4444}
  .ms-device-list{display:flex;flex-direction:column;gap:5px;max-height:180px;overflow-y:auto;padding:8px;border:1.5px solid var(--sl-border);border-radius:11px;background:var(--sl-bg)}
  .ms-device-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:9px;cursor:pointer;transition:background 0.12s;border:1.5px solid transparent}
  .ms-device-item:hover{background:var(--sl-border)}
  .ms-device-item.selected{background:rgba(59,130,246,0.18);border-color:#3b82f6;color:var(--sl-text)}
  .ms-dot-on{width:7px;height:7px;border-radius:50%;background:#22c55e;flex-shrink:0}
  .ms-dot-off{width:7px;height:7px;border-radius:50%;background:#94a3b8;flex-shrink:0}
  .ms-detail-grid{display:grid;grid-template-columns:130px 1fr;gap:8px 16px;font-size:13.5px;margin-bottom:18px}
  .ms-detail-key{font-weight:800;color:var(--sl-muted);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;padding-top:3px;font-family:'Nunito',sans-serif}
  .ms-detail-body{background:var(--sl-bg);border:1px solid var(--sl-border);border-radius:11px;padding:12px 14px;font-size:14px;line-height:1.65;white-space:pre-wrap;word-break:break-word;grid-column:1/-1;margin-top:6px}
  /* Felvétel UI */
  .ms-mode-tabs{display:flex;gap:0;border:1.5px solid var(--sl-border);border-radius:12px;overflow:hidden;background:var(--sl-bg)}
  .ms-mode-tab{flex:1;padding:9px 16px;border:none;background:transparent;font-size:13.5px;font-weight:700;font-family:inherit;cursor:pointer;color:var(--sl-text-2);transition:all 0.15s}
  .ms-mode-tab.active{background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff}
  .ms-rec-center{display:flex;flex-direction:column;align-items:center;gap:20px;padding:28px 20px;border:1.5px solid var(--sl-border);border-radius:16px;background:var(--sl-bg)}
  .ms-mic-icon{font-size:56px;line-height:1}
  @keyframes msPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.18);opacity:0.7}}
  .ms-mic-pulse{animation:msPulse 1s ease-in-out infinite}
  .ms-rec-time{font-size:32px;font-weight:900;font-family:monospace;color:var(--sl-text);letter-spacing:2px}
  .ms-rec-hint{font-size:13px;color:var(--sl-muted);text-align:center}
  @keyframes msFade{from{opacity:0}to{opacity:1}}
  @keyframes msSlide{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}
  @media(max-width:600px){.ms-msg-row{grid-template-columns:auto 1fr auto auto}.ms-msg-meta,.ms-msg-time{display:none}}
`;

// Segédfüggvény: felvételi idő formázása
function fmtRecTime(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function Messages() {
  const { state } = useAuth();
  const role = state.status === "authed" ? (state.user as any)?.role || "" : "";
  const canDelete = role === "SUPER_ADMIN" || role === "TENANT_ADMIN";

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage]   = useState(1);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string|null>(null);
  const [detailMsg, setDetailMsg] = useState<MessageItem|null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  // TTS state
  const [composerMode, setComposerMode] = useState<ComposerMode>("tts");
  const [text, setText]   = useState("");
  const [voice, setVoice] = useState("anna");

  // Közös state
  const [scheduleType, setScheduleType] = useState<ScheduleType>("immediate");
  const [customTime, setCustomTime] = useState("");
  const [targetType, setTargetType] = useState<"DEVICE"|"GROUP"|"ALL">("ALL");
  const [targetId, setTargetId]     = useState("");
  const [sending, setSending]       = useState(false);
  const [sendError, setSendError]   = useState<string|null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);

  // Sablon state
  const [templates, setTemplates]   = useState<Template[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateMsg, setTemplateMsg] = useState<string|null>(null);

  const [devices, setDevices] = useState<Device[]>([]);
  const [groups, setGroups]   = useState<DeviceGroup[]>([]);
  const [bells,  setBells]    = useState<BellEntry[]>([]);

  // Recording state
  const [recState, setRecState]       = useState<RecordState>("idle");
  const [recSeconds, setRecSeconds]   = useState(0);
  const [recBlob, setRecBlob]         = useState<Blob|null>(null);
  const [recAudioUrl, setRecAudioUrl] = useState<string|null>(null);
  const [recError, setRecError]       = useState<string|null>(null);
  const mediaRecorderRef = useRef<MediaRecorder|null>(null);
  const recChunksRef     = useRef<BlobPart[]>([]);
  const recTimerRef      = useRef<ReturnType<typeof setInterval>|null>(null);

  const LIMIT = 20;

  async function loadMessages(p=1) {
    setLoading(true); setListError(null);
    try {
      const res = await apiFetch<{ok:boolean;messages:MessageItem[];total:number}>(`/messages?page=${p}&limit=${LIMIT}`);
      setMessages(res.messages); setTotal(res.total); setPage(p);
    } catch (e:any) { setListError(e?.message??"Betöltés sikertelen"); }
    finally { setLoading(false); }
  }
  async function loadTemplates() {
    try { const r = await apiFetch<{ok:boolean;templates:Template[]}>("/messages/templates"); setTemplates(r.templates); } catch {}
  }
  async function loadDevices() {
    try {
      const r = await apiFetch<{devices:any[]}>("/admin/devices/health");
      setDevices((r.devices ?? []).map((d: any) => ({ ...d, id: String(d.id ?? d.deviceId ?? "") })));
    } catch {}
  }
  async function loadGroups() {
    try { const r = await apiFetch<{groups:DeviceGroup[]}>("/admin/devices/groups"); setGroups(r.groups??[]); } catch {}
  }

  async function deleteMessage(id:string) { try { await apiFetch(`/messages/${id}`,{method:"DELETE"}); } catch {} }
  async function doDeleteOne(id:string) {
    if (!window.confirm("Törlöd ezt az üzenetet?")) return;
    await deleteMessage(id); await loadMessages(page);
  }
  async function doBulkDelete() {
    if (!window.confirm(`Törlöd a(z) ${selectedIds.size} kijelölt üzenetet?`)) return;
    await Promise.all(Array.from(selectedIds).map(id => deleteMessage(id)));
    setSelectedIds(new Set()); await loadMessages(page);
  }
  function toggleSelect(id:string) {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  useEffect(() => { loadMessages(1); }, []);
  useEffect(() => {
    if (composerOpen) {
      loadTemplates(); loadDevices(); loadGroups();
      apiFetch<{ok:boolean;templates:Array<{bells:BellEntry[];isDefault:boolean}>}>("/bells/templates")
        .then(r => {
          const def = r.templates?.find(t => t.isDefault) ?? r.templates?.[0];
          if (def) setBells(def.bells.filter(b => b.type === "MAIN"));
        }).catch(() => {});
    }
  }, [composerOpen]);

  // Cleanup recording on close
  useEffect(() => {
    if (!composerOpen) {
      stopRecordingCleanup();
    }
  }, [composerOpen]);

  function openComposer() {
    setText(""); setVoice("anna"); setScheduleType("immediate"); setCustomTime("");
    setTargetType("ALL"); setTargetId(""); setSendError(null); setSendSuccess(false);
    setTemplateName(""); setTemplateMsg(null);
    setComposerMode("tts");
    setRecState("idle"); setRecBlob(null); setRecAudioUrl(null); setRecError(null); setRecSeconds(0);
    setComposerOpen(true);
  }
  function closeComposer() {
    stopRecordingCleanup();
    setComposerOpen(false); setSendSuccess(false);
  }

  // ── Felvétel logika ────────────────────────────────────────────────────────

  function stopRecordingCleanup() {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
  }

  async function startRecording() {
    setRecError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Engedély megőrzése localStorage-ban (tájékoztatás céljából)
      localStorage.setItem("mic_permission_granted", "1");

      recChunksRef.current = [];
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorderRef.current = mr;

      mr.ondataavailable = e => { if (e.data.size > 0) recChunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(recChunksRef.current, { type: "audio/webm" });
        setRecBlob(blob);
        setRecAudioUrl(URL.createObjectURL(blob));
        setRecState("recorded");
        // Mikrofon stream leállítása
        stream.getTracks().forEach(t => t.stop());
      };

      mr.start(100);
      setRecState("recording");
      setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
    } catch (e: any) {
      if (e.name === "NotAllowedError") {
        setRecError("Mikrofon hozzáférés megtagadva. Engedélyezze a böngészőben.");
      } else {
        setRecError("Mikrofon nem érhető el: " + e.message);
      }
    }
  }

  function stopRecording() {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
  }

  function resetRecording() {
    stopRecordingCleanup();
    if (recAudioUrl) URL.revokeObjectURL(recAudioUrl);
    setRecState("idle"); setRecBlob(null); setRecAudioUrl(null); setRecSeconds(0); setRecError(null);
  }

  // ── Küldés ─────────────────────────────────────────────────────────────────

  function getScheduledAt(): string | null {
    if (scheduleType === "immediate") return null;
    if (scheduleType === "next_bell") {
      const nb = getNextBreakTime(bells);
      return nb ? nb.toISOString() : null;
    }
    if (scheduleType === "custom" && customTime) {
      const today = new Date().toISOString().slice(0,10);
      return new Date(`${today}T${customTime}:00`).toISOString();
    }
    return null;
  }

  async function sendTTS() {
    if (!text.trim()) { setSendError("A szöveg nem lehet üres!"); return; }
    if (targetType !== "ALL" && !targetId) { setSendError("Válassz célt!"); return; }
    if (scheduleType === "next_bell" && !getNextBreakTime(bells)) { setSendError("Ma már nincs több szünet."); return; }
    if (scheduleType === "custom") {
      if (!customTime) { setSendError("Add meg az időpontot!"); return; }
      const today = new Date().toISOString().slice(0,10);
      const dt = new Date(`${today}T${customTime}:00`);
      if (dt <= new Date()) { setSendError("A megadott időpont már elmúlt!"); return; }
      if (checkLessonOverlap(dt, bells)) {
        if (!window.confirm("⚠️ Tanítási óra alatti időpont! Biztosan így szeretnéd?")) return;
      }
    }
    setSendError(null); setSending(true);
    try {
      await apiPost("/messages", { text: text.trim(), voice, targetType, targetId: targetType === "ALL" ? undefined : targetId, scheduledAt: getScheduledAt() });
      setSendSuccess(true); await loadMessages(1);
    } catch (e:any) { setSendError(e?.message ?? "Küldés sikertelen"); }
    finally { setSending(false); }
  }

  async function sendRecording() {
    if (!recBlob) { setSendError("Nincs rögzített hang!"); return; }
    if (targetType !== "ALL" && !targetId) { setSendError("Válassz célt!"); return; }
    setSendError(null); setSending(true);
    try {
      const formData = new FormData();
      formData.append("audio", recBlob, "recording.webm");
      formData.append("targetType", targetType);
      if (targetType !== "ALL" && targetId) formData.append("targetId", targetId);
      const scheduledAt = getScheduledAt();
      if (scheduledAt) formData.append("scheduledAt", scheduledAt);

      const token = sessionStorage.getItem("accessToken") ?? localStorage.getItem("accessToken") ?? "";
      // "activeTenantId" – ugyanaz a kulcs mint BellSchedule/Devices/SchoolRadio oldalakon
      const tenantId = sessionStorage.getItem("activeTenantId") ?? localStorage.getItem("activeTenantId") ?? "";

      const resp = await fetch(`${API_BASE}/messages/audio`, {
        method: "POST",
        headers: {
          ...(token     ? { Authorization: `Bearer ${token}` } : {}),
          ...(tenantId  ? { "x-tenant-id": tenantId } : {}),
        },
        body: formData,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Feltöltés sikertelen");
      setSendSuccess(true); await loadMessages(1);
    } catch (e:any) { setSendError(e?.message ?? "Küldés sikertelen"); }
    finally { setSending(false); }
  }

  async function saveTemplate() {
    if (!templateName.trim() || !text.trim()) { setTemplateMsg("Adj meg nevet és szöveget!"); return; }
    setSavingTemplate(true); setTemplateMsg(null);
    try { await apiPost("/messages/templates",{name:templateName.trim(),text,voice}); setTemplateMsg("Sablon elmentve!"); setTemplateName(""); await loadTemplates(); }
    catch (e:any) { setTemplateMsg(e?.message??"Mentés sikertelen"); }
    finally { setSavingTemplate(false); }
  }
  async function deleteTemplate(id:string) {
    try { await apiFetch(`/messages/templates/${id}`,{method:"DELETE"}); await loadTemplates(); } catch {}
  }

  const totalPages = Math.ceil(total/LIMIT);

  // ── Cél + ütemezés UI (közös TTS és Recording esetén) ─────────────────────
  function TargetAndSchedule() {
    return (
      <>
        {/* Cél */}
        <div>
          <div className="ms-label">🎯 Lejátszó eszközök</div>
          <div className="ms-row" style={{ marginBottom:10 }}>
            {(["ALL","DEVICE","GROUP"] as const).map(t => (
              <div key={t} className={"ms-chip"+(targetType===t?" active":"")} onClick={() => { setTargetType(t); setTargetId(""); }}>
                {t==="ALL"?"📡 Összes":t==="DEVICE"?"🔊 Egyedi":"👥 Csoport"}
              </div>
            ))}
          </div>
          {targetType==="DEVICE" && (
            <div className="ms-device-list">
              {devices.length===0 && <div style={{fontSize:13,color:"var(--sl-muted)",padding:8}}>Nincs elérhető eszköz</div>}
              {devices.map(d => (
                <div key={d.id||d.name} className={"ms-device-item"+(targetId===d.id&&d.id!==""?" selected":"")} onClick={() => setTargetId(p => p===d.id?"":d.id)}>
                  <span className={d.online?"ms-dot-on":"ms-dot-off"} />
                  <span style={{fontSize:13.5,fontWeight:600}}>{d.name}</span>
                  <span style={{fontSize:11,color:"var(--sl-muted)",marginLeft:"auto"}}>{d.deviceClass}</span>
                </div>
              ))}
            </div>
          )}
          {targetType==="GROUP" && (
            <select className="ms-select" value={targetId} onChange={e => setTargetId(e.target.value)}>
              <option value="">Válassz csoportot…</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
        </div>

        {/* Ütemezés */}
        <div>
          <div className="ms-label">⏰ Lejátszás időpontja</div>
          <div className="ms-row">
            {(["immediate","next_bell","custom"] as ScheduleType[]).map(s => (
              <div key={s} className={"ms-chip"+(scheduleType===s?" active":"")} onClick={() => setScheduleType(s)}>
                {s==="immediate"?"⚡ Azonnal":s==="next_bell"?"🔔 Köv. szünet":"🕐 Időpont"}
              </div>
            ))}
          </div>
          {scheduleType==="next_bell" && (() => {
            const nb = getNextBreakTime(bells);
            return (
              <div style={{fontSize:12,marginTop:8,padding:"7px 11px",borderRadius:9,background:nb?"#f0fdf4":"#fef2f2",color:nb?"#15803d":"#dc2626",border:"1px solid",borderColor:nb?"#bbf7d0":"#fecaca"}}>
                {nb ? `⏱ Következő szünet: ${nb.toLocaleTimeString("hu-HU",{hour:"2-digit",minute:"2-digit"})}` : "⚠️ Ma már nincs több szünet."}
              </div>
            );
          })()}
          {scheduleType==="custom" && (
            <div style={{marginTop:10}}>
              <input type="time" className="ms-input" style={{width:"auto"}} value={customTime} onChange={e => setCustomTime(e.target.value)} />
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="ms-page">
      <style>{CSS}</style>

      <div className="ms-hdr">
        <div>
          <div className="ms-title">📢 Üzenetek</div>
          <div className="ms-subtitle">Iskolai hangüzenetek küldése és előzményei.</div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          {canDelete && selectedIds.size > 0 && (
            <button className="ms-btn ms-btn-danger" onClick={doBulkDelete}>🗑 Kijelöltek törlése ({selectedIds.size})</button>
          )}
          <button className="ms-btn ms-btn-primary" onClick={openComposer}>＋ Új üzenet</button>
        </div>
      </div>

      {listError && <div className="ms-alert ms-alert-error"><span>⚠️</span>{listError}</div>}

      {loading ? (
        <div className="ms-empty"><div className="ms-empty-icon">⏳</div><div className="ms-empty-txt">Betöltés…</div></div>
      ) : messages.length === 0 ? (
        <div className="ms-empty">
          <div className="ms-empty-icon">📭</div>
          <div className="ms-empty-txt">Még nem küldtek üzenetet</div>
          <div style={{fontSize:13,marginTop:6}}>Kattints az „Új üzenet" gombra az első küldéshez</div>
        </div>
      ) : (
        <div className="ms-card">
          {messages.map(m => (
            <div className="ms-msg-row" key={m.id}>
              {canDelete ? (
                <input type="checkbox" checked={selectedIds.has(m.id)} onChange={() => toggleSelect(m.id)} style={{width:15,height:15,cursor:"pointer",flexShrink:0}} />
              ) : <span />}
              <div className="ms-msg-excerpt">{messageExcerpt(m)}</div>
              <div className="ms-msg-meta">{m.createdBy.displayName||m.createdBy.email}</div>
              <div className="ms-msg-time">
                {m.playedAt ? formatDate(m.playedAt) : m.scheduledAt ? `⏰ ${formatDate(m.scheduledAt)}` : formatDate(m.createdAt)}
              </div>
              <button className="ms-btn ms-btn-ghost ms-btn-sm" onClick={() => setDetailMsg(m)}>Részletek</button>
              {canDelete && (
                <button className="ms-btn ms-btn-danger ms-btn-sm" onClick={() => void doDeleteOne(m.id)} title="Törlés">🗑</button>
              )}
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="ms-pagination">
          <button className="ms-btn ms-btn-ghost ms-btn-sm" disabled={page<=1} onClick={() => loadMessages(page-1)}>← Előző</button>
          <span>{page} / {totalPages}</span>
          <button className="ms-btn ms-btn-ghost ms-btn-sm" disabled={page>=totalPages} onClick={() => loadMessages(page+1)}>Következő →</button>
        </div>
      )}

      {/* Detail modal */}
      {detailMsg && (
        <div className="ms-overlay" onClick={() => setDetailMsg(null)}>
          <div className="ms-modal" onClick={e => e.stopPropagation()}>
            <div className="ms-modal-hdr">
              <div className="ms-modal-title">📄 Üzenet részletei</div>
              <button className="ms-close" onClick={() => setDetailMsg(null)}>✕</button>
            </div>
            <div className="ms-modal-body">
              <div className="ms-detail-grid">
                <div className="ms-detail-key">Feladó</div><div>{detailMsg.createdBy.displayName||detailMsg.createdBy.email}</div>
                <div className="ms-detail-key">Létrehozva</div><div>{formatDate(detailMsg.createdAt)}</div>
                {detailMsg.scheduledAt && <><div className="ms-detail-key">Ütemezve</div><div>{formatDate(detailMsg.scheduledAt)}</div></>}
                {detailMsg.playedAt    && <><div className="ms-detail-key">Lejátszva</div><div>{formatDate(detailMsg.playedAt)}</div></>}
                {detailMsg.voice && <><div className="ms-detail-key">Hangszín</div><div>{VOICE_LABELS[detailMsg.voice]??detailMsg.voice}</div></>}
                <div className="ms-detail-key">Cél</div><div>{detailMsg.targetType}{detailMsg.targetId?` (${detailMsg.targetId.slice(0,8)}…)`:""}</div>
              </div>
              {detailMsg.fileUrl && <audio controls src={detailMsg.fileUrl} style={{width:"100%"}} />}
              {detailMsg.text && (
                <div><div className="ms-label">Szöveg</div><div className="ms-detail-body">{detailMsg.text}</div></div>
              )}
            </div>
            <div className="ms-modal-footer">
              <button className="ms-btn ms-btn-ghost" onClick={() => setDetailMsg(null)}>Bezárás</button>
            </div>
          </div>
        </div>
      )}

      {/* Composer modal */}
      {composerOpen && (
        <div className="ms-overlay" onClick={closeComposer}>
          <div className="ms-modal" onClick={e => e.stopPropagation()}>
            <div className="ms-modal-hdr">
              <div className="ms-modal-title">✉️ Új üzenet küldése</div>
              <button className="ms-close" onClick={closeComposer}>✕</button>
            </div>

            {sendSuccess ? (
              <div className="ms-modal-body">
                <div className="ms-alert ms-alert-success">
                  <span>✅</span>Az üzenet sikeresen elküldve!
                </div>
                <div className="ms-modal-footer" style={{padding:0,border:0}}>
                  <button className="ms-btn ms-btn-primary" onClick={closeComposer}>Bezárás</button>
                </div>
              </div>
            ) : (
              <div className="ms-modal-body">

                {/* Mode tabs */}
                <div className="ms-mode-tabs">
                  <button className={"ms-mode-tab"+(composerMode==="tts"?" active":"")} onClick={() => setComposerMode("tts")} type="button">
                    🤖 Szövegfelolvasó (TTS)
                  </button>
                  <button className={"ms-mode-tab"+(composerMode==="record"?" active":"")} onClick={() => setComposerMode("record")} type="button">
                    🎙️ Hangfelvétel
                  </button>
                </div>

                {/* ── TTS mód ───────────────────────────────────────────── */}
                {composerMode === "tts" && (
                  <>
                    {templates.length > 0 && (
                      <div>
                        <div className="ms-label">💾 Mentett sablonok</div>
                        <div className="ms-tpl-bar">
                          {templates.map(t => (
                            <div key={t.id} className="ms-tpl-chip" onClick={() => { setText(t.text); setVoice(t.voice); }}>
                              {t.name}
                              <span className="ms-tpl-del" onClick={e => { e.stopPropagation(); deleteTemplate(t.id); }}>✕</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <label className="ms-label">✏️ Üzenet szövege</label>
                      <textarea className="ms-textarea" value={text} onChange={e => setText(e.target.value)} placeholder="Írd be az üzenet szövegét…" />
                    </div>
                    <div>
                      <label className="ms-label">📁 Mentés sablonként</label>
                      <div className="ms-row">
                        <input className="ms-input" style={{flex:1,minWidth:130}} placeholder="Sablon neve…" value={templateName} onChange={e => setTemplateName(e.target.value)} />
                        <button className="ms-btn ms-btn-ghost ms-btn-sm" onClick={saveTemplate} disabled={savingTemplate}>{savingTemplate?"Mentés…":"💾 Mentés"}</button>
                      </div>
                      {templateMsg && <div style={{fontSize:12,marginTop:5,color:templateMsg.includes("mentve")?"#15803d":"#dc2626"}}>{templateMsg}</div>}
                    </div>
                    <div>
                      <div className="ms-label">🎙️ Hangszín</div>
                      <div className="ms-row">
                        {Object.entries(VOICE_LABELS).map(([val,label]) => (
                          <div key={val} className={"ms-chip"+(voice===val?" active":"")} onClick={() => setVoice(val)}>{label}</div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* ── Hangfelvétel mód ──────────────────────────────────── */}
                {composerMode === "record" && (
                  <div>
                    <div className="ms-rec-center">
                      {recState === "idle" && (
                        <>
                          <div className="ms-mic-icon">🎙️</div>
                          <div className="ms-rec-hint">Kattints a gombra a felvétel megkezdéséhez.</div>
                          <button className="ms-btn ms-btn-primary" onClick={startRecording} type="button">
                            ⏺ Felvétel indítása
                          </button>
                          {recError && <div className="ms-alert ms-alert-error" style={{margin:0}}><span>⚠️</span>{recError}</div>}
                        </>
                      )}

                      {recState === "recording" && (
                        <>
                          <div className="ms-mic-icon ms-mic-pulse" style={{color:"#ef4444"}}>🎙️</div>
                          <div className="ms-rec-time" style={{color:"#ef4444"}}>{fmtRecTime(recSeconds)}</div>
                          <div className="ms-rec-hint" style={{color:"#ef4444",fontWeight:700}}>● Felvétel folyamatban…</div>
                          <button className="ms-btn ms-btn-danger" onClick={stopRecording} type="button">
                            ⏹ Felvétel befejezése
                          </button>
                        </>
                      )}

                      {recState === "recorded" && recAudioUrl && (
                        <>
                          <div className="ms-mic-icon">✅</div>
                          <div className="ms-rec-hint">Felvétel kész – hallgasd meg!</div>
                          <audio controls src={recAudioUrl} style={{width:"100%",maxWidth:380}} />
                          <div className="ms-row" style={{justifyContent:"center"}}>
                            <button className="ms-btn ms-btn-ghost" onClick={resetRecording} type="button">
                              🔄 Új felvétel
                            </button>
                            <div style={{fontSize:13,color:"var(--sl-muted)",display:"flex",alignItems:"center",gap:6}}>
                              <span style={{color:"#22c55e",fontWeight:700}}>✓ Elfogadva</span>
                              <span>– töltsd ki a részleteket alább</span>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Közös: cél + ütemezés */}
                <TargetAndSchedule />

                {sendError && <div className="ms-alert ms-alert-error"><span>⚠️</span>{sendError}</div>}

                <div className="ms-modal-footer" style={{padding:"0",border:"0"}}>
                  <button className="ms-btn ms-btn-ghost" onClick={closeComposer}>Mégse</button>
                  {composerMode === "tts" && (
                    <button className="ms-btn ms-btn-primary" onClick={sendTTS} disabled={sending}>
                      {sending ? "⏳ Generálás…" : "🔊 Küldés"}
                    </button>
                  )}
                  {composerMode === "record" && (
                    <button className="ms-btn ms-btn-primary" onClick={sendRecording} disabled={sending || recState !== "recorded"}>
                      {sending ? "⏳ Feltöltés…" : "🔊 Küldés"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}