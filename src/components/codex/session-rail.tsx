// Resumable session rail. Sessions persist server-side; selecting one reloads
// its threads and native resume ids.
import type { SessionMeta } from "@/lib/codex-council-types";

function relativeTime(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function SessionRail({
  sessions,
  activeId,
  now,
  onNew,
  onSelect,
}: {
  sessions: SessionMeta[];
  activeId: string | null;
  now: number;
  onNew: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="cx-sessions cx-glass" aria-label="Resumable sessions">
      <div className="cx-rail-head">
        <b>Sessions</b>
        <button type="button" onClick={onNew}>
          + New
        </button>
      </div>
      <div className="cx-session-list">
        {sessions.length === 0 ? (
          <div className="cx-empty-banner">No sessions yet.</div>
        ) : (
          sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`cx-session${s.id === activeId ? " active" : ""}${s.errored ? " errored" : ""}`}
              onClick={() => onSelect(s.id)}
            >
              <b>{s.title || "Untitled session"}</b>
              <small>
                {relativeTime(s.updatedAt, now)} · {s.mode} ·{" "}
                {s.lanes.map((l) => l.model).join(" + ")}
              </small>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
