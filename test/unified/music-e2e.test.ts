/**
 * `unmodel/music`, end to end through the ready-made pack.
 *
 * The golden matrix next door pins *what* each provider compiles to; this pins
 * what a caller gets back — the provider's own `Validated`, its `.request`, its
 * `.toSdk(...)` and its estimate — plus the two things this category has that
 * the others do not: a unit conversion that must be exact, and a pair of
 * sibling routes that were deliberately left out of the vocabulary.
 */
import { describe, expect, test } from "bun:test";
import { UnmodelValidationError } from "../../src/core/issues";
import { TranslationUnavailableError } from "../../src/core/translate/errors";
import {
  MUSIC_LENGTH_MS_MAX,
  MUSIC_LENGTH_MS_MIN,
  music as elevenlabsMusic,
} from "../../src/providers/elevenlabs";
import { musicFromAudio, musicInpaint } from "../../src/providers/stability";
import { music } from "../../src/unified/music";

const PROMPT = "slow post-rock build, brushed drums, no vocals";

describe("the pack", () => {
  test("registers exactly the two music providers, sorted", () => {
    expect([...music.providers]).toEqual(["elevenlabs", "stability"]);
  });

  test("a provider outside the pack is structural, not a validation error", () => {
    expect(() => music({ model: "suno/v5", prompt: PROMPT } as never)).toThrow(
      TranslationUnavailableError,
    );
    const result = music.safe({ model: "suno/v5", prompt: PROMPT } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.meta).toMatchObject({ structural: true, provider: "suno" });
  });

  test("a model the adapter does not list warns but still compiles", () => {
    const result = music.safe({ model: "elevenlabs/music_v3", prompt: PROMPT } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((issue) => issue.code)).toEqual([
      "unknown_model",
      "unknown_model",
    ]);
  });
});

