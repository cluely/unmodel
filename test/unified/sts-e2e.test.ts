/**
 * `unmodel/sts`, end to end through the ready-made pack.
 *
 * The golden matrix next door pins *what* each ref compiles to; this pins what
 * a caller gets back — each provider's own `Validated`, its `.request`, its
 * `.toSdk`, its estimate — plus the three things this category has that its
 * siblings do not:
 *
 * 1. a canonical word that lands in the URL at one provider and in the body at
 *    the other;
 * 2. a required `Blob`, which is what makes the whole category library-only;
 * 3. a required `voice` at this surface that the wire below deliberately leaves
 *    optional — the two-layer architecture visible in one pair of assertions.
 */
import { describe, expect, test } from "bun:test";
import { TranslationUnavailableError } from "../../src/core/translate/errors";
import { sts as elevenlabsSts, SPEECH_TO_SPEECH_BASE_URL } from "../../src/providers/elevenlabs";
import { sts as humeSts, VOICE_CONVERSION_URL } from "../../src/providers/hume";
import { createSts, sts } from "../../src/unified/sts";
import { sts as elevenlabsAdapter } from "../../src/providers/elevenlabs/unified-sts";
import { sts as humeAdapter } from "../../src/providers/hume/unified-sts";
import { MULTIPART_ONLY, UNIFIED } from "../../src/cli-registry";

const EL = "elevenlabs/eleven_multilingual_sts_v2";
const EL_EN = "elevenlabs/eleven_english_sts_v2";
const HUME = "hume/voice-conversion";

const CLIP = new Blob([new Uint8Array(64)], { type: "audio/wav" });
const audio = (): { file: Blob } => ({ file: CLIP });
const VOICE = "21m00Tcm4TlvDq8ikWAM";

/** The translation warnings a compile produced, which ride on the params. */
function translationWarnings(params: object): readonly { code: string; path: unknown }[] {
  return (params as { warnings: readonly { code: string; path: unknown }[] }).warnings;
}

describe("the pack", () => {
  test("registers exactly the two voice-conversion providers", () => {
    expect([...sts.providers]).toEqual(["elevenlabs", "hume"]);
  });

  test("a provider outside the pack is structural, not a validation error", () => {
    // Cartesia's route was sunset and Resemble's is an SSML mode of its TTS
    // wire — both recorded, neither reachable. See sts-capabilities.test.ts.
    expect(() =>
      sts({ model: "cartesia/voice-changer", audio: audio(), voice: VOICE } as never),
    ).toThrow(TranslationUnavailableError);
  });

  test("`createSts` builds a narrower pack from the adapters you name", () => {
    const elevenlabsOnly = createSts([elevenlabsAdapter]);
    expect([...elevenlabsOnly.providers]).toEqual(["elevenlabs"]);
    expect(() => elevenlabsOnly({ model: HUME, audio: audio(), voice: VOICE } as never)).toThrow(
      TranslationUnavailableError,
    );

    const humeOnly = createSts([humeAdapter]);
    expect([...humeOnly.providers]).toEqual(["hume"]);
  });
});

