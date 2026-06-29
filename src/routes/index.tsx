import { createFileRoute } from "@tanstack/react-router";
import { CodexCouncil } from "@/components/codex/codex-council";

// The standalone app IS the council — re-rooted to "/" (no Claude-OS sidebar to
// embed in). Head meta lives on the root route.
export const Route = createFileRoute("/")({
  component: CodexCouncil,
});
