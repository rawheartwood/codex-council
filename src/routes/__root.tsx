import { Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Codex Council" },
      {
        name: "description",
        content:
          "Codex (ChatGPT) + Claude (Max) streaming council console with synthesis — runs on your existing subscriptions.",
      },
      { name: "theme-color", content: "#0a0e14" },
    ],
  }),
  shellComponent: RootShell,
  component: Outlet,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
        {/* Standalone-only: the shared codex-council.css reserves 3.5rem for the
            Claude-OS chrome header, which doesn't exist here — reclaim it. Higher
            specificity (html .codex-tab) wins regardless of stylesheet order, and
            this lives in the standalone shell so the shared CSS stays untouched. */}
        <style>{`html .codex-tab, html .codex-tab .cx-content { min-height: 100vh; }`}</style>
      </head>
      <body style={{ margin: 0, background: "#0a0e14", color: "#dceaf0" }}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
