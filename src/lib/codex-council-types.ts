// ────────────────────────────────────────────────────────────────────────────
// Codex Council — browser-safe shared types + endpoint/SSE contract.
//
// NO node imports here (imported by React components). The server module
// (codex-council-endpoints.ts) imports these too, so this file is the single
// source of truth for the wire shapes between the tab and the dev-server
// middleware.
//
// Cost/auth model: the Codex lane runs `codex exec` on your ChatGPT subscription
// (preferred_auth_method=chatgpt, no API key); the Claude lane runs `claude -p` on
// your Claude subscription. No provider API keys, ever — both use the CLIs' own auth.
// ────────────────────────────────────────────────────────────────────────────

/** The two model families the council can route to. Open to a 3rd later. */
export type CouncilEngine = "codex" | "claude";

/** Codex sandbox capability. workspace-write edits go through the approval gate. */
export type CodexSandbox = "read-only" | "workspace-write";

/** Console layout modes. `empty`/`states` are UI-only; chat data uses the rest. */
export type CouncilMode = "single" | "council" | "independent";

/** A message author. `assistant` carries an engine + model. */
export type ChatRole = "user" | "assistant";

/** Lifecycle of an assistant turn, for streaming/stop/error rendering. */
export type TurnStatus = "pending" | "streaming" | "done" | "stopped" | "error";

/** A single lane in the workspace (one model column). */
export interface LaneConfig {
  /** Stable lane id, e.g. "primary" | "reviewer". */
  id: string;
  /** Display label, e.g. "Codex" | "Reviewer". */
  label: string;
  engine: CouncilEngine;
  /** Model id for the engine (e.g. "gpt-5.5", "opus"). */
  model: string;
}

/** One message in a lane's thread. */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** Set on assistant messages. */
  engine?: CouncilEngine;
  model?: string;
  text: string;
  /** epoch ms */
  ts: number;
  status?: TurnStatus;
  /** Real token count for this turn (from the engine), when known. Never faked. */
  tokens?: number;
  /** A unified diff the model proposed (workspace-write propose step), if any. */
  diff?: string;
  /** Whether a proposed diff has been applied via the approval gate. */
  diffApplied?: boolean;
}

/** Persisted session metadata (the resumable session rail entries). */
export interface SessionMeta {
  id: string;
  title: string;
  mode: CouncilMode;
  /** epoch ms */
  createdAt: number;
  updatedAt: number;
  lanes: LaneConfig[];
  /** Whether the last turn ended in an error (rail shows the error treatment). */
  errored?: boolean;
}

/** A full session record: metadata + per-lane threads + native resume ids. */
export interface SessionRecord extends SessionMeta {
  /** laneId → ordered messages. */
  threads: Record<string, ChatMessage[]>;
  /**
   * laneId → the engine's NATIVE session id, captured from the first turn's
   * output, used to `resume` with prior context instead of replaying it.
   */
  nativeSessionIds: Record<string, string>;
}

// ── SSE wire protocol (event names emitted by /__codex_chat and /__codex_synthesize) ──
export type CodexStreamEvent =
  | { type: "session"; sessionId: string } // engine's native session id (resume key)
  | { type: "token"; text: string } // an incremental chunk of the answer
  | { type: "usage"; tokens: number } // real token count for the turn
  | { type: "error"; message: string }
  | { type: "done" };

/** Request body for POST /__codex_chat. */
export interface CodexChatRequest {
  engine: CouncilEngine;
  model: string;
  prompt: string;
  /** Native engine session id to resume (omit to start fresh). */
  sessionId?: string;
  /** Working directory the engine reads/operates in. Must be under $HOME. */
  cwd?: string;
  sandbox?: CodexSandbox;
  /** When true, the server prepends the shared brief to the prompt (identical
   *  bytes for both lanes) so both models start from the same context floor.
   *  Off by default. */
  ground?: boolean;
}

/** Request body for POST /__codex_synthesize. */
export interface CodexSynthesizeRequest {
  /** The original prompt sent to the council. */
  prompt: string;
  /** The independent lane answers to merge. */
  answers: Array<{ label: string; model: string; text: string }>;
  /** Synthesizer model (default: Claude opus). */
  model?: string;
}

