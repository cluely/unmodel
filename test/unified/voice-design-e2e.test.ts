/**
 * `unmodel/voice-design` end to end, through the ready pack — the
 * ./voice-clone-e2e contract on the simpler category, plus the bound checks
 * that live in the provider validators and must surface at canonical paths.
 */
import { describe, expect, test } from "bun:test";
import { TranslationUnavailableError } from "../../src/core/translate/errors";
import { voiceDesign } from "../../src/unified/voice-design";

const PROMPT = "An elderly British gentleman with a warm, gravelly storytelling tone";
const SCRIPT =
  "Once upon a time, in a land far away, there lived a clockmaker who wound the stars " +
  "each evening and listened to their slow, patient music.";

describe("the pack", () => {
  test("registers exactly the four design providers", () => {
    expect([...voiceDesign.providers]).toEqual([
      "elevenlabs",
      "fish-audio",
      "inworld",
      "minimax",
    ]);
  });

  test("hume is the signposted gap: an unregistered provider, structurally", () => {
    expect(() =>
      voiceDesign({
        model: "hume/octave" as never,
        operation: "design",
        prompt: PROMPT,
      }),
    ).toThrow(TranslationUnavailableError);
  });

  test("the result is the provider's own Validated — fish carries the model header", () => {
    const result = voiceDesign.safe({
      model: "fish-audio/voice-design-1",
      operation: "design",
      prompt: PROMPT,
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const validated = result.params as unknown as {
      request: { url: string; headers: Record<string, string> };
      estimate?: unknown;
    };
    expect(validated.request.url).toBe("https://api.fish.audio/v1/voice-design");
    expect(validated.request.headers["model"]).toBe("voice-design-1");
    // The flat $0.01/request rate rides through the unified surface.
    expect(result.estimate.costUSD).toBe(0.01);
  });

  test("minimax prices the preview text through the synthetic row", () => {
    const result = voiceDesign.safe({
      model: "minimax/voice-design",
      operation: "design",
      prompt: PROMPT,
      previewText: "a".repeat(500),
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate.costUSD).toBeCloseTo((30 * 500) / 1_000_000, 12);
  });
});

describe("bounds surface at canonical paths", () => {
  test("elevenlabs: a short previewText is the wire's 100–1000 check, at `previewText`", () => {
    const result = voiceDesign.safe({
      model: "elevenlabs/eleven_ttv_v3",
      operation: "design",
      prompt: PROMPT,
      previewText: "too short",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.errors.find((e) => e.path?.[0] === "previewText");
    expect(issue?.code).toBe("invalid_shape");
    expect(issue?.meta?.["min"]).toBe(100);
  });

  test("inworld: the 30–250 prompt window arrives at `prompt`", () => {
    const result = voiceDesign.safe({
      model: "inworld/voice-design",
      operation: "design",
      prompt: "too short",
      previewText: SCRIPT,
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path?.[0] === "prompt")).toBe(true);
  });

  test("minimax: the 500-character preview cap arrives at `previewText`", () => {
    const result = voiceDesign.safe({
      model: "minimax/voice-design",
      operation: "design",
      prompt: PROMPT,
      previewText: "a".repeat(501),
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path?.[0] === "previewText")).toBe(true);
  });

  test("fish: n outside 1–4 is the wire's schema bound, at `n`", () => {
    const result = voiceDesign.safe({
      model: "fish-audio/voice-design-1",
      operation: "design",
      prompt: PROMPT,
      n: 5,
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path?.[0] === "n")).toBe(true);
  });

  test("elevenlabs: the v3-only extras are gated per model through the unified surface", () => {
    const onV3 = voiceDesign.safe({
      model: "elevenlabs/eleven_ttv_v3",
      operation: "design",
      prompt: PROMPT,
      prompt_strength: 0.5,
      reference_audio_base64: "AAAA",
    } as never);
    expect(onV3.ok).toBe(true);

    const onV2 = voiceDesign.safe({
      model: "elevenlabs/eleven_multilingual_ttv_v2",
      operation: "design",
      prompt: PROMPT,
      prompt_strength: 0.5,
    } as never);
    expect(onV2.ok).toBe(false);
  });
});
