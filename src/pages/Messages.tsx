import { useEffect, useState } from "react";
import { apiFetch, apiPost } from "../lib/api";

// ─── Típusok ──────────────────────────────────────────────────────────────────

type MessageItem = {
  id: string;
  title: string | null;
  text: string | null;
  type: string;
  voice: string | null;
  fileUrl: string | null;
  targetType: string;
  targetId: string | null;
  scheduledAt: string | null;
  playedAt: string | null;
  createdAt: string;
  createdBy: { id: string; displayName: string | null; email: string };
};

type Template = {
  id: string;
  name: string;
  text: string;
  voice: string;
  createdAt: string;
};

type Device = {
  id: string;
  name: string;
  online: boolean;
  deviceClass: string;
};

type DeviceGroup = {
  id: string;
  name: string;
};

type ScheduleType = "immediate" | "next_bell" | "custom";

// ─── Segédfüggvények ──────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("hu-HU", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function excerpt(text: string | null, n = 16): string {
  if (!text) return "–";
  return text.length > n ? text.slice(0, n) + "…" : text;
}

const VOICE_LABELS: Record<string, string> = {
  anna:  "Anna (női)",
  berta: "Berta (női)",
  imre:  "Imre (férfi)",
};

// ─── Komponens ────────────────────────────────────────────────────────────────

