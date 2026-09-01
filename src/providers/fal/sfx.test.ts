/**
 * `fal.sfx` — the wire contract of the eleventh verb.
 *
 * Most of the routing contract is `fal.image`'s (stripping, degradation,
 * `.toSdk`), asserted there and not repeated. What is asserted HERE is what is
 * particular to this address: the prompt has three wire spellings, the length
 * has two and is REQUIRED at exactly one endpoint, the encoding has three, one
 * endpoint publishes a separate `bitrate` string beside its codec, and the
 * ElevenLabs route is a NARROWED resale of a model unmodel also serves
 * natively.
 */

import { describe, expect, test } from "bun:test";
import { sfx } from "./sfx";
import { FAL_SFX_ENDPOINTS } from "./gen/endpoints.gen";
import type { ModelInfo } from "../../core/catalog-types";
import { sfxModels } from "./gen/models-sfx.gen";
import { FAL_SFX_SHAPES } from "./gen/sfx-narrow.gen";
import { FAL_SFX_PARAM_SHAPES } from "./gen/sfx-params.gen";
import { FAL_RATES } from "./gen/pricing.gen";

const PROMPT = "a heavy oak door creaking open in a stone hall";

/** The catalog slice, widened to `ModelInfo` — see `src/providers/fal/stt.test.ts`. */
const CATALOG = sfxModels as Readonly<Record<string, ModelInfo>>;

const SHAPES = FAL_SFX_SHAPES as Readonly<
  Record<string, { props: Record<string, { req?: true; t: string }>; order: readonly string[] }>
>;

const ROWS = FAL_SFX_PARAM_SHAPES as Readonly<
  Record<
    string,
    {
      textWire?: string;
      lengthWire?: string;
      durationRange?: readonly [number, number];
      durationInt?: true;
      durationDefault?: number;
      durationRequired?: true;
      formatWire?: string;
      bitrateWire?: string;
      codecs?: readonly string[];
    }
  >
>;

/** Every field this endpoint requires, at a legal value. */
function minimal(endpoint: string): Record<string, unknown> {
  const row = ROWS[endpoint];
  const body: Record<string, unknown> = { [row?.textWire ?? "prompt"]: PROMPT };
  if (row?.durationRequired === true && row.lengthWire !== undefined) {
    body[row.lengthWire] = row.durationRange?.[0] ?? 1;
  }
  return body;
}

describe("routing", () => {
  test("every curated endpoint routes to a queue URL that round-trips its id", () => {
    for (const endpoint of FAL_SFX_ENDPOINTS) {
      const params = sfx({ endpoint, ...minimal(endpoint) } as never);
      expect(params.request.url).toBe(`https://queue.fal.run/${endpoint}`);
      expect(params.request.method).toBe("POST");
      expect(Object.keys(params)).not.toContain("endpoint");
    }
  });

  test("the vendor-namespaced ids route to the PUBLISHED id", () => {
    // Three of the five vendors namespace their own ids rather than sitting
    // under `fal-ai/` — the `ideogram/v4` precedent, several categories over.
    for (const endpoint of [
      "sonilo/v1.1/text-to-sound-effects",
      "cassetteai/sound-effects-generator",
      "mirelo-ai/sfx1.6/text-to-audio",
    ]) {
      expect(sfx({ endpoint, ...minimal(endpoint) } as never).request.url).toBe(
        `https://queue.fal.run/${endpoint}`,
      );
    }
  });

  test("the six endpoints are the curated roster, and every one is catalogued", () => {
    expect([...FAL_SFX_ENDPOINTS].sort()).toEqual([
      "cassetteai/sound-effects-generator",
      "fal-ai/elevenlabs/sound-effects/v2",
      "fal-ai/stable-audio-3/small/sfx/base/text-to-audio",
      "fal-ai/stable-audio-3/small/sfx/text-to-audio",
      "mirelo-ai/sfx1.6/text-to-audio",
      "sonilo/v1.1/text-to-sound-effects",
    ]);
    for (const endpoint of FAL_SFX_ENDPOINTS) {
      expect(CATALOG[endpoint], endpoint).toBeDefined();
      expect(FAL_RATES[endpoint as keyof typeof FAL_RATES], endpoint).toBeDefined();
    }
  });
});

