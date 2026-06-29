import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CodexCouncil } from "./codex-council";

// The controller fetches /__token + status/usage/sessions on mount. With no dev
// server in the test env, stub fetch to reject so those calls fall through their
// catch branches and the shell still renders.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("no network in test"))),
  );
});

describe("CodexCouncil shell", () => {
  it("renders the identity, all three mode tabs, and the empty-state composer", () => {
    render(<CodexCouncil />);
    expect(screen.getByRole("button", { name: "Single" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Council" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Independent" })).toBeInTheDocument();
    // Empty state hero + working composer present on first run.
    expect(screen.getByRole("button", { name: "Send to Council" })).toBeInTheDocument();
    // Disconnected status until the (stubbed-out) status call resolves.
    expect(screen.getByText(/Codex offline/)).toBeInTheDocument();
  });
});
