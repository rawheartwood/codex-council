import { describe, it, expect } from "vitest";
import { redact, tokenMatches, originAllowed, parseModelJson } from "./business-ops-env";

describe("redact — masks secret shapes, leaves prose intact", () => {
  it("masks each known key shape", () => {
    const cases = [
      "sk-ant-" + "A1b2C3d4E5",
      "sk-" + "A".repeat(24),
      "ghp_" + "B".repeat(20),
      "github_pat_" + "C".repeat(24),
      "pcsk_" + "D".repeat(20),
      "fc-" + "E".repeat(20),
      "xai-" + "F".repeat(20),
      "AKIA" + "0123456789ABCDEF",
      "eyJ" + "A".repeat(10) + "." + "B".repeat(10) + "." + "C".repeat(6),
    ];
    for (const secret of cases) {
      expect(redact(`leak: ${secret} end`)).not.toContain(secret);
      expect(redact(`leak: ${secret} end`)).toContain("<redacted>");
    }
  });
  it("masks authorization bearer and xi-api-key", () => {
    expect(redact("Authorization: Bearer abc.def-ghi")).toContain("<redacted>");
    expect(redact('xi-api-key: "abcdef123456ghij"')).toContain("<redacted>");
  });
  it("leaves ordinary text untouched", () => {
    const text = "just a normal sentence with no secrets, only 12345.";
    expect(redact(text)).toBe(text);
  });
});

describe("tokenMatches — constant-time-ish equality with length guard", () => {
  const tok = "a".repeat(64);
  it("accepts the exact token", () => expect(tokenMatches(tok, tok)).toBe(true));
  it("rejects a wrong value of the same length", () =>
    expect(tokenMatches("b".repeat(64), tok)).toBe(false));
  it("rejects a wrong length", () => expect(tokenMatches("a".repeat(63), tok)).toBe(false));
  it("rejects non-strings", () => {
    expect(tokenMatches(undefined, tok)).toBe(false);
    expect(tokenMatches(12345, tok)).toBe(false);
    expect(tokenMatches(["x"], tok)).toBe(false);
  });
});

describe("originAllowed — same-origin allowed, cross-site rejected", () => {
  it("allows localhost/127.0.0.1/[::1] at any port", () => {
    expect(originAllowed("http://localhost:5173")).toBe(true);
    expect(originAllowed("http://127.0.0.1:8081")).toBe(true);
    expect(originAllowed("https://[::1]")).toBe(true);
  });
  it("allows a missing Origin (non-browser callers)", () => {
    expect(originAllowed(undefined)).toBe(true);
    expect(originAllowed("")).toBe(true);
  });
  it("rejects an external https origin", () =>
    expect(originAllowed("https://evil.example.com")).toBe(false));
  it("rejects forge-proof cross-site/same-site Sec-Fetch-Site regardless of Origin", () => {
    expect(originAllowed("http://localhost:5173", "cross-site")).toBe(false);
    expect(originAllowed(undefined, "same-site")).toBe(false);
  });
  it("allows a same-origin Sec-Fetch-Site with no Origin (same-origin GET)", () =>
    expect(originAllowed(undefined, "same-origin")).toBe(true));
});

describe("parseModelJson — tolerant single-object extraction", () => {
  it("parses a plain object", () => expect(parseModelJson('{"a":1}')).toEqual({ a: 1 }));
  it("strips ```json fences", () =>
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 }));
  it("falls back to a brace span inside prose", () =>
    expect(parseModelJson('here you go: {"a":1} thanks')).toEqual({ a: 1 }));
  it("returns null for arrays and garbage", () => {
    expect(parseModelJson("[1,2,3]")).toBeNull();
    expect(parseModelJson("not json at all")).toBeNull();
    expect(parseModelJson("")).toBeNull();
  });
});
