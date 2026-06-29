// One message in a lane thread. User messages are plain; assistant messages
// render markdown, a streaming indicator while live, the real token count, and
// — in workspace-write mode when the model proposed a diff — the approval gate.
import { Markdown } from "./markdown";
import { extractDiff } from "@/lib/codex-council-client";
import type { ChatMessage } from "@/lib/codex-council-types";

function ApprovalGate({
  applied,
  applying,
  onApprove,
}: {
  applied?: boolean;
  applying?: boolean;
  onApprove: () => void;
}) {
  return (
    <div className="cx-approval">
      <div className="cx-approval-head">
        <span>Proposed file changes · workspace-write</span>
        <span>{applied ? "applied" : applying ? "applying…" : "awaiting approval"}</span>
      </div>
      <div className="cx-approval-actions">
        <button
          type="button"
          className="cx-action primary"
          disabled={applied || applying}
          onClick={onApprove}
        >
          {applied ? "Applied ✓" : applying ? "Applying…" : "Approve & apply"}
        </button>
      </div>
    </div>
  );
}

export function Message({
  msg,
  head,
  avatar,
  accent,
  onApprove,
  applying,
}: {
  msg: ChatMessage;
  head: string;
  avatar: string;
  accent: "cyan" | "violet";
  /** Provided only in workspace-write mode; receives the extracted diff. */
  onApprove?: (diff: string) => void;
  applying?: boolean;
}) {
  if (msg.role === "user") return <div className="cx-user-msg">{msg.text}</div>;

  const streaming = msg.status === "streaming";
  const errored = msg.status === "error";
  // A diff fence isn't complete until the turn finishes — and re-scanning the
  // full text on every streamed token is wasted work.
  const diff = msg.diff ?? (!streaming && msg.text ? extractDiff(msg.text) : null);

  return (
    <article
      className={`cx-ai-msg${accent === "violet" ? " violet" : ""}${errored ? " errored" : ""}${streaming ? " streaming" : ""}`}
    >
      <div className="cx-msg-head">
        <span className="cx-avatar">
          <img src={avatar} alt="" />
        </span>
        {streaming ? `${head} is responding` : head}
      </div>
      {msg.text ? (
        streaming ? (
          // Render plain text while streaming (cheap); parse markdown once done.
          <div className="cx-md" style={{ whiteSpace: "pre-wrap" }}>
            {msg.text}
          </div>
        ) : (
          <Markdown text={msg.text} />
        )
      ) : null}
      {streaming ? <div className="cx-stream-line" /> : null}
      {diff && onApprove ? (
        <ApprovalGate
          applied={msg.diffApplied}
          applying={applying}
          onApprove={() => onApprove(diff)}
        />
      ) : null}
      {typeof msg.tokens === "number" && msg.tokens > 0 ? (
        <div className="cx-shortcut" style={{ textAlign: "left", marginTop: 6 }}>
          {msg.tokens.toLocaleString()} tokens
        </div>
      ) : null}
    </article>
  );
}
