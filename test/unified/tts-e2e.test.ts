/**
 * `unmodel/tts`, end to end through the ready-made pack.
 *
 * The golden matrix next door pins *what* each provider compiles to; this pins
 * what a caller gets back — that the result is the provider's own `Validated`,
 * with its `.request`, its `.toSdk(...)` and its estimate intact, and that the
 * two escape hatches behave: `providerOptions` merging before validation, and
 * a bound the adapter deliberately did not copy surfacing as the provider's
 * own finding at the canonical path.
 */
import { describe, expect, test } from "bun:test";
import { UnmodelValidationError } from "../../src/core/issues";
import { TranslationUnavailableError } from "../../src/core/translate/errors";
import { tts } from "../../src/unified/tts";

describe("the pack", () => {
  test("registers exactly the fourteen speech providers, sorted", () => {
    expect([...tts.providers]).toEqual([
      "cartesia",
      "deepgram",
      "elevenlabs",
      "fish-audio",
      "hume",
      "inworld",
      "lmnt",
      "minimax",
      "murf",
      "openai",
      "resemble",
      "rime",
      "smallest-ai",
      "speechify",
    ]);
  });

  test("a provider outside the pack is structural, not a validation error", () => {
    expect(() =>
      tts({ model: "sarvam/bulbul-v2", text: "hi" } as never),
    ).toThrow(TranslationUnavailableError);
    const result = tts.safe({ model: "sarvam/bulbul-v2", text: "hi" } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.meta).toMatchObject({ structural: true, provider: "sarvam" });
  });

  test("a model the adapter does not list warns but still compiles", () => {
    const result = tts.safe({
      model: "openai/tts-3-turbo",
      text: "hi",
      voice: "alloy",
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Twice, and correctly so: the kernel checks the ref against the adapter's
    // `models` list, and the provider's own catalog layer checks it again.
    // Neither can stand in for the other — the adapter list is what drives the
    // ref union, the catalog is what drives the limits and the pricing.
    expect(result.warnings.map((issue) => issue.code)).toEqual([
      "unknown_model",
      "unknown_model",
    ]);
    expect((result.params as unknown as { model: string }).model).toBe("tts-3-turbo");
  });
});

describe("the result is the provider's own Validated", () => {
  test("openai: JSON body, request line and toSdk", () => {
    const params = tts({
      model: "openai/gpt-4o-mini-tts",
      text: "The lamp is lit.",
      voice: "marin",
      outputFormat: "opus",
      speed: 1.25,
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      model: "gpt-4o-mini-tts",
      input: "The lamp is lit.",
      voice: "marin",
      response_format: "opus",
      speed: 1.25,
    });
    expect(params.request).toEqual({
      url: "https://api.openai.com/v1/audio/speech",
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(params.toSdk("openai")).toEqual(JSON.parse(JSON.stringify(params)) as never);
    expect(params.warnings).toEqual([]);
  });

  test("elevenlabs: the voice and the format leave the body for the URL", () => {
    const params = tts({
      model: "elevenlabs/eleven_flash_v2_5",
      text: "The lamp is lit.",
      voice: { id: "JBFqnCBsd6RMkjVDRZzb" },
      outputFormat: { format: "mp3", sampleRate: 44100, bitrate: 128000 },
    });
    // `voice_id` is a path param and `output_format` a query param — neither is
    // in the JSON body, which is the regression this endpoint's cast exists for.
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      text: "The lamp is lit.",
      model_id: "eleven_flash_v2_5",
    });
    expect(params.request.url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128",
    );
    const sdk = params.toSdk("elevenlabs");
    expect(sdk.voiceId).toBe("JBFqnCBsd6RMkjVDRZzb");
    expect(sdk.request).toMatchObject({ modelId: "eleven_flash_v2_5", outputFormat: "mp3_44100_128" });
  });

  test("deepgram: the body is `{text}` and everything else is the query string", () => {
    const params = tts({
      model: "deepgram/aura-2-thalia-en",
      text: "The lamp is lit.",
      outputFormat: { format: "pcm_s16le", container: "raw", sampleRate: 24000 },
      speed: 1.2,
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({ text: "The lamp is lit." });
    const url = new URL(params.request.url);
    expect(url.origin + url.pathname).toBe("https://api.deepgram.com/v1/speak");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      model: "aura-2-thalia-en",
      encoding: "linear16",
      container: "none",
      sample_rate: "24000",
      speed: "1.2",
    });
    // `.toSdk("deepgram")` is the options object of `speak.request({text}, options)`.
    expect(params.toSdk("deepgram")).toMatchObject({ model: "aura-2-thalia-en", speed: 1.2 });
  });

  test("the estimate rides through from the provider's own pricing", () => {
    const result = tts.safe({
      model: "openai/tts-1",
      text: "x".repeat(1000),
      voice: "alloy",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate.costUSD).toBeGreaterThan(0);
  });
});

describe("providerOptions", () => {
  test("deep-merges over the compiled body before validation", () => {
    const params = tts({
      model: "minimax/speech-2.8-hd",
      text: "The lamp is lit.",
      voice: "English_Graceful_Lady",
      speed: 1.2,
      providerOptions: {
        // A nested override merges key-by-key: `voice_id` and `speed` survive.
        minimax: { voice_setting: { vol: 2, emotion: "calm" }, subtitle_enable: true },
      },
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      model: "speech-2.8-hd",
      text: "The lamp is lit.",
      voice_setting: { voice_id: "English_Graceful_Lady", speed: 1.2, vol: 2, emotion: "calm" },
      subtitle_enable: true,
    });
  });

  test("an override wins over the compiled value, and is validated like it", () => {
    const params = tts({
      model: "openai/gpt-4o-mini-tts",
      text: "The lamp is lit.",
      voice: "marin",
      outputFormat: "mp3",
      providerOptions: { openai: { response_format: "flac", instructions: "Speak briskly." } },
    });
    expect(JSON.parse(JSON.stringify(params))).toMatchObject({
      response_format: "flac",
      instructions: "Speak briskly.",
    });
  });

  test("an explicit undefined unsets what the adapter emitted", () => {
    const params = tts({
      model: "smallest-ai/lightning_v3.1_pro",
      text: "The lamp is lit.",
      voice: "meher",
      outputFormat: { format: "mp3", sampleRate: 24000 },
      providerOptions: { "smallest-ai": { sample_rate: undefined } },
    });
    expect(Object.hasOwn(params, "sample_rate")).toBe(false);
    expect(JSON.parse(JSON.stringify(params))).toMatchObject({ output_format: "mp3" });
  });

  test("a block for another provider is ignored", () => {
    const params = tts({
      model: "openai/tts-1",
      text: "The lamp is lit.",
      voice: "alloy",
      providerOptions: { cartesia: { language: "fr" } },
    });
    expect(Object.hasOwn(params, "language")).toBe(false);
  });

  test("an override the provider rejects says where it came from", () => {
    const result = tts.safe({
      model: "openai/tts-1",
      text: "The lamp is lit.",
      voice: "alloy",
      providerOptions: { openai: { speed: 9 } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["speed"]);
    expect(result.errors[0]!.message).toEndWith("(supplied via `providerOptions`)");
  });
});

describe("bounds the adapter did not copy surface as the provider's own finding", () => {
  /**
   * The point of these two: a bound that exists in a provider's validator is
   * NOT restated in its adapter, so there is exactly one copy of it. What the
   * adapter owes the caller is the *path* — the finding has to arrive at the
   * canonical field, not at a wire param they never wrote.
   */
  test("speed: ElevenLabs' 0.7–1.2 range, reported at `speed`", () => {
    const result = tts.safe({
      model: "elevenlabs/eleven_flash_v2_5",
      text: "The lamp is lit.",
      voice: "JBFqnCBsd6RMkjVDRZzb",
      speed: 1.5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: "invalid_shape",
      path: ["speed"],
      meta: { min: 0.7, max: 1.2, value: 1.5 },
    });
    // The wire name is quoted, so the bug report writes itself.
    expect(result.errors[0]!.message).toContain("`voice_settings.speed` is 1.5");
    expect(result.errors[0]!.message).toEndWith("(compiled from `voice_settings.speed`)");
  });

  test("bitrate: Deepgram's opus range, reported at `outputFormat`", () => {
    const result = tts.safe({
      model: "deepgram/aura-2-thalia-en",
      text: "The lamp is lit.",
      outputFormat: { format: "opus", bitrate: 1_000_000 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      code: "invalid_shape",
      path: ["outputFormat"],
      meta: { min: 4000, max: 650000, encoding: "opus" },
    });
    expect(result.errors[0]!.message).toEndWith("(compiled from `bit_rate`)");
  });

  test("a half-specified composite is refused rather than half-sent", () => {
    // Speechify's `output_format` carries the rate and the bitrate together;
    // a bitrate with no rate cannot be spelled, and the container-only
    // `audio_format` cannot carry the bitrate. Dropping one of the two
    // silently is the failure mode this asserts against.
    const result = tts.safe({
      model: "speechify/simba-3.0",
      text: "The lamp is lit.",
      voice: "geffen_32",
      outputFormat: { format: "mp3", bitrate: 128_000 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ code: "invalid_shape", path: ["outputFormat"] });
    expect(result.errors[0]!.message).toContain("`outputFormat.sampleRate` is required");
  });

  test("a canonical-space failure stops before the provider validator runs", () => {
    const result = tts.safe({
      model: "openai/tts-1",
      text: "The lamp is lit.",
      voice: "alloy",
      outputFormat: { format: "mp3", bitrate: 128000 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((issue) => issue.code)).toEqual(["unsupported_param"]);
    expect(result.errors[0]!.path).toEqual(["outputFormat"]);
  });
});

describe("the throwing form", () => {
  test("throws UnmodelValidationError labelled with the category", () => {
    expect(() =>
      tts({ model: "lmnt/blizzard", text: "hi", voice: "leah", speed: 2 }),
    ).toThrow(UnmodelValidationError);
    try {
      tts({ model: "lmnt/blizzard", text: "hi", voice: "leah", speed: 2 });
    } catch (error) {
      expect((error as Error).message).toContain("unmodel/tts");
      expect((error as UnmodelValidationError).issues[0]!.path).toEqual(["speed"]);
    }
  });
});
