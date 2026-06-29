// ────────────────────────────────────────────────────────────────────────────
// Codex Council — browser client for the loopback dev-server endpoints.
//
// Every call fetches the per-run token from /__token and sends it as
// X-Claude-OS-Token (the verbatim Claude-OS pattern). Streaming endpoints are
// consumed as SSE via fetch + ReadableStream (EventSource can't POST).
// ────────────────────────────────────────────────────────────────────────────

import {
  CODEX_ENDPOINTS,
  type CodexChatRequest,
  type CodexSynthesizeRequest,
  type CodexStreamEvent,
  type CodexStatus,
  type CodexUsage,
  type CodexApplyResult,
  type SessionMeta,
  type SessionRecord,
  type CouncilSettings,
} from "./codex-council-types";

async function getToken(): Promise<string | null> {
  try {
    const r = await fetch("/__token");
    if (!r.ok) return null;
    return ((await r.json()) as { token?: string }).token ?? null;
  } catch {
    return null;
  }
}

async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = await getToken();
  return { ...(extra ?? {}), ...(token ? { "X-Claude-OS-Token": token } : {}) };
}

/** Generic SSE consumer: POSTs body, parses `data: {json}\n\n` events. */
async function streamSse(
  endpoint: string,
  body: unknown,
  onEvent: (ev: CodexStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: await authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (!signal.aborted)
      onEvent({ type: "error", message: err instanceof Error ? err.message : "network error" });
    onEvent({ type: "done" });
    return;
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    onEvent({ type: "error", message: detail || `HTTP ${res.status}` });
    onEvent({ type: "done" });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        if (!data) continue;
        try {
          onEvent(JSON.parse(data) as CodexStreamEvent);
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  } catch (err) {
    if (!signal.aborted)
      onEvent({ type: "error", message: err instanceof Error ? err.message : "stream error" });
  }
  onEvent({ type: "done" });
}

export function streamChat(
  req: CodexChatRequest,
  onEvent: (ev: CodexStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  return streamSse(CODEX_ENDPOINTS.chat, req, onEvent, signal);
}

export function streamSynthesize(
  req: CodexSynthesizeRequest,
  onEvent: (ev: CodexStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  return streamSse(CODEX_ENDPOINTS.synthesize, req, onEvent, signal);
}

export async function getStatus(): Promise<CodexStatus | null> {
  try {
    const r = await fetch(CODEX_ENDPOINTS.status, { headers: await authHeaders() });
    return r.ok ? ((await r.json()) as CodexStatus) : null;
  } catch {
    return null;
  }
}

export async function getUsage(): Promise<CodexUsage | null> {
  try {
    const r = await fetch(CODEX_ENDPOINTS.usage, { headers: await authHeaders() });
    return r.ok ? ((await r.json()) as CodexUsage) : null;
  } catch {
    return null;
  }
}

/** Persisted console preferences. GET also returns `defaultBrief` (the built-in). */
export async function getSettings(): Promise<(CouncilSettings & { defaultBrief?: string }) | null> {
  try {
    const r = await fetch(CODEX_ENDPOINTS.settings, { headers: await authHeaders() });
    return r.ok ? ((await r.json()) as CouncilSettings & { defaultBrief?: string }) : null;
  } catch {
    return null;
  }
}

export async function saveSettings(settings: CouncilSettings): Promise<boolean> {
  try {
    const r = await fetch(CODEX_ENDPOINTS.settings, {
      method: "POST",
      headers: await authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(settings),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function listSessions(): Promise<SessionMeta[]> {
  try {
    const r = await fetch(CODEX_ENDPOINTS.sessions, { headers: await authHeaders() });
    if (!r.ok) return [];
    return ((await r.json()) as { sessions: SessionMeta[] }).sessions ?? [];
  } catch {
    return [];
  }
}

export async function getSession(id: string): Promise<SessionRecord | null> {
  try {
    const r = await fetch(`${CODEX_ENDPOINTS.sessions}?id=${encodeURIComponent(id)}`, {
      headers: await authHeaders(),
    });
    return r.ok ? ((await r.json()) as SessionRecord) : null;
  } catch {
    return null;
  }
}

export async function saveSession(session: SessionRecord): Promise<boolean> {
  try {
    const r = await fetch(CODEX_ENDPOINTS.sessions, {
      method: "POST",
      headers: await authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ action: "save", session }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function deleteSession(id: string): Promise<boolean> {
  try {
    const r = await fetch(CODEX_ENDPOINTS.sessions, {
      method: "POST",
      headers: await authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ action: "delete", id }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function applyDiff(cwd: string, diff: string): Promise<CodexApplyResult> {
  try {
    const r = await fetch(CODEX_ENDPOINTS.apply, {
      method: "POST",
      headers: await authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ cwd, diff }),
    });
    return (await r.json()) as CodexApplyResult;
  } catch (err) {
    return {
      ok: false,
      applied: false,
      message: err instanceof Error ? err.message : "network error",
    };
  }
}

/** Extract the first fenced ```diff block from assistant text, if present. */
export function extractDiff(text: string): string | null {
  const m = /```(?:diff|patch)\n([\s\S]*?)```/.exec(text);
  return m ? m[1].replace(/\s+$/, "") + "\n" : null;
}
