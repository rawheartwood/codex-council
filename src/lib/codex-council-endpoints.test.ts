import { describe, it, expect } from "vitest";
import os from "node:os";
import { join } from "node:path";
import { mkdtempSync, symlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { __test } from "./codex-council-endpoints";

const HOME = os.homedir();

describe("buildCodexArgs", () => {
  it("fresh turn: exec with sandbox/model/cwd, ChatGPT auth, no resume", () => {
    const a = __test.buildCodexArgs({ model: "gpt-5.5", sandbox: "read-only", cwd: HOME });
    expect(a[0]).toBe("exec");
    expect(a).toContain("--skip-git-repo-check");
    expect(a).toEqual(
      expect.arrayContaining(["--sandbox", "read-only", "-m", "gpt-5.5", "-C", HOME]),
    );
    expect(a).toContain('preferred_auth_method="chatgpt"');
    expect(a).not.toContain("resume");
  });

  it("resume turn: subcommand follows the options, then the id", () => {
    const a = __test.buildCodexArgs({
      model: "gpt-5.5",
      sandbox: "workspace-write",
      cwd: HOME,
      sessionId: "abc-123",
    });
    const i = a.indexOf("resume");
    expect(i).toBeGreaterThan(0);
    expect(a[i + 1]).toBe("abc-123");
    expect(a).toContain("workspace-write");
  });
});

describe("buildCodexArgs — max-tier pinning", () => {
  it("pins gpt-5.5 at xhigh reasoning + priority tier on every turn", () => {
    const a = __test.buildCodexArgs({ model: "gpt-5.5", sandbox: "read-only", cwd: HOME });
    expect(a).toEqual(
      expect.arrayContaining([
        "-c",
        'model_reasoning_effort="xhigh"',
        "-c",
        'service_tier="priority"',
      ]),
    );
  });
});

describe("applyGrounding — shared brief parity", () => {
  it("prepends the identical brief for both lanes when grounded", () => {
    const q = "how should I structure this module?";
    const codexPrompt = __test.applyGrounding(q, true);
    const claudePrompt = __test.applyGrounding(q, true);
    expect(codexPrompt).toBe(claudePrompt); // byte-identical = the parity guarantee
    expect(codexPrompt.startsWith(__test.DEFAULT_BRIEF)).toBe(true);
    expect(codexPrompt).toContain(q);
  });
  it("leaves the prompt untouched when not grounded", () => {
    expect(__test.applyGrounding("hello", false)).toBe("hello");
    expect(__test.applyGrounding("hello", undefined)).toBe("hello");
  });
});

describe("settings store — merge + brief fallback", () => {
  it("mergeSettings fills missing keys from DEFAULT_SETTINGS", () => {
    const merged = __test.mergeSettings({ theme: "sumi", autoSynth: false });
    expect(merged.theme).toBe("sumi");
    expect(merged.autoSynth).toBe(false);
    expect(merged.synthModel).toBe("opus"); // from defaults
    expect(Array.isArray(merged.defaultLanes)).toBe(true);
  });
  it("resolveBrief uses the override when set, the built-in when blank", () => {
    expect(__test.resolveBrief("my custom brief")).toBe("my custom brief");
    expect(__test.resolveBrief("")).toBe(__test.DEFAULT_BRIEF);
    expect(__test.resolveBrief("   ")).toBe(__test.DEFAULT_BRIEF);
    expect(__test.resolveBrief(undefined)).toBe(__test.DEFAULT_BRIEF);
  });
});

describe("buildClaudeArgs", () => {
  it("streams JSON with no tools and the right permission mode", () => {
    const a = __test.buildClaudeArgs({ model: "opus" });
    expect(a).toEqual(
      expect.arrayContaining([
        "-p",
        "--model",
        "opus",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-mode",
        "dontAsk",
        "--disallowedTools",
        "*",
      ]),
    );
    expect(a).not.toContain("--resume");
  });

  it("resume adds --resume <id>", () => {
    const a = __test.buildClaudeArgs({ model: "opus", sessionId: "s1" });
    expect(a[a.indexOf("--resume") + 1]).toBe("s1");
  });
});

describe("safeCwd", () => {
  it("undefined resolves to HOME", () => expect(__test.safeCwd()).toBe(HOME));
  it("HOME stays HOME", () => expect(__test.safeCwd(HOME)).toBe(HOME));
  it("a path outside HOME is rejected", () => expect(__test.safeCwd("/etc")).toBeNull());
  it("a nonexistent path under HOME is rejected", () =>
    expect(__test.safeCwd(`${HOME}/__codex_council_missing_dir_xyz`)).toBeNull());
  it("rejects a symlink under HOME that points outside HOME (realpath confinement)", () => {
    const dir = mkdtempSync(join(HOME, ".codex-council-symtest-"));
    try {
      const link = join(dir, "escape");
      symlinkSync("/etc", link);
      expect(__test.safeCwd(link)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveBinary — PATH lookup", () => {
  it("finds the binary via $PATH, not only the hardcoded locations", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-bin-"));
    const prevPath = process.env.PATH;
    try {
      writeFileSync(join(dir, "codex"), "#!/bin/sh\n", { mode: 0o755 });
      process.env.PATH = `${dir}:${prevPath ?? ""}`;
      expect(__test.resolveBinary("codex")).toBe(join(dir, "codex"));
    } finally {
      process.env.PATH = prevPath;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
