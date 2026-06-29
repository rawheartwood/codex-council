import { describe, it, expect } from "vitest";
import { extractDiff } from "./codex-council-client";

describe("extractDiff", () => {
  it("extracts a fenced diff block and trailing-newline normalizes", () => {
    const text = "Here is the change:\n```diff\n--- a/x.ts\n+++ b/x.ts\n+const y = 1;\n```\nDone.";
    const diff = extractDiff(text);
    expect(diff).toContain("--- a/x.ts");
    expect(diff).toContain("+const y = 1;");
    expect(diff?.endsWith("\n")).toBe(true);
  });

  it("supports ```patch fences", () => {
    expect(extractDiff("```patch\n+y\n```")).toContain("+y");
  });

  it("returns null when there is no diff block", () => {
    expect(extractDiff("just prose with some `inline code`")).toBeNull();
  });
});
