import { describe, expect, test } from "bun:test";
import {
  textToSpeechStreamInput,
  textToSpeechStreamInputUrl,
  toInitializeConnectionMessage,
  STREAM_INPUT_WS_BASE_URL,
  STREAM_INPUT_CHUNK_LENGTH_MAX,
  STREAM_INPUT_CHUNK_LENGTH_MIN,
  STREAM_INPUT_DEFAULT_CHUNK_LENGTH_SCHEDULE,
  STREAM_INPUT_INACTIVITY_TIMEOUT_DEFAULT,
  STREAM_INPUT_INACTIVITY_TIMEOUT_MAX,
} from "./text-to-speech-stream-input";
import { TTS_MODEL_IDS } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = textToSpeechStreamInput.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";

describe("elevenlabs.textToSpeechStreamInput happy path", () => {
  test("returns the validated config; url and first message are built from it", () => {
    const params = {
      voice_id: VOICE_ID,
      model_id: "eleven_flash_v2_5" as const,
      output_format: "mp3_44100_128" as const,
      inactivity_timeout: 180,
      auto_mode: false,
      voice_settings: { stability: 0.5, similarity_boost: 0.8, speed: 1.1 },
      generation_config: { chunk_length_schedule: [120, 160, 250, 290] },
    };
    const config = textToSpeechStreamInput(params);
    expect(config).toEqual(params);

    const url = textToSpeechStreamInputUrl(config);
    expect(url.startsWith(`${STREAM_INPUT_WS_BASE_URL}/${VOICE_ID}/stream-input?`)).toBe(true);
    const query = new URL(url.replace("wss://", "https://")).searchParams;
    expect(query.get("model_id")).toBe("eleven_flash_v2_5");
    expect(query.get("output_format")).toBe("mp3_44100_128");
    expect(query.get("inactivity_timeout")).toBe("180");
    expect(query.get("auto_mode")).toBe("false");
    // Message-only fields never leak into the URL.
    expect(query.get("voice_settings")).toBeNull();

    // The first frame is the InitializeConnection message, blank space and all.
    expect(toInitializeConnectionMessage(config)).toEqual({
      text: " ",
      voice_settings: { stability: 0.5, similarity_boost: 0.8, speed: 1.1 },
      generation_config: { chunk_length_schedule: [120, 160, 250, 290] },
    });
  });

  test("a bare config yields a bare url and a blank-space-only first message", () => {
    const config = textToSpeechStreamInput({ voice_id: VOICE_ID });
    expect(textToSpeechStreamInputUrl(config)).toBe(
      `${STREAM_INPUT_WS_BASE_URL}/${VOICE_ID}/stream-input`,
    );
    expect(toInitializeConnectionMessage(config)).toEqual({ text: " " });
  });

  test("every text-to-speech model id validates clean", () => {
    for (const id of TTS_MODEL_IDS) {
      const r = textToSpeechStreamInput.safe({ voice_id: VOICE_ID, model_id: id });
      expect(r.ok).toBe(true);
      // eleven_turbo_* are deprecated in the catalog; that is the only warning.
      if (r.ok) {
        expect(r.warnings.every((w) => w.code === "deprecated_model")).toBe(true);
      }
    }
  });

  test("documented defaults and bounds are exported verbatim", () => {
    expect(STREAM_INPUT_DEFAULT_CHUNK_LENGTH_SCHEDULE).toEqual([120, 160, 250, 290]);
    expect(STREAM_INPUT_CHUNK_LENGTH_MIN).toBe(50);
    expect(STREAM_INPUT_CHUNK_LENGTH_MAX).toBe(500);
    expect(STREAM_INPUT_INACTIVITY_TIMEOUT_DEFAULT).toBe(20);
    expect(STREAM_INPUT_INACTIVITY_TIMEOUT_MAX).toBe(180);
  });

  test("an unknown model warns; an unknown top-level key warns", () => {
    const r = safeUnchecked({ voice_id: VOICE_ID, model_id: "eleven_v9", brand_new_param: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const codes = r.warnings.map((w) => w.code);
      expect(codes).toContain("unknown_model");
      expect(codes).toContain("unknown_param");
    }
  });
});

describe("elevenlabs.textToSpeechStreamInput schema enforcement", () => {
  test("chunk_length_schedule items must be integers in 50-500", () => {
    for (const bad of [49, 501, 120.5]) {
      const r = safeUnchecked({
        voice_id: VOICE_ID,
        generation_config: { chunk_length_schedule: [bad] },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("invalid_shape");
        expect(r.errors[0]?.path).toEqual(["generation_config", "chunk_length_schedule", 0]);
      }
    }
    const ok = textToSpeechStreamInput.safe({
      voice_id: VOICE_ID,
      generation_config: { chunk_length_schedule: [50, 500] },
    });
    expect(ok.ok).toBe(true);
  });

  test("voice_settings.speed is bounded 0.7-1.2", () => {
    expect(
      textToSpeechStreamInput.safe({ voice_id: VOICE_ID, voice_settings: { speed: 0.7 } }).ok,
    ).toBe(true);
    const r = safeUnchecked({ voice_id: VOICE_ID, voice_settings: { speed: 1.5 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["voice_settings", "speed"]);
  });

  test("inactivity_timeout is capped at the documented 180", () => {
    expect(textToSpeechStreamInput.safe({ voice_id: VOICE_ID, inactivity_timeout: 180 }).ok).toBe(
      true,
    );
    const r = safeUnchecked({ voice_id: VOICE_ID, inactivity_timeout: 181 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("the first message's text must be the documented blank space", () => {
    expect(textToSpeechStreamInput.safe({ voice_id: VOICE_ID, text: " " }).ok).toBe(true);
    const r = safeUnchecked({ voice_id: VOICE_ID, text: "Hello " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["text"]);
  });

  test("pronunciation dictionary locators require BOTH ids on this endpoint", () => {
    const ok = textToSpeechStreamInput.safe({
      voice_id: VOICE_ID,
      pronunciation_dictionary_locators: [
        { pronunciation_dictionary_id: "dict_1", version_id: "v1" },
      ],
    });
    expect(ok.ok).toBe(true);
    const r = safeUnchecked({
      voice_id: VOICE_ID,
      pronunciation_dictionary_locators: [{ pronunciation_dictionary_id: "dict_1" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.path).toEqual(["pronunciation_dictionary_locators", 0, "version_id"]);
    }
  });

  test("an empty voice_id is invalid_shape", () => {
    const r = safeUnchecked({ voice_id: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["voice_id"]);
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const unchecked = textToSpeechStreamInput as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      unchecked({ voice_id: VOICE_ID, apply_text_normalization: "sometimes" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("elevenlabs.textToSpeechStreamInput checks", () => {
  test("a non-TTS catalog id is unsupported_capability", () => {
    const r = safeUnchecked({ voice_id: VOICE_ID, model_id: "music_v2" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.path).toEqual(["model_id"]);
    }
  });

  test("an off-list output_format is a WARNING (the socket reference publishes no enum)", () => {
    const r = safeUnchecked({ voice_id: VOICE_ID, output_format: "mp3_44100_999" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const issue = r.warnings.find((w) => w.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["output_format"]);
      expect(String(issue?.meta?.source)).toContain("text-to-speech/convert");
    }
  });

  test("auto_mode warns that the chunk schedule is ignored", () => {
    const r = textToSpeechStreamInput.safe({
      voice_id: VOICE_ID,
      auto_mode: true,
      generation_config: { chunk_length_schedule: [120] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const issue = r.warnings.find((w) => w.code === "unsupported_param");
      expect(issue?.path).toEqual(["generation_config", "chunk_length_schedule"]);
      expect(issue?.meta?.ignored).toBe(true);
    }
    // Without auto_mode the same schedule is silent.
    const quiet = textToSpeechStreamInput.safe({
      voice_id: VOICE_ID,
      generation_config: { chunk_length_schedule: [120] },
    });
    expect(quiet.ok).toBe(true);
    if (quiet.ok) expect(quiet.warnings).toEqual([]);
  });

  test("language_code on multilingual_v2 is the shared ignored-param warning", () => {
    const r = textToSpeechStreamInput.safe({
      voice_id: VOICE_ID,
      model_id: "eleven_multilingual_v2",
      language_code: "en",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const issue = r.warnings.find((w) => w.code === "unsupported_param");
      expect(issue?.path).toEqual(["language_code"]);
      expect(issue?.meta?.ignored).toBe(true);
    }
    expect(
      textToSpeechStreamInput.constraintsFor("eleven_multilingual_v2")[0]?.deny?.language_code
        ?.ignored,
    ).toBe(true);
  });
});
