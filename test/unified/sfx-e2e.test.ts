/**
 * `unmodel/sfx`, end to end through the ready-made pack.
 *
 * The golden matrix next door pins *what* each ref compiles to; this pins what
 * a caller gets back — each provider's own `Validated`, its `.request`, its
 * `.toSdk`, its estimate — plus the two things this category has that its
 * siblings do not: a canonical field whose ABSENCE means something different at
 * every vendor, and an overlap where the aggregator's copy of a model is
 * strictly NARROWER than the vendor's own.
 */
import { describe, expect, test } from "bun:test";
import { TranslationUnavailableError } from "../../src/core/translate/errors";
import { sfx as falSfx } from "../../src/providers/fal";
import { sfx as elevenlabsSfx, SOUND_EFFECTS_URL } from "../../src/providers/elevenlabs";
import { createSfx, sfx } from "../../src/unified/sfx";
import { sfx as elevenlabsAdapter } from "../../src/providers/elevenlabs/unified-sfx";
import { sfx as falAdapter } from "../../src/providers/fal/unified-sfx";

const PROMPT = "a heavy oak door creaking open in a stone hall";

const EL = "elevenlabs/eleven_text_to_sound_v2";
const EL_VIA_FAL = "fal/fal-ai/elevenlabs/sound-effects/v2";
const CASSETTE = "fal/cassetteai/sound-effects-generator";
const SONILO = "fal/sonilo/v1.1/text-to-sound-effects";
const STABLE = "fal/fal-ai/stable-audio-3/small/sfx/text-to-audio";
const MIRELO = "fal/mirelo-ai/sfx1.6/text-to-audio";

/** The translation warnings a compile produced, which ride on the params. */
function translationWarnings(params: object): readonly { code: string; path: unknown }[] {
  return (params as { warnings: readonly { code: string; path: unknown }[] }).warnings;
}

