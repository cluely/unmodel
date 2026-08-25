/**
 * `fal.music` — the wire contract for ten music endpoints, and the one place in
 * this provider where a bare number means MILLISECONDS.
 *
 * The routing contract is `fal.image`'s, asserted there and not repeated. What
 * is asserted HERE is what the category's own vocabulary had to answer for: the
 * length has four spellings and one unit trap, the prompt is spelled three
 * different ways, and two endpoints require a second text field beside it that
 * unmodel refuses to invent.
 */

import { describe, expect, test } from "bun:test";
import { music } from "./music";
import { FAL_MUSIC_ENDPOINTS, FAL_REQUIRED_PROBES } from "./gen/endpoints.gen";
import { FAL_MUSIC_PARAM_SHAPES } from "./gen/music-params.gen";
import type { ModelInfo } from "../../core/catalog-types";
import { musicModels } from "./gen/models-music.gen";

const ROWS = FAL_MUSIC_PARAM_SHAPES as Readonly<
  Record<string, { textWire?: string; lengthWire?: string; lengthUnit?: string }>
>;

const PROMPT = "slow post-rock build, brushed drums";

/** The catalog slice, widened to `ModelInfo` — see `src/providers/fal/stt.test.ts`. */
const CATALOG = musicModels as Readonly<Record<string, ModelInfo>>;

/** The minimal legal body: this endpoint's own text field, plus anything else it requires. */
function minimal(endpoint: string): Record<string, unknown> {
  const body: Record<string, unknown> = { [ROWS[endpoint]?.textWire ?? "prompt"]: PROMPT };
  const required = (FAL_REQUIRED_PROBES as Readonly<Record<string, readonly string[]>>)[endpoint] ?? [];
  // Long enough for `fal-ai/minimax-music/v2`, whose `lyrics_prompt` has a
  // ten-character floor — the shortest probe that clears every endpoint's own
  // minLength rather than a per-endpoint table to keep in step.
  for (const name of required) if (body[name] === undefined) body[name] = "a probe value";
  return body;
}

describe("routing", () => {
  test("every curated endpoint routes to a queue URL that round-trips its id", () => {
    for (const endpoint of FAL_MUSIC_ENDPOINTS) {
      const params = music({ endpoint, ...minimal(endpoint) } as never);
      expect(params.request.url).toBe(`https://queue.fal.run/${endpoint}`);
      expect(params.request.method).toBe("POST");
      expect(Object.keys(params)).not.toContain("endpoint");
    }
  });

  test("the vendor-namespaced MiniMax id routes to the PUBLISHED id", () => {
    // fal's OpenAPI documents the internal route `/fal-ai/minimax-music-3`.
    expect(
      music({ endpoint: "minimax/music-3", prompt: PROMPT, lyrics: "la la la" }).request.url,
    ).toBe("https://queue.fal.run/minimax/music-3");
  });
});

describe("the prompt has three names", () => {
  test("`prompt` at Lyria, `tags` at ACE-Step, `lyrics` at DiffRhythm", () => {
    expect(ROWS["fal-ai/lyria2"]?.textWire).toBe("prompt");
    // A comma-separated style LIST rather than a sentence.
    expect(ROWS["fal-ai/ace-step"]?.textWire).toBe("tags");
    // The one endpoint where the two words swap places: DiffRhythm turns lyrics
    // into a song and `style_prompt` is the decoration.
    expect(ROWS["fal-ai/diffrhythm"]?.textWire).toBe("lyrics");
  });

  test("each endpoint's own name is the one that reaches the wire", () => {
    expect(JSON.parse(JSON.stringify(music({ endpoint: "fal-ai/ace-step", tags: PROMPT })))).toEqual({
      tags: PROMPT,
    });
    expect(
      JSON.parse(JSON.stringify(music({ endpoint: "fal-ai/diffrhythm", lyrics: "la la la" }))),
    ).toEqual({ lyrics: "la la la" });
  });
});

