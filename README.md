# Codex Council

**Two minds, one verdict.** A local developer console that runs **Codex (ChatGPT)** and **Claude** side by side on the same prompt, streams both answers in real time, then synthesizes where they agree, where they differ, and what to actually do.

It runs on the CLIs you already have logged in — your **ChatGPT** and **Claude** subscriptions. **No API keys. No per-token billing.** Every model turn is a spawned `codex exec` / `claude -p` that authenticates through the CLI's own session, and the spawn environment is stripped of every secret before it launches.

> Status: this is the **foundation** repo — it boots, streams a real council turn, passes its tests, and is certified secret-free. Demo/mock mode, a disagreement visualizer, and a third model lane are tracked as follow-ons.

---

## Why

A single model is one opinion. On a hard design call or a gnarly bug, you want a second one — and the disagreement between two strong models is often more useful than either answer alone. Codex Council puts ChatGPT and Claude in the same room, on the same context, and makes their agreement (and friction) legible.

```
                          ┌──────────────────────────┐
            your prompt ─▶│   Codex Council (local)   │
       (+ optional shared │   loopback dev server     │
            grounding)    └────────────┬─────────────┘
                                        │  spawns, secret-free
                         ┌──────────────┴───────────────┐
                         ▼                               ▼
                 ┌───────────────┐               ┌───────────────┐
                 │  codex exec   │               │   claude -p   │
                 │  (ChatGPT)    │               │   (Claude)    │
                 └───────┬───────┘               └───────┬───────┘
                         │  SSE stream                   │  SSE stream
                         └───────────────┬───────────────┘
                                         ▼
                              ┌─────────────────────┐
                              │     Synthesis        │
                              │  agree · differ · do │
                              └─────────────────────┘
```

## Modes

- **Single** — one Codex chat, stop/regenerate, the fast path.
- **Council** — one shared prompt fans out to both lanes; an optional synthesis pass distills the two answers into agree / differ / recommended-path.
- **Independent** — each lane gets its own composer for side-by-side exploration.

Plus: a **shared grounding brief** injected *byte-identical* into both lanes (so neither model is arguing from different context — that sameness is the parity guarantee), per-session usage/token accounting, and a `workspace-write` **apply gate** that turns a model's fenced `diff` into a reviewed patch against a git repo.

## Prerequisites

You need all three installed and authenticated **before** running:

| Tool | Why | Check |
|------|-----|-------|
| [**Bun**](https://bun.sh) ≥ 1.3 | runtime + package manager | `bun --version` |
| [**Codex CLI**](https://github.com/openai/codex) | the ChatGPT lane | `codex --version` then `codex login` (ChatGPT auth) |
| [**Claude Code CLI**](https://docs.claude.com/en/docs/claude-code) | the Claude lane | `claude --version` then `claude` (sign in) |

Both CLIs authenticate through your existing subscription. The app never reads, stores, or transmits an API key — and the child processes it spawns inherit only `PATH` + `HOME` (see [Security](#security)).

## Setup

```bash
git clone <this-repo> codex-council
cd codex-council
bun install
bun run dev
```

Open **http://127.0.0.1:5173**. If a lane shows offline, run `codex login` / sign into `claude` and reload — the status pills go live when each CLI answers.

## Scripts

```bash
bun run dev      # dev server with SSR + HMR (127.0.0.1:5173)
bun run build    # production build
bun run test     # vitest (unit: arg-building, grounding parity, cwd confinement, UI)
bun run lint     # eslint
```

## Security

The council spawns real CLIs with real subscription access, so the dev server is locked down accordingly:

- **Loopback only.** The server binds `127.0.0.1`; every privileged endpoint also re-checks the socket is loopback.
- **Per-run token.** A fresh 32-byte token is minted on each boot. The browser fetches it from `/__token` (loopback + origin gated) and sends it as `X-Claude-OS-Token` on every privileged call — a drive-by tab or extension can't guess it.
- **Secret-free spawns.** Child processes get a strict env **allowlist** (`PATH`, `HOME`, locale, proxy vars) — never `GITHUB_*`, `AWS_*`, provider keys, etc. A spawned agent literally cannot read another service's secret out of its environment.
- **Output redaction.** Known secret shapes (Anthropic/OpenAI/GitHub/AWS keys, JWTs, …) are masked from any model output before it's written to disk or returned to the browser.
- **Confined writes.** `workspace-write` applies are realpath-confined under `$HOME` and require the apply gate; a symlink that escapes `$HOME` is rejected.

Console preferences and session history persist locally at `~/.codex-council/` (mode `0700`), never in the repo.

## Stack

Bun · TanStack Start · React 19 · Vite · TypeScript · vitest. The two-lane orchestration is a set of loopback dev-server endpoints (`/__codex_*`); the UI is a self-contained "Datastream" theme (one scoped stylesheet, no Tailwind, no UI-kit dependency).

## Architecture

```
src/
├── routes/                      # / → the council (TanStack Start)
├── components/codex/            # UI: shell, lanes, composer, settings, markdown
│   ├── codex-council.tsx        #   tab shell + layout/wiring
│   └── use-codex.ts             #   all client orchestration
├── lib/
│   ├── codex-council-endpoints.ts   # the 7 /__codex_* dev-server endpoints
│   ├── codex-council-client.ts      # browser client (token handshake + SSE)
│   ├── codex-council-types.ts       # shared wire types + endpoint contract
│   └── business-ops-env.ts          # spawn security helpers (allowlist, redact, token)
├── styles/codex-council.css     # the Datastream theme (scoped .codex-tab)
└── assets/codex/                # Kitsune / torii art (WebP)
vite.config.ts                   # host: mints the token, serves /__token, registers the endpoints
```

## License

TBD.
