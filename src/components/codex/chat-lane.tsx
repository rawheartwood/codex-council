// A model lane: pane head (identity + model picker + stop/regenerate) and the
// scrolling message thread. Optionally carries its own composer (independent
// mode). Reused for single, council, and independent layouts via paneClass.
import { useEffect, useRef, type ReactNode } from "react";
import { Message } from "./message";
import { ModelPicker } from "./model-picker";
import { ENGINE_LABEL, type ChatMessage, type LaneConfig } from "@/lib/codex-council-types";

export function ChatLane({
  lane,
  messages,
  streaming,
  accent,
  avatar,
  paneClass,
  allowEdit,
  onModelChange,
  onStop,
  onRegenerate,
  workspaceWrite,
  onApprove,
  applyingId,
  composer,
}: {
  lane: LaneConfig;
  messages: ChatMessage[];
  streaming: boolean;
  accent: "cyan" | "violet";
  avatar: string;
  paneClass: string;
  allowEdit: boolean;
  onModelChange: (lane: LaneConfig) => void;
  onStop: () => void;
  onRegenerate: () => void;
  workspaceWrite: boolean;
  onApprove?: (msgId: string, diff: string) => void;
  applyingId?: string | null;
  composer?: ReactNode;
}) {
  const threadRef = useRef<HTMLDivElement>(null);
  const lastLen = messages[messages.length - 1]?.text.length ?? 0;
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    // Only auto-follow when already near the bottom, so scrolling up to re-read
    // isn't yanked back on every streamed token.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastLen]);

  return (
    <article className={paneClass}>
      <div className="cx-pane-head">
        <div className="cx-pane-id">
          <span className="cx-avatar">
            <img src={avatar} alt="" />
          </span>
          <div>
            <b>{lane.label}</b>
            <span>
              {ENGINE_LABEL[lane.engine].split(" · ")[0]} · {lane.model}
            </span>
          </div>
        </div>
        <div className="cx-pane-actions">
          {allowEdit ? (
            <ModelPicker lane={lane} onChange={onModelChange} disabled={streaming} />
          ) : null}
          <button type="button" className="cx-tiny-btn hot" disabled={!streaming} onClick={onStop}>
            Stop
          </button>
          <button
            type="button"
            className="cx-tiny-btn"
            disabled={streaming || messages.length === 0}
            onClick={onRegenerate}
          >
            Regenerate
          </button>
        </div>
      </div>
      <div className="cx-thread" ref={threadRef}>
        {messages.length === 0 ? (
          <div className="cx-empty-banner">No messages yet — send a prompt below.</div>
        ) : (
          messages.map((m) => (
            <Message
              key={m.id}
              msg={m}
              head={lane.label}
              avatar={avatar}
              accent={accent}
              onApprove={workspaceWrite && onApprove ? (diff) => onApprove(m.id, diff) : undefined}
              applying={applyingId === m.id}
            />
          ))
        )}
      </div>
      {composer}
    </article>
  );
}
