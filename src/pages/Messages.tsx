import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch, apiPost } from "../lib/api";
import { stripAccents } from "../lib/text";
import { useAuth } from "../auth/AuthContext";
import { SUPPORTED_LOCALES, LOCALE_NATIVE_NAMES, type SupportedLocale } from "../i18n";

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
type IntroSound   = { id:string; filename:string; sizeBytes:number; durationMs:number|null; createdAt:string };

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
function messageExcerpt(t: (k:string)=>string, m: MessageItem): string {
  if (!m.text && m.fileUrl && m.fileUrl.includes("/rec_")) return `🎙️ ${t("messages:history.voiceMessage")}`;
  if (!m.text) return "–";
  return excerpt(m.text);
}
const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "https://api.schoollive.hu";

// Hangszín-címke feloldása: a 3 magyar Piper-hang (saját, "messages" névtér)
// VAGY egy 9 nyelvkód egyike (a "Fordítás" gombbal kiválasztott célnyelv,
// ld. src/i18n LOCALE_NATIVE_NAMES) — a horvátnál jelezve, hogy szerb hang
// szól (ld. backend tts.service.ts VOICES komment: nincs natív horvát modell).
function voiceLabel(t: (k:string)=>string, code: string | null | undefined): string {
  if (!code) return "–";
  if (code === "anna")  return t("messages:voices.anna");
  if (code === "berta") return t("messages:voices.berta");
  if (code === "imre")  return t("messages:voices.imre");
  if (code === "hr")    return `${LOCALE_NATIVE_NAMES.hr} (${t("messages:translate.hrNote")})`;
  if ((SUPPORTED_LOCALES as readonly string[]).includes(code)) return LOCALE_NATIVE_NAMES[code as SupportedLocale];
  return code;
}