describe("the length has four spellings and one unit trap", () => {
  test("`music_length_ms` is the only one that counts milliseconds", () => {
    const ms = Object.entries(ROWS).filter(([, row]) => row.lengthUnit === "ms");
    expect(ms.map(([id]) => id)).toEqual(["fal-ai/elevenlabs/music"]);
    expect(ms[0]?.[1].lengthWire).toBe("music_length_ms");
  });

  test("the other three are seconds, and each endpoint takes exactly one", () => {
    const spellings = new Set(
      Object.values(ROWS)
        .map((row) => row.lengthWire)
        .filter((name): name is string => name !== undefined),
    );
    expect([...spellings].sort()).toEqual([
      "duration",
      "music_duration",
      "music_length_ms",
      "seconds_total",
    ]);
  });

  test("DiffRhythm's is a two-member string enum, and it is enforced", () => {
    expect(
      JSON.parse(
        JSON.stringify(music({ endpoint: "fal-ai/diffrhythm", lyrics: "la la", music_duration: "285s" })),
      ),
    ).toMatchObject({ music_duration: "285s" });
    const bad = music.safe({
      endpoint: "fal-ai/diffrhythm",
      lyrics: "la la",
      music_duration: "120s",
    } as never);
    expect(bad.ok).toBe(false);
  });

  test("the numeric ones keep their own bounds", () => {
    // 240 is legal at ACE-Step (5..240) and illegal at Stable Audio 2.5 (1..190).
    expect(music.safe({ endpoint: "fal-ai/ace-step", tags: PROMPT, duration: 240 }).ok).toBe(true);
    expect(
      music.safe({
        endpoint: "fal-ai/stable-audio-25/text-to-audio",
        prompt: PROMPT,
        seconds_total: 240,
      }).ok,
    ).toBe(false);
  });
});

describe("the two endpoints that require lyrics", () => {
  test("a prompt-only request is refused, naming the field", () => {
    for (const endpoint of ["minimax/music-3", "fal-ai/minimax-music/v2"]) {
      const bad = music.safe({ endpoint, prompt: PROMPT } as never);
      expect(bad.ok, endpoint).toBe(false);
      if (bad.ok) continue;
      // Refused rather than filled with an empty string: the alternative is
      // letting the model sing nothing and billing for it.
      expect(bad.errors.some((error) => error.message.includes("lyrics"))).toBe(true);
    }
  });
});

describe("cost", () => {
  test("the five flat per-generation rates estimate exactly, and nothing else does", () => {
    const flat = music.safe({ endpoint: "fal-ai/lyria3/pro", prompt: PROMPT });
    expect(flat.ok).toBe(true);
    if (!flat.ok) return;
    expect(flat.estimate?.costUSD).toBeCloseTo(0.08, 8);

    // Per-second-of-generated-audio: the length is the model's answer rather
    // than the request's question, so there is nothing to multiply by.
    const open = music.safe({ endpoint: "fal-ai/lyria2", prompt: PROMPT });
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    expect(open.estimate?.costUSD).toBeUndefined();
  });

  test("none of the ten reaches `ModelCost`, and that is the shape of the pricing", () => {
    // `per_generation` is a flat rate that is not an IMAGE rate, and
    // `ModelCost` has no other flat field. The rate survives as a provenance
    // comment above each generated row and as an estimate through pricing.ts.
    const priced = Object.values(CATALOG).filter((row) => row.cost !== undefined);
    expect(priced).toEqual([]);
  });
});

describe("degradation", () => {
  test("an endpoint outside the roster still routes, with a warning", () => {
    const result = music.safe({ endpoint: "fal-ai/minimax-music/v3", prompt: PROMPT } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((issue) => issue.code === "unknown_model")).toBe(true);
    expect(result.params.request.url).toBe("https://queue.fal.run/fal-ai/minimax-music/v3");
  });
});
