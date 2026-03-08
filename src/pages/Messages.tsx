import { useEffect, useState } from "react";
import { apiFetch, apiPost } from "../lib/api";

type MessageItem = {
  id:string; title:string|null; text:string|null; type:string; voice:string|null; fileUrl:string|null;
  targetType:string; targetId:string|null; scheduledAt:string|null; playedAt:string|null; createdAt:string;
  createdBy:{ id:string; displayName:string|null; email:string };
};
type Template     = { id:string; name:string; text:string; voice:string; createdAt:string };
type Device       = { id:string; name:string; online:boolean; deviceClass:string };
type DeviceGroup  = { id:string; name:string };
type ScheduleType = "immediate"|"next_bell"|"custom";

function formatDate(iso:string|null) {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("hu-HU",{ year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit" });
}
function excerpt(text:string|null,n=60) {
  if (!text) return "–";
  return text.length > n ? text.slice(0,n)+"…" : text;
}
const VOICE_LABELS:Record<string,string> = { anna:"Anna (női)", berta:"Berta (női)", imre:"Imre (férfi)" };

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
  .ms-btn-sm{padding:5px 11px;font-size:12px;border-radius:8px}
  .ms-card{background:var(--sl-surface);border:1px solid var(--sl-border);border-radius:18px;overflow:hidden;box-shadow:0 2px 12px rgba(59,130,246,0.07);margin-bottom:8px}
  .ms-msg-row{
    display:grid;grid-template-columns:1fr auto auto auto;align-items:center;gap:14px;
    padding:14px 18px;border-bottom:1px solid var(--sl-border);transition:background 0.12s;
  }
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

  /* Overlay + Modal */
  .ms-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.44);backdrop-filter:blur(4px);z-index:100;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto;animation:msFade 0.15s ease}
  .ms-modal{background:var(--sl-surface);border:1px solid var(--sl-border);border-radius:22px;padding:0;width:100%;max-width:660px;box-shadow:0 24px 64px rgba(0,0,0,0.18);animation:msSlide 0.2s ease}
  .ms-modal-hdr{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--sl-border)}
  .ms-modal-title{font-family:'Nunito',sans-serif;font-size:17px;font-weight:900;color:var(--sl-text);display:flex;align-items:center;gap:8px}
  .ms-modal-body{padding:20px 22px;display:flex;flex-direction:column;gap:18px}
  .ms-modal-footer{padding:14px 22px;border-top:1px solid var(--sl-border);display:flex;justify-content:flex-end;gap:10px}
  .ms-close{width:32px;height:32px;border-radius:8px;border:1.5px solid var(--sl-border);background:var(--sl-bg);color:var(--sl-muted);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s}
  .ms-close:hover{background:var(--sl-border);color:var(--sl-text)}

  /* Form atoms */
  .ms-label{display:block;font-size:11.5px;font-weight:800;color:var(--sl-text-2);margin-bottom:5px;letter-spacing:0.3px;text-transform:uppercase;font-family:'Nunito',sans-serif}
  .ms-textarea{width:100%;min-height:110px;padding:11px 13px;border:1.5px solid var(--sl-border);border-radius:12px;background:var(--sl-bg);color:var(--sl-text);font-size:14px;line-height:1.65;resize:vertical;font-family:inherit;outline:none;transition:all 0.15s}
  .ms-textarea:focus{border-color:#3b82f6;background:var(--sl-surface);box-shadow:0 0 0 3px rgba(59,130,246,0.11)}
  .ms-input{width:100%;height:38px;padding:0 12px;border:1.5px solid var(--sl-border);border-radius:11px;background:var(--sl-bg);color:var(--sl-text);font-size:13.5px;font-family:inherit;outline:none;transition:all 0.15s}
  .ms-input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,0.11)}
  .ms-select{height:38px;padding:0 12px;border:1.5px solid var(--sl-border);border-radius:11px;background:var(--sl-bg);color:var(--sl-text);font-size:13.5px;font-family:inherit;outline:none;cursor:pointer;min-width:160px}
  .ms-select:focus{border-color:#3b82f6}
  .ms-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}

  /* Chips (voice, schedule, target) */
  .ms-chip{
    display:inline-flex;align-items:center;gap:6px;padding:7px 14px;
    border-radius:20px;border:1.5px solid var(--sl-border);background:var(--sl-bg);
    font-size:13px;font-weight:600;font-family:'Nunito',sans-serif;color:var(--sl-text-2);
    cursor:pointer;transition:all 0.15s;
  }
  .ms-chip.active{background:linear-gradient(135deg,#eff6ff,#f5f3ff);border-color:#bfdbfe;color:#1d4ed8;font-weight:800}
  .ms-chip:hover:not(.active){border-color:#bfdbfe;color:var(--sl-text)}

  /* Templates */
  .ms-tpl-bar{display:flex;gap:8px;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--sl-border);border-radius:12px;background:var(--sl-bg)}
  .ms-tpl-chip{height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--sl-border);background:var(--sl-surface);font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:6px;color:var(--sl-text-2);transition:all 0.12s;font-family:inherit}
  .ms-tpl-chip:hover{background:#f0f7ff;border-color:#bfdbfe;color:#1d4ed8}
  .ms-tpl-del{color:var(--sl-muted);font-size:10px;cursor:pointer}
  .ms-tpl-del:hover{color:#ef4444}

  /* Device list */
  .ms-device-list{display:flex;flex-direction:column;gap:5px;max-height:180px;overflow-y:auto;padding:8px;border:1.5px solid var(--sl-border);border-radius:11px;background:var(--sl-bg)}
  .ms-device-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:9px;cursor:pointer;transition:background 0.12s;border:1.5px solid transparent}
  .ms-device-item:hover{background:var(--sl-border)}
  .ms-device-item.selected{background:#eff6ff;border-color:#bfdbfe}
  .ms-dot-on{width:7px;height:7px;border-radius:50%;background:#22c55e;flex-shrink:0}
  .ms-dot-off{width:7px;height:7px;border-radius:50%;background:#94a3b8;flex-shrink:0}

  /* Detail grid */
  .ms-detail-grid{display:grid;grid-template-columns:130px 1fr;gap:8px 16px;font-size:13.5px;margin-bottom:18px}
  .ms-detail-key{font-weight:800;color:var(--sl-muted);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;padding-top:3px;font-family:'Nunito',sans-serif}
  .ms-detail-body{background:var(--sl-bg);border:1px solid var(--sl-border);border-radius:11px;padding:12px 14px;font-size:14px;line-height:1.65;white-space:pre-wrap;word-break:break-word;grid-column:1/-1;margin-top:6px}

  @keyframes msFade{from{opacity:0}to{opacity:1}}
  @keyframes msSlide{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}
  @media(max-width:600px){
    .ms-msg-row{grid-template-columns:1fr auto}
    .ms-msg-meta,.ms-msg-time{display:none}
  }
`;

export default function Messages() {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage]   = useState(1);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string|null>(null);
  const [detailMsg, setDetailMsg] = useState<MessageItem|null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [text, setText]   = useState("");
  const [voice, setVoice] = useState("anna");
  const [scheduleType, setScheduleType] = useState<ScheduleType>("immediate");
  const [customTime, setCustomTime] = useState("");
  const [targetType, setTargetType] = useState<"DEVICE"|"GROUP"|"ALL">("ALL");
  const [targetId, setTargetId]     = useState("");
  const [sending, setSending]       = useState(false);
  const [sendError, setSendError]   = useState<string|null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [templates, setTemplates]   = useState<Template[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateMsg, setTemplateMsg] = useState<string|null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [groups, setGroups]   = useState<DeviceGroup[]>([]);
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
    try { const r = await apiFetch<{devices:Device[]}>("/admin/devices/health"); setDevices(r.devices??[]); } catch {}
  }
  async function loadGroups() {
    try { const r = await apiFetch<{groups:DeviceGroup[]}>("/admin/devices/groups"); setGroups(r.groups??[]); } catch {}
  }

  useEffect(() => { loadMessages(1); }, []);
  useEffect(() => { if (composerOpen) { loadTemplates(); loadDevices(); loadGroups(); } }, [composerOpen]);

  function openComposer() {
    setText(""); setVoice("anna"); setScheduleType("immediate"); setCustomTime("");
    setTargetType("ALL"); setTargetId(""); setSendError(null); setSendSuccess(false);
    setTemplateName(""); setTemplateMsg(null); setComposerOpen(true);
  }
  function closeComposer() { setComposerOpen(false); setSendSuccess(false); }

  async function saveTemplate() {
    if (!templateName.trim()||!text.trim()) { setTemplateMsg("Adj meg nevet és szöveget!"); return; }
    setSavingTemplate(true); setTemplateMsg(null);
    try { await apiPost("/messages/templates",{name:templateName.trim(),text,voice}); setTemplateMsg("Sablon elmentve!"); setTemplateName(""); await loadTemplates(); }
    catch (e:any) { setTemplateMsg(e?.message??"Mentés sikertelen"); }
    finally { setSavingTemplate(false); }
  }
  async function deleteTemplate(id:string) {
    try { await apiFetch(`/messages/templates/${id}`,{method:"DELETE"}); await loadTemplates(); } catch {}
  }
  async function sendMessage() {
    if (!text.trim()) { setSendError("A szöveg nem lehet üres!"); return; }
    if (targetType!=="ALL"&&!targetId) { setSendError("Válassz célt!"); return; }
    if (scheduleType==="custom"&&!customTime) { setSendError("Add meg az időpontot!"); return; }
    setSending(true); setSendError(null);
    let scheduledAt:string|null=null;
    if (scheduleType==="custom"&&customTime) {
      const today=new Date().toISOString().slice(0,10);
      scheduledAt=new Date(`${today}T${customTime}:00`).toISOString();
    }
    try {
      await apiPost("/messages",{text:text.trim(),voice,targetType,targetId:targetType==="ALL"?undefined:targetId,scheduledAt});
      setSendSuccess(true); await loadMessages(1);
    } catch (e:any) { setSendError(e?.message??"Küldés sikertelen"); }
    finally { setSending(false); }
  }
  const totalPages = Math.ceil(total/LIMIT);

  return (
    <div className="ms-page">
      <style>{CSS}</style>

      <div className="ms-hdr">
        <div>
          <div className="ms-title">📢 Üzenetek</div>
          <div className="ms-subtitle">Iskolai hangüzenetek küldése és előzményei.</div>
        </div>
        <button className="ms-btn ms-btn-primary" onClick={openComposer}>＋ Új üzenet</button>
      </div>

      {listError && <div className="ms-alert ms-alert-error"><span>⚠️</span>{listError}</div>}

      {loading ? (
        <div className="ms-empty"><div className="ms-empty-icon">⏳</div><div className="ms-empty-txt">Betöltés…</div></div>
      ) : messages.length === 0 ? (
        <div className="ms-empty">
          <div className="ms-empty-icon">📭</div>
          <div className="ms-empty-txt">Még nem küldtek üzenetet</div>
          <div style={{ fontSize:13, marginTop:6 }}>Kattints az „Új üzenet" gombra az első küldéshez</div>
        </div>
      ) : (
        <div className="ms-card">
          {messages.map(m => (
            <div className="ms-msg-row" key={m.id}>
              <div className="ms-msg-excerpt">{excerpt(m.text)}</div>
              <div className="ms-msg-meta">{m.createdBy.displayName||m.createdBy.email}</div>
              <div className="ms-msg-time">
                {m.playedAt ? formatDate(m.playedAt) : m.scheduledAt ? `⏰ ${formatDate(m.scheduledAt)}` : formatDate(m.createdAt)}
              </div>
              <button className="ms-btn ms-btn-ghost ms-btn-sm" onClick={() => setDetailMsg(m)}>Részletek</button>
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
                <div className="ms-detail-key">Feladó</div>
                <div>{detailMsg.createdBy.displayName||detailMsg.createdBy.email}</div>
                <div className="ms-detail-key">Létrehozva</div>
                <div>{formatDate(detailMsg.createdAt)}</div>
                {detailMsg.scheduledAt && <><div className="ms-detail-key">Ütemezve</div><div>{formatDate(detailMsg.scheduledAt)}</div></>}
                {detailMsg.playedAt && <><div className="ms-detail-key">Lejátszva</div><div>{formatDate(detailMsg.playedAt)}</div></>}
                <div className="ms-detail-key">Hangszín</div>
                <div>{VOICE_LABELS[detailMsg.voice??"anna"]??detailMsg.voice}</div>
                <div className="ms-detail-key">Cél</div>
                <div>{detailMsg.targetType}{detailMsg.targetId?` (${detailMsg.targetId.slice(0,8)}…)`:""}</div>
              </div>
              {detailMsg.fileUrl && <audio controls src={detailMsg.fileUrl} style={{ width:"100%" }} />}
              <div>
                <div className="ms-label">Szöveg</div>
                <div className="ms-detail-body">{detailMsg.text||"–"}</div>
              </div>
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
                  <span>✅</span>Az üzenet sikeresen elküldve! A hangfájl generálódik és az eszközök megkapják a parancsot.
                </div>
                <div className="ms-modal-footer" style={{ padding:0, border:0 }}>
                  <button className="ms-btn ms-btn-primary" onClick={closeComposer}>Bezárás</button>
                </div>
              </div>
            ) : (
              <div className="ms-modal-body">
                {/* Sablonok */}
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

                {/* Szöveg */}
                <div>
                  <label className="ms-label">✏️ Üzenet szövege</label>
                  <textarea className="ms-textarea" value={text} onChange={e => setText(e.target.value)} placeholder="Írd be az üzenet szövegét…" />
                </div>

                {/* Sablon mentése */}
                <div>
                  <label className="ms-label">📁 Mentés sablonként</label>
                  <div className="ms-row">
                    <input className="ms-input" style={{ flex:1, minWidth:130 }} placeholder="Sablon neve…" value={templateName} onChange={e => setTemplateName(e.target.value)} />
                    <button className="ms-btn ms-btn-ghost ms-btn-sm" onClick={saveTemplate} disabled={savingTemplate}>
                      {savingTemplate ? "Mentés…" : "💾 Mentés"}
                    </button>
                  </div>
                  {templateMsg && (
                    <div style={{ fontSize:12, marginTop:5, color: templateMsg.includes("mentve") ? "#15803d" : "#dc2626" }}>{templateMsg}</div>
                  )}
                </div>

                {/* Hangszín */}
                <div>
                  <div className="ms-label">🎙️ Hangszín</div>
                  <div className="ms-row">
                    {Object.entries(VOICE_LABELS).map(([val,label]) => (
                      <div key={val} className={"ms-chip"+(voice===val?" active":"")} onClick={() => setVoice(val)}>{label}</div>
                    ))}
                  </div>
                </div>

                {/* Cél */}
                <div>
                  <div className="ms-label">🎯 Lejátszó eszközök</div>
                  <div className="ms-row" style={{ marginBottom:10 }}>
                    {(["ALL","DEVICE","GROUP"] as const).map(t => (
                      <div key={t} className={"ms-chip"+(targetType===t?" active":"")} onClick={() => { setTargetType(t); setTargetId(""); }}>
                        {t==="ALL"?"📡 Összes":t==="DEVICE"?"🔊 Egyedi eszköz":"👥 Csoport"}
                      </div>
                    ))}
                  </div>
                  {targetType==="DEVICE" && (
                    <div className="ms-device-list">
                      {devices.length===0 && <div style={{ fontSize:13,color:"var(--sl-muted)",padding:8 }}>Nincs elérhető eszköz</div>}
                      {devices.map(d => (
                        <div key={d.id} className={"ms-device-item"+(targetId===d.id?" selected":"")} onClick={() => setTargetId(d.id)}>
                          <span className={d.online?"ms-dot-on":"ms-dot-off"} />
                          <span style={{ fontSize:13.5,fontWeight:600 }}>{d.name}</span>
                          <span style={{ fontSize:11,color:"var(--sl-muted)",marginLeft:"auto" }}>{d.deviceClass}</span>
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
                  {scheduleType==="next_bell" && <div style={{ fontSize:12,color:"var(--sl-muted)",marginTop:8 }}>Az üzenet a csengetési rend szerinti következő szünetben játszódik le.</div>}
                  {scheduleType==="custom" && (
                    <div style={{ marginTop:10 }}>
                      <input type="time" className="ms-input" style={{ width:"auto" }} value={customTime} onChange={e => setCustomTime(e.target.value)} />
                    </div>
                  )}
                </div>

                {sendError && <div className="ms-alert ms-alert-error"><span>⚠️</span>{sendError}</div>}

                <div className="ms-modal-footer" style={{ padding:"0", border:"0" }}>
                  <button className="ms-btn ms-btn-ghost" onClick={closeComposer}>Mégse</button>
                  <button className="ms-btn ms-btn-primary" onClick={sendMessage} disabled={sending}>
                    {sending ? "⏳ Generálás…" : "🔊 Küldés"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
