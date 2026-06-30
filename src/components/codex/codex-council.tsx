// Codex Council — the tab shell. Composes the topbar, status strip, session
// rail, and the single / council / independent layouts. All orchestration lives
// in useCodex(); this file is layout + wiring.
import "@/styles/codex-council.css";
import { useState } from "react";
import faceAvatar from "@/assets/codex/face-avatar-digital.webp";
import codexFox from "@/assets/codex/codex-fox.webp";
import claudeFox from "@/assets/codex/claude-fox.webp";
import toriiSplit from "@/assets/codex/torii-split.webp";
import toriiMoon from "@/assets/codex/torii-moon-icon.webp";
import { useCodex } from "./use-codex";
import { ChatLane } from "./chat-lane";
import { Composer } from "./composer";
import { SessionRail } from "./session-rail";
import { SettingsView } from "./settings-view";
import { EmptyState } from "./empty-state";
import { Markdown } from "./markdown";
import type { CouncilMode } from "@/lib/codex-council-types";

const MODES: Array<{ id: CouncilMode; label: string }> = [
  { id: "single", label: "Single" },
  { id: "council", label: "Council" },
  { id: "independent", label: "Independent" },
];

// Ambient binary-rain for the datastream gutters. Deterministic (no Math.random)
// so the server and client render identical text — no hydration mismatch.
const RAIN = Array.from({ length: 220 }, (_, i) => ((i * 1103515245 + 12345) >>> 8) & 1).join("\n");

