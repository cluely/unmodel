import { describe, expect, test } from "bun:test";
import {
  sttWebsocket,
  sttWebsocketUrl,
  STT_WEBSOCKET_URL,
  STT_WEBSOCKET_MODEL_IDS,
  STT_WEBSOCKET_KEYTERM_MAX,
  STT_WEBSOCKET_KEYTERM_TOTAL_CHARACTERS_MAX,
} from "./stt-websocket";
import { CARTESIA_VERSION } from "./tts";
import { stt } from "./stt";
import { UnmodelValidationError } from "../../core/issues";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = sttWebsocket.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

const BASE = { model: "ink-2" as const, encoding: "pcm_s16le" as const, sample_rate: 16000 };

describe("cartesia.sttWebsocket happy path", () => {
  test("returns the validated session config and builds the socket url", () => {
    const session = sttWebsocket({ ...BASE, keyterm: ["Cartesia", "Ink 2"] });
    expect(session).toEqual({ ...BASE, keyterm: ["Cartesia", "Ink 2"] });

    const url = sttWebsocketUrl(session);
    expect(url.startsWith(`${STT_WEBSOCKET_URL}?`)).toBe(true);
    const query = new URL(url.replace("wss://", "https://")).searchParams;
    expect(query.get("model")).toBe("ink-2");
    expect(query.get("encoding")).toBe("pcm_s16le");
    expect(query.get("sample_rate")).toBe("16000");
    // cartesia_version is a QUERY param here, not the REST `Cartesia-Version` header.
    expect(query.get("cartesia_version")).toBe(CARTESIA_VERSION);
    // keyterm is a repeated param; multi-word phrases keep their space encoded.
    expect(query.getAll("keyterm")).toEqual(["Cartesia", "Ink 2"]);
    expect(url).toContain("keyterm=Ink+2");
    // Auth is never serialized by unmodel.
    expect(query.get("access_token")).toBeNull();
  });

  test("a single string keyterm rides as one repeated param; the version is overridable", () => {
    const url = sttWebsocketUrl(sttWebsocket({ ...BASE, keyterm: "Cartesia" }), "2025-04-16");
    const query = new URL(url.replace("wss://", "https://")).searchParams;
    expect(query.getAll("keyterm")).toEqual(["Cartesia"]);
    expect(query.get("cartesia_version")).toBe("2025-04-16");
  });

  test("both published model ids validate clean with their own knobs", () => {
    expect(STT_WEBSOCKET_MODEL_IDS).toEqual(["ink-2", "ink-whisper"]);
    const ink2 = sttWebsocket.safe({ ...BASE, keyterm: ["Cartesia"] });
    expect(ink2.ok).toBe(true);
    if (ink2.ok) expect(ink2.warnings).toEqual([]);
    const whisper = sttWebsocket.safe({
      ...BASE,
      model: "ink-whisper",
      min_volume: 0.2,
      max_silence_duration_secs: 2,
    });
    expect(whisper.ok).toBe(true);
    if (whisper.ok) expect(whisper.warnings).toEqual([]);
  });

  test("ink-2 is realtime-only: the batch validator rejects it, this one accepts it", () => {
    const batch = (stt.safe as unknown as (params: unknown) => ValidateResult<unknown>)({
      file: new Blob(["x"]),
      model: "ink-2",
    });
    expect(batch.ok).toBe(false);
    expect(sttWebsocket.safe({ ...BASE, model: "ink-2" }).ok).toBe(true);
    // ink-whisper is documented on BOTH surfaces.
    expect(sttWebsocket.safe({ ...BASE, model: "ink-whisper" }).ok).toBe(true);
  });

  test("no costUSD is estimated — Cartesia publishes no USD rate (credits only)", () => {
    const r = sttWebsocket.safe(BASE, { maxCostUSD: 0.000001 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("an unknown model warns; an unknown top-level key warns", () => {
    const r = safeUnchecked({ ...BASE, model: "ink-3", brand_new_param: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const codes = r.warnings.map((w) => w.code);
      expect(codes).toContain("unknown_model");
      expect(codes).toContain("unknown_param");
    }
  });
});

describe("cartesia.sttWebsocket schema enforcement", () => {
  test("model, encoding and sample_rate are required", () => {
    for (const key of ["model", "encoding", "sample_rate"] as const) {
      const params: Record<string, unknown> = { ...BASE };
      delete params[key];
      const r = safeUnchecked(params);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]?.path).toEqual([key]);
    }
  });

  test("encoding is the documented six-value PCM enum", () => {
    for (const encoding of [
      "pcm_s16le",
      "pcm_s32le",
      "pcm_f16le",
      "pcm_f32le",
      "pcm_mulaw",
      "pcm_alaw",
    ]) {
      expect(sttWebsocket.safe({ ...BASE, encoding: encoding as "pcm_s16le" }).ok).toBe(true);
    }
    const r = safeUnchecked({ ...BASE, encoding: "mp3" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["encoding"]);
  });

  test("sample_rate must be a positive integer", () => {
    for (const bad of [0, -16000, 16000.5]) {
      const r = safeUnchecked({ ...BASE, sample_rate: bad });
      expect(r.ok).toBe(false);
    }
  });

  test("min_volume is bounded 0.0-1.0", () => {
    expect(sttWebsocket.safe({ ...BASE, model: "ink-whisper", min_volume: 0 }).ok).toBe(true);
    expect(sttWebsocket.safe({ ...BASE, model: "ink-whisper", min_volume: 1 }).ok).toBe(true);
    const r = safeUnchecked({ model: "ink-whisper", encoding: "pcm_s16le", sample_rate: 16000, min_volume: 1.1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["min_volume"]);
  });

  test("keyterms are capped at 100 by count", () => {
    const hundred = Array.from({ length: STT_WEBSOCKET_KEYTERM_MAX }, (_, i) => `t${i}`);
    expect(sttWebsocket.safe({ ...BASE, keyterm: hundred }).ok).toBe(true);
    const r = safeUnchecked({ ...BASE, keyterm: [...hundred, "one-too-many"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["keyterm"]);
  });

  test("the throwing form throws UnmodelValidationError", () => {
    const unchecked = sttWebsocket as unknown as (params: unknown) => unknown;
    let caught: unknown;
    try {
      unchecked({ ...BASE, encoding: "opus" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
  });
});

describe("cartesia.sttWebsocket checks and constraints", () => {
  test("a Sonic (TTS) model on the STT socket is unsupported_capability", () => {
    const r = safeUnchecked({ ...BASE, model: "sonic-3.5" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.path).toEqual(["model"]);
      expect(r.errors[0]?.meta?.allowed).toEqual([...STT_WEBSOCKET_MODEL_IDS]);
    }
  });

  test("language is the single-value enum this socket publishes", () => {
    expect(sttWebsocket.safe({ ...BASE, language: "en" }).ok).toBe(true);
    const r = safeUnchecked({ ...BASE, language: "es" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["language"]);
      expect(issue?.meta?.allowed).toEqual(["en"]);
    }
  });

  test("keyterms totaling over 1200 characters are invalid_shape", () => {
    const terms = Array.from({ length: 20 }, () => "a".repeat(61)); // 1220 chars
    const r = safeUnchecked({ ...BASE, keyterm: terms });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_shape");
      expect(issue?.path).toEqual(["keyterm"]);
      expect(issue?.meta?.limit).toBe(STT_WEBSOCKET_KEYTERM_TOTAL_CHARACTERS_MAX);
    }
    const justUnder = Array.from({ length: 20 }, () => "a".repeat(60)); // 1200 chars
    expect(sttWebsocket.safe({ ...BASE, keyterm: justUnder }).ok).toBe(true);
  });

  test("the per-model knobs are inverted and reported as ignored, not fatal", () => {
    const onInk2 = sttWebsocket.safe({ ...BASE, min_volume: 0.2, max_silence_duration_secs: 2 });
    expect(onInk2.ok).toBe(true);
    if (onInk2.ok) {
      expect(onInk2.warnings.map((w) => w.path?.[0]).sort()).toEqual([
        "max_silence_duration_secs",
        "min_volume",
      ]);
      expect(onInk2.warnings.every((w) => w.code === "unsupported_param")).toBe(true);
      expect(String(onInk2.warnings[0]?.message)).toContain("silently ignored");
    }

    const onWhisper = sttWebsocket.safe({ ...BASE, model: "ink-whisper", keyterm: "Cartesia" });
    expect(onWhisper.ok).toBe(true);
    if (onWhisper.ok) {
      const issue = onWhisper.warnings.find((w) => w.code === "unsupported_param");
      expect(issue?.path).toEqual(["keyterm"]);
      expect(String(issue?.message)).toContain("`ink-2` models only");
    }
  });

  test("constraintsFor exposes both sides of the inversion", () => {
    expect(sttWebsocket.constraintsFor("ink-2")[0]?.deny?.min_volume?.ignored).toBe(true);
    expect(sttWebsocket.constraintsFor("ink-whisper")[0]?.deny?.keyterm?.reason).toContain(
      "`ink-2` models only",
    );
  });
});
