// ────────────────────────────────────────────────────────────────────────────
// Codex Council — dev-server middleware (Codex + Claude, council, usage, apply).
//
// Reproduces the verified Claude-OS patterns VERBATIM (do not reinvent):
//   • loopback + origin + token guard (business-ops-env helpers)
//   • text/event-stream SSE with heartbeat + flushHeaders
//   • safeChildEnv() COST RULE — every spawn strips provider API keys; the Codex
//     lane runs on the ChatGPT subscription (preferred_auth_method=chatgpt), the
//     Claude lane on Claude Max. No API keys are ever passed to a child. ($0)
//
// Endpoints (all loopback-only, token-gated):
//   POST /__codex_chat        SSE  stream one engine's answer; capture native
//                                  session id (resume) + real token usage
//   POST /__codex_synthesize  SSE  Claude opus merges the council's lane answers
//   GET  /__codex_status           login status + model/tier + claude availability
//   GET  /__codex_usage            real token totals aggregated from stored turns
//   GET/POST /__codex_sessions     dashboard-owned persisted session store
//   POST /__codex_apply            validated `git apply` of an approved diff
// ────────────────────────────────────────────────────────────────────────────

import { spawn, execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { safeChildEnv, redact, tokenMatches, originAllowed } from "./business-ops-env";
import {
  CODEX_ENDPOINTS,
  LIMITS,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_SETTINGS,
  type CodexChatRequest,
  type CodexSynthesizeRequest,
  type CodexStatus,
  type CodexUsage,
  type CodexApplyResult,
  type CodexStreamEvent,
  type SessionRecord,
  type SessionMeta,
  type CouncilEngine,
  type CodexSandbox,
  type CouncilSettings,
  type LaneConfig,
} from "./codex-council-types";

const HOME = homedir();
const STORE_DIR = join(HOME, ".claude-os", "codex-council");
const SESSIONS_FILE = join(STORE_DIR, "sessions.json");
const SETTINGS_FILE = join(STORE_DIR, "settings.json");
const CHAT_TIMEOUT_MS = 240_000; // gpt-5.5 xhigh can think for a while
const STATUS_TIMEOUT_MS = 15_000;
const APPLY_TIMEOUT_MS = 20_000;
const MAX_SESSIONS = 200;
const MAX_MSG_CHARS = 200_000;
const ERR_TAIL_CAP = 8_000;

// ── minimal structural types for the connect server we register onto ──────────
type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
interface DevServer {
  middlewares: { use(path: string, handler: Handler): void };
}
export interface CodexCouncilContext {
  REFRESH_TOKEN: string;
  isLoopback: (req: { socket?: { remoteAddress?: string | null } }) => boolean;
  /** Repo root (unused today; kept for parity with the other register* modules). */
  root: string;
}

function resolveBinary(name: CouncilEngine): string | null {
  const candidates =
    name === "claude"
      ? [join(HOME, ".local", "bin", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]
      : ["/usr/local/bin/codex", join(HOME, ".local", "bin", "codex"), "/opt/homebrew/bin/codex"];
  return candidates.find((p) => existsSync(p)) ?? null;
}

// ── guards / io helpers ───────────────────────────────────────────────────────
function blocked(ctx: CodexCouncilContext, req: IncomingMessage, res: ServerResponse): boolean {
  if (!ctx.isLoopback(req)) {
    sendJson(res, 403, { error: "loopback only" });
    return true;
  }
  if (!originAllowed(req.headers.origin)) {
    sendJson(res, 403, { error: "bad origin" });
    return true;
  }
  const provided = req.headers["x-claude-os-token"];
  if (!tokenMatches(Array.isArray(provided) ? provided[0] : provided, ctx.REFRESH_TOKEN)) {
    sendJson(res, 403, { error: "invalid token" });
    return true;
  }
  return false;
}

async function readBody(req: IncomingMessage, maxBytes = 512 * 1024): Promise<string> {
  let body = "";
  let size = 0;
  for await (const chunk of req as AsyncIterable<unknown>) {
    const s = String(chunk);
    size += Buffer.byteLength(s);
    if (size > maxBytes) {
      (req as unknown as { destroy?: () => void }).destroy?.();
      throw new Error("request body too large");
    }
    body += s;
  }
  return body;
}

function sendJson(res: ServerResponse, code: number, obj: unknown): void {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

/** Open an SSE stream; returns an emit() for typed events + a stop() to tear down. */
function openSse(res: ServerResponse): { emit: (ev: CodexStreamEvent) => void; close: () => void } {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  (res as unknown as { flushHeaders?: () => void }).flushHeaders?.();
  const heartbeat = setInterval(() => {
    try {
      res.write(":hb\n\n");
    } catch {
      /* socket gone */
    }
  }, 15_000);
  return {
    emit(ev) {
      const safe = ev.type === "token" ? { ...ev, text: redact(ev.text) } : ev;
      try {
        res.write(`data: ${JSON.stringify(safe)}\n\n`);
      } catch {
        /* socket gone */
      }
    },
    close() {
      clearInterval(heartbeat);
      try {
        res.end();
      } catch {
        /* already ended */
      }
    },
  };
}

/** Resolve + confine a working directory to under $HOME. Returns null if unsafe. */
function safeCwd(input?: string): string | null {
  if (!input) return HOME;
  let r: string;
  try {
    // realpath resolves symlinks so a link under $HOME can't point outside it.
    r = realpathSync(resolve(input));
  } catch {
    return null;
  }
  if (r !== HOME && !r.startsWith(HOME + sep)) return null;
  try {
    if (!statSync(r).isDirectory()) return null;
  } catch {
    return null;
  }
  return r;
}

// ── engine runners ────────────────────────────────────────────────────────────
interface RunHandle {
  /** Wire client-abort (SSE closed) to killing the child. */
  bind: (req: IncomingMessage) => void;
}

/**
 * Spawn an engine, pipe the prompt via stdin (avoids argv length/escaping),
 * stream answer chunks through emit(), and capture the native session id +
 * real token usage. Calls done() exactly once.
 */
function runEngine(
  engine: CouncilEngine,
  args: string[],
  bin: string,
  prompt: string,
  emit: (ev: CodexStreamEvent) => void,
  done: () => void,
): RunHandle {
  let child: ReturnType<typeof spawn>;
  let settled = false;
  let sessionEmitted = false;
  let errTail = "";
  let claudeUsage = 0;
  let textEmitted = false; // claude: did any content_block_delta stream?

  const finish = (): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    // Codex prints "session id:" and "tokens used\nN" to stderr.
    if (engine === "codex") {
      if (!sessionEmitted) {
        const m = /session id:\s*([0-9a-fA-F-]{8,128})/.exec(errTail);
        if (m) emit({ type: "session", sessionId: m[1] });
      }
      const t = /tokens used[\s:]*([\d,]+)/i.exec(errTail);
      if (t) {
        const used = Number(t[1].replace(/,/g, ""));
        if (used > 0) emit({ type: "usage", tokens: used });
      }
    } else if (claudeUsage > 0) {
      emit({ type: "usage", tokens: claudeUsage });
    }
    emit({ type: "done" });
    done();
  };

  try {
    child = spawn(bin, args, {
      cwd: HOME,
      env: safeChildEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    emit({
      type: "error",
      message: `spawn failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    finish();
    return { bind: () => {} };
  }

  const timer = setTimeout(() => {
    emit({ type: "error", message: "Request timed out." });
    try {
      child.kill("SIGTERM");
    } catch {
      /* gone */
    }
    // Escalate so a child that ignores SIGTERM can't keep the stream open.
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* gone */
      }
    }, 2_000);
    // Guarantee done() fires regardless of signal delivery.
    finish();
  }, CHAT_TIMEOUT_MS);

  // Prompt over stdin.
  try {
    child.stdin?.write(prompt);
    child.stdin?.end();
  } catch {
    /* will surface as no-output / error on close */
  }

  if (engine === "codex") {
    // stdout = the clean answer; stream it verbatim.
    child.stdout?.on("data", (b) => emit({ type: "token", text: String(b) }));
    child.stderr?.on("data", (b) => {
      errTail = (errTail + String(b)).slice(-ERR_TAIL_CAP);
      if (!sessionEmitted) {
        const m = /session id:\s*([0-9a-fA-F-]{8,128})/.exec(errTail);
        if (m) {
          sessionEmitted = true;
          emit({ type: "session", sessionId: m[1] });
        }
      }
    });
  } else {
    // Claude: stream-json (JSONL). Parse text deltas + session id + usage.
    let buf = "";
    const handleLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(trimmed);
      } catch {
        return;
      }
      const type = ev.type as string | undefined;
      if (
        type === "system" &&
        (ev.subtype as string) === "init" &&
        typeof ev.session_id === "string" &&
        LIMITS.sessionIdRe.test(ev.session_id)
      ) {
        if (!sessionEmitted) {
          sessionEmitted = true;
          emit({ type: "session", sessionId: ev.session_id });
        }
        return;
      }
      if (type === "stream_event") {
        const inner = ev.event as
          | { type?: string; delta?: { type?: string; text?: string } }
          | undefined;
        if (
          inner?.type === "content_block_delta" &&
          inner.delta?.type === "text_delta" &&
          inner.delta.text
        ) {
          textEmitted = true;
          emit({ type: "token", text: inner.delta.text });
        }
        return;
      }
      if (type === "result") {
        const usage = ev.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        if (usage) claudeUsage = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
        // Fallback: if this claude build didn't stream partial deltas, the final
        // answer lives on the result event — emit it so the lane is never
        // silently empty.
        if (!textEmitted && typeof ev.result === "string" && ev.result.trim()) {
          textEmitted = true;
          emit({ type: "token", text: ev.result });
        }
      }
    };
    child.stdout?.on("data", (b) => {
      buf += String(b);
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        handleLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    });
    child.stderr?.on("data", (b) => {
      errTail = (errTail + String(b)).slice(-ERR_TAIL_CAP);
    });
  }

  child.on("error", (err) => {
    emit({ type: "error", message: redact(err instanceof Error ? err.message : String(err)) });
    finish();
  });
  child.on("close", (code) => {
    if (code !== 0 && !settled) {
      const tail = errTail.trim();
      emit({ type: "error", message: redact(tail ? tail.slice(-400) : `exited ${code}`) });
    }
    finish();
  });

  return {
    bind(req) {
      req.on("close", () => {
        if (!settled) {
          try {
            child.kill("SIGTERM");
          } catch {
            /* gone */
          }
          // Stop the heartbeat + end the stream promptly (writes to the closed
          // socket are caught).
          finish();
        }
      });
    },
  };
}

// Shared brief — an EXAMPLE, prepended IDENTICALLY to both council lanes on a
// "grounded" turn so Codex (thin ~/.codex/AGENTS.md) starts from the same context
// floor as Claude (auto-loaded ~/.claude/CLAUDE.md). That sameness is the parity
// guarantee. Edit it in Settings to ground both lanes in your own project, stack,
// or team conventions. Keep it short — it rides on every grounded turn.
const DEFAULT_BRIEF = `[Shared context — example brief]
You are a pragmatic senior software engineer pairing on a real codebase. This is an
example brief — replace it in Settings with your own project context (stack, domain,
conventions, the decision you're weighing).

How to work:
- Take the full-picture view: map the second-order consequences and what a change
  touches before you land it. Don't fix the narrow symptom in isolation.
- Senior-craftsman quality: find the root cause (no band-aids), choose the simplest
  solution that actually works (no over-engineering, no speculative complexity),
  prefer clarity over cleverness.
- Fact-only: verify load-bearing claims; never present assumption or inference as
  fact. Accuracy over speed.
- Deliver the decision WITH the data and the tradeoffs. Direct and plain — recommend
  a path, don't just list options.`;

/** Prepend the shared brief when a turn is grounded. Pure + identical for both
 *  lanes — that sameness IS the parity guarantee (same brief → same bytes). Brief
 *  defaults to the built-in; handleChat passes the user's edited override. */
function applyGrounding(prompt: string, ground?: boolean, brief: string = DEFAULT_BRIEF): string {
  return ground ? `${brief}\n---\n${prompt}` : prompt;
}

// ── settings store (cross-device console prefs) ───────────────────────────────
function mergeSettings(raw: Partial<CouncilSettings>): CouncilSettings {
  return { ...DEFAULT_SETTINGS, ...raw };
}
function readSettings(): CouncilSettings {
  try {
    return mergeSettings(
      JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as Partial<CouncilSettings>,
    );
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function writeSettings(s: CouncilSettings): void {
  mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}
/** The brief actually injected on a grounded turn: the user's override, else built-in. */
function resolveBrief(stored: string | undefined): string {
  return stored && stored.trim() ? stored : DEFAULT_BRIEF;
}
function effectiveBrief(): string {
  return resolveBrief(readSettings().brief);
}

function buildCodexArgs(opts: {
  model: string;
  sandbox: CodexSandbox;
  cwd: string;
  sessionId?: string;
}): string[] {
  const flags = [
    "--skip-git-repo-check",
    "--sandbox",
    opts.sandbox,
    "-c",
    'preferred_auth_method="chatgpt"',
    // Pin the maximum subscription-legal Codex tier on every turn: GPT-5.5 at
    // xhigh ("extended") reasoning + priority ("Pro") tier. gpt-5.5-pro is API-only
    // (blocked on the ChatGPT sub), so this is the ceiling without an API key.
    "-c",
    'model_reasoning_effort="xhigh"',
    "-c",
    'service_tier="priority"',
    "-m",
    opts.model,
    "-C",
    opts.cwd,
  ];
  // `codex exec [OPTIONS] resume <id>` — options precede the subcommand.
  return opts.sessionId ? ["exec", ...flags, "resume", opts.sessionId] : ["exec", ...flags];
}

function buildClaudeArgs(opts: { model: string; sessionId?: string }): string[] {
  const args = [
    "-p",
    "--model",
    opts.model,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    "dontAsk",
    "--disallowedTools",
    "*",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
  ];
  if (opts.sessionId) args.push("--resume", opts.sessionId);
  return args;
}

// ── session store ─────────────────────────────────────────────────────────────
function readStore(): Record<string, SessionRecord> {
  try {
    return JSON.parse(readFileSync(SESSIONS_FILE, "utf8")) as Record<string, SessionRecord>;
  } catch {
    return {};
  }
}
function writeStore(store: Record<string, SessionRecord>): void {
  mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(SESSIONS_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
}
// Serialize read-modify-write of the session store so two near-simultaneous
// saves (e.g. both council lanes finishing at once) can't clobber each other.
let storeLock: Promise<void> = Promise.resolve();
function withStoreLock<T>(fn: () => T): Promise<T> {
  const run = storeLock.then(fn, fn);
  storeLock = run.then(
    () => {},
    () => {},
  );
  return run;
}

// ── handlers ──────────────────────────────────────────────────────────────────
async function handleChat(
  ctx: CodexCouncilContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (blocked(ctx, req, res)) return;
  let p: CodexChatRequest;
  try {
    p = JSON.parse((await readBody(req)) || "{}") as CodexChatRequest;
  } catch {
    return sendJson(res, 400, { error: "invalid json" });
  }
  if (p.engine !== "codex" && p.engine !== "claude")
    return sendJson(res, 400, { error: "bad engine" });
  if (!LIMITS.modelRe.test(p.model ?? "")) return sendJson(res, 400, { error: "bad model" });
  const prompt = (p.prompt ?? "").trim();
  if (!prompt || prompt.length > LIMITS.promptMax)
    return sendJson(res, 400, { error: "prompt empty or too long" });
  if (p.sessionId && !LIMITS.sessionIdRe.test(p.sessionId))
    return sendJson(res, 400, { error: "bad sessionId" });
  const sandbox: CodexSandbox = p.sandbox === "workspace-write" ? "workspace-write" : "read-only";
  const cwd = safeCwd(p.cwd);
  if (cwd === null) return sendJson(res, 400, { error: "cwd must be a directory under $HOME" });

  const bin = resolveBinary(p.engine);
  if (!bin) return sendJson(res, 503, { error: `${p.engine} binary not found` });

  const args =
    p.engine === "codex"
      ? buildCodexArgs({ model: p.model, sandbox, cwd, sessionId: p.sessionId })
      : buildClaudeArgs({ model: p.model, sessionId: p.sessionId });

  const { emit, close } = openSse(res);
  const handle = runEngine(
    p.engine,
    args,
    bin,
    applyGrounding(prompt, p.ground, effectiveBrief()),
    emit,
    close,
  );
  handle.bind(req);
}

async function handleSynthesize(
  ctx: CodexCouncilContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (blocked(ctx, req, res)) return;
  let p: CodexSynthesizeRequest;
  try {
    p = JSON.parse((await readBody(req)) || "{}") as CodexSynthesizeRequest;
  } catch {
    return sendJson(res, 400, { error: "invalid json" });
  }
  const prompt = (p.prompt ?? "").trim();
  if (!prompt) return sendJson(res, 400, { error: "missing prompt" });
  if (!Array.isArray(p.answers) || p.answers.length < 2)
    return sendJson(res, 400, { error: "need at least two answers" });
  if (p.answers.length > 12) return sendJson(res, 400, { error: "too many answers" });
  const model = LIMITS.modelRe.test(p.model ?? "") ? (p.model as string) : DEFAULT_CLAUDE_MODEL;
  const bin = resolveBinary("claude");
  if (!bin) return sendJson(res, 503, { error: "claude binary not found" });

  const lanes = p.answers
    .map(
      (a, i) =>
        `### Answer ${i + 1} — ${a.label} (${a.model})\n${String(a.text ?? "").slice(0, MAX_MSG_CHARS)}`,
    )
    .join("\n\n");
  const synthPrompt =
    `You are the council synthesizer. Multiple AI models independently answered the same question. ` +
    `Produce a tight, decision-ready verdict so the reader never has to read both answers in full.\n\n` +
    `## Original question\n${prompt}\n\n## Independent answers\n${lanes}\n\n` +
    `## Your verdict\nWrite three short sections with these exact headings:\n` +
    `**Differences** — the key things each model surfaced that the other did not, and where they diverge. Attribute each point to the model by its label above. Make the contrast obvious; this is the section that matters most.\n` +
    `**Agreements** — what they converge on.\n` +
    `**Recommendation** — the single course of action you'd take, and which model to trust where they conflict. Be specific. No hedging.`;

  if (synthPrompt.length > LIMITS.promptMax + 40_000)
    return sendJson(res, 400, { error: "answers too long to synthesize" });

  const { emit, close } = openSse(res);
  const handle = runEngine("claude", buildClaudeArgs({ model }), bin, synthPrompt, emit, close);
  handle.bind(req);
}

function handleStatus(ctx: CodexCouncilContext, req: IncomingMessage, res: ServerResponse): void {
  if (blocked(ctx, req, res)) return;
  const codexBin = resolveBinary("codex");
  const claudeAvailable = resolveBinary("claude") !== null;
  const status: CodexStatus = {
    codexConnected: false,
    authMode: "unknown",
    codexModel: "gpt-5.5",
    codexTier: "default",
    codexVersion: "unknown",
    claudeAvailable,
  };
  // config.toml carries the configured model + service tier (cheap, local).
  try {
    const cfg = readFileSync(join(HOME, ".codex", "config.toml"), "utf8");
    const m = /^\s*model\s*=\s*"([^"]+)"/m.exec(cfg);
    if (m) status.codexModel = m[1];
    const t = /^\s*service_tier\s*=\s*"([^"]+)"/m.exec(cfg);
    if (t) status.codexTier = t[1];
  } catch {
    /* defaults stand */
  }
  if (!codexBin) {
    status.note = "codex binary not found";
    return sendJson(res, 200, status);
  }
  // `codex login status` → "Logged in using ChatGPT" when on the subscription.
  execFile(
    codexBin,
    ["login", "status"],
    { env: safeChildEnv(), timeout: STATUS_TIMEOUT_MS },
    (err, stdout, stderr) => {
      // codex prints the login state to stderr, not stdout — read both.
      const out = `${String(stdout || "")}\n${String(stderr || "")}`;
      if (/logged in using chatgpt/i.test(out)) {
        status.codexConnected = true;
        status.authMode = "chatgpt";
      } else if (/logged in/i.test(out)) {
        status.codexConnected = true;
        status.authMode = "api-key";
        status.note = "not on ChatGPT subscription auth";
      } else if (err) {
        status.note = "login status unavailable";
      }
      sendJson(res, 200, status);
    },
  );
}

function handleUsage(ctx: CodexCouncilContext, req: IncomingMessage, res: ServerResponse): void {
  if (blocked(ctx, req, res)) return;
  const store = readStore();
  const usage: CodexUsage = {
    totalTokens: 0,
    turns: 0,
    byEngine: { codex: { tokens: 0, turns: 0 }, claude: { tokens: 0, turns: 0 } },
    bySession: [],
  };
  for (const rec of Object.values(store)) {
    let sessionTokens = 0;
    let sessionTurns = 0;
    for (const messages of Object.values(rec.threads ?? {})) {
      for (const msg of messages) {
        if (msg.role !== "assistant" || typeof msg.tokens !== "number") continue;
        const eng: CouncilEngine = msg.engine === "claude" ? "claude" : "codex";
        usage.totalTokens += msg.tokens;
        usage.turns += 1;
        usage.byEngine[eng].tokens += msg.tokens;
        usage.byEngine[eng].turns += 1;
        sessionTokens += msg.tokens;
        sessionTurns += 1;
      }
    }
    usage.bySession.push({
      id: rec.id,
      title: rec.title,
      tokens: sessionTokens,
      turns: sessionTurns,
      updatedAt: rec.updatedAt,
    });
  }
  usage.bySession.sort((a, b) => b.updatedAt - a.updatedAt);
  sendJson(res, 200, usage);
}

async function handleSessions(
  ctx: CodexCouncilContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (blocked(ctx, req, res)) return;
  if (req.method === "GET") {
    const store = readStore();
    const url = new URL(req.url ?? "", "http://localhost");
    const id = url.searchParams.get("id");
    if (id) {
      if (!LIMITS.sessionIdRe.test(id)) return sendJson(res, 400, { error: "bad id" });
      const rec = store[id];
      return rec ? sendJson(res, 200, rec) : sendJson(res, 404, { error: "not found" });
    }
    const sessions: SessionMeta[] = Object.values(store)
      .map((r) => ({
        id: r.id,
        title: r.title,
        mode: r.mode,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        lanes: r.lanes,
        errored: r.errored,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return sendJson(res, 200, { sessions });
  }
  if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });

  let body: { action?: string; session?: SessionRecord; id?: string };
  try {
    body = JSON.parse((await readBody(req, 8 * 1024 * 1024)) || "{}");
  } catch {
    return sendJson(res, 400, { error: "invalid json" });
  }
  if (body.action === "delete") {
    if (!body.id || !LIMITS.sessionIdRe.test(body.id))
      return sendJson(res, 400, { error: "bad id" });
    const delId = body.id;
    await withStoreLock(() => {
      const store = readStore();
      delete store[delId];
      writeStore(store);
    });
    return sendJson(res, 200, { ok: true });
  }
  if (body.action === "save" && body.session) {
    const s = body.session;
    if (!s.id || !LIMITS.sessionIdRe.test(s.id)) return sendJson(res, 400, { error: "bad id" });
    // Bound disk: cap per-message text.
    const threads = s.threads ?? {};
    for (const messages of Object.values(threads)) {
      for (const msg of messages) {
        if (typeof msg.text === "string" && msg.text.length > MAX_MSG_CHARS)
          msg.text = msg.text.slice(0, MAX_MSG_CHARS);
      }
    }
    // Read-modify-write inside the lock so concurrent saves (both council
    // lanes finishing at once) can't clobber each other.
    await withStoreLock(() => {
      const store = readStore();
      store[s.id] = { ...s, threads, updatedAt: Date.now() };
      const ids = Object.values(store)
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .map((r) => r.id);
      while (ids.length > MAX_SESSIONS) {
        const victim = ids.shift();
        if (victim) delete store[victim];
      }
      writeStore(store);
    });
    return sendJson(res, 200, { ok: true });
  }
  return sendJson(res, 400, { error: "unknown action" });
}

async function handleApply(
  ctx: CodexCouncilContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (blocked(ctx, req, res)) return;
  let body: { cwd?: string; diff?: string };
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    return sendJson(res, 400, { error: "invalid json" });
  }
  const cwd = safeCwd(body.cwd);
  const diff = body.diff ?? "";
  const fail = (message: string): void =>
    sendJson(res, 400, { ok: false, applied: false, message } satisfies CodexApplyResult);
  if (cwd === null) return fail("cwd must be a directory under $HOME");
  if (!diff.trim() || diff.length > MAX_MSG_CHARS) return fail("empty or oversized diff");
  if (!existsSync(join(cwd, ".git"))) return fail("target is not a git repository");

  const patchPath = join(
    tmpdir(),
    `codex-council-${process.pid}-${Math.round(performance.now())}.patch`,
  );
  try {
    writeFileSync(patchPath, diff, { mode: 0o600 });
  } catch {
    return fail("could not stage patch");
  }
  // --check first: never apply a patch that doesn't cleanly verify.
  execFile(
    "git",
    ["-C", cwd, "apply", "--check", patchPath],
    { env: safeChildEnv(), timeout: APPLY_TIMEOUT_MS },
    (checkErr, _o, checkStderr) => {
      if (checkErr) {
        rmSync(patchPath, { force: true });
        return sendJson(res, 200, {
          ok: false,
          applied: false,
          message: redact(`patch does not apply cleanly: ${String(checkStderr).slice(-300)}`),
        } satisfies CodexApplyResult);
      }
      execFile(
        "git",
        ["-C", cwd, "apply", patchPath],
        { env: safeChildEnv(), timeout: APPLY_TIMEOUT_MS },
        (applyErr, _so, applyStderr) => {
          rmSync(patchPath, { force: true });
          if (applyErr)
            return sendJson(res, 200, {
              ok: false,
              applied: false,
              message: redact(`apply failed: ${String(applyStderr).slice(-300)}`),
            } satisfies CodexApplyResult);
          sendJson(res, 200, {
            ok: true,
            applied: true,
            message: "diff applied",
          } satisfies CodexApplyResult);
        },
      );
    },
  );
}

function sanitizeLane(l: Partial<LaneConfig> | undefined): LaneConfig {
  return {
    id: String(l?.id ?? "").slice(0, 32) || "lane",
    label: String(l?.label ?? "").slice(0, 40) || "Lane",
    engine: l?.engine === "claude" ? "claude" : "codex",
    model: LIMITS.modelRe.test(l?.model ?? "") ? (l!.model as string) : "gpt-5.5",
  };
}

async function handleSettings(
  ctx: CodexCouncilContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (blocked(ctx, req, res)) return;
  if (req.method === "GET") {
    // Raw stored prefs + the built-in brief, so the editor can show the default
    // text and treat a blank field as "use the built-in brief".
    return sendJson(res, 200, { ...readSettings(), defaultBrief: DEFAULT_BRIEF });
  }
  let body: Partial<CouncilSettings>;
  try {
    body = JSON.parse((await readBody(req)) || "{}") as Partial<CouncilSettings>;
  } catch {
    return sendJson(res, 400, { error: "invalid json" });
  }
  const cur = readSettings();
  const next: CouncilSettings = {
    defaultLanes:
      Array.isArray(body.defaultLanes) && body.defaultLanes.length
        ? body.defaultLanes.slice(0, 4).map(sanitizeLane)
        : cur.defaultLanes,
    defaultSandbox: body.defaultSandbox === "workspace-write" ? "workspace-write" : "read-only",
    defaultGrounded: !!body.defaultGrounded,
    autoSynth: body.autoSynth !== false,
    synthModel: LIMITS.modelRe.test(body.synthModel ?? "")
      ? (body.synthModel as string)
      : cur.synthModel,
    theme: typeof body.theme === "string" && body.theme.length <= 32 ? body.theme : cur.theme,
    brief: typeof body.brief === "string" ? body.brief.slice(0, 8000) : cur.brief,
  };
  writeSettings(next);
  return sendJson(res, 200, { ok: true });
}

// ── registration ──────────────────────────────────────────────────────────────
export function registerCodexCouncil(server: DevServer, ctx: CodexCouncilContext): void {
  const post =
    (fn: (c: CodexCouncilContext, req: IncomingMessage, res: ServerResponse) => unknown): Handler =>
    (req, res, next) => {
      if (req.method !== "POST") return next();
      void fn(ctx, req, res);
    };

  server.middlewares.use(CODEX_ENDPOINTS.chat, post(handleChat));
  server.middlewares.use(CODEX_ENDPOINTS.synthesize, post(handleSynthesize));
  server.middlewares.use(CODEX_ENDPOINTS.apply, post(handleApply));
  server.middlewares.use(CODEX_ENDPOINTS.status, (req, res, next) => {
    if (req.method !== "GET") return next();
    handleStatus(ctx, req, res);
  });
  server.middlewares.use(CODEX_ENDPOINTS.usage, (req, res, next) => {
    if (req.method !== "GET") return next();
    handleUsage(ctx, req, res);
  });
  server.middlewares.use(CODEX_ENDPOINTS.sessions, (req, res, next) => {
    if (req.method !== "GET" && req.method !== "POST") return next();
    void handleSessions(ctx, req, res);
  });
  server.middlewares.use(CODEX_ENDPOINTS.settings, (req, res, next) => {
    if (req.method !== "GET" && req.method !== "POST") return next();
    void handleSettings(ctx, req, res);
  });
}

// Exported for unit tests (pure logic, no spawning).
export const __test = {
  buildCodexArgs,
  buildClaudeArgs,
  applyGrounding,
  DEFAULT_BRIEF,
  mergeSettings,
  resolveBrief,
  safeCwd,
  resolveBinary,
  STORE_DIR,
  SESSIONS_FILE,
  SETTINGS_FILE,
};
