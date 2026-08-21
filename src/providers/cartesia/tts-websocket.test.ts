import { describe, expect, test } from "bun:test";
import {
  ttsWebsocket,
  ttsWebsocketUrl,
  TTS_WEBSOCKET_URL,
  TTS_WEBSOCKET_MAX_BUFFER_DELAY_MS_DEFAULT,
  TTS_WEBSOCKET_MAX_BUFFER_DELAY_MS_MAX,
} from "./tts-websocket";
import { CARTESIA_EMOTIONS, CARTESIA_TTS_LANGUAGES, CARTESIA_VERSION } from "./tts";
import { TTS_MODEL_IDS } from "./models";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = ttsWebsocket.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const VOICE = { mode: "id", id: "a0e99841-438c-4a64-b679-ae501e7d6091" } as const;
const OUTPUT = { container: "raw", encoding: "pcm_s16le", sample_rate: 8000 } as const;
const BASE = {
  model_id: "sonic-3.5" as const,
  transcript: "Hello, world! ",
  voice: VOICE,
  output_format: OUTPUT,
  context_id: "ab977222-f9e0-4563-a1c0-5a934ae8fdd6",
};

describe("cartesia.ttsWebsocket happy path", () => {
  test("the validated object IS the socket message", () => {
    const params = { ...BASE, language: "en" as const, continue: true, add_timestamps: true };
    const message = ttsWebsocket(params);
    expect(Object.keys(message)).toEqual([
      "model_id",
      "transcript",
      "voice",
      "output_format",
      "context_id",
      "language",
      "continue",
      "add_timestamps",
    ]);
    expect(JSON.parse(JSON.stringify(message))).toEqual(params);
  });

  test("the socket url carries cartesia_version as a QUERY param (not a header)", () => {
    expect(ttsWebsocketUrl()).toBe(`${TTS_WEBSOCKET_URL}?cartesia_version=${CARTESIA_VERSION}`);
    expect(ttsWebsocketUrl("2025-04-16")).toBe(`${TTS_WEBSOCKET_URL}?cartesia_version=2025-04-16`);
  });

  test("every id in the published model_id enum validates clean", () => {
    for (const id of TTS_MODEL_IDS) {
      const r = ttsWebsocket.safe({ ...BASE, model_id: id });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
    }
  });

  test("continuation and flush messages pass, including an empty final transcript", () => {
    expect(ttsWebsocket.safe({ ...BASE, transcript: "", continue: false }).ok).toBe(true);
    expect(ttsWebsocket.safe({ ...BASE, flush: true }).ok).toBe(true);
    expect(ttsWebsocket.safe({ ...BASE, max_buffer_delay_ms: 0 }).ok).toBe(true);
    expect(
      ttsWebsocket.safe({ ...BASE, max_buffer_delay_ms: TTS_WEBSOCKET_MAX_BUFFER_DELAY_MS_MAX }).ok,
    ).toBe(true);
    expect(TTS_WEBSOCKET_MAX_BUFFER_DELAY_MS_DEFAULT).toBe(3000);
  });

  test("no costUSD is estimated — Cartesia publishes no USD rate (credits only)", () => {
    const r = ttsWebsocket.safe(
      { ...BASE, transcript: "a".repeat(10_000) },
      { maxCostUSD: 0.000001 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("an unknown model warns; an unknown top-level key warns", () => {
    const r = safeUnchecked({ ...BASE, model_id: "sonic-99", brand_new_param: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const codes = r.warnings.map((w) => w.code);
      expect(codes).toContain("unknown_model");
      expect(codes).toContain("unknown_param");
    }
  });
});

describe("cartesia.ttsWebsocket schema enforcement", () => {
  test("context_id is required on the socket", () => {
    const { context_id, ...withoutContext } = BASE;
    void context_id;
    const missing = safeUnchecked(withoutContext);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]?.path).toEqual(["context_id"]);
    const empty = safeUnchecked({ ...BASE, context_id: "" });
    expect(empty.ok).toBe(false);
  });

  test("output_format is raw-only with encoding and sample_rate both required", () => {
    const wav = safeUnchecked({ ...BASE, output_format: { container: "wav" } });
    expect(wav.ok).toBe(false);
    if (!wav.ok) expect(wav.errors[0]?.path).toEqual(["output_format", "container"]);

    const mp3 = safeUnchecked({
      ...BASE,
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
    });
    expect(mp3.ok).toBe(false);

    const noEncoding = safeUnchecked({
      ...BASE,
      output_format: { container: "raw", sample_rate: 44100 },
    });
    expect(noEncoding.ok).toBe(false);
    if (!noEncoding.ok) expect(noEncoding.errors[0]?.path).toEqual(["output_format", "encoding"]);

    const undocumentedRate = safeUnchecked({
      ...BASE,
      output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 11025 },
    });
    expect(undocumentedRate.ok).toBe(false);
  });

  test("max_buffer_delay_ms is bounded [0, 5000] and integral", () => {
    for (const bad of [-1, 5001, 100.5]) {
      const r = safeUnchecked({ ...BASE, max_buffer_delay_ms: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.path).toEqual(["max_buffer_delay_ms"]);
    }
  });

  test("generation_config ranges match the REST endpoint's", () => {
    expect(
      ttsWebsocket.safe({ ...BASE, generation_config: { volume: 2, speed: 0.6, emotion: "calm" } }).ok,
    ).toBe(true);
    const volume = safeUnchecked({ ...BASE, generation_config: { volume: 2.1 } });
    expect(volume.ok).toBe(false);
    const speed = safeUnchecked({ ...BASE, generation_config: { speed: 1.6 } });
    expect(speed.ok).toBe(false);
  });

  test("voice must use mode 'id'; the deprecated top-level speed keeps its enum", () => {
    const voice = safeUnchecked({ ...BASE, voice: { mode: "embedding", embedding: [0.1] } });
    expect(voice.ok).toBe(false);
    expect(ttsWebsocket.safe({ ...BASE, speed: "fast" }).ok).toBe(true);
    expect(safeUnchecked({ ...BASE, speed: "faster" }).ok).toBe(false);
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const unchecked = ttsWebsocket as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      unchecked({ ...BASE, output_format: { container: "flac" } });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("cartesia.ttsWebsocket checks", () => {
  test("an Ink (STT) model on the TTS socket is unsupported_capability", () => {
    for (const id of ["ink-whisper", "ink-2"]) {
      const r = safeUnchecked({ ...BASE, model_id: id });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors[0]?.code).toBe("unsupported_capability");
        expect(r.errors[0]?.path).toEqual(["model_id"]);
        expect(String(r.errors[0]?.message)).toContain("/stt/websocket");
      }
    }
  });

  test("a cataloged sonic id outside the published enum warns (not an error)", () => {
    const r = ttsWebsocket.safe({ ...BASE, model_id: "sonic-3.5-2026-05-04" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const issue = r.warnings.find((w) => w.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["model_id"]);
      expect(issue?.meta?.allowed).toEqual([...TTS_MODEL_IDS]);
    }
  });

  test("emotion accepts the complete 58-label list, not just the primaries", () => {
    expect(CARTESIA_EMOTIONS).toHaveLength(58);
    // `as const`, not a cast: the array is now a compile-time membership
    // contract — a label that leaves the 58-value enum fails to typecheck here.
    for (const emotion of ["neutral", "nostalgic", "determined"] as const) {
      expect(ttsWebsocket.safe({ ...BASE, generation_config: { emotion } }).ok).toBe(true);
    }
    const r = safeUnchecked({ ...BASE, generation_config: { emotion: "hangry" } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["generation_config", "emotion"]);
      expect(String(issue?.meta?.source)).toContain("docs.cartesia.ai");
    }
  });

  test("language is the same 42-code enum as POST /tts/bytes", () => {
    expect(CARTESIA_TTS_LANGUAGES).toHaveLength(42);
    // Ditto: these three codes are asserted to be members at compile time.
    for (const language of ["en", "ja", "pa"] as const) {
      expect(ttsWebsocket.safe({ ...BASE, language }).ok).toBe(true);
    }
    const r = safeUnchecked({ ...BASE, language: "xx" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "invalid_enum_value")).toBe(true);
  });

  test("the shared pronunciation-dictionary constraint applies to the socket", () => {
    expect(ttsWebsocket.safe({ ...BASE, pronunciation_dict_id: "dict_123" }).ok).toBe(true);
    const r = safeUnchecked({ ...BASE, model_id: "sonic-2", pronunciation_dict_id: "dict_123" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["pronunciation_dict_id"]);
      expect(String(issue?.message)).toContain("sonic-3 models and newer");
    }
    expect(ttsWebsocket.constraintsFor("sonic-turbo")[0]?.deny?.pronunciation_dict_id).toBeDefined();
  });
});