describe("the pack", () => {
  test("registers exactly the two sound-effect providers", () => {
    expect([...sfx.providers]).toEqual(["elevenlabs", "fal"]);
  });

  test("a provider outside the pack is structural, not a validation error", () => {
    expect(() => sfx({ model: "stability/stable-audio-2", prompt: PROMPT } as never)).toThrow(
      TranslationUnavailableError,
    );
    const result = sfx.safe({ model: "stability/stable-audio-2", prompt: PROMPT } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.meta?.["structural"]).toBe(true);
    expect(result.errors[0]?.message).toContain("not a sfx provider in this build");
  });

  test("a model the adapter does not list warns but still compiles", () => {
    const result = sfx.safe({ model: "fal/sonilo/v2/text-to-sound-effects", prompt: PROMPT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((issue) => issue.code === "unknown_model")).toBe(true);
    // …and it still ROUTES, which is the half that matters: fal adds endpoints
    // weekly and a curated roster is a snapshot.
    const params = result.params as unknown as { request: { url: string } };
    expect(params.request.url).toBe("https://queue.fal.run/sonilo/v2/text-to-sound-effects");
    // With no row to read, the adapter sends the commonest spelling.
    expect(JSON.parse(JSON.stringify(result.params))).toMatchObject({ prompt: PROMPT });
  });

  test("the two adapters are the pack, and each can be built alone", () => {
    expect(elevenlabsAdapter.models).toHaveLength(1);
    expect(falAdapter.models).toHaveLength(6);
    expect([...createSfx([elevenlabsAdapter]).providers]).toEqual(["elevenlabs"]);
    expect([...createSfx([falAdapter]).providers]).toEqual(["fal"]);
  });

  test("a word from a neighbouring category is refused by name", () => {
    // `instrumental` and `seed` are `unmodel/music` words. Both would be
    // silently dropped by a compiler that did not check, which is exactly what
    // the canonical envelope exists to stop.
    for (const key of ["instrumental", "seed", "loop"]) {
      const result = sfx.safe({ model: SONILO, prompt: PROMPT, [key]: true } as never);
      expect(result.ok, key).toBe(false);
      if (result.ok) continue;
      expect(result.errors[0]?.code).toBe("unsupported_param");
      expect(result.errors[0]?.path).toEqual([key]);
    }
    // …and `loop` IS reachable at the one route that publishes it, as an extra.
    expect(sfx.safe({ model: EL, prompt: PROMPT, loop: true }).ok).toBe(true);
  });
});

describe("the result is the provider's own Validated", () => {
  test("elevenlabs: the body is the fetch payload and the format is in the URL", () => {
    const result = sfx.safe({ model: EL, prompt: PROMPT, outputFormat: "opus" });
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (!result.ok) return;
    const params = result.params as unknown as {
      request: { url: string; method: string; headers: Record<string, string> };
      toSdk: (target: "elevenlabs") => Record<string, unknown>;
    };
    expect(JSON.parse(JSON.stringify(result.params))).toEqual({
      text: PROMPT,
      model_id: "eleven_text_to_sound_v2",
    });
    expect(params.request.url).toBe(`${SOUND_EFFECTS_URL}?output_format=opus_48000_128`);
    expect(params.request.method).toBe("POST");
    expect(params.toSdk("elevenlabs")).toEqual({
      text: PROMPT,
      modelId: "eleven_text_to_sound_v2",
      outputFormat: "opus_48000_128",
    });
  });

  test("fal: the enumerable body IS the fetch payload, and the route is not in it", () => {
    const result = sfx.safe({ model: STABLE, prompt: PROMPT, durationSeconds: 12 });
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (!result.ok) return;
    const params = result.params as unknown as {
      request: { url: string };
      toSdk: (target: "fal") => { input: Record<string, unknown> };
    };
    expect(JSON.parse(JSON.stringify(result.params))).toEqual({ prompt: PROMPT, duration: 12 });
    expect(params.request.url).toBe(
      "https://queue.fal.run/fal-ai/stable-audio-3/small/sfx/text-to-audio",
    );
    expect(params.toSdk("fal")).toEqual({ input: { prompt: PROMPT, duration: 12 } });
  });

  test("each ends in the SAME validator its hand surface calls", () => {
    const viaUnified = sfx({ model: EL, prompt: PROMPT, durationSeconds: 4 });
    const viaHand = elevenlabsSfx({
      text: PROMPT,
      model_id: "eleven_text_to_sound_v2",
      duration_seconds: 4,
    });
    expect(JSON.parse(JSON.stringify(viaUnified))).toEqual(JSON.parse(JSON.stringify(viaHand)));

    const falUnified = sfx({ model: CASSETTE, prompt: PROMPT, durationSeconds: 3 });
    const falHand = falSfx({
      endpoint: "cassetteai/sound-effects-generator",
      prompt: PROMPT,
      duration: 3,
    });
    expect(JSON.parse(JSON.stringify(falUnified))).toEqual(JSON.parse(JSON.stringify(falHand)));
  });
});

describe("the absence of durationSeconds", () => {
  /**
   * The category's whole argument, exercised at all three answers. The adopter
   * request that produced `unmodel/sfx` proposed `durationSeconds?: number //
   * auto when absent`, which is true for two of these seven routes and an HTTP
   * 422 for one of them.
   */
  test("at ElevenLabs it means the model reads a length off the prompt — silently", () => {
    for (const ref of [EL, EL_VIA_FAL]) {
      const result = sfx.safe({ model: ref, prompt: PROMPT } as never);
      expect(result.ok, ref).toBe(true);
      if (!result.ok) continue;
      expect(translationWarnings(result.params), ref).toEqual([]);
      expect(Object.keys(result.params), ref).not.toContain("duration_seconds");
    }
  });

  test("at Sonilo, Mirelo and Stable Audio it means a NUMBER, and the warning names it", () => {
    const expected: ReadonlyArray<readonly [string, number]> = [
      [SONILO, 8],
      [MIRELO, 10],
      [STABLE, 30],
    ];
    for (const [ref, seconds] of expected) {
      const result = sfx.safe({ model: ref, prompt: PROMPT } as never);
      expect(result.ok, ref).toBe(true);
      if (!result.ok) continue;
      const warnings = translationWarnings(result.params) as ReadonlyArray<{
        code: string;
        path: unknown;
        message: string;
        meta?: Record<string, unknown>;
      }>;
      expect(warnings.map((w) => w.code), ref).toEqual(["approximated_param"]);
      expect(warnings[0]?.path, ref).toEqual(["durationSeconds"]);
      expect(warnings[0]?.meta?.["achieved"], ref).toBe(seconds);
      expect(warnings[0]?.message, ref).toContain(`${seconds} seconds`);
      // Never sent: pinning it would freeze a number the provider may change.
      expect(Object.keys(result.params), ref).not.toContain("duration");
    }
  });

  test("at CassetteAI it is a refusal, from the route's own required check", () => {
    const result = sfx.safe({ model: CASSETTE, prompt: PROMPT } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Remapped onto the canonical word, not left on the wire name the caller
    // never typed.
    expect(result.errors[0]?.path).toEqual(["durationSeconds"]);
    expect(result.errors[0]?.message).toContain("required");
    // …and the message still names the wire field it came from, so the caller
    // can find it in CassetteAI's own docs.
    expect(result.errors[0]?.message).toContain("`duration`");
    // …and stating one is all it takes.
    expect(sfx.safe({ model: CASSETTE, prompt: PROMPT, durationSeconds: 3 }).ok).toBe(true);
  });

  test("nothing ever compiles to a literal \"auto\"", () => {
    for (const ref of [EL, EL_VIA_FAL, SONILO, MIRELO, STABLE]) {
      const result = sfx.safe({ model: ref, prompt: PROMPT } as never);
      expect(result.ok, ref).toBe(true);
      if (!result.ok) continue;
      expect(JSON.stringify(result.params), ref).not.toContain("auto");
    }
  });
});

describe("the same model, two ways", () => {
  /**
   * The overlap this category was worth building for. `elevenlabs.sfx` and
   * fal's resale of the same model differ four ways, and the differences are
   * the kind a caller finds out about at the 422 rather than in the docs.
   */
  test("the fal resale is NARROWER, and the difference shows in four places", () => {
    // 1. The cap: 30 natively, 22 at fal.
    expect(sfx.safe({ model: EL, prompt: PROMPT, durationSeconds: 25 }).ok).toBe(true);
    expect(sfx.safe({ model: EL_VIA_FAL, prompt: PROMPT, durationSeconds: 25 }).ok).toBe(false);

    const native = sfx({ model: EL, prompt: PROMPT, outputFormat: "mp3" });
    const resold = sfx({ model: EL_VIA_FAL, prompt: PROMPT, outputFormat: "mp3" });

    // 2. The format's placement: query string vs body.
    const nativeRequest = (native as unknown as { request: { url: string } }).request;
    expect(nativeRequest.url).toContain("?output_format=mp3_44100_128");
    expect(JSON.parse(JSON.stringify(native))).not.toHaveProperty("output_format");
    expect(JSON.parse(JSON.stringify(resold))).toMatchObject({ output_format: "mp3_44100_128" });

    // 3. The model field: present natively, absent at fal (the route IS it).
    expect(JSON.parse(JSON.stringify(native))).toMatchObject({
      model_id: "eleven_text_to_sound_v2",
    });
    expect(JSON.parse(JSON.stringify(resold))).not.toHaveProperty("model_id");

    // 4. The prompt cap: unbounded natively, 450 characters at fal.
    const long = "x".repeat(451);
    expect(sfx.safe({ model: EL, prompt: long }).ok).toBe(true);
    expect(sfx.safe({ model: EL_VIA_FAL, prompt: long }).ok).toBe(false);
  });

  test("the words they agree about are canonical and the rest are extras", () => {
    // `loop` and `prompt_influence` exist on BOTH — same vendor, so still one
    // witness — and ride as extras on both sides rather than as vocabulary.
    for (const ref of [EL, EL_VIA_FAL]) {
      const result = sfx.safe({
        model: ref,
        prompt: PROMPT,
        loop: true,
        prompt_influence: 0.8,
      } as never);
      expect(result.ok, ref).toBe(true);
      if (!result.ok) continue;
      expect(JSON.parse(JSON.stringify(result.params))).toMatchObject({
        loop: true,
        prompt_influence: 0.8,
      });
    }
  });
});

describe("the encoding", () => {
  test("a codec a route cannot emit is refused naming what it offers", () => {
    // ElevenLabs' composite has no FLAC arm.
    const result = sfx.safe({ model: EL, prompt: PROMPT, outputFormat: "flac" } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("invalid_enum_value");
    expect(result.errors[0]?.path).toEqual(["outputFormat"]);
    expect(result.errors[0]?.message).toContain("mp3");
  });

  test("a route with no encoding field refuses by name rather than dropping", () => {
    const result = sfx.safe({
      model: CASSETTE,
      prompt: PROMPT,
      durationSeconds: 3,
      outputFormat: "mp3",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("unsupported_param");
    expect(result.errors[0]?.message).toContain("fixed encoding");
  });

  test("a bitrate lands in Stable Audio's own field and is refused where there is none", () => {
    const stable = sfx.safe({
      model: STABLE,
      prompt: PROMPT,
      durationSeconds: 5,
      outputFormat: { format: "mp3", bitrate: 256000 },
    } as never);
    expect(stable.ok, JSON.stringify(stable.ok ? [] : stable.errors)).toBe(true);
    if (stable.ok) {
      expect(JSON.parse(JSON.stringify(stable.params))).toMatchObject({ bitrate: "256k" });
    }

    // Sonilo publishes a bare codec enum and no bitrate field at all.
    const sonilo = sfx.safe({
      model: SONILO,
      prompt: PROMPT,
      durationSeconds: 5,
      outputFormat: { format: "mp3", bitrate: 256000 },
    } as never);
    expect(sonilo.ok).toBe(false);
    if (sonilo.ok) return;
    expect(sonilo.errors[0]?.code).toBe("unsupported_param");
    expect(sonilo.errors[0]?.message).toContain("bitrate");
  });
});

describe("estimates", () => {
  test("ElevenLabs estimates exactly when the request states a length", () => {
    const timed = sfx.safe({ model: EL, prompt: PROMPT, durationSeconds: 30 });
    expect(timed.ok).toBe(true);
    if (timed.ok) expect(timed.estimate?.costUSD).toBeCloseTo(0.06, 10);

    // …and declines when the model picks the length, because there is nothing
    // to bill against.
    const open = sfx.safe({ model: EL, prompt: PROMPT });
    expect(open.ok).toBe(true);
    if (open.ok) expect(open.estimate?.costUSD).toBeUndefined();
  });

  test("fal estimates the flat-rate endpoints and declines the per-second ones", () => {
    const flat = sfx.safe({ model: STABLE, prompt: PROMPT, durationSeconds: 5 });
    expect(flat.ok).toBe(true);
    if (flat.ok) expect(flat.estimate?.costUSD).toBeCloseTo(0.0206, 10);

    const perSecond = sfx.safe({ model: SONILO, prompt: PROMPT, durationSeconds: 5 });
    expect(perSecond.ok).toBe(true);
    if (perSecond.ok) expect(perSecond.estimate?.costUSD).toBeUndefined();
  });
});

describe("providerOptions", () => {
  test("a wire param with no canonical word reaches the body and is still checked", () => {
    const result = sfx.safe({
      model: EL,
      prompt: PROMPT,
      providerOptions: { elevenlabs: { prompt_influence: 0.9 } },
    });
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(JSON.stringify(result.params))).toMatchObject({ prompt_influence: 0.9 });

    // …and an out-of-range one is the provider's own refusal, on the wire name
    // the caller actually typed.
    const bad = sfx.safe({
      model: EL,
      prompt: PROMPT,
      providerOptions: { elevenlabs: { prompt_influence: 4 } },
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors[0]?.path).toEqual(["prompt_influence"]);
  });

  test("a block naming a provider outside the pack is reported, not applied", () => {
    const result = sfx.safe({
      model: EL,
      prompt: PROMPT,
      providerOptions: { stability: { steps: 40 } },
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((issue) => issue.code === "unknown_param")).toBe(true);
  });
});
