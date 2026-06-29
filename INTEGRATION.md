# Integrating back into Claude-OS

This repo is the **public, standalone extraction** of the Codex Council feature. It's
designed so the feature drops back into a Claude-OS install cleanly: the **feature
files are byte-identical to Claude-OS except for a small set of deliberate scrubs**,
and everything standalone-specific lives in a thin **host shim** you discard on merge.

## Two layers

### Feature (merges back — keep identical to Claude-OS)
These are the feature. To pull improvements into Claude-OS, copy these over:

```
src/lib/codex-council-endpoints.ts        # the 7 /__codex_* endpoints + registerCodexCouncil
src/lib/codex-council-types.ts            # shared wire types
src/lib/codex-council-client.ts           # browser client (token handshake + SSE)
src/lib/codex-council-*.test.ts           # unit tests
src/components/codex/*                     # the entire UI
src/styles/codex-council.css              # the scoped Datastream theme
src/assets/codex/*                         # Kitsune / torii art (WebP)
```

### Host shim (standalone-only — do NOT copy into Claude-OS)
Claude-OS already provides equivalents of every one of these. Overwriting them would
break the host.

```
vite.config.ts            # Claude-OS already registers the feature in its own vite.config (~line 4202)
src/routes/index.tsx      # standalone route at "/"; in Claude-OS the route is src/routes/agents.codex.tsx at /agents/codex
src/routes/__root.tsx     # Claude-OS has its own root shell (sidebar, etc.)
src/router.tsx            # Claude-OS has its own
src/lib/business-ops-env.ts  # ⚠️ Claude-OS has the REAL one (imports remote-access.ts). DO NOT overwrite — this copy stubs remoteAllowedOrigin for loopback-only standalone.
package.json, tsconfig.json, vitest.config.ts, eslint.config.js, src/test/setup.ts
```

## Why these are safe in both places
- **`registerCodexCouncil(server, { REFRESH_TOKEN, isLoopback, root })`** is the exact
  call Claude-OS already makes. The standalone `vite.config.ts` reproduces it.
- **`X-Claude-OS-Token` + `/__token`** is the verbatim Claude-OS auth handshake — kept,
  not renamed, so the client works unchanged in both.
- **Store path `~/.claude-os/codex-council`** is identical to Claude-OS, so sessions and
  prefs land in the same place inside the OS.
- **`-m-4 md:-m-6`** on the council root are kept so the tab fits Claude-OS's padded
  shell. They are inert in the standalone (no Tailwind to interpret them), so they cost
  nothing here.

## The deliberate differences from Claude-OS (intentional — these *should* propagate)
No one else's Claude-OS wants the original author's personal content, so the shared
edition genericizes it:

- The grounding brief is a generic **example** ("you are a pragmatic senior engineer"),
  not a personal business brief. The `applyGrounding` mechanism and off-by-default
  toggle are unchanged — only the content.
- Constant renamed `RH_BRIEF` → `DEFAULT_BRIEF`.
- Branding is **"Codex Council"** (was an author-specific label).
- Comments referencing private context were genericized.
- Assets are **WebP** (≈15× smaller than the original PNGs) — adopt these in Claude-OS too.

## Merge checklist
1. Copy the **Feature** files above into Claude-OS (`src/lib`, `src/components/codex`, `src/styles`, `src/assets/codex`).
2. **Skip** every **Host shim** file — Claude-OS already has its own.
3. `bun run test` in Claude-OS to confirm the feature's unit tests still pass.
