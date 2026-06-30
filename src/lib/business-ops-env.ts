// ────────────────────────────────────────────────────────────────────────────
// Business Ops — server-only security helpers (S2 hardening).
//
// Kept separate from business-ops-types.ts (which must stay browser-safe, no
// node imports) and imported by the two spawn sites: business-ops-endpoints.ts
// and business-ops-voice.ts.
// ────────────────────────────────────────────────────────────────────────────

import { timingSafeEqual } from "node:crypto";

// Standalone is loopback-only — remote (Tailscale) access is a Claude-OS concern,
// out of scope here. Stubbed to "no remote origin configured" so originAllowed()
// accepts same-origin local requests and rejects everything cross-site.
function remoteAllowedOrigin(): string | null {
  return null;
}

// Strict ALLOWLIST of env vars passed to a spawned `claude -p` / `codex exec`.
// claude/codex authenticate via OAuth/keychain under HOME, so HOME + PATH are
// sufficient (verified: claude returns a result under exactly this set). Every
// other var — GITHUB_*, AWS_*, STRIPE_*, and any provider API keys — is EXCLUDED,
// so a spawned agent cannot read another service's secret out of its own
// environment. Allowlist (not denylist)
// so a newly-added secret is excluded by default, never leaked by omission.
const ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "TMPDIR",
  "TZ",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LANGUAGE",
  // NOTE: proxy vars (HTTP_PROXY/HTTPS_PROXY/...) are deliberately NOT forwarded —
  // they frequently embed credentials (http://user:pass@host) and can redirect the
  // child's auth traffic, which would violate the no-inherited-secrets guarantee.
];

/** Build a child-process env from the allowlist only — no inherited secrets. */
export function safeChildEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// Secret shapes masked from any child output before it is written to disk
// (runs.json) or returned to a client.
const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g, // Anthropic
  /sk-[A-Za-z0-9]{20,}/g, // OpenAI-style
  /ghp_[A-Za-z0-9]{16,}/g, // GitHub PAT (classic)
  /github_pat_[A-Za-z0-9_]{20,}/g, // GitHub PAT (fine-grained)
  /pcsk_[A-Za-z0-9_-]{16,}/g, // vector-DB key (pcsk_)
  /fc-[A-Za-z0-9]{16,}/g, // Firecrawl
  /xai-[A-Za-z0-9]{16,}/g, // xAI
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, // JWT
];

/** Mask known secret shapes before output leaves the process (disk or client). */
export function redact(text: string): string {
  if (!text) return text;
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "<redacted>");
  out = out.replace(/(authorization:\s*bearer\s+)[A-Za-z0-9._-]+/gi, "$1<redacted>");
  out = out.replace(/(xi-api-key["']?\s*[:=]\s*["']?)[A-Za-z0-9_-]{12,}/gi, "$1<redacted>");
  return out;
}

/**
 * Parse a single JSON object out of model output — strips ```json fences, tries
 * a direct parse first, and only falls back to a brace-span as a last resort, so
 * stray prose/braces can't smuggle a different object. Returns null if none.
 */
export function parseModelJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const tryParse = (text: string): Record<string, unknown> | null => {
    try {
      const value: unknown = JSON.parse(text);
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(stripped);
  if (direct) return direct;
  const a = stripped.indexOf("{");
  const z = stripped.lastIndexOf("}");
  if (a !== -1 && z > a) return tryParse(stripped.slice(a, z + 1));
  return null;
}

/** Constant-time comparison of a provided token against the expected token. */
export function tokenMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string" || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Reject cross-site requests. A real cross-site browser request always carries
 * Sec-Fetch-Site: cross-site/same-site (a header pages cannot forge), so those are
 * rejected up front. Same-origin browser requests (localhost/127.0.0.1, any port)
 * and non-browser callers (no Origin header, e.g. curl) are allowed; an external
 * site's drive-by POST is rejected. When remote access is configured
 * (~/.claude-os/remote-access.json), the single pinned tailnet origin is also
 * accepted — the identity gate in remote-access.ts has already vouched for the
 * request by the time any guard runs.
 */
export function originAllowed(origin: unknown, secFetchSite?: unknown): boolean {
  if (secFetchSite === "cross-site" || secFetchSite === "same-site") return false;
  if (origin === undefined || origin === null || origin === "") return true;
  if (typeof origin !== "string") return false;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)) return true;
  const remote = remoteAllowedOrigin();
  return remote !== null && origin.toLowerCase() === remote.toLowerCase();
}
