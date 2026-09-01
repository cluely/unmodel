import { describe, expect, test } from "bun:test";
import {
  sfx,
  soundEffectsUrl,
  DEFAULT_SFX_MODEL_ID,
  SOUND_EFFECTS_URL,
  SOUND_EFFECTS_OUTPUT_FORMATS,
  SOUND_EFFECTS_DURATION_SECONDS_MAX,
  SOUND_EFFECTS_DURATION_SECONDS_MIN,
} from "./sound-effects";
import { MUSIC_OUTPUT_FORMATS } from "./music";
import { models, SFX_MODEL_IDS, SOUND_EFFECTS_PER_AUDIO_MINUTE } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

const safeUnchecked = sfx.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("elevenlabs.sfx wire shape", () => {
  test("output_format is a query param, stripped from the body", () => {
    const v = sfx({
      text: "A heavy oak door creaking open",
      duration_seconds: 4,
      model_id: "eleven_text_to_sound_v2",
      output_format: "mp3_44100_192",
    });

    expect(Object.keys(v)).toEqual(["text", "duration_seconds", "model_id"]);
    expect(v.request.url).toBe(`${SOUND_EFFECTS_URL}?output_format=mp3_44100_192`);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("no output_format → bare endpoint URL", () => {
    const v = sfx({ text: "footsteps on gravel" });
    expect(v.request.url).toBe(SOUND_EFFECTS_URL);
    expect(soundEffectsUrl()).toBe(SOUND_EFFECTS_URL);
  });

  test("toSdk camelCases keys, drops nulls and carries outputFormat", () => {
    const v = sfx({
      text: "a distant thunderclap",
      loop: false,
      duration_seconds: 2.5,
      prompt_influence: 0.7,
      duration_seconds_unused: undefined,
      output_format: "opus_48000_64",
    } as never);
    const request = v.toSdk("elevenlabs");
    expect(request).toEqual({
      text: "a distant thunderclap",
      loop: false,
      durationSeconds: 2.5,
      promptInfluence: 0.7,
      outputFormat: "opus_48000_64",
    });
  });

  test("an undocumented output_format is invalid_enum_value", () => {
    const result = safeUnchecked({ text: "hum", output_format: "mp3_11025_16" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("invalid_enum_value");
    expect(result.errors[0]?.path).toEqual(["output_format"]);
  });

  /**
   * The reason this endpoint declares its own list rather than importing the
   * music one: `/v1/music` publishes four 48 kHz MP3 arms that
   * `/v1/sound-generation` does not, so a shared constant would accept four
   * values this endpoint rejects.
   */
  test("the format enum is NOT the music one — no 48 kHz MP3 arm here", () => {
    const musicOnly = MUSIC_OUTPUT_FORMATS.filter(
      (format) => !(SOUND_EFFECTS_OUTPUT_FORMATS as readonly string[]).includes(format),
    );
    expect(musicOnly).toEqual([
      "auto",
      "mp3_48000_128",
      "mp3_48000_192",
      "mp3_48000_240",
      "mp3_48000_320",
    ]);
    for (const format of musicOnly) {
      const result = safeUnchecked({ text: "hum", output_format: format });
      expect(result.ok, `${format} must be refused here`).toBe(false);
    }
  });

  test("every SOUND_EFFECTS_OUTPUT_FORMATS preset validates cleanly", () => {
    for (const format of SOUND_EFFECTS_OUTPUT_FORMATS) {
      const result = safeUnchecked({ text: "hum", output_format: format });
      expect(result.ok, `${format} must validate`).toBe(true);
      if (!result.ok) continue;
      const request = result.params["request"] as { url: string };
      expect(request.url).toBe(`${SOUND_EFFECTS_URL}?output_format=${format}`);
    }
  });
});

describe("elevenlabs.sfx model gate", () => {
  test("the one sound-effects id passes, and it is the documented default", () => {
    expect(SFX_MODEL_IDS).toEqual(["eleven_text_to_sound_v2"]);
    expect(DEFAULT_SFX_MODEL_ID).toBe("eleven_text_to_sound_v2");
    expect(safeUnchecked({ text: "hum", model_id: DEFAULT_SFX_MODEL_ID }).ok).toBe(true);
  });

  /**
   * The catalog knows every ElevenLabs id, so without this gate a music id
   * would resolve and pass sound-effects validation unremarked. The mirror
   * refusal lives in `./music.ts`, and the two together are why these are
   * separate categories rather than one.
   */
  test("a music id is rejected as unsupported_capability", () => {
    const result = safeUnchecked({ text: "hum", model_id: "music_v2" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("unsupported_capability");
    expect(result.errors[0]?.message).toContain("/v1/sound-generation");
    expect(result.errors[0]?.message).toContain("eleven_text_to_sound_v2");
  });

  test("an id absent from the catalog only warns", () => {
    const result = safeUnchecked({ text: "hum", model_id: "eleven_text_to_sound_v3" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((issue) => issue.code === "unknown_model")).toBe(true);
  });

  test("`loop` on an unknown model warns without refusing", () => {
    const result = safeUnchecked({ text: "hum", loop: true, model_id: "eleven_text_to_sound_v3" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warning = result.warnings.find((issue) => issue.path[0] === "loop");
    expect(warning?.code).toBe("unsupported_param");
    expect(safeUnchecked({ text: "hum", loop: true }).ok).toBe(true);
  });
});

describe("elevenlabs.sfx shape bounds", () => {
  test("duration_seconds outside 0.5–30 is invalid_shape", () => {
    for (const seconds of [0.4, 30.1]) {
      const result = safeUnchecked({ text: "hum", duration_seconds: seconds });
      expect(result.ok, `${seconds} must be refused`).toBe(false);
    }
    expect(
      safeUnchecked({ text: "hum", duration_seconds: SOUND_EFFECTS_DURATION_SECONDS_MIN }).ok,
    ).toBe(true);
    expect(
      safeUnchecked({ text: "hum", duration_seconds: SOUND_EFFECTS_DURATION_SECONDS_MAX }).ok,
    ).toBe(true);
  });

  /** `anyOf[number, null]`, and the null arm is the "you decide" spelling. */
  test("duration_seconds accepts an explicit null", () => {
    const result = safeUnchecked({ text: "hum", duration_seconds: null });
    expect(result.ok).toBe(true);
  });

  test("prompt_influence outside 0–1 is invalid_shape", () => {
    expect(safeUnchecked({ text: "hum", prompt_influence: 1.5 }).ok).toBe(false);
    expect(safeUnchecked({ text: "hum", prompt_influence: 0 }).ok).toBe(true);
    expect(safeUnchecked({ text: "hum", prompt_influence: 1 }).ok).toBe(true);
  });

  test("a missing text is invalid_shape", () => {
    expect(safeUnchecked({ duration_seconds: 3 }).ok).toBe(false);
  });

  test("unknown body params warn but pass through", () => {
    const result = safeUnchecked({ text: "hum", not_a_field: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((issue) => issue.code === "unknown_param")).toBe(true);
    expect(result.params["not_a_field"]).toBe(1);
  });
});

describe("elevenlabs.sfx cost estimation", () => {
  test("the catalog carries $0.12 per generated minute", () => {
    expect(SOUND_EFFECTS_PER_AUDIO_MINUTE).toBe(0.12);
    expect(models.eleven_text_to_sound_v2.cost).toEqual({
      perAudioMinute: SOUND_EFFECTS_PER_AUDIO_MINUTE,
    });
  });

  test("duration_seconds drives the estimate", () => {
    const result = safeUnchecked({ text: "hum", duration_seconds: 30 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate?.costUSD).toBeCloseTo(0.06, 10);
  });

  /**
   * The behaviour the whole `unmodel/sfx` duration row exists for, seen from
   * the wire side: with no length stated the model picks one, so there is
   * nothing to bill against and nothing to estimate.
   */
  test("no stated length → no estimate (the model picks the length)", () => {
    const result = safeUnchecked({ text: "hum" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate?.costUSD).toBeUndefined();
  });

  test("the throwing form throws UnmodelValidationError", () => {
    expect(() => (sfx as unknown as (p: unknown) => unknown)({ text: 4 })).toThrow(
      UnmodelValidationError,
    );
  });
});