// Composer alapértelmezett hangja a UI-nyelv (i18n.language) alapján: magyar
// felület esetén a 3 magyar Piper-hang egyike (Anna marad az induló
// választás), bármely más felületi nyelv esetén magának a nyelvnek a Piper
// hangja (ld. tts.service.ts VOICES map — a nyelvkód közvetlenül hangkulcs
// is). Így egy szlovák felületű user alapból szlovák hangon küld, nem
// (rossz kiejtésű) magyar Anna-hangon.
function defaultVoiceForLocale(locale: string): string {
  return locale === "hu" ? "anna" : locale;
}

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
  const { t, i18n } = useTranslation(["messages", "common"]);
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
  // Új: a "Korábbi üzenetek" overlay nyitva van-e. (A composer a fő view).
  const [listOpen, setListOpen] = useState(false);

  // TTS state
  const [composerMode, setComposerMode] = useState<ComposerMode>("tts");
  const [text, setText]   = useState("");
  const [voice, setVoice] = useState(() => defaultVoiceForLocale(i18n.language));

  // Ha a user menet közben vált felületi nyelvet (nyelvválasztó az AppShell-ben),
  // a composer hangja is kövesse — hacsak épp nem egy fordítás/sablon állította be.
  useEffect(() => {
    setVoice(defaultVoiceForLocale(i18n.language));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.language]);

  // Fordítás popover (TTS-üzenet-fordítás, ld. terv "Lokalizáció" szakasz F)
  const [translateOpen, setTranslateOpen]   = useState(false);
  const [translating, setTranslating]       = useState<string | null>(null);
  const [translateError, setTranslateError] = useState<string | null>(null);

  // Közös state
  const [scheduleType, setScheduleType] = useState<ScheduleType>("immediate");
  const [customTime, setCustomTime] = useState("");
  const [targetType, setTargetType] = useState<"DEVICE"|"GROUP"|"ALL">("ALL");
  const [targetId, setTargetId]     = useState("");
  const [sending, setSending]       = useState(false);
  const [sendError, setSendError]   = useState<string|null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);

  // ── Csak-generálás/előhallgatás/letöltés (küldés nélkül) ────────────────────
  const [previewing,      setPreviewing]      = useState(false);
  const [previewUrl,      setPreviewUrl]      = useState<string | null>(null);
  const [previewFilename, setPreviewFilename] = useState<string | null>(null);
  const [previewError,    setPreviewError]    = useState<string | null>(null);

  // Ha a szöveg változik, a régi előnézet már nem tartozik hozzá a
  // láthatóhoz – ne tűnjön úgy, mintha az AKTUÁLIS szöveget hallgatná vissza.
  useEffect(() => {
    setPreviewUrl(null); setPreviewFilename(null); setPreviewError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // Sablon state
  const [templates, setTemplates]   = useState<Template[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateMsg, setTemplateMsg] = useState<string|null>(null);
  const [templateOk, setTemplateOk] = useState(false);

  // Intro hang (üzenet előtt) – default "" = backend dingdong fallback
  const [introSounds, setIntroSounds]       = useState<IntroSound[]>([]);
  const [preBellSoundId, setPreBellSoundId] = useState<string>("");
  const [introUploadBusy, setIntroUploadBusy] = useState(false);
  const [introUploadError, setIntroUploadError] = useState<string|null>(null);
  const introFileRef = useRef<HTMLInputElement|null>(null);

  // Replay state (loading per-id, hogy ne lehessen duplán nyomni)
  // (a régi `replayingId` state törölve – az új replay modal a `replayBusy`
  // állapotot használja).

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
    } catch (e:any) { setListError(e?.message??t("messages:history.loadFailed")); }
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
    if (!window.confirm(t("messages:history.deleteConfirmSingle"))) return;
    await deleteMessage(id); await loadMessages(page);
  }
  async function doBulkDelete() {
    if (!window.confirm(t("messages:history.deleteConfirmBulk", { count: selectedIds.size }))) return;
    await Promise.all(Array.from(selectedIds).map(id => deleteMessage(id)));
    setSelectedIds(new Set()); await loadMessages(page);
  }
  function toggleSelect(id:string) {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  // ── Intro sounds (üzenet-előtti rövid bell hangok) ────────────────────────
  async function loadIntroSounds() {
    try {
      const r = await apiFetch<{ok:boolean;sounds:IntroSound[]}>("/bells/intro-sounds");
      setIntroSounds(r.sounds ?? []);
    } catch { setIntroSounds([]); }
  }
  async function uploadIntroSound(file: File) {
    if (file.size > 200 * 1024) {
      setIntroUploadError(t("messages:introSound.maxSizeError"));
      return;
    }
    setIntroUploadBusy(true); setIntroUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const token    = sessionStorage.getItem("accessToken") ?? localStorage.getItem("accessToken") ?? "";
      const tenantId = sessionStorage.getItem("activeTenantId") ?? localStorage.getItem("activeTenantId") ?? "";
      const resp = await fetch(`${API_BASE}/bells/intro-sounds`, {
        method: "POST",
        headers: {
          ...(token    ? { Authorization: `Bearer ${token}` } : {}),
          ...(tenantId ? { "x-tenant-id": tenantId } : {}),
        },
        body: fd,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || t("messages:introSound.uploadFailed"));
      await loadIntroSounds();
      // Az újonnan feltöltött hangot automatikusan kiválasztjuk
      if (data.sound?.id) setPreBellSoundId(data.sound.id);
    } catch (e:any) {
      setIntroUploadError(e?.message ?? t("messages:introSound.uploadFailed"));
    } finally {
      setIntroUploadBusy(false);
      if (introFileRef.current) introFileRef.current.value = "";
    }
  }
  async function deleteIntroSound(id: string) {
    if (!window.confirm(t("messages:introSound.deleteConfirm"))) return;
    try {
      await apiFetch(`/bells/intro-sounds/${id}`, { method: "DELETE" });
      if (preBellSoundId === id) setPreBellSoundId("");
      await loadIntroSounds();
    } catch (e:any) {
      setIntroUploadError(e?.message ?? t("messages:introSound.deleteFailed"));
    }
  }

  // ── Replay (újra-bemondatás) ──────────────────────────────────────────────
  // Két "üzemmód":
  //  1) replayQuick(id): a régi viselkedés – ALL target, azonnal
  //  2) Replay modal: célzás + ütemezés (next_bell / custom / immediate)
  type ReplayForm = {
    messageId:   string;
    messageName: string;
    targetType:  "ALL" | "DEVICE" | "GROUP";
    targetId:    string;
    schedule:    "immediate" | "next_bell" | "custom";
    customTime:  string;
  };
  const [replayForm, setReplayForm] = useState<ReplayForm | null>(null);
  const [replayBusy, setReplayBusy] = useState(false);

  function openReplayModal(m: MessageItem) {
    if (!m.fileUrl) { setSendError(t("messages:replay.noFileError")); return; }
    setReplayForm({
      messageId:   m.id,
      messageName: messageExcerpt(t, m),
      targetType:  (m.targetType as any) ?? "ALL",
      targetId:    m.targetId ?? "",
      schedule:    "immediate",
      customTime:  "",
    });
  }

  async function submitReplay() {
    if (!replayForm) return;
    if (replayForm.targetType !== "ALL" && !replayForm.targetId) {
      setSendError(t("messages:errors.chooseTarget")); return;
    }
    // Időpont számítása (mint a TTS composer-ben)
    let scheduledAt: string | null = null;
    if (replayForm.schedule === "next_bell") {
      const nb = getNextBreakTime(bells);
      if (!nb) { setSendError(t("messages:errors.noMoreBreaksToday")); return; }
      scheduledAt = nb.toISOString();
    } else if (replayForm.schedule === "custom") {
      if (!replayForm.customTime) { setSendError(t("messages:errors.enterTime")); return; }
      const today = new Date().toISOString().slice(0, 10);
      const dt = new Date(`${today}T${replayForm.customTime}:00`);
      if (dt <= new Date()) { setSendError(t("messages:errors.timePassed")); return; }
      scheduledAt = dt.toISOString();
    }
    setReplayBusy(true);
    setSendError(null); setSendSuccess(false);
    try {
      const body: any = { targetType: replayForm.targetType };
      if (replayForm.targetType !== "ALL") body.targetId = replayForm.targetId;
      if (scheduledAt) body.scheduledAt = scheduledAt;
      await apiPost(`/messages/${replayForm.messageId}/replay`, body);
      setSendSuccess(true);
      setReplayForm(null);
      await loadMessages(page);
    } catch (e:any) {
      setSendError(e?.message ?? t("messages:replay.replayFailed"));
    } finally {
      setReplayBusy(false);
    }
  }

  // (régi gyors-replayMessage(id) függvény törölve – mostantól minden
  // 🔁 Újra kattintás a `openReplayModal(m)`-on át megy, ami cél +
  // időzítés választást is felajánl.)

  useEffect(() => {
    // A composer most a fő view → minden kezdő adat azonnal betöltődik.
    loadMessages(1);
    loadTemplates();
    loadDevices();
    loadGroups();
    loadIntroSounds();
    apiFetch<{ok:boolean;templates:Array<{bells:BellEntry[];isDefault:boolean}>}>("/bells/templates")
      .then(r => {
        const def = r.templates?.find(t => t.isDefault) ?? r.templates?.[0];
        if (def) setBells(def.bells.filter(b => b.type === "MAIN"));
      }).catch(() => {});
    // Komponens unmount-kor a recorder cleanup-ja megfut
    return () => { stopRecordingCleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetComposer() {
    setText(""); setVoice(defaultVoiceForLocale(i18n.language)); setScheduleType("immediate"); setCustomTime("");
    setTargetType("ALL"); setTargetId(""); setSendError(null); setSendSuccess(false);
    setTemplateName(""); setTemplateMsg(null);
    setComposerMode("tts");
    setRecState("idle"); setRecBlob(null); setRecAudioUrl(null); setRecError(null); setRecSeconds(0);
    setPreBellSoundId("");
    setPreviewUrl(null); setPreviewFilename(null); setPreviewError(null);
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
        setRecError(t("messages:record.micDenied"));
      } else {
        setRecError(t("messages:record.micUnavailable", { error: e.message }));
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

  // A previewUrl az API-domainről jön (más origin, mint a frontend) – a
  // sima <a download> attribútumot a böngészők cross-origin URL-nél
  // figyelmen kívül hagyják (csak megnyitja a fájlt, nem tölti le). Ezért
  // blob-ként lekérjük, és arra tesszük rá a download-ot – ez origin-
  // függetlenül működik.
  async function downloadPreview() {
    if (!previewUrl) return;
    try {
      const res = await fetch(previewUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = previewFilename ?? "uzenet.opus";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (e: any) {
      setPreviewError(e?.message ?? t("messages:errors.sendFailed"));
    }
  }

  // Csak legenerálja a TTS-hangot (a POST /messages/tts-preview-vel) —
  // NEM küld semmit egyetlen eszközre sem, nincs hozzá Message-rekord. A
  // visszakapott fileUrl-t <audio controls> előnézetben lehet visszahallgatni,
  // ill. letölteni.
  async function generatePreview() {
    if (!text.trim()) { setPreviewError(t("messages:errors.textRequired")); return; }
    setPreviewError(null); setPreviewing(true);
    try {
      const r = await apiPost<{ ok: boolean; fileUrl: string; filename: string }>("/messages/tts-preview", {
        text: text.trim(), voice,
        preBellSoundId: preBellSoundId || undefined,
      });
      setPreviewUrl(r.fileUrl); setPreviewFilename(r.filename);
    } catch (e: any) { setPreviewError(e?.message ?? t("messages:errors.sendFailed")); }
    finally { setPreviewing(false); }
  }

  async function sendTTS() {
    if (!text.trim()) { setSendError(t("messages:errors.textRequired")); return; }
    if (targetType !== "ALL" && !targetId) { setSendError(t("messages:errors.chooseTarget")); return; }
    if (scheduleType === "next_bell" && !getNextBreakTime(bells)) { setSendError(t("messages:errors.noMoreBreaksToday")); return; }
    if (scheduleType === "custom") {
      if (!customTime) { setSendError(t("messages:errors.enterTime")); return; }
      const today = new Date().toISOString().slice(0,10);
      const dt = new Date(`${today}T${customTime}:00`);
      if (dt <= new Date()) { setSendError(t("messages:errors.timePassed")); return; }
      if (checkLessonOverlap(dt, bells)) {
        if (!window.confirm(t("messages:errors.lessonOverlapConfirm"))) return;
      }
    }
    setSendError(null); setSending(true);
    try {
      await apiPost("/messages", {
        text: text.trim(), voice, targetType,
        targetId: targetType === "ALL" ? undefined : targetId,
        scheduledAt:    getScheduledAt(),
        preBellSoundId: preBellSoundId || undefined,
      });
      setSendSuccess(true); await loadMessages(1);
    } catch (e:any) { setSendError(e?.message ?? t("messages:errors.sendFailed")); }
    finally { setSending(false); }
  }

  async function sendRecording() {
    if (!recBlob) { setSendError(t("messages:record.noRecording")); return; }
    if (targetType !== "ALL" && !targetId) { setSendError(t("messages:errors.chooseTarget")); return; }
    setSendError(null); setSending(true);
    try {
      const formData = new FormData();
      formData.append("audio", recBlob, "recording.webm");
      formData.append("targetType", targetType);
      if (targetType !== "ALL" && targetId) formData.append("targetId", targetId);
      const scheduledAt = getScheduledAt();
      if (scheduledAt) formData.append("scheduledAt", scheduledAt);
      if (preBellSoundId) formData.append("preBellSoundId", preBellSoundId);

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
      if (!resp.ok) throw new Error(data.error || t("messages:record.uploadFailed"));
      setSendSuccess(true); await loadMessages(1);
    } catch (e:any) { setSendError(e?.message ?? t("messages:errors.sendFailed")); }
    finally { setSending(false); }
  }

  async function saveTemplate() {
    if (!templateName.trim() || !text.trim()) { setTemplateOk(false); setTemplateMsg(t("messages:templates.nameAndTextRequired")); return; }
    setSavingTemplate(true); setTemplateMsg(null);
    try { await apiPost("/messages/templates",{name:templateName.trim(),text,voice}); setTemplateOk(true); setTemplateMsg(t("messages:templates.saved")); setTemplateName(""); await loadTemplates(); }
    catch (e:any) { setTemplateOk(false); setTemplateMsg(e?.message??t("messages:templates.saveFailed")); }
    finally { setSavingTemplate(false); }
  }
  async function deleteTemplate(id:string) {
    try { await apiFetch(`/messages/templates/${id}`,{method:"DELETE"}); await loadTemplates(); } catch {}
  }

  // ── Fordítás (Layer 2 lokalizáció) ────────────────────────────────────────
  // A backend POST /messages/translate a szöveget lefordítja a célnyelvre;
  // a fordítás után a `voice`-t is a célnyelv kódjára állítjuk, hogy a
  // POST /messages (sendTTS) a megfelelő idegen nyelvi Piper-modellel
  // generálja le a hangot (ld. tts.service.ts VOICES map).
  async function translateTo(targetLang: string) {
    if (!text.trim()) { setTranslateError(t("messages:translate.emptyText")); return; }
    setTranslating(targetLang); setTranslateError(null);
    try {
      const res = await apiPost<{ ok: true; translatedText: string }>("/messages/translate", { text: text.trim(), targetLang });
      setText(res.translatedText);
      // Magyarra fordításnál nincs 3-as hangválasztó (ld. lent, csak hu UI-nál
      // jelenik meg) — fix Imre hangot használunk, hogy más nyelvű felhasználó
      // sablonos "alapértelmezett" magyar hangot kapjon, nem esetlegeset.
      setVoice(targetLang === "hu" ? "imre" : targetLang);
      setTranslateOpen(false);
    } catch (e: any) {
      setTranslateError(e?.message ?? t("messages:translate.failed"));
    } finally {
      setTranslating(null);
    }
  }

  const totalPages = Math.ceil(total/LIMIT);

  // ── Cél + ütemezés UI (közös TTS és Recording esetén) ─────────────────────
  function TargetAndSchedule() {
    return (
      <>
        {/* Cél */}
        <div>
          <div className="ms-label">🎯 {t("messages:target.label")}</div>
          <div className="ms-row" style={{ marginBottom:10 }}>
            {(["ALL","DEVICE","GROUP"] as const).map(tt => (
              <div key={tt} className={"ms-chip"+(targetType===tt?" active":"")} onClick={() => { setTargetType(tt); setTargetId(""); }}>
                {tt==="ALL"?`📡 ${t("messages:target.all")}`:tt==="DEVICE"?`🔊 ${t("messages:target.device")}`:`👥 ${t("messages:target.group")}`}
              </div>
            ))}
          </div>
          {targetType==="DEVICE" && (
            <div className="ms-device-list">
              {devices.length===0 && <div style={{fontSize:13,color:"var(--sl-muted)",padding:8}}>{t("messages:target.noDevices")}</div>}
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
              <option value="">{t("messages:target.chooseGroupPlaceholder")}</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
        </div>

        {/* Ütemezés */}
        <div>
          <div className="ms-label">⏰ {t("messages:schedule.label")}</div>
          <div className="ms-row">
            {(["immediate","next_bell","custom"] as ScheduleType[]).map(s => (
              <div key={s} className={"ms-chip"+(scheduleType===s?" active":"")} onClick={() => setScheduleType(s)}>
                {s==="immediate"?`⚡ ${t("messages:schedule.immediate")}`:s==="next_bell"?`🔔 ${t("messages:schedule.nextBell")}`:`🕐 ${t("messages:schedule.customTime")}`}
              </div>
            ))}
          </div>
          {scheduleType==="next_bell" && (() => {
            const nb = getNextBreakTime(bells);
            return (
              <div style={{fontSize:12,marginTop:8,padding:"7px 11px",borderRadius:9,background:nb?"#f0fdf4":"#fef2f2",color:nb?"#15803d":"#dc2626",border:"1px solid",borderColor:nb?"#bbf7d0":"#fecaca"}}>
                {nb ? `⏱ ${t("messages:schedule.nextBreakAt", { time: nb.toLocaleTimeString("hu-HU",{hour:"2-digit",minute:"2-digit"}) })}` : `⚠️ ${t("messages:schedule.noMoreBreaksToday")}`}
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

  // ── Intro hang választó (composer-ben TTS és Record módban közös) ─────────
  function IntroSoundPicker() {
    return (
      <div>
        <label className="ms-label">🔔 {t("messages:introSound.label")}</label>
        <div className="ms-row" style={{alignItems:"center"}}>
          <select
            className="ms-select"
            style={{flex:1, minWidth:180}}
            value={preBellSoundId}
            onChange={e => setPreBellSoundId(e.target.value)}>
            <option value="">🔔 {t("messages:introSound.defaultOption")}</option>
            {introSounds.map(s => (
              <option key={s.id} value={s.id}>
                🎵 {s.filename}{s.durationMs ? ` (${(s.durationMs/1000).toFixed(1)}s)` : ""}
              </option>
            ))}
          </select>
          <input
            ref={introFileRef}
            type="file"
            accept="audio/*"
            style={{display:"none"}}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) void uploadIntroSound(f);
            }} />
          <button
            type="button"
            className="ms-btn ms-btn-ghost ms-btn-sm"
            onClick={() => introFileRef.current?.click()}
            disabled={introUploadBusy}
            title={t("messages:introSound.uploadTitle")}>
            {introUploadBusy ? `⏳ ${t("messages:introSound.uploading")}` : `＋ ${t("messages:introSound.uploadButton")}`}
          </button>
          {preBellSoundId && (
            <button
              type="button"
              className="ms-btn ms-btn-danger ms-btn-sm"
              onClick={() => void deleteIntroSound(preBellSoundId)}
              title={t("messages:introSound.deleteTitle")}>
              🗑
            </button>
          )}
        </div>
        {introUploadError && (
          <div style={{fontSize:12,marginTop:5,color:"#dc2626"}}>{introUploadError}</div>
        )}
        <div style={{fontSize:11,color:"var(--sl-muted)",marginTop:4}}>
          {t("messages:introSound.hint")}
        </div>
      </div>
    );
  }

  return (
    <div className="ms-page">
      <style>{CSS}</style>

      <div className="ms-hdr">
        <div>
          <div className="ms-title">📢 {t("common:nav.messages")}</div>
          <div className="ms-subtitle">{t("messages:header.subtitle")}</div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <button
            className="ms-btn ms-btn-ghost"
            onClick={() => { setListOpen(true); void loadMessages(1); }}
            type="button">
            📥 {t("messages:header.historyButton")}{total > 0 ? ` (${total})` : ""}
          </button>
        </div>
      </div>

      {sendSuccess && (
        <div className="ms-alert ms-alert-success">
          <span>✅</span>
          <span style={{flex:1}}>{t("messages:success.sent")}</span>
          <button
            className="ms-btn ms-btn-ghost ms-btn-sm"
            type="button"
            onClick={() => { resetComposer(); }}
            style={{marginLeft:"auto"}}>
            🔄 {t("messages:success.newMessage")}
          </button>
        </div>
      )}

      {/* ── Composer – fő view ─────────────────────────────────────────────── */}
      <div className="ms-card" style={{padding:"20px 22px"}}>
        <div style={{display:"flex",flexDirection:"column",gap:18}}>

          {/* Mode tabs */}
          <div className="ms-mode-tabs">
            <button className={"ms-mode-tab"+(composerMode==="tts"?" active":"")} onClick={() => setComposerMode("tts")} type="button">
              🤖 {t("messages:composer.ttsTab")}
            </button>
            <button className={"ms-mode-tab"+(composerMode==="record"?" active":"")} onClick={() => setComposerMode("record")} type="button">
              🎙️ {t("messages:composer.recordTab")}
            </button>
          </div>

          {/* TTS mód */}
          {composerMode === "tts" && (
            <>
              {templates.length > 0 && (
                <div>
                  <div className="ms-label">💾 {t("messages:templates.savedLabel")}</div>
                  <div className="ms-tpl-bar">
                    {templates.map(tpl => (
                      <div key={tpl.id} className="ms-tpl-chip" onClick={() => { setText(tpl.text); setVoice(tpl.voice); }}>
                        {tpl.name}
                        <span className="ms-tpl-del" onClick={e => { e.stopPropagation(); deleteTemplate(tpl.id); }}>✕</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                  <label className="ms-label" style={{marginBottom:0}}>✏️ {t("messages:composer.textLabel")}</label>
                  <button type="button" className="ms-btn ms-btn-ghost ms-btn-sm" onClick={() => { setTranslateError(null); setTranslateOpen(true); }}>
                    🌐 {t("messages:translate.button")}
                  </button>
                </div>
                <textarea className="ms-textarea" style={{marginTop:5}} value={text} onChange={e => setText(e.target.value)} placeholder={t("messages:composer.textPlaceholder")} />
              </div>
              <div>
                <label className="ms-label">📁 {t("messages:templates.saveLabel")}</label>
                <div className="ms-row">
                  <input className="ms-input" style={{flex:1,minWidth:130}} placeholder={t("messages:templates.namePlaceholder")} value={templateName} onChange={e => setTemplateName(stripAccents(e.target.value))} />
                  <button className="ms-btn ms-btn-ghost ms-btn-sm" onClick={saveTemplate} disabled={savingTemplate}>{savingTemplate?t("messages:templates.saving"):`💾 ${t("common:actions.save")}`}</button>
                </div>
                {templateMsg && <div style={{fontSize:12,marginTop:5,color:templateOk?"#15803d":"#dc2626"}}>{templateMsg}</div>}
              </div>
              <div>
                <div className="ms-label">🎙️ {t("messages:composer.voiceLabel")}</div>
                <div className="ms-row">
                  {i18n.language === "hu" && ["anna","berta","imre"].map(val => (
                    <div key={val} className={"ms-chip"+(voice===val?" active":"")} onClick={() => setVoice(val)}>{voiceLabel(t, val)}</div>
                  ))}
                  {!(i18n.language === "hu" && ["anna","berta","imre"].includes(voice)) && (
                    <div className={"ms-chip active"}>{voiceLabel(t, voice)}</div>
                  )}
                </div>
              </div>

              {/* Csak-generálás/előhallgatás/letöltés – küldés nélkül */}
              <div>
                <button type="button" className="ms-btn ms-btn-ghost" onClick={() => void generatePreview()} disabled={previewing || !text.trim()}>
                  {previewing ? `⏳ ${t("messages:preview.generating")}` : `🎧 ${t("messages:preview.button")}`}
                </button>
                {previewError && <div className="ms-alert ms-alert-error" style={{marginTop:8}}><span>⚠️</span>{previewError}</div>}
                {previewUrl && (
                  <div className="ms-row" style={{marginTop:8,alignItems:"center",gap:10}}>
                    <audio controls src={previewUrl} style={{flex:1,minWidth:220,maxWidth:380}} />
                    <button type="button" className="ms-btn ms-btn-ghost ms-btn-sm" onClick={() => void downloadPreview()}>
                      ⬇ {t("messages:preview.downloadButton")}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Hangfelvétel mód */}
          {composerMode === "record" && (
            <div>
              <div className="ms-rec-center">
                {recState === "idle" && (
                  <>
                    <div className="ms-mic-icon">🎙️</div>
                    <div className="ms-rec-hint">{t("messages:record.idleHint")}</div>
                    <button className="ms-btn ms-btn-primary" onClick={startRecording} type="button">
                      ⏺ {t("messages:record.start")}
                    </button>
                    {recError && <div className="ms-alert ms-alert-error" style={{margin:0}}><span>⚠️</span>{recError}</div>}
                  </>
                )}
                {recState === "recording" && (
                  <>
                    <div className="ms-mic-icon ms-mic-pulse" style={{color:"#ef4444"}}>🎙️</div>
                    <div className="ms-rec-time" style={{color:"#ef4444"}}>{fmtRecTime(recSeconds)}</div>
                    <div className="ms-rec-hint" style={{color:"#ef4444",fontWeight:700}}>● {t("messages:record.recordingHint")}</div>
                    <button className="ms-btn ms-btn-danger" onClick={stopRecording} type="button">
                      ⏹ {t("messages:record.stop")}
                    </button>
                  </>
                )}
                {recState === "recorded" && recAudioUrl && (
                  <>
                    <div className="ms-mic-icon">✅</div>
                    <div className="ms-rec-hint">{t("messages:record.doneHint")}</div>
                    <audio controls src={recAudioUrl} style={{width:"100%",maxWidth:380}} />
                    <div className="ms-row" style={{justifyContent:"center"}}>
                      <button className="ms-btn ms-btn-ghost" onClick={resetRecording} type="button">
                        🔄 {t("messages:record.newRecording")}
                      </button>
                      <div style={{fontSize:13,color:"var(--sl-muted)",display:"flex",alignItems:"center",gap:6}}>
                        <span style={{color:"#22c55e",fontWeight:700}}>✓ {t("messages:record.accepted")}</span>
                        <span>– {t("messages:record.fillDetails")}</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Üzenet előtti intro hang */}
          <IntroSoundPicker />

          {/* Cél + ütemezés */}
          <TargetAndSchedule />

          {sendError && <div className="ms-alert ms-alert-error"><span>⚠️</span>{sendError}</div>}

          <div style={{display:"flex",justifyContent:"flex-end",gap:10,paddingTop:6}}>
            {composerMode === "tts" && (
              <button className="ms-btn ms-btn-primary" onClick={sendTTS} disabled={sending}>
                {sending ? `⏳ ${t("messages:send.generating")}` : `🔊 ${t("common:actions.send")}`}
              </button>
            )}
            {composerMode === "record" && (
              <button className="ms-btn ms-btn-primary" onClick={sendRecording} disabled={sending || recState !== "recorded"}>
                {sending ? `⏳ ${t("messages:send.uploading")}` : `🔊 ${t("common:actions.send")}`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Korábbi üzenetek overlay ──────────────────────────────────────── */}
      {listOpen && (
        <div className="ms-overlay" onClick={() => setListOpen(false)}>
          <div className="ms-modal" style={{maxWidth:780}} onClick={e => e.stopPropagation()}>
            <div className="ms-modal-hdr">
              <div className="ms-modal-title">📥 {t("messages:header.historyButton")}{total>0 ? ` (${total})` : ""}</div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                {canDelete && selectedIds.size > 0 && (
                  <button className="ms-btn ms-btn-danger ms-btn-sm" onClick={doBulkDelete} type="button">
                    🗑 {t("messages:history.deleteSelected", { count: selectedIds.size })}
                  </button>
                )}
                <button className="ms-close" onClick={() => setListOpen(false)}>✕</button>
              </div>
            </div>
            <div style={{padding:"14px 18px",maxHeight:"70vh",overflowY:"auto"}}>
              {listError && <div className="ms-alert ms-alert-error" style={{marginBottom:10}}><span>⚠️</span>{listError}</div>}
              {loading ? (
                <div className="ms-empty"><div className="ms-empty-icon">⏳</div><div className="ms-empty-txt">{t("common:actions.loading")}</div></div>
              ) : messages.length === 0 ? (
                <div className="ms-empty">
                  <div className="ms-empty-icon">📭</div>
                  <div className="ms-empty-txt">{t("messages:history.empty")}</div>
                </div>
              ) : (
                <div>
                  {messages.map(m => (
                    <div className="ms-msg-row" key={m.id}>
                      {canDelete ? (
                        <input type="checkbox" checked={selectedIds.has(m.id)} onChange={() => toggleSelect(m.id)} style={{width:15,height:15,cursor:"pointer",flexShrink:0}} />
                      ) : <span />}
                      <div className="ms-msg-excerpt">{messageExcerpt(t, m)}</div>
                      <div className="ms-msg-meta">{m.createdBy.displayName||m.createdBy.email}</div>
                      <div className="ms-msg-time">
                        {m.playedAt ? formatDate(m.playedAt) : m.scheduledAt ? `⏰ ${formatDate(m.scheduledAt)}` : formatDate(m.createdAt)}
                      </div>
                      <button
                        className="ms-btn ms-btn-primary ms-btn-sm"
                        onClick={() => openReplayModal(m)}
                        disabled={!m.fileUrl}
                        title={m.fileUrl ? t("messages:history.replayTooltip") : t("messages:history.noFileTooltip")}>
                        🔁 {t("messages:history.replayAction")}
                      </button>
                      <button className="ms-btn ms-btn-ghost ms-btn-sm" onClick={() => setDetailMsg(m)}>{t("messages:history.detailsAction")}</button>
                      {canDelete && (
                        <button className="ms-btn ms-btn-danger ms-btn-sm" onClick={() => void doDeleteOne(m.id)} title={t("common:actions.delete")}>🗑</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {totalPages > 1 && (
                <div className="ms-pagination">
                  <button className="ms-btn ms-btn-ghost ms-btn-sm" disabled={page<=1} onClick={() => loadMessages(page-1)}>← {t("messages:history.prevPage")}</button>
                  <span>{page} / {totalPages}</span>
                  <button className="ms-btn ms-btn-ghost ms-btn-sm" disabled={page>=totalPages} onClick={() => loadMessages(page+1)}>{t("messages:history.nextPage")} →</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detailMsg && (
        <div className="ms-overlay" onClick={() => setDetailMsg(null)}>
          <div className="ms-modal" onClick={e => e.stopPropagation()}>
            <div className="ms-modal-hdr">
              <div className="ms-modal-title">📄 {t("messages:detail.title")}</div>
              <button className="ms-close" onClick={() => setDetailMsg(null)}>✕</button>
            </div>
            <div className="ms-modal-body">
              <div className="ms-detail-grid">
                <div className="ms-detail-key">{t("messages:detail.from")}</div><div>{detailMsg.createdBy.displayName||detailMsg.createdBy.email}</div>
                <div className="ms-detail-key">{t("messages:detail.created")}</div><div>{formatDate(detailMsg.createdAt)}</div>
                {detailMsg.scheduledAt && <><div className="ms-detail-key">{t("messages:detail.scheduled")}</div><div>{formatDate(detailMsg.scheduledAt)}</div></>}
                {detailMsg.playedAt    && <><div className="ms-detail-key">{t("messages:detail.played")}</div><div>{formatDate(detailMsg.playedAt)}</div></>}
                {detailMsg.voice && <><div className="ms-detail-key">{t("messages:composer.voiceLabel")}</div><div>{voiceLabel(t, detailMsg.voice)}</div></>}
                <div className="ms-detail-key">{t("messages:detail.target")}</div><div>{detailMsg.targetType}{detailMsg.targetId?` (${detailMsg.targetId.slice(0,8)}…)`:""}</div>
              </div>
              {detailMsg.fileUrl && <audio controls src={detailMsg.fileUrl} style={{width:"100%"}} />}
              {detailMsg.text && (
                <div><div className="ms-label">{t("messages:detail.textLabel")}</div><div className="ms-detail-body">{detailMsg.text}</div></div>
              )}
            </div>
            <div className="ms-modal-footer">
              <button className="ms-btn ms-btn-ghost" onClick={() => setDetailMsg(null)}>{t("common:actions.close")}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Replay modal ─ újra-bemondás célzással és időzítéssel ─────────── */}
      {replayForm && (
        <div className="ms-overlay" onClick={() => !replayBusy && setReplayForm(null)}>
          <div className="ms-modal" onClick={e => e.stopPropagation()}>
            <div className="ms-modal-hdr">
              <div className="ms-modal-title">🔁 {t("messages:replay.title")}</div>
              <button className="ms-close" onClick={() => !replayBusy && setReplayForm(null)}>✕</button>
            </div>
            <div className="ms-modal-body">
              <div style={{fontSize:13,color:"var(--sl-muted)",background:"var(--sl-bg)",border:"1px solid var(--sl-border)",borderRadius:9,padding:"8px 12px"}}>
                <strong style={{color:"var(--sl-text)"}}>{replayForm.messageName}</strong>
                <div style={{fontSize:11,marginTop:3}}>{t("messages:replay.storedFileNote")}</div>
              </div>

              {/* Cél */}
              <div>
                <div className="ms-label">🎯 {t("messages:target.label")}</div>
                <div className="ms-row" style={{marginBottom:10}}>
                  {(["ALL","DEVICE","GROUP"] as const).map(tt => (
                    <div key={tt}
                      className={"ms-chip"+(replayForm.targetType===tt?" active":"")}
                      onClick={() => setReplayForm(s => s ? { ...s, targetType: tt, targetId: "" } : s)}>
                      {tt==="ALL"?`📡 ${t("messages:target.all")}`:tt==="DEVICE"?`🔊 ${t("messages:target.device")}`:`👥 ${t("messages:target.group")}`}
                    </div>
                  ))}
                </div>
                {replayForm.targetType==="DEVICE" && (
                  <div className="ms-device-list">
                    {devices.length===0 && <div style={{fontSize:13,color:"var(--sl-muted)",padding:8}}>{t("messages:target.noDevices")}</div>}
                    {devices.map(d => (
                      <div key={d.id||d.name}
                        className={"ms-device-item"+(replayForm.targetId===d.id&&d.id!==""?" selected":"")}
                        onClick={() => setReplayForm(s => s ? { ...s, targetId: s.targetId===d.id?"":d.id } : s)}>
                        <span className={d.online?"ms-dot-on":"ms-dot-off"} />
                        <span style={{fontSize:13.5,fontWeight:600}}>{d.name}</span>
                        <span style={{fontSize:11,color:"var(--sl-muted)",marginLeft:"auto"}}>{d.deviceClass}</span>
                      </div>
                    ))}
                  </div>
                )}
                {replayForm.targetType==="GROUP" && (
                  <select className="ms-select"
                    value={replayForm.targetId}
                    onChange={e => setReplayForm(s => s ? { ...s, targetId: e.target.value } : s)}>
                    <option value="">{t("messages:target.chooseGroupPlaceholder")}</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                )}
              </div>

              {/* Ütemezés */}
              <div>
                <div className="ms-label">⏰ {t("messages:schedule.label")}</div>
                <div className="ms-row">
                  {(["immediate","next_bell","custom"] as const).map(s => (
                    <div key={s}
                      className={"ms-chip"+(replayForm.schedule===s?" active":"")}
                      onClick={() => setReplayForm(p => p ? { ...p, schedule: s } : p)}>
                      {s==="immediate"?`⚡ ${t("messages:schedule.immediate")}`:s==="next_bell"?`🔔 ${t("messages:schedule.nextBell")}`:`🕐 ${t("messages:schedule.customTime")}`}
                    </div>
                  ))}
                </div>
                {replayForm.schedule==="next_bell" && (() => {
                  const nb = getNextBreakTime(bells);
                  return (
                    <div style={{fontSize:12,marginTop:8,padding:"7px 11px",borderRadius:9,background:nb?"#f0fdf4":"#fef2f2",color:nb?"#15803d":"#dc2626",border:"1px solid",borderColor:nb?"#bbf7d0":"#fecaca"}}>
                      {nb ? `⏱ ${t("messages:schedule.nextBreakAt", { time: nb.toLocaleTimeString("hu-HU",{hour:"2-digit",minute:"2-digit"}) })}` : `⚠️ ${t("messages:schedule.noMoreBreaksToday")}`}
                    </div>
                  );
                })()}
                {replayForm.schedule==="custom" && (
                  <div style={{marginTop:10}}>
                    <input type="time" className="ms-input" style={{width:"auto"}}
                      value={replayForm.customTime}
                      onChange={e => setReplayForm(s => s ? { ...s, customTime: e.target.value } : s)} />
                  </div>
                )}
              </div>

              {sendError && <div className="ms-alert ms-alert-error"><span>⚠️</span>{sendError}</div>}
            </div>
            <div className="ms-modal-footer">
              <button className="ms-btn ms-btn-ghost"
                onClick={() => setReplayForm(null)}
                disabled={replayBusy}>{t("common:actions.cancel")}</button>
              <button className="ms-btn ms-btn-primary"
                onClick={() => void submitReplay()}
                disabled={replayBusy}>
                {replayBusy ? `⏳ ${t("messages:replay.sending")}` : replayForm.schedule === "immediate" ? `▶ ${t("messages:replay.sendImmediate")}` : `📅 ${t("messages:replay.schedule")}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Fordítás popover ─ görgethető nyelvlista, ld. lokalizációs terv F. szakasz */}
      {translateOpen && (
        <div className="ms-overlay" onClick={() => translating === null && setTranslateOpen(false)}>
          <div className="ms-modal" style={{maxWidth:380}} onClick={e => e.stopPropagation()}>
            <div className="ms-modal-hdr">
              <div className="ms-modal-title">🌐 {t("messages:translate.title")}</div>
              <button className="ms-close" onClick={() => setTranslateOpen(false)}>✕</button>
            </div>
            <div className="ms-modal-body" style={{maxHeight:"50vh",overflowY:"auto"}}>
              {translateError && <div className="ms-alert ms-alert-error"><span>⚠️</span>{translateError}</div>}
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {SUPPORTED_LOCALES.map(code => (
                  <button key={code} type="button" className="ms-btn ms-btn-ghost"
                    style={{justifyContent:"flex-start"}}
                    onClick={() => void translateTo(code)}
                    disabled={translating !== null}>
                    {translating === code ? "⏳ " : ""}{LOCALE_NATIVE_NAMES[code]}
                    {code === "hr" ? ` (${t("messages:translate.hrNote")})` : ""}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}