describe("the prompt has three spellings", () => {
  test("each endpoint requires its own, and refuses the others by name", () => {
    const spellings = new Set(FAL_SFX_ENDPOINTS.map((id) => ROWS[id]?.textWire));
    expect([...spellings].sort()).toEqual(["prompt", "text", "text_prompt"]);

    for (const endpoint of FAL_SFX_ENDPOINTS) {
      const wire = ROWS[endpoint]?.textWire as string;
      expect(SHAPES[endpoint]?.props[wire]?.req, endpoint).toBe(true);
      // The other two spellings are unknown params here, not silent drops.
      for (const other of ["prompt", "text", "text_prompt"].filter((n) => n !== wire)) {
        expect(SHAPES[endpoint]?.props[other], `${endpoint}.${other}`).toBeUndefined();
      }
    }
  });
});

describe("the length", () => {
  test("two spellings, and both are already in SECONDS", () => {
    const wires = new Set(FAL_SFX_ENDPOINTS.map((id) => ROWS[id]?.lengthWire));
    expect([...wires].sort()).toEqual(["duration", "duration_seconds"]);
    // Unlike `fal.music`, no endpoint here counts milliseconds, so no row
    // carries a unit and the adapter never multiplies.
    for (const endpoint of FAL_SFX_ENDPOINTS) {
      expect((ROWS[endpoint] as { lengthUnit?: string }).lengthUnit, endpoint).toBeUndefined();
    }
  });

  /**
   * The fact `unmodel/sfx`'s required arm exists for. One of six, and the
   * refusal comes from the shared `checkRequired` rather than from anything
   * hand-written here.
   */
  test("CassetteAI REQUIRES it and the other five do not", () => {
    const required = FAL_SFX_ENDPOINTS.filter((id) => ROWS[id]?.durationRequired === true);
    expect(required).toEqual(["cassetteai/sound-effects-generator"]);

    const result = sfx.safe({
      endpoint: "cassetteai/sound-effects-generator",
      prompt: PROMPT,
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.path).toEqual(["duration"]);
    expect(result.errors[0]?.message).toContain("required");
  });

  test("the ranges and defaults are the five vendors' own, verbatim", () => {
    const table = Object.fromEntries(
      FAL_SFX_ENDPOINTS.map((id) => [
        id,
        {
          range: ROWS[id]?.durationRange,
          int: ROWS[id]?.durationInt ?? false,
          default: ROWS[id]?.durationDefault,
        },
      ]),
    );
    expect(table).toEqual({
      "cassetteai/sound-effects-generator": { range: [1, 30], int: true, default: undefined },
      "fal-ai/elevenlabs/sound-effects/v2": { range: [0.5, 22], int: false, default: undefined },
      "fal-ai/stable-audio-3/small/sfx/base/text-to-audio": {
        range: [1, 120],
        int: false,
        default: 30,
      },
      "fal-ai/stable-audio-3/small/sfx/text-to-audio": { range: [1, 120], int: false, default: 30 },
      "mirelo-ai/sfx1.6/text-to-audio": { range: [0.1, 60], int: false, default: 10 },
      "sonilo/v1.1/text-to-sound-effects": { range: [1, 180], int: true, default: 8 },
    });
  });

  test("an integer field refuses a fractional second, and a float field takes one", () => {
    const whole = sfx.safe({
      endpoint: "sonilo/v1.1/text-to-sound-effects",
      prompt: PROMPT,
      duration: 2.5,
    } as never);
    expect(whole.ok).toBe(false);

    const fraction = sfx.safe({
      endpoint: "mirelo-ai/sfx1.6/text-to-audio",
      text_prompt: PROMPT,
      duration: 2.5,
    } as never);
    expect(fraction.ok).toBe(true);
  });
});

describe("the ElevenLabs route is a NARROWED resale", () => {
  /**
   * The comparison this endpoint is curated FOR. The native
   * `elevenlabs.sfx` caps the length at 30, takes `output_format` in the query
   * string, puts no ceiling on `text` and has a `model_id`; fal's resale of the
   * same model does none of those things.
   */
  test("22 seconds, not 30", () => {
    expect(ROWS["fal-ai/elevenlabs/sound-effects/v2"]?.durationRange).toEqual([0.5, 22]);
    const over = sfx.safe({
      endpoint: "fal-ai/elevenlabs/sound-effects/v2",
      text: PROMPT,
      duration_seconds: 25,
    } as never);
    expect(over.ok).toBe(false);
  });

  test("`text` is capped at 450 characters here and unbounded natively", () => {
    const props = SHAPES["fal-ai/elevenlabs/sound-effects/v2"]?.props["text"] as {
      maxLen?: number;
    };
    expect(props.maxLen).toBe(450);
    const long = sfx.safe({
      endpoint: "fal-ai/elevenlabs/sound-effects/v2",
      text: "x".repeat(451),
    } as never);
    expect(long.ok).toBe(false);
  });

  test("`output_format` is a BODY field here, and there is no `model_id`", () => {
    const params = sfx({
      endpoint: "fal-ai/elevenlabs/sound-effects/v2",
      text: PROMPT,
      output_format: "mp3_44100_128",
    } as never);
    expect(params).toEqual({ text: PROMPT, output_format: "mp3_44100_128" } as never);
    expect(params.request.url).toBe(
      "https://queue.fal.run/fal-ai/elevenlabs/sound-effects/v2",
    );
    expect(SHAPES["fal-ai/elevenlabs/sound-effects/v2"]?.props["model_id"]).toBeUndefined();
  });
});

describe("the encoding", () => {
  test("three wire spellings, and one endpoint has none at all", () => {
    const table = Object.fromEntries(
      FAL_SFX_ENDPOINTS.map((id) => [id, ROWS[id]?.formatWire ?? null]),
    );
    expect(table).toEqual({
      "cassetteai/sound-effects-generator": null,
      "fal-ai/elevenlabs/sound-effects/v2": "output_format",
      "fal-ai/stable-audio-3/small/sfx/base/text-to-audio": "output_format",
      "fal-ai/stable-audio-3/small/sfx/text-to-audio": "output_format",
      "mirelo-ai/sfx1.6/text-to-audio": "upload_audio_format",
      "sonilo/v1.1/text-to-sound-effects": "audio_format",
    });
    expect(ROWS["cassetteai/sound-effects-generator"]?.codecs).toEqual([]);
  });

  /**
   * Wave 1's `assertCodecsComplete` guard, seen from the other end: Stable
   * Audio's CLOSED seven-member enum contains `ogg` and `m4a`, which are
   * containers rather than encodings and are recorded refusals in the
   * generator. The other five members reached the row.
   */
  test("Stable Audio's closed enum lands five codecs and two recorded refusals", () => {
    const members = (
      SHAPES["fal-ai/stable-audio-3/small/sfx/text-to-audio"]?.props["output_format"] as {
        enum?: readonly string[];
      }
    ).enum;
    expect(members).toEqual(["mp3", "wav", "flac", "ogg", "opus", "m4a", "aac"]);
    expect(ROWS["fal-ai/stable-audio-3/small/sfx/text-to-audio"]?.codecs).toEqual([
      "aac",
      "flac",
      "mp3",
      "opus",
      "pcm_s16le",
    ]);
  });

  test("only Stable Audio publishes a separate `bitrate`, and it is a STRING", () => {
    const withBitrate = FAL_SFX_ENDPOINTS.filter((id) => ROWS[id]?.bitrateWire !== undefined);
    expect(withBitrate.sort()).toEqual([
      "fal-ai/stable-audio-3/small/sfx/base/text-to-audio",
      "fal-ai/stable-audio-3/small/sfx/text-to-audio",
    ]);
    expect(
      SHAPES["fal-ai/stable-audio-3/small/sfx/text-to-audio"]?.props["bitrate"]?.t,
    ).toBe("string");
  });
});

describe("cost", () => {
  test("three endpoints estimate exactly and three decline", () => {
    const estimated: string[] = [];
    for (const endpoint of FAL_SFX_ENDPOINTS) {
      const result = sfx.safe({ endpoint, ...minimal(endpoint) } as never);
      expect(result.ok, endpoint).toBe(true);
      if (!result.ok) continue;
      if (result.estimate?.costUSD !== undefined) estimated.push(endpoint);
    }
    // The flat-rate half: fal's "per generation" and "per audio" wording. The
    // other three bill per second of GENERATED audio, which is the model's
    // answer rather than the request's question.
    expect(estimated.sort()).toEqual([
      "cassetteai/sound-effects-generator",
      "fal-ai/stable-audio-3/small/sfx/base/text-to-audio",
      "fal-ai/stable-audio-3/small/sfx/text-to-audio",
    ]);
  });

  test("every rate carries a source, a date and a verbatim quote", () => {
    for (const endpoint of FAL_SFX_ENDPOINTS) {
      const rate = FAL_RATES[endpoint as keyof typeof FAL_RATES] as {
        source: string;
        verified: string;
      };
      expect(rate.source, endpoint).toContain("https://fal.ai/models/");
      expect(rate.verified, endpoint).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
