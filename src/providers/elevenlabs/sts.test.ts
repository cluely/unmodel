import { describe, expect, test } from "bun:test";
import {
  sts,
  stsToFormData,
  speechToSpeechUrl,
  DEFAULT_STS_MODEL_ID,
  SPEECH_TO_SPEECH_BASE_URL,
  STS_SEED_MAX,
} from "./sts";
import { TTS_OUTPUT_FORMATS } from "./tts";
import { STS_MODEL_IDS, VOICE_CHANGER_PER_AUDIO_MINUTE } from "./models";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = sts.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const clip = () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" });
const VOICE = "21m00Tcm4TlvDq8ikWAM";

describe("elevenlabs.sts happy path", () => {
  test("returns the validated form fields, with the path param moved into the URL", () => {
    const blob = clip();
    const v = sts({ voice_id: VOICE, audio: blob });

    // `voice_id` is a path segment and is stripped from the body.
    expect(Object.keys(v)).toEqual(["audio"]);
    expect(v.audio).toBe(blob);

    expect(v.request.url).toBe(`${SPEECH_TO_SPEECH_BASE_URL}/${VOICE}`);
    expect(v.request.method).toBe("POST");
    // Multipart: fetch must derive the boundary from the FormData body.
    expect(v.request.headers).toEqual({});
  });

  test("the two query params ride on the URL and leave the body", () => {
    const v = sts({
      voice_id: VOICE,
      audio: clip(),
      model_id: "eleven_multilingual_sts_v2",
      output_format: "opus_48000_96",
      enable_logging: false,
    });
    expect(Object.keys(v)).toEqual(["audio", "model_id"]);
    expect(v.request.url).toBe(
      `${SPEECH_TO_SPEECH_BASE_URL}/${VOICE}?output_format=opus_48000_96&enable_logging=false`,
    );
  });

  test("all documented fields validate together", () => {
    const r = sts.safe({
      voice_id: VOICE,
      audio: clip(),
      model_id: "eleven_multilingual_sts_v2",
      voice_settings: { stability: 0.4, similarity_boost: 0.8, speed: 1.1 },
      seed: 12345,
      remove_background_noise: true,
      file_format: "pcm_s16le_16",
      output_format: "mp3_44100_128",
      enable_logging: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("all three catalogued speech-to-speech ids are accepted", () => {
    expect(STS_MODEL_IDS).toEqual([
      "eleven_multilingual_sts_v2",
      "eleven_english_sts_v2",
      "eleven_english_sts_v1",
    ]);
    for (const model_id of STS_MODEL_IDS) {
      const r = sts.safe({ voice_id: VOICE, audio: clip(), model_id });
      expect(r.ok).toBe(true);
      // v1 is catalogued deprecated, so it warns — and is still accepted.
      if (r.ok && model_id !== "eleven_english_sts_v1") expect(r.warnings).toEqual([]);
    }
  });
});

describe("elevenlabs.sts model gate", () => {
  test("a text-to-speech id is refused naming the three that work", () => {
    const r = sts.safe({ voice_id: VOICE, audio: clip(), model_id: "eleven_multilingual_v2" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]?.code).toBe("unsupported_capability");
    expect(r.errors[0]?.path).toEqual(["model_id"]);
    expect(r.errors[0]?.message).toContain("eleven_multilingual_sts_v2");
    expect(r.errors[0]?.message).toContain("can_do_voice_conversion");
  });

  test("the sound-effects id is refused too — the enums are disjoint", () => {
    const r = sts.safe({ voice_id: VOICE, audio: clip(), model_id: "eleven_text_to_sound_v2" });
    expect(r.ok).toBe(false);
  });

  test("an id the catalog has never heard of degrades to the unknown-model warning", () => {
    const r = sts.safe({ voice_id: VOICE, audio: clip(), model_id: "eleven_sts_v9" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.some((w) => w.code === "unknown_model")).toBe(true);
  });

  test("an omitted model_id is checked against the ENGLISH server-side default", () => {
    // The documented default is eleven_english_sts_v2, not the multilingual
    // model the capability docs recommend — worth an assertion, not a comment.
    expect(DEFAULT_STS_MODEL_ID).toBe("eleven_english_sts_v2");
    const r = sts.safe({ voice_id: VOICE, audio: clip() });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });
});

describe("elevenlabs.sts field validation", () => {
  test("audio must be a Blob — there is no URL alternative on this wire", () => {
    const r = safeUnchecked({ voice_id: VOICE, audio: "https://example.com/clip.wav" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["audio"]);
  });

  test("audio is required", () => {
    const r = safeUnchecked({ voice_id: VOICE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["audio"]);
  });

  test("voice_id must be non-empty", () => {
    const r = safeUnchecked({ voice_id: "", audio: clip() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["voice_id"]);
  });

  test("the output_format enum is the text-to-speech one, byte for byte", () => {
    for (const output_format of TTS_OUTPUT_FORMATS) {
      expect(sts.safe({ voice_id: VOICE, audio: clip(), output_format }).ok).toBe(true);
    }
    const r = safeUnchecked({ voice_id: VOICE, audio: clip(), output_format: "flac_44100" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["output_format"]);
    }
  });

  test("seed is bounded 0–4294967295", () => {
    expect(sts.safe({ voice_id: VOICE, audio: clip(), seed: 0 }).ok).toBe(true);
    expect(sts.safe({ voice_id: VOICE, audio: clip(), seed: STS_SEED_MAX }).ok).toBe(true);
    expect(sts.safe({ voice_id: VOICE, audio: clip(), seed: STS_SEED_MAX + 1 }).ok).toBe(false);
    expect(safeUnchecked({ voice_id: VOICE, audio: clip(), seed: 1.5 }).ok).toBe(false);
  });

  test("file_format is the two-member enum", () => {
    expect(sts.safe({ voice_id: VOICE, audio: clip(), file_format: "other" }).ok).toBe(true);
    expect(safeUnchecked({ voice_id: VOICE, audio: clip(), file_format: "pcm_f32le" }).ok).toBe(
      false,
    );
  });

  test("voice_settings.speed carries the documented 0.7–1.2 bounds", () => {
    expect(sts.safe({ voice_id: VOICE, audio: clip(), voice_settings: { speed: 1.2 } }).ok).toBe(
      true,
    );
    const r = sts.safe({ voice_id: VOICE, audio: clip(), voice_settings: { speed: 1.9 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["voice_settings", "speed"]);
  });
});

describe("elevenlabs.sts cost estimate", () => {
  test("a declared duration prices the request at the voice-changer rate", () => {
    const r = sts.safe(
      { voice_id: VOICE, audio: clip() },
      { media: [{ path: ["audio"], durationSeconds: 120 }] },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(2 * VOICE_CHANGER_PER_AUDIO_MINUTE, 10);
  });

  test("no declaration means no number — a Blob's duration cannot be read", () => {
    const r = sts.safe({ voice_id: VOICE, audio: clip() });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("maxCostUSD is enforced against that estimate", () => {
    const r = sts.safe(
      { voice_id: VOICE, audio: clip() },
      { media: [{ path: ["audio"], durationSeconds: 600 }], maxCostUSD: 0.5 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});

describe("stsToFormData", () => {
  test("the file part, the JSON-string part, and nothing from the URL", () => {
    const v = sts({
      voice_id: VOICE,
      audio: clip(),
      model_id: "eleven_multilingual_sts_v2",
      voice_settings: { stability: 0.4 },
      seed: 7,
      remove_background_noise: true,
      file_format: "pcm_s16le_16",
      output_format: "mp3_44100_128",
      enable_logging: false,
    });
    const form = stsToFormData(v);

    // FormData re-wraps a Blob part as a File, so the identity check is on the
    // bytes rather than the reference.
    expect(form.get("audio")).toBeInstanceOf(Blob);
    expect((form.get("audio") as Blob).size).toBe(3);
    expect(form.get("model_id")).toBe("eleven_multilingual_sts_v2");
    // The wire wants a JSON-encoded STRING here, not a nested object.
    expect(form.get("voice_settings")).toBe('{"stability":0.4}');
    expect(form.get("seed")).toBe("7");
    expect(form.get("remove_background_noise")).toBe("true");
    expect(form.get("file_format")).toBe("pcm_s16le_16");

    // Path and query params never appear in the body.
    expect(form.get("voice_id")).toBeNull();
    expect(form.get("output_format")).toBeNull();
    expect(form.get("enable_logging")).toBeNull();
  });

  test("null and undefined fields are omitted", () => {
    const form = stsToFormData({ audio: clip(), seed: null, file_format: null });
    expect([...form.keys()]).toEqual(["audio"]);
  });
});

describe("speechToSpeechUrl", () => {
  test("no query params means no question mark", () => {
    expect(speechToSpeechUrl(VOICE)).toBe(`${SPEECH_TO_SPEECH_BASE_URL}/${VOICE}`);
  });

  test("the voice id is percent-encoded", () => {
    expect(speechToSpeechUrl("a b/c")).toBe(`${SPEECH_TO_SPEECH_BASE_URL}/a%20b%2Fc`);
  });

  test("either query param alone", () => {
    expect(speechToSpeechUrl(VOICE, { enable_logging: false })).toBe(
      `${SPEECH_TO_SPEECH_BASE_URL}/${VOICE}?enable_logging=false`,
    );
    expect(speechToSpeechUrl(VOICE, { output_format: "wav_44100" })).toBe(
      `${SPEECH_TO_SPEECH_BASE_URL}/${VOICE}?output_format=wav_44100`,
    );
  });
});

describe("toSdk('elevenlabs')", () => {
  test("camelCases the fields and JSON-encodes voice_settings, as the SDK types it", () => {
    const v = sts({
      voice_id: VOICE,
      audio: clip(),
      model_id: "eleven_multilingual_sts_v2",
      voice_settings: { stability: 0.4 },
      remove_background_noise: true,
      file_format: "other",
      output_format: "mp3_44100_128",
      enable_logging: false,
    });
    const sdk = v.toSdk("elevenlabs");
    // `voice_id` is the method's positional first argument, not a field.
    expect(sdk).toEqual({
      audio: v.audio,
      modelId: "eleven_multilingual_sts_v2",
      voiceSettings: '{"stability":0.4}',
      removeBackgroundNoise: true,
      fileFormat: "other",
      outputFormat: "mp3_44100_128",
      enableLogging: false,
    });
  });
});
