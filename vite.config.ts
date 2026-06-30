import { defineConfig } from "vite";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { registerCodexCouncil } from "./src/lib/codex-council-endpoints";
import { originAllowed } from "./src/lib/business-ops-env";

// Per-run secret gating the privileged /__codex_* endpoints. Generated fresh on
// every dev-server boot; the browser reads it once via GET /__token and sends it
// back as X-Claude-OS-Token. A drive-by request from another tab/extension can't
// guess it. (Verbatim Claude-OS pattern — this is a security feature, not a leak.)
const REFRESH_TOKEN = randomBytes(32).toString("hex");

// Reject any socket whose remote isn't loopback. Belt-and-braces alongside
// server.host = "127.0.0.1": even a future config change that re-exposes the dev
// server keeps the privileged endpoints loopback-only.
function isLoopback(req: { socket?: { remoteAddress?: string | null } }): boolean {
  const a = req.socket?.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

// Wires the Codex Council middleware (/__token + /__codex_*) into the dev server.
// Placed first so its handlers register before TanStack Start's SSR catch-all.
const codexHost = {
  name: "codex-council-host",
  configureServer(server: { middlewares: { use: (path: string, fn: (req: any, res: any, next: any) => void) => void } }) {
    // GET /__token — hands the per-run token to the same-origin browser. Loopback
    // + origin gated, so an extension on another origin can't fetch it.
    server.middlewares.use("/__token", (req, res, next) => {
      if (req.method !== "GET") return next();
      if (!isLoopback(req)) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: "loopback only" }));
        return;
      }
      if (!originAllowed(req.headers["origin"], req.headers["sec-fetch-site"])) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: "bad origin" }));
        return;
      }
      // This endpoint vends the secret, so demand affirmative browser proof: a
      // real same-origin fetch sends Sec-Fetch-Site: same-origin; a top-level
      // navigation sends "none". A header-less caller (curl/script that didn't set
      // it) is refused — it can't prove it's the same-origin app.
      const sfs = req.headers["sec-fetch-site"];
      const origin = req.headers["origin"];
      if (origin === undefined && sfs !== "same-origin" && sfs !== "none") {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: "forbidden" }));
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ token: REFRESH_TOKEN }));
    });

    // Codex Council endpoints — chat / synthesize / apply / status / usage /
    // sessions / settings. Same loopback + token + safeChildEnv($0) isolation as
    // Claude-OS: a spawned `codex exec` / `claude -p` inherits only PATH+HOME, no
    // secrets. All logic lives in the imported module.
    registerCodexCouncil(server as never, { REFRESH_TOKEN, isLoopback, root: resolve(__dirname) });
  },
};

export default defineConfig({
  // Pinned so the URL in the README + the per-origin token handshake stay valid;
  // strictPort fails loudly on a collision instead of silently moving to 5174.
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  plugins: [codexHost, tsConfigPaths(), tanstackStart(), viteReact()],
});