export default function Messages() {
  // --- Lista ---
  const [messages, setMessages]   = useState<MessageItem[]>([]);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // --- Részletek modal ---
  const [detailMsg, setDetailMsg] = useState<MessageItem | null>(null);

  // --- Új üzenet modal ---
  const [composerOpen, setComposerOpen] = useState(false);

  // --- Composer state ---
  const [text, setText]                   = useState("");
  const [voice, setVoice]                 = useState("anna");
  const [scheduleType, setScheduleType]   = useState<ScheduleType>("immediate");
  const [customTime, setCustomTime]       = useState("");
  const [targetType, setTargetType]       = useState<"DEVICE" | "GROUP" | "ALL">("ALL");
  const [targetId, setTargetId]           = useState<string>("");
  const [sending, setSending]             = useState(false);
  const [sendError, setSendError]         = useState<string | null>(null);
  const [sendSuccess, setSendSuccess]     = useState(false);

  // --- Sablonok ---
  const [templates, setTemplates]         = useState<Template[]>([]);
  const [templateName, setTemplateName]   = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateMsg, setTemplateMsg]     = useState<string | null>(null);

  // --- Eszközök és csoportok ---
  const [devices, setDevices]   = useState<Device[]>([]);
  const [groups, setGroups]     = useState<DeviceGroup[]>([]);

  const LIMIT = 20;

  // ── Üzenetlista betöltése ──
  async function loadMessages(p = 1) {
    setLoading(true);
    setListError(null);
    try {
      const res = await apiFetch<{ ok: boolean; messages: MessageItem[]; total: number }>(
        `/messages?page=${p}&limit=${LIMIT}`
      );
      setMessages(res.messages);
      setTotal(res.total);
      setPage(p);
    } catch (e: any) {
      setListError(e?.message ?? "Betöltés sikertelen");
    } finally {
      setLoading(false);
    }
  }

  // ── Sablonok betöltése ──
  async function loadTemplates() {
    try {
      const res = await apiFetch<{ ok: boolean; templates: Template[] }>("/messages/templates");
      setTemplates(res.templates);
    } catch { /* silent */ }
  }

  // ── Eszközök betöltése ──
  async function loadDevices() {
    try {
      const res = await apiFetch<{ devices: Device[] }>("/admin/devices/health");
      setDevices(res.devices ?? []);
    } catch { /* silent */ }
  }

  // ── Csoportok betöltése ──
  async function loadGroups() {
    try {
      const res = await apiFetch<{ groups: DeviceGroup[] }>("/admin/devices/groups");
      setGroups(res.groups ?? []);
    } catch { /* silent */ }
  }

  useEffect(() => {
    loadMessages(1);
  }, []);

  useEffect(() => {
    if (composerOpen) {
      loadTemplates();
      loadDevices();
      loadGroups();
    }
  }, [composerOpen]);

  // ── Composer megnyitása / bezárása ──
  function openComposer() {
    setText("");
    setVoice("anna");
    setScheduleType("immediate");
    setCustomTime("");
    setTargetType("ALL");
    setTargetId("");
    setSendError(null);
    setSendSuccess(false);
    setTemplateName("");
    setTemplateMsg(null);
    setComposerOpen(true);
  }

  function closeComposer() {
    setComposerOpen(false);
    setSendSuccess(false);
  }

  // ── Sablon betöltése szerkesztőbe ──
  function loadTemplate(t: Template) {
    setText(t.text);
    setVoice(t.voice);
  }

  // ── Sablon mentése ──
  async function saveTemplate() {
    if (!templateName.trim() || !text.trim()) {
      setTemplateMsg("Adj meg nevet és szöveget!");
      return;
    }
    setSavingTemplate(true);
    setTemplateMsg(null);
    try {
      await apiPost("/messages/templates", { name: templateName.trim(), text, voice });
      setTemplateMsg("Sablon elmentve!");
      setTemplateName("");
      await loadTemplates();
    } catch (e: any) {
      setTemplateMsg(e?.message ?? "Mentés sikertelen");
    } finally {
      setSavingTemplate(false);
    }
  }

  // ── Sablon törlése ──
  async function deleteTemplate(id: string) {
    try {
      await apiFetch(`/messages/templates/${id}`, { method: "DELETE" });
      await loadTemplates();
    } catch { /* silent */ }
  }

  // ── Üzenet küldése ──
  async function sendMessage() {
    if (!text.trim()) { setSendError("A szöveg nem lehet üres!"); return; }
    if (targetType !== "ALL" && !targetId) { setSendError("Válassz célt!"); return; }
    if (scheduleType === "custom" && !customTime) { setSendError("Add meg az időpontot!"); return; }

    setSending(true);
    setSendError(null);

    let scheduledAt: string | null = null;
    if (scheduleType === "custom" && customTime) {
      const today = new Date().toISOString().slice(0, 10);
      scheduledAt = new Date(`${today}T${customTime}:00`).toISOString();
    }

    try {
      await apiPost("/messages", {
        text: text.trim(),
        voice,
        targetType,
        targetId: targetType === "ALL" ? undefined : targetId,
        scheduledAt,
      });
      setSendSuccess(true);
      await loadMessages(1);
    } catch (e: any) {
      setSendError(e?.message ?? "Küldés sikertelen");
    } finally {
      setSending(false);
    }
  }

  const totalPages = Math.ceil(total / LIMIT);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="msg-page">
      <style>{`
        .msg-page {
          max-width: 900px;
        }

        .msg-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 24px;
          flex-wrap: wrap;
          gap: 12px;
        }

        .msg-header h1 {
          margin: 0;
          font-size: 22px;
          font-weight: 700;
        }

        .msg-btn-primary {
          height: 40px;
          padding: 0 18px;
          border-radius: 12px;
          border: none;
          background: var(--sl-accent, #2563eb);
          color: #fff;
          font-weight: 700;
          font-size: 14px;
          cursor: pointer;
          transition: opacity .15s;
        }
        .msg-btn-primary:hover { opacity: .88; }
        .msg-btn-primary:disabled { opacity: .5; cursor: not-allowed; }

        .msg-btn-secondary {
          height: 36px;
          padding: 0 14px;
          border-radius: 10px;
          border: 1px solid var(--sl-border);
          background: rgba(127,127,127,0.08);
          color: inherit;
          font-size: 13px;
          cursor: pointer;
        }
        .msg-btn-secondary:hover { background: rgba(127,127,127,0.14); }

        .msg-btn-danger {
          height: 30px;
          padding: 0 10px;
          border-radius: 8px;
          border: 1px solid rgba(239,68,68,0.4);
          background: rgba(239,68,68,0.08);
          color: #ef4444;
          font-size: 12px;
          cursor: pointer;
        }
        .msg-btn-danger:hover { background: rgba(239,68,68,0.16); }

        /* Timeline */
        .msg-timeline {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .msg-row {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr auto;
          align-items: center;
          gap: 12px;
          padding: 14px 16px;
          border: 1px solid var(--sl-border);
          border-radius: 14px;
          background: rgba(127,127,127,0.03);
          transition: background .15s;
        }
        .msg-row:hover { background: rgba(127,127,127,0.07); }

        .msg-row-excerpt {
          font-weight: 600;
          font-size: 14px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .msg-row-meta {
          font-size: 12px;
          color: var(--sl-muted);
        }

        .msg-row-time {
          font-size: 12px;
          color: var(--sl-muted);
          white-space: nowrap;
        }

        .msg-empty {
          text-align: center;
          padding: 48px 0;
          color: var(--sl-muted);
          font-size: 15px;
        }

        .msg-pagination {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 16px;
          font-size: 13px;
          color: var(--sl-muted);
        }

        .msg-error {
          padding: 12px 16px;
          border-radius: 12px;
          border: 1px solid rgba(239,68,68,0.3);
          background: rgba(239,68,68,0.07);
          color: #ef4444;
          font-size: 13px;
          margin-bottom: 16px;
        }

        .msg-success {
          padding: 12px 16px;
          border-radius: 12px;
          border: 1px solid rgba(34,197,94,0.3);
          background: rgba(34,197,94,0.07);
          color: #16a34a;
          font-size: 13px;
          margin-bottom: 16px;
        }

        /* Modal overlay */
        .msg-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          backdrop-filter: blur(3px);
          z-index: 100;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 32px 16px;
          overflow-y: auto;
        }

        .msg-modal {
          background: var(--sl-bg, #fff);
          border: 1px solid var(--sl-border);
          border-radius: 20px;
          padding: 28px;
          width: 100%;
          max-width: 680px;
          box-shadow: 0 24px 64px rgba(0,0,0,0.18);
          position: relative;
        }

        .msg-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
        }

        .msg-modal-header h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 700;
        }

        .msg-close {
          height: 36px;
          width: 40px;
          border-radius: 10px;
          border: 1px solid var(--sl-border);
          background: rgba(127,127,127,0.08);
          color: inherit;
          font-size: 16px;
          cursor: pointer;
        }
        .msg-close:hover { background: rgba(127,127,127,0.16); }

        /* Composer form */
        .msg-section {
          margin-bottom: 20px;
        }

        .msg-label {
          display: block;
          font-size: 12px;
          font-weight: 600;
          color: var(--sl-muted);
          text-transform: uppercase;
          letter-spacing: .05em;
          margin-bottom: 8px;
        }

        .msg-textarea {
          width: 100%;
          min-height: 120px;
          padding: 12px 14px;
          border-radius: 12px;
          border: 1px solid var(--sl-border);
          background: rgba(127,127,127,0.04);
          color: inherit;
          font-size: 15px;
          line-height: 1.6;
          resize: vertical;
          box-sizing: border-box;
          font-family: inherit;
        }
        .msg-textarea:focus {
          outline: none;
          border-color: var(--sl-accent, #2563eb);
          box-shadow: 0 0 0 3px rgba(37,99,235,0.12);
        }

        .msg-select {
          height: 40px;
          padding: 0 12px;
          border-radius: 10px;
          border: 1px solid var(--sl-border);
          background: rgba(127,127,127,0.04);
          color: inherit;
          font-size: 14px;
          cursor: pointer;
          min-width: 160px;
        }
        .msg-select:focus { outline: none; border-color: var(--sl-accent, #2563eb); }

        .msg-input {
          height: 40px;
          padding: 0 12px;
          border-radius: 10px;
          border: 1px solid var(--sl-border);
          background: rgba(127,127,127,0.04);
          color: inherit;
          font-size: 14px;
          box-sizing: border-box;
        }
        .msg-input:focus { outline: none; border-color: var(--sl-accent, #2563eb); }

        .msg-row-inline {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          align-items: center;
        }

        /* Sablon sáv */
        .msg-template-bar {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
          padding: 12px 14px;
          border: 1px solid var(--sl-border);
          border-radius: 12px;
          background: rgba(127,127,127,0.03);
          margin-bottom: 12px;
        }

        .msg-template-chip {
          height: 32px;
          padding: 0 12px;
          border-radius: 8px;
          border: 1px solid var(--sl-border);
          background: rgba(127,127,127,0.06);
          color: inherit;
          font-size: 13px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .msg-template-chip:hover { background: rgba(127,127,127,0.12); }

        .msg-template-chip-del {
          color: var(--sl-muted);
          font-size: 11px;
          margin-left: 2px;
          cursor: pointer;
        }
        .msg-template-chip-del:hover { color: #ef4444; }

        /* Cél kiválasztó */
        .msg-target-section {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .msg-device-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 180px;
          overflow-y: auto;
          padding: 8px;
          border: 1px solid var(--sl-border);
          border-radius: 10px;
          background: rgba(127,127,127,0.03);
        }

        .msg-device-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border-radius: 8px;
          cursor: pointer;
          transition: background .12s;
        }
        .msg-device-item:hover { background: rgba(127,127,127,0.08); }
        .msg-device-item.selected { background: rgba(37,99,235,0.10); border: 1px solid rgba(37,99,235,0.25); }

        .msg-online-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .msg-online-dot.online  { background: #22c55e; }
        .msg-online-dot.offline { background: #6b7280; }

        /* Részletek modal */
        .msg-detail-grid {
          display: grid;
          grid-template-columns: 140px 1fr;
          gap: 8px 16px;
          font-size: 14px;
          margin-bottom: 20px;
        }

        .msg-detail-key {
          font-weight: 600;
          color: var(--sl-muted);
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: .04em;
          padding-top: 2px;
        }

        .msg-detail-text {
          background: rgba(127,127,127,0.05);
          border: 1px solid var(--sl-border);
          border-radius: 10px;
          padding: 12px 14px;
          font-size: 15px;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
          grid-column: 1 / -1;
          margin-top: 4px;
        }

        /* Ütemezés radio */
        .msg-schedule-options {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .msg-schedule-option {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border-radius: 10px;
          border: 1px solid var(--sl-border);
          background: rgba(127,127,127,0.04);
          cursor: pointer;
          font-size: 13px;
          transition: all .12s;
          user-select: none;
        }
        .msg-schedule-option.active {
          border-color: var(--sl-accent, #2563eb);
          background: rgba(37,99,235,0.08);
          color: var(--sl-accent, #2563eb);
          font-weight: 600;
        }

        @media (max-width: 600px) {
          .msg-row {
            grid-template-columns: 1fr auto;
          }
          .msg-row-meta, .msg-row-time { display: none; }
        }
      `}</style>

      {/* ── Fejléc ── */}
      <div className="msg-header">
        <h1>Üzenetek</h1>
        <button className="msg-btn-primary" onClick={openComposer}>
          + Új üzenet
        </button>
      </div>

      {/* ── Hiba ── */}
      {listError && <div className="msg-error">{listError}</div>}

      {/* ── Timeline ── */}
      {loading ? (
        <div className="msg-empty">Betöltés…</div>
      ) : messages.length === 0 ? (
        <div className="msg-empty">Még nincs egyetlen üzenet sem.</div>
      ) : (
        <div className="msg-timeline">
          {messages.map((m) => (
            <div className="msg-row" key={m.id}>
              <div className="msg-row-excerpt">{excerpt(m.text)}</div>
              <div className="msg-row-meta">
                {m.createdBy.displayName || m.createdBy.email}
              </div>
              <div className="msg-row-time">
                {m.playedAt ? formatDate(m.playedAt) : m.scheduledAt ? `⏰ ${formatDate(m.scheduledAt)}` : formatDate(m.createdAt)}
              </div>
              <button
                className="msg-btn-secondary"
                onClick={() => setDetailMsg(m)}
              >
                Részletek
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Lapozó ── */}
      {totalPages > 1 && (
        <div className="msg-pagination">
          <button
            className="msg-btn-secondary"
            disabled={page <= 1}
            onClick={() => loadMessages(page - 1)}
          >
            ← Előző
          </button>
          <span>{page} / {totalPages}</span>
          <button
            className="msg-btn-secondary"
            disabled={page >= totalPages}
            onClick={() => loadMessages(page + 1)}
          >
            Következő →
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          RÉSZLETEK MODAL
      ══════════════════════════════════════════════════════ */}
      {detailMsg && (
        <div className="msg-overlay" onClick={() => setDetailMsg(null)}>
          <div className="msg-modal" onClick={(e) => e.stopPropagation()}>
            <div className="msg-modal-header">
              <h2>Üzenet részletei</h2>
              <button className="msg-close" onClick={() => setDetailMsg(null)}>✕</button>
            </div>

            <div className="msg-detail-grid">
              <div className="msg-detail-key">Feladó</div>
              <div>{detailMsg.createdBy.displayName || detailMsg.createdBy.email}</div>

              <div className="msg-detail-key">Létrehozva</div>
              <div>{formatDate(detailMsg.createdAt)}</div>

              {detailMsg.scheduledAt && (
                <>
                  <div className="msg-detail-key">Ütemezve</div>
                  <div>{formatDate(detailMsg.scheduledAt)}</div>
                </>
              )}

              {detailMsg.playedAt && (
                <>
                  <div className="msg-detail-key">Lejátszva</div>
                  <div>{formatDate(detailMsg.playedAt)}</div>
                </>
              )}

              <div className="msg-detail-key">Hangszín</div>
              <div>{VOICE_LABELS[detailMsg.voice ?? "anna"] ?? detailMsg.voice}</div>

              <div className="msg-detail-key">Cél</div>
              <div>{detailMsg.targetType}{detailMsg.targetId ? ` (${detailMsg.targetId.slice(0, 8)}…)` : ""}</div>

              {detailMsg.fileUrl && (
                <>
                  <div className="msg-detail-key">Hangfájl</div>
                  <div>
                    <audio controls src={detailMsg.fileUrl} style={{ width: "100%", marginTop: 4 }} />
                  </div>
                </>
              )}
            </div>

            <div className="msg-label">Szöveg</div>
            <div className="msg-detail-text">{detailMsg.text || "–"}</div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          COMPOSER MODAL
      ══════════════════════════════════════════════════════ */}
      {composerOpen && (
        <div className="msg-overlay" onClick={closeComposer}>
          <div className="msg-modal" onClick={(e) => e.stopPropagation()}>
            <div className="msg-modal-header">
              <h2>Új üzenet</h2>
              <button className="msg-close" onClick={closeComposer}>✕</button>
            </div>

            {sendSuccess ? (
              <>
                <div className="msg-success">
                  ✓ Az üzenet sikeresen elküldve! A hangfájl generálódik és az eszközök megkapják a parancsot.
                </div>
                <button className="msg-btn-primary" onClick={closeComposer}>Bezárás</button>
              </>
            ) : (
              <>
                {/* ── Sablonok ── */}
                {templates.length > 0 && (
                  <div className="msg-section">
                    <div className="msg-label">Mentett sablonok</div>
                    <div className="msg-template-bar">
                      {templates.map((t) => (
                        <div key={t.id} className="msg-template-chip" onClick={() => loadTemplate(t)}>
                          {t.name}
                          <span
                            className="msg-template-chip-del"
                            onClick={(e) => { e.stopPropagation(); deleteTemplate(t.id); }}
                            title="Törlés"
                          >✕</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Szöveg ── */}
                <div className="msg-section">
                  <label className="msg-label">Szöveg</label>
                  <textarea
                    className="msg-textarea"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Írd be az üzenet szövegét…"
                  />
                </div>

                {/* ── Sablon mentése ── */}
                <div className="msg-section">
                  <label className="msg-label">Mentés sablonként</label>
                  <div className="msg-row-inline">
                    <input
                      className="msg-input"
                      style={{ flex: 1, minWidth: 140 }}
                      placeholder="Sablon neve…"
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                    />
                    <button
                      className="msg-btn-secondary"
                      onClick={saveTemplate}
                      disabled={savingTemplate}
                    >
                      {savingTemplate ? "Mentés…" : "Mentés"}
                    </button>
                  </div>
                  {templateMsg && (
                    <div style={{ fontSize: 12, marginTop: 6, color: templateMsg.includes("mentve") ? "#16a34a" : "#ef4444" }}>
                      {templateMsg}
                    </div>
                  )}
                </div>

                {/* ── Hangszín ── */}
                <div className="msg-section">
                  <label className="msg-label">Hangszín</label>
                  <div className="msg-row-inline">
                    {Object.entries(VOICE_LABELS).map(([val, label]) => (
                      <div
                        key={val}
                        className={`msg-schedule-option${voice === val ? " active" : ""}`}
                        onClick={() => setVoice(val)}
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Cél ── */}
                <div className="msg-section">
                  <label className="msg-label">Lejátszó eszközök</label>
                  <div className="msg-target-section">
                    <div className="msg-row-inline">
                      {(["ALL", "DEVICE", "GROUP"] as const).map((t) => (
                        <div
                          key={t}
                          className={`msg-schedule-option${targetType === t ? " active" : ""}`}
                          onClick={() => { setTargetType(t); setTargetId(""); }}
                        >
                          {t === "ALL" ? "Összes eszköz" : t === "DEVICE" ? "Egyedi eszköz" : "Csoport"}
                        </div>
                      ))}
                    </div>

                    {targetType === "DEVICE" && (
                      <div className="msg-device-list">
                        {devices.length === 0 && (
                          <div style={{ fontSize: 13, color: "var(--sl-muted)", padding: 8 }}>Nincs elérhető eszköz</div>
                        )}
                        {devices.map((d) => (
                          <div
                            key={d.id}
                            className={`msg-device-item${targetId === d.id ? " selected" : ""}`}
                            onClick={() => setTargetId(d.id)}
                          >
                            <div className={`msg-online-dot ${d.online ? "online" : "offline"}`} />
                            <span style={{ fontSize: 14 }}>{d.name}</span>
                            <span style={{ fontSize: 12, color: "var(--sl-muted)", marginLeft: "auto" }}>{d.deviceClass}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {targetType === "GROUP" && (
                      <select
                        className="msg-select"
                        value={targetId}
                        onChange={(e) => setTargetId(e.target.value)}
                      >
                        <option value="">Válassz csoportot…</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {/* ── Ütemezés ── */}
                <div className="msg-section">
                  <label className="msg-label">Lejátszás időpontja</label>
                  <div className="msg-schedule-options">
                    {(["immediate", "next_bell", "custom"] as ScheduleType[]).map((s) => (
                      <div
                        key={s}
                        className={`msg-schedule-option${scheduleType === s ? " active" : ""}`}
                        onClick={() => setScheduleType(s)}
                      >
                        {s === "immediate" ? "⚡ Azonnal" : s === "next_bell" ? "🔔 Következő szünet" : "🕐 Időpont megadása"}
                      </div>
                    ))}
                  </div>

                  {scheduleType === "next_bell" && (
                    <div style={{ fontSize: 13, color: "var(--sl-muted)", marginTop: 8 }}>
                      Az üzenet a csengetési rend szerinti következő szünetben játszódik le.
                    </div>
                  )}

                  {scheduleType === "custom" && (
                    <div style={{ marginTop: 10 }}>
                      <input
                        type="time"
                        className="msg-input"
                        value={customTime}
                        onChange={(e) => setCustomTime(e.target.value)}
                      />
                    </div>
                  )}
                </div>

                {/* ── Hiba ── */}
                {sendError && <div className="msg-error">{sendError}</div>}

                {/* ── Küldés ── */}
                <div className="msg-row-inline" style={{ justifyContent: "flex-end" }}>
                  <button className="msg-btn-secondary" onClick={closeComposer}>Mégse</button>
                  <button
                    className="msg-btn-primary"
                    onClick={sendMessage}
                    disabled={sending}
                  >
                    {sending ? "Generálás és küldés…" : "🔊 Küldés"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}