export function CodexCouncil() {
  const c = useCodex();
  const [railOpen, setRailOpen] = useState(true);
  const [activeView, setActiveView] = useState<"council" | "sessions" | "settings">("council");
  // Recomputed each render (the rail re-renders on every refresh) so relative
  // timestamps stay live instead of freezing at mount.
  const now = Date.now();
  const workspaceWrite = c.sandbox === "workspace-write";
  // Council/independent always show their lanes (the side-by-side); only an
  // empty Single lane falls back to the first-run hero with example prompts.
  const singleEmpty = (c.threads[c.lanes[0]?.id] ?? []).length === 0;

  const statusText = c.note
    ? c.note
    : c.status?.codexConnected
      ? c.mode === "council"
        ? "Council ready · the shared prompt targets both lanes"
        : c.mode === "independent"
          ? "Independent mode · each lane has its own composer"
          : "Single Codex chat · stop and regenerate ready"
      : "Codex offline — run `codex login` to reconnect the ChatGPT subscription";

  return (
    <div
      className={`codex-tab -m-4 md:-m-6${railOpen ? "" : " cx-rail-collapsed"}`}
      data-cx-theme={c.settings.theme}
    >
      <div className="cx-aurora" aria-hidden="true" />
      <div className="cx-gate" aria-hidden="true" />
      <pre className="cx-rain l" aria-hidden="true">
        {RAIN}
      </pre>
      <pre className="cx-rain r" aria-hidden="true">
        {RAIN}
      </pre>

      {/* ── internal collapsible rail (reproduces the approved prototype) ── */}
      <aside className="cx-sidebar">
        <button
          type="button"
          className="cx-nav-toggle"
          aria-label={railOpen ? "Collapse sidebar" : "Expand sidebar"}
          title={railOpen ? "Collapse sidebar" : "Expand sidebar"}
          onClick={() => setRailOpen((v) => !v)}
        >
          {railOpen ? "‹" : "›"}
        </button>
        <div className="cx-brand">
          <div className="cx-logo-tile">
            <img src={faceAvatar} alt="" />
          </div>
          <div className="cx-brand-txt">
            <strong>Codex Council</strong>
            <small>Developer Console</small>
          </div>
        </div>
        <nav className="cx-nav" aria-label="Codex console">
          <button
            type="button"
            className={`cx-nav-item${activeView === "council" ? " active" : ""}`}
            title="Codex Council"
            onClick={() => setActiveView("council")}
          >
            <span className="cx-nav-ico">
              <img src={toriiMoon} alt="" />
            </span>
            <span className="cx-lbl">Codex Council</span>
          </button>
          <button
            type="button"
            className={`cx-nav-item${activeView === "sessions" ? " active" : ""}`}
            title="Sessions — history log of every council run"
            onClick={() => setActiveView("sessions")}
          >
            <span className="cx-dot" />
            <span className="cx-lbl">Sessions</span>
          </button>
          <button
            type="button"
            className={`cx-nav-item${activeView === "settings" ? " active" : ""}`}
            title="Settings — default models, sandbox, grounding, synthesizer, theme & the shared brief"
            onClick={() => setActiveView("settings")}
          >
            <span className="cx-dot" />
            <span className="cx-lbl">Settings</span>
          </button>
        </nav>
      </aside>

      <div className="cx-content">
        {/* ── topbar ── */}
        <header className="cx-topbar cx-glass">
          <div className="cx-ident">
            <div className="cx-split-mark" title="Two minds, one verdict">
              <img src={toriiSplit} alt="" className="cx-split-img" />
            </div>
            <div className="cx-title">
              <strong>Codex Council</strong>
              <span className="cx-verdict-sub">
                <span className="m1">two minds</span>
                <span className="sep">, </span>
                <span className="m2">one verdict</span>
              </span>
            </div>
          </div>
          <div className="cx-actions">
            <div className="cx-mode-tabs" role="tablist" aria-label="Console mode">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={c.mode === m.id ? "active" : ""}
                  aria-selected={c.mode === m.id}
                  onClick={() => c.setMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <span className={`cx-chip ${c.status?.codexConnected ? "cyan" : "warn"}`}>
              <span className={`cx-pulse${c.status?.codexConnected ? "" : " warn"}`} />
              ChatGPT Pro
            </span>
            <span className="cx-chip violet">
              <span
                className={`cx-pulse violet${c.status?.claudeAvailable === false ? " warn" : ""}`}
              />
              Claude Max
            </span>
          </div>
        </header>

        {/* ── status strip ── */}
        <section className="cx-status cx-glass" aria-live="polite">
          <div className="cx-status-left">
            <span className={`cx-pulse${c.status?.codexConnected ? "" : " warn"}`} />
            <span>{statusText}</span>
            <span className="cx-scan" aria-hidden="true" />
          </div>
          <div className="cx-status-right">
            {c.usage ? (
              <span
                className="cx-chip"
                title={`Codex ${c.usage.byEngine.codex.tokens.toLocaleString()} · Claude ${c.usage.byEngine.claude.tokens.toLocaleString()}`}
              >
                {c.usage.totalTokens.toLocaleString()} tokens · {c.usage.turns} turns
              </span>
            ) : null}
            <button
              type="button"
              className="cx-chip"
              onClick={() => c.setGrounded(!c.grounded)}
              aria-pressed={c.grounded}
              style={c.grounded ? { fontWeight: 700, opacity: 1 } : { opacity: 0.6 }}
              title="Ground both lanes in the shared brief — the same context to Codex + Claude (leave off for pure code questions). Edit the brief in Settings."
            >
              {c.grounded ? "◈ Grounding" : "◇ Grounding"}
            </button>
            <span className="cx-picker">
              <select
                value={c.sandbox}
                onChange={(e) => c.setSandbox(e.target.value as "read-only" | "workspace-write")}
                aria-label="Codex sandbox"
              >
                <option value="read-only">read-only</option>
                <option value="workspace-write">workspace-write</option>
              </select>
            </span>
            {workspaceWrite ? (
              <input
                className="cx-chip"
                style={{ width: 230 }}
                placeholder="working folder (under $HOME, a git repo)"
                value={c.cwd}
                onChange={(e) => c.setCwd(e.target.value)}
                aria-label="Working folder"
              />
            ) : null}
          </div>
        </section>

        {/* ── workspace ── */}
        <div className="cx-workspace">
          {activeView === "sessions" ? (
            <div className="cx-sessions-view">
              <SessionRail
                sessions={c.sessions}
                activeId={c.activeId}
                now={now}
                onNew={() => {
                  c.newSession();
                  setActiveView("council");
                }}
                onSelect={(id) => {
                  void c.loadSession(id);
                  setActiveView("council");
                }}
              />
            </div>
          ) : activeView === "settings" ? (
            <SettingsView settings={c.settings} onSave={c.updateSettings} />
          ) : c.mode === "single" ? (
            singleEmpty ? (
              <div className="cx-chat-shell">
                <EmptyState onPrompt={(p) => c.setDraft(p)} />
                <Composer
                  value={c.draft}
                  onChange={c.setDraft}
                  onSend={c.sendShared}
                  placeholder="Ask Codex to reason through code, architecture, logs, or a plan…"
                  sendLabel="Send"
                  hint={`${c.sandbox} · ⌘↵ send`}
                />
              </div>
            ) : (
              <div className="cx-chat-shell">
                <ChatLane
                  lane={c.lanes[0]}
                  messages={c.threads[c.lanes[0].id] ?? []}
                  streaming={!!c.streamingLanes[c.lanes[0].id]}
                  accent="cyan"
                  avatar={codexFox}
                  paneClass="cx-single"
                  allowEdit
                  onModelChange={(l) => c.setLane(0, l)}
                  onStop={() => c.stop(c.lanes[0].id)}
                  onRegenerate={() => c.regenerate(c.lanes[0].id)}
                  workspaceWrite={workspaceWrite}
                  onApprove={(msgId, diff) => void c.applyProposed(c.lanes[0].id, msgId, diff)}
                  applyingId={c.applyingId}
                />
                <Composer
                  value={c.draft}
                  onChange={c.setDraft}
                  onSend={c.sendShared}
                  placeholder="Ask Codex…"
                  sendLabel="Send"
                  disabled={!!c.streamingLanes[c.lanes[0].id]}
                  hint={`${c.sandbox} · ⌘↵ send`}
                />
              </div>
            )
          ) : c.mode === "council" ? (
            <div className="cx-chat-shell">
              <div className="cx-grid-2">
                {c.lanes.map((lane, i) => (
                  <ChatLane
                    key={lane.id}
                    lane={lane}
                    messages={c.threads[lane.id] ?? []}
                    streaming={!!c.streamingLanes[lane.id]}
                    accent={i === 0 ? "cyan" : "violet"}
                    avatar={i === 0 ? codexFox : claudeFox}
                    paneClass={`cx-pane${i === 1 ? " alt" : ""}`}
                    allowEdit
                    onModelChange={(l) => c.setLane(i, l)}
                    onStop={() => c.stop(lane.id)}
                    onRegenerate={() => c.regenerate(lane.id)}
                    workspaceWrite={workspaceWrite}
                    onApprove={(msgId, diff) => void c.applyProposed(lane.id, msgId, diff)}
                    applyingId={c.applyingId}
                  />
                ))}
              </div>
              {c.synthMsg ? (
                <div className="cx-synthesis" style={{ overflow: "auto" }}>
                  <div className="cx-msg-head">
                    Synthesis · Claude opus
                    {c.synthStreaming ? (
                      <button
                        type="button"
                        className="cx-tiny-btn hot"
                        onClick={c.stopSynth}
                        style={{ marginLeft: 8 }}
                      >
                        Stop
                      </button>
                    ) : null}
                  </div>
                  {c.synthMsg.text ? <Markdown text={c.synthMsg.text} /> : null}
                  {c.synthStreaming ? <div className="cx-stream-line" /> : null}
                </div>
              ) : null}
              <Composer
                value={c.draft}
                onChange={c.setDraft}
                onSend={c.sendShared}
                placeholder="Ask the council to review architecture, code, logs, or implementation risk…"
                sendLabel="Send to Council"
                disabled={c.lanes.some((l) => c.streamingLanes[l.id])}
                hint={`${c.sandbox} · ⌘↵ send`}
                extra={
                  <button
                    type="button"
                    className="cx-action"
                    onClick={() => void c.synthesize()}
                    disabled={c.synthStreaming}
                  >
                    {c.synthStreaming ? "Synthesizing…" : "Synthesize verdict"}
                  </button>
                }
              />
            </div>
          ) : (
            <div className="cx-grid-2">
              {c.lanes.map((lane, i) => (
                <ChatLane
                  key={lane.id}
                  lane={lane}
                  messages={c.threads[lane.id] ?? []}
                  streaming={!!c.streamingLanes[lane.id]}
                  accent={i === 0 ? "cyan" : "violet"}
                  avatar={i === 0 ? codexFox : claudeFox}
                  paneClass={`cx-pane with-composer${i === 1 ? " alt" : ""}`}
                  allowEdit
                  onModelChange={(l) => c.setLane(i, l)}
                  onStop={() => c.stop(lane.id)}
                  onRegenerate={() => c.regenerate(lane.id)}
                  workspaceWrite={workspaceWrite}
                  onApprove={(msgId, diff) => void c.applyProposed(lane.id, msgId, diff)}
                  applyingId={c.applyingId}
                  composer={
                    <Composer
                      value={c.drafts[lane.id] ?? ""}
                      onChange={(v) => c.setDrafts((d) => ({ ...d, [lane.id]: v }))}
                      onSend={() => c.sendLane(lane.id)}
                      placeholder={`Ask ${lane.label} only…`}
                      sendLabel={`Send ${lane.label}`}
                      individual
                      disabled={!!c.streamingLanes[lane.id]}
                      hint="⌘↵"
                    />
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