describe("elevenlabs — the voice is a URL path segment", () => {
  test("the compile puts the voice in the URL and the recording in the body", () => {
    const result = sts({ model: EL, audio: audio(), voice: VOICE });
    expect(Object.keys(result)).toEqual(["audio", "model_id"]);
    expect(result.request.url).toBe(`${SPEECH_TO_SPEECH_BASE_URL}/${VOICE}`);
    expect(result.request.method).toBe("POST");
    // Multipart: fetch derives the boundary from the FormData body.
    expect(result.request.headers).toEqual({});
    expect(translationWarnings(result)).toEqual([]);
  });

  test("the result is the provider's own Validated, `.toSdk` included", () => {
    const result = sts({ model: EL, audio: audio(), voice: VOICE });
    expect(result.toSdk("elevenlabs")).toEqual({
      audio: CLIP,
      modelId: "eleven_multilingual_sts_v2",
    });
  });

  test("`{ name }` is refused naming the id — a per-account catalog, not a name space", () => {
    const result = sts.safe({ model: EL, audio: audio(), voice: { name: "Rachel" } } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.path).toEqual(["voice"]);
    expect(result.errors[0]?.message).toContain("voice id");
  });

  test("the encoding becomes a query composite, and the shorthand says what it assumed", () => {
    const result = sts({ model: EL, audio: audio(), voice: VOICE, outputFormat: "mp3" });
    expect(result.request.url).toContain("?output_format=mp3_44100_128");
    // A bare codec cannot fill a `codec_rate_bitrate` composite on its own, so
    // the two defaults it borrowed are named rather than assumed silently.
    expect(translationWarnings(result).map((w) => w.code)).toEqual([
      "approximated_param",
      "approximated_param",
    ]);
  });

  test("a fully pinned encoding is lossless", () => {
    const result = sts({
      model: EL_EN,
      audio: audio(),
      voice: VOICE,
      outputFormat: { format: "mp3", sampleRate: 44100, bitrate: 128000 },
    });
    expect(result.request.url).toContain("?output_format=mp3_44100_128");
    expect(translationWarnings(result)).toEqual([]);
  });

  test("the cost estimate rides on a declared duration, at $0.12 the minute", () => {
    const result = sts.safe({ model: EL, audio: audio(), voice: VOICE } as never, {
      media: [{ path: ["audio"], durationSeconds: 300 }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.estimate.costUSD).toBeCloseTo(0.6, 10);
  });

  test("the deprecated v1 row still compiles, and says so", () => {
    const result = sts.safe({
      model: "elevenlabs/eleven_english_sts_v1",
      audio: audio(),
      voice: VOICE,
    } as never);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.map((w) => w.code)).toContain("deprecated_model");
  });

  test("a text-to-speech id is not in this category's ref union at run time either", () => {
    const result = sts.safe({
      model: "elevenlabs/eleven_multilingual_v2",
      audio: audio(),
      voice: VOICE,
    } as never);
    expect(result.ok).toBe(false);
  });
});

describe("hume — the voice is a form part, and there is no model field", () => {
  test("the compile puts everything in the body and nothing in the URL", () => {
    const result = sts({ model: HUME, audio: audio(), voice: VOICE });
    expect(Object.keys(result)).toEqual(["audio", "voice"]);
    expect(result.request.url).toBe(VOICE_CONVERSION_URL);
    expect(result.request.headers).toEqual({});
    // The synthetic catalog id is unmodel's, and never reaches the wire.
    expect(Object.keys(result)).not.toContain("model");
    expect(Object.keys(result)).not.toContain("version");
  });

  test("both voice spellings reach the wire unchanged", () => {
    expect(sts({ model: HUME, audio: audio(), voice: { id: "abc" } }).voice).toEqual({ id: "abc" });
    expect(sts({ model: HUME, audio: audio(), voice: { name: "Inspiring Man" } }).voice).toEqual({
      name: "Inspiring Man",
    });
    // A bare string is read as an id — `accepts[0]`.
    expect(sts({ model: HUME, audio: audio(), voice: "abc" }).voice).toEqual({ id: "abc" });
  });

  test("the encoding is a container name, so a sample rate is refused rather than dropped", () => {
    const ok = sts({ model: HUME, audio: audio(), voice: VOICE, outputFormat: "mp3" });
    expect(ok.format).toEqual({ type: "mp3" });
    expect(translationWarnings(ok)).toEqual([]);

    const refused = sts.safe({
      model: HUME,
      audio: audio(),
      voice: VOICE,
      outputFormat: { format: "mp3", sampleRate: 24000 },
    } as never);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.errors[0]?.code).toBe("unsupported_param");
      expect(refused.errors[0]?.path).toEqual(["outputFormat"]);
    }
  });

  test("there is no estimate, because Hume publishes no rate for this route", () => {
    const result = sts.safe({ model: HUME, audio: audio(), voice: VOICE } as never, {
      media: [{ path: ["audio"], durationSeconds: 300 }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.estimate.costUSD).toBeUndefined();
  });

  test("the result is the provider's own Validated, `.toSdk` included", () => {
    const result = sts({ model: HUME, audio: audio(), voice: { name: "Inspiring Man" } });
    expect(result.toSdk("hume")).toEqual({ audio: CLIP, voice: { name: "Inspiring Man" } });
  });
});

describe("the two layers, in one pair of assertions", () => {
  /**
   * The unified surface REQUIRES a target voice; Hume's wire marks it optional
   * and documents no default. Both are true at once, which is the whole point
   * of `docs/decisions.md` §1: the substrate keeps the request expressible, the
   * unified layer states what the operation means.
   */
  test("`voice` is required here and optional at `hume.sts`", () => {
    const unified = sts.safe({ model: HUME, audio: audio() } as never);
    expect(unified.ok).toBe(false);
    if (!unified.ok) expect(unified.errors[0]?.path).toEqual(["voice"]);

    const wire = humeSts.safe({ audio: CLIP });
    expect(wire.ok).toBe(true);
  });

  test("`elevenlabs.sts` is reachable wire-exactly by name, path param and all", () => {
    const wire = elevenlabsSts({ voice_id: VOICE, audio: CLIP, enable_logging: false });
    expect(wire.request.url).toBe(
      `${SPEECH_TO_SPEECH_BASE_URL}/${VOICE}?enable_logging=false`,
    );
  });
});

describe("the category is library-only, by design", () => {
  test("both endpoints are MULTIPART_ONLY and the pack has no CLI entry", () => {
    // `audio` is a required binary form part at both witnesses with no
    // reference alternative, so no JSON params document can express a request.
    expect(MULTIPART_ONLY["elevenlabs.sts"]).toBe("unmodel/elevenlabs");
    expect(MULTIPART_ONLY["hume.sts"]).toBe("unmodel/hume");
    expect(Object.keys(UNIFIED)).not.toContain("unified.sts");
  });

  test("a canonical `audio` that is not a Blob is refused, not coerced", () => {
    for (const bad of [{ url: "https://example.com/clip.wav" }, { data: "AAAA" }, CLIP]) {
      const result = sts.safe({ model: EL, audio: bad, voice: VOICE } as never);
      expect(result.ok).toBe(false);
    }
  });
});

describe("the envelope", () => {
  test("a word from the neighbouring TTS vocabulary is an unsupported_param", () => {
    const result = sts.safe({ model: EL, audio: audio(), voice: VOICE, text: "hi" } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("unsupported_param");
      expect(result.errors[0]?.path).toEqual(["text"]);
      expect(result.errors[0]?.message).toContain("unmodel/sts");
    }
  });

  test("providerOptions reaches each vendor's own validator", () => {
    const result = sts({
      model: EL,
      audio: audio(),
      voice: VOICE,
      providerOptions: { elevenlabs: { seed: 42 } },
    });
    expect(result.seed).toBe(42);

    const refused = sts.safe({
      model: EL,
      audio: audio(),
      voice: VOICE,
      providerOptions: { elevenlabs: { seed: -1 } },
    } as never);
    expect(refused.ok).toBe(false);
  });

  test("a providerOptions key naming a provider outside the pack is called out", () => {
    // A warning rather than an error, uniformly across the packs: the block is
    // inert here, and a caller sharing one params object across categories
    // should not have a working request refused for it.
    const result = sts.safe({
      model: EL,
      audio: audio(),
      voice: VOICE,
      providerOptions: { cartesia: { voice: { id: "x" } } },
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const unknown = result.warnings.find((w) => w.code === "unknown_param");
    expect(unknown?.path).toEqual(["providerOptions", "cartesia"]);
    expect(unknown?.message).toContain("unmodel/sts");
  });
});