/** Response from GET /__codex_status. */
export interface CodexStatus {
  /** Codex reachable + authenticated on the ChatGPT subscription. */
  codexConnected: boolean;
  /** "chatgpt" when logged in via ChatGPT (the only sanctioned mode). */
  authMode: string;
  codexModel: string;
  codexTier: string;
  codexVersion: string;
  /** Claude (Claude Max) binary present for the reviewer lane. */
  claudeAvailable: boolean;
  /** Non-fatal note, e.g. an available update. */
  note?: string;
}

/** Aggregated, real usage from stored turns (GET /__codex_usage). */
export interface CodexUsage {
  totalTokens: number;
  turns: number;
  byEngine: Record<CouncilEngine, { tokens: number; turns: number }>;
  /** Most-recent-first per-session rollups. */
  bySession: Array<{ id: string; title: string; tokens: number; turns: number; updatedAt: number }>;
}

/** Result of POST /__codex_apply (the workspace-write approval gate). */
export interface CodexApplyResult {
  ok: boolean;
  applied: boolean;
  message: string;
}

// ── Defaults + small catalogs (kept honest; pickers allow these) ──
export const DEFAULT_CODEX_MODEL = "gpt-5.5";
export const DEFAULT_CLAUDE_MODEL = "opus";

/** Suggested models per engine. Codex shows the configured default; a plan may
 *  expose others, so the picker also permits a typed value. Claude uses the
 *  Claude Code aliases (verified valid via `claude --model <alias>`). */
export const ENGINE_MODELS: Record<CouncilEngine, string[]> = {
  codex: ["gpt-5.5"],
  claude: ["opus", "sonnet", "haiku"],
};

export const ENGINE_LABEL: Record<CouncilEngine, string> = {
  codex: "Codex · ChatGPT Pro",
  claude: "Claude · Max",
};

/** Default lane layout for a brand-new council session. */
export const DEFAULT_LANES: LaneConfig[] = [
  { id: "primary", label: "Codex", engine: "codex", model: DEFAULT_CODEX_MODEL },
  { id: "reviewer", label: "Claude", engine: "claude", model: DEFAULT_CLAUDE_MODEL },
];

/** Tab skins (set via data-cx-theme on .codex-tab). */
export const CODEX_THEMES = [
  { id: "datastream", label: "Datastream" },
  { id: "sumi", label: "Sumi-e" },
] as const;

/**
 * Persisted, cross-device console preferences.
 * Server store: ~/.claude-os/codex-council/settings.json (so they follow you across
 * devices, unlike per-browser localStorage).
 */
export interface CouncilSettings {
  /** Lanes a brand-new session starts with. */
  defaultLanes: LaneConfig[];
  /** Sandbox a new session starts in. */
  defaultSandbox: CodexSandbox;
  /** Whether new sessions start with brief grounding on. */
  defaultGrounded: boolean;
  /** Auto-run the differences synthesis at the end of every council cycle. */
  autoSynth: boolean;
  /** Model the synthesizer (and auto-synth) runs on. */
  synthModel: string;
  /** Tab skin id (see CODEX_THEMES). */
  theme: string;
  /** Override for the shared grounding brief. Blank → the server's built-in. */
  brief: string;
}

export const DEFAULT_SETTINGS: CouncilSettings = {
  defaultLanes: DEFAULT_LANES,
  defaultSandbox: "read-only",
  defaultGrounded: false,
  autoSynth: true,
  synthModel: DEFAULT_CLAUDE_MODEL,
  theme: "datastream",
  brief: "",
};

/** Endpoint paths (loopback-only, token-gated dev-server middleware). */
export const CODEX_ENDPOINTS = {
  chat: "/__codex_chat",
  synthesize: "/__codex_synthesize",
  status: "/__codex_status",
  usage: "/__codex_usage",
  sessions: "/__codex_sessions",
  apply: "/__codex_apply",
  settings: "/__codex_settings",
} as const;

/** Validation shared by client + server so the UI fails fast before a round-trip. */
export const LIMITS = {
  promptMax: 16_000,
  /** Native session ids (codex uuid / claude uuid) charset. */
  sessionIdRe: /^[A-Za-z0-9_-]{1,128}$/,
  /** Model id charset. */
  modelRe: /^[A-Za-z0-9._:-]{1,64}$/,
} as const;