describe("the result is the provider's own Validated", () => {
  test("elevenlabs: JSON body, the format in the query, and toSdk", () => {
    const params = music({
      model: "elevenlabs/music_v1",
      prompt: PROMPT,
      durationSeconds: 45,
      instrumental: true,
      outputFormat: { format: "mp3", sampleRate: 44100, bitrate: 192000 },
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      prompt: PROMPT,
      model_id: "music_v1",
      music_length_ms: 45000,
      force_instrumental: true,
    });
    expect(params.request.url).toBe(
      "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192",
    );
    expect(params.request.headers).toEqual({ "content-type": "application/json" });
    // The SDK view camelCases and carries the format back as an argument.
    expect(params.toSdk("elevenlabs")).toMatchObject({
      musicLengthMs: 45000,
      forceInstrumental: true,
      outputFormat: "mp3_44100_192",
    });
  });

  test("stability: a multipart body with the format as a form field", () => {
    const params = music({
      model: "stability/stable-audio-2.5",
      prompt: PROMPT,
      durationSeconds: 45,
      outputFormat: { format: "pcm_s16le", container: "wav" },
      seed: 7,
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      prompt: PROMPT,
      model: "stable-audio-2.5",
      duration: 45,
      output_format: "wav",
      seed: 7,
    });
    expect(params.request).toMatchObject({
      url: "https://api.stability.ai/v2beta/audio/stable-audio-2/text-to-audio",
      method: "POST",
      // Deliberately empty: the boundary belongs to the FormData.
      headers: {},
    });
  });

  test("an estimate rides through, from the provider's own cost model", () => {
    // ElevenLabs prices music per generated minute, and the duration is in the
    // request rather than declared out of band — so the estimate needs no
    // `options.media` at all.
    const result = music.safe({
      model: "elevenlabs/music_v1",
      prompt: PROMPT,
      durationSeconds: 120,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate?.costUSD).toBeCloseTo(0.15 * 2, 6);
  });
});

describe("the one conversion in the category", () => {
  test("seconds become milliseconds exactly, and silently", () => {
    const params = music({
      model: "elevenlabs/music_v1",
      prompt: PROMPT,
      durationSeconds: 90,
    });
    expect((params as unknown as { music_length_ms: number }).music_length_ms).toBe(90000);
    // Exact means no warning: ×1000 loses nothing, and spending the warning
    // channel on arithmetic that is exact is what makes warnings ignorable.
    expect(params.warnings).toEqual([]);
  });

  test("a fractional millisecond is refused rather than rounded", () => {
    const result = music.safe({
      model: "elevenlabs/music_v1",
      prompt: PROMPT,
      durationSeconds: 12.3456,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("invalid_shape");
    expect(result.errors[0]!.path).toEqual(["durationSeconds"]);
    expect(result.errors[0]!.message).toContain("12345.6");
  });

  test("a decimal that IS a whole millisecond passes", () => {
    const params = music({
      model: "elevenlabs/music_v1",
      prompt: PROMPT,
      durationSeconds: 12.3,
    });
    expect((params as unknown as { music_length_ms: number }).music_length_ms).toBe(12300);
  });

  test("the length bounds are the provider's, reported at `durationSeconds`", () => {
    // Not restated in the adapter — there is exactly one copy of 3 000–600 000
    // ms, and it lives in `elevenlabs.music`'s schema.
    for (const seconds of [MUSIC_LENGTH_MS_MIN / 1000 - 1, MUSIC_LENGTH_MS_MAX / 1000 + 1]) {
      const result = music.safe({ model: "elevenlabs/music_v1", prompt: PROMPT, durationSeconds: seconds });
      expect(result.ok, `${seconds}s`).toBe(false);
      if (result.ok) continue;
      expect(result.errors[0]!.path).toEqual(["durationSeconds"]);
      expect(result.errors[0]!.message).toContain("compiled from `music_length_ms`");
    }
  });

  test("stability's 1–190 s range, likewise", () => {
    const result = music.safe({
      model: "stability/stable-audio-2",
      prompt: PROMPT,
      durationSeconds: 300,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["durationSeconds"]);
    expect(result.errors[0]!.message).toContain("compiled from `duration`");
  });
});

describe("providerOptions", () => {
  test("reaches the params the vocabulary deliberately has no word for", () => {
    const params = music({
      model: "stability/stable-audio-2",
      prompt: PROMPT,
      providerOptions: { stability: { steps: 60, cfg_scale: 9 } },
    });
    expect(JSON.parse(JSON.stringify(params))).toMatchObject({ steps: 60, cfg_scale: 9 });
  });

  test("an override the provider rejects says where it came from", () => {
    const result = music.safe({
      model: "stability/stable-audio-2",
      prompt: PROMPT,
      providerOptions: { stability: { steps: 4 } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["steps"]);
    expect(result.errors[0]!.message).toEndWith("(supplied via `providerOptions`)");
  });

  test("a composition plan rides through the escape hatch, and is validated", () => {
    const result = music.safe({
      model: "elevenlabs/music_v1",
      prompt: PROMPT,
      providerOptions: {
        elevenlabs: {
          composition_plan: { positive_global_styles: ["post-rock"], sections: [] },
        },
      },
    });
    // `prompt` and `composition_plan` are mutually exclusive at ElevenLabs, and
    // it is the provider's own rule that says so — not a second copy here.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["composition_plan"]);
  });
});

describe("the routes this category deliberately does not unify", () => {
  /**
   * `musicFromAudio` and `musicInpaint` are Stability's audio-conditioned
   * routes. Both take an `audio` Blob plus controls no other provider has, so
   * a canonical vocabulary for them would be a vocabulary of one. They stay
   * wire-only — and this test is what keeps that a decision rather than an
   * oversight: they exist, they validate, and they are not reachable through
   * `music()`.
   */
  test("they are wire-only, and they still work", () => {
    expect(typeof musicFromAudio).toBe("function");
    expect(typeof musicInpaint).toBe("function");
    expect(music.providers).toContain("stability");
    // The unified surface has one Stability route, and it is text-to-audio.
    const params = music({ model: "stability/stable-audio-2", prompt: PROMPT });
    expect(params.request.url).toEndWith("/text-to-audio");
  });

  test("elevenlabs' own music validator is the one the pack ends in", () => {
    const direct = elevenlabsMusic({ prompt: PROMPT, model_id: "music_v1", music_length_ms: 45000 });
    const unified = music({ model: "elevenlabs/music_v1", prompt: PROMPT, durationSeconds: 45 });
    expect(JSON.parse(JSON.stringify(unified))).toEqual(JSON.parse(JSON.stringify(direct)));
  });
});

describe("the throwing form", () => {
  test("throws UnmodelValidationError labelled with the category", () => {
    expect(() =>
      music({ model: "stability/stable-audio-2", prompt: PROMPT, instrumental: true }),
    ).toThrow(UnmodelValidationError);
    try {
      music({ model: "stability/stable-audio-2", prompt: PROMPT, instrumental: true });
    } catch (error) {
      expect((error as Error).message).toContain("unmodel/music");
      expect((error as UnmodelValidationError).issues[0]!.path).toEqual(["instrumental"]);
    }
  });
});
