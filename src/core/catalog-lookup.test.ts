import { describe, expect, test } from "bun:test";
import { resolveModelInfo } from "./catalog-lookup";
import type { ModelInfo } from "./catalog-types";

function model(id: string): ModelInfo {
  return {
    id,
    name: id,
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["text"] },
    limit: { context: 1000, output: 100 },
  };
}

const catalog: Record<string, ModelInfo> = {
  "gpt-5": model("gpt-5"),
  "gpt-5-mini": model("gpt-5-mini"),
  "gpt-5.2": model("gpt-5.2"),
  "claude-opus-4-6": model("claude-opus-4-6"),
  "gemini-2.5-flash": model("gemini-2.5-flash"),
  "grok-4": model("grok-4"),
};

describe("resolveModelInfo", () => {
  test("exact match", () => {
    expect(resolveModelInfo(catalog, "gpt-5")?.id).toBe("gpt-5");
    expect(resolveModelInfo(catalog, "gemini-2.5-flash")?.id).toBe("gemini-2.5-flash");
  });

  test("strips a leading models/ prefix (google REST form)", () => {
    expect(resolveModelInfo(catalog, "models/gemini-2.5-flash")?.id).toBe("gemini-2.5-flash");
  });

  test("models/ prefix combines with the other fallbacks", () => {
    expect(resolveModelInfo(catalog, "models/gemini-2.5-flash-preview-05-20")?.id).toBe(
      "gemini-2.5-flash",
    );
  });

  test("strips a trailing -YYYY-MM-DD date suffix (openai-style snapshots)", () => {
    expect(resolveModelInfo(catalog, "gpt-5.2-2026-01-15")?.id).toBe("gpt-5.2");
  });

  test("strips a trailing -YYYYMMDD date suffix (anthropic-style snapshots)", () => {
    expect(resolveModelInfo(catalog, "claude-opus-4-6-20260204")?.id).toBe("claude-opus-4-6");
  });

  test("falls back to the longest prefix across a - boundary", () => {
    expect(resolveModelInfo(catalog, "gpt-5-mini-preview")?.id).toBe("gpt-5-mini");
    expect(resolveModelInfo(catalog, "gemini-2.5-flash-preview-05-20")?.id).toBe(
      "gemini-2.5-flash",
    );
  });

  test("longest prefix wins over a shorter one", () => {
    // Both "gpt-5" and "gpt-5-mini" prefix this id; the longer must win.
    expect(resolveModelInfo(catalog, "gpt-5-mini-2026-01-15")?.id).toBe("gpt-5-mini");
  });

  test("falls back across a . boundary (dotted snapshots)", () => {
    expect(resolveModelInfo(catalog, "grok-4.1-fast")?.id).toBe("grok-4");
  });

  test("dotted catalog ids still win over their dotless prefix", () => {
    // "gpt-5.2-..." matches both "gpt-5" (via ".") and "gpt-5.2" (via "-").
    expect(resolveModelInfo(catalog, "gpt-5.2-preview")?.id).toBe("gpt-5.2");
  });

  test("no match without a -/. boundary", () => {
    expect(resolveModelInfo(catalog, "gpt-52")).toBeUndefined();
    expect(resolveModelInfo(catalog, "gpt-5x")).toBeUndefined();
  });

  test("unknown id resolves to undefined", () => {
    expect(resolveModelInfo(catalog, "llama-9")).toBeUndefined();
    expect(resolveModelInfo(catalog, "")).toBeUndefined();
  });
});
