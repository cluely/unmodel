/**
 * `fal.tts` — the wire contract, and the widest per-endpoint vocabulary in the
 * provider.
 *
 * The routing contract is `fal.image`'s (stripping, degradation, `.toSdk`),
 * asserted there and not repeated. What is asserted HERE is what makes
 * twenty-three vendors usable from one address: the voice lists are per
 * endpoint and enforced per endpoint, the text has two names, `output_format`
 * means three different things, and `fal-ai/gemini-tts` carries a real `model`
 * body field.
 */

import { describe, expect, test } from "bun:test";
import { tts } from "./tts";
import { FAL_TTS_ENDPOINTS } from "./gen/endpoints.gen";
import { FAL_TTS_PARAM_SHAPES } from "./gen/tts-params.gen";
import type { ModelInfo } from "../../core/catalog-types";
import { ttsModels } from "./gen/models-tts.gen";

/** The catalog slice, widened to `ModelInfo` — see `src/providers/fal/stt.test.ts`. */
const CATALOG = ttsModels as Readonly<Record<string, ModelInfo>>;

const ROWS = FAL_TTS_PARAM_SHAPES as Readonly<
  Record<string, { textWire?: string; voices?: readonly string[] }>
>;

/** The minimal legal body for an endpoint: its own text field, and a voice if it needs one. */
function minimal(endpoint: string): Record<string, unknown> {
  const row = ROWS[endpoint];
  const body: Record<string, unknown> = { [row?.textWire ?? "text"]: "A probe." };
  // Kokoro's non-American endpoints declare `voice` REQUIRED, with no default.
  const voice = row?.voices?.[0];
  if (voice !== undefined && endpoint.startsWith("fal-ai/kokoro/")) body["voice"] = voice;
  return body;
}

describe("routing", () => {
  test("every curated endpoint routes to a queue URL that round-trips its id", () => {
    for (const endpoint of FAL_TTS_ENDPOINTS) {
      const params = tts({ endpoint, ...minimal(endpoint) } as never);
      expect(params.request.url).toBe(`https://queue.fal.run/${endpoint}`);
      expect(params.request.method).toBe("POST");
      expect(Object.keys(params)).not.toContain("endpoint");
    }
  });

  test("the vendor-namespaced xAI id routes to the PUBLISHED id", () => {
    // fal's OpenAPI documents the internal route `/fal-ai/xai-tts/v1`.
    expect(tts({ endpoint: "xai/tts/v1", text: "A probe." }).request.url).toBe(
      "https://queue.fal.run/xai/tts/v1",
    );
  });
});

describe("the text has two names", () => {
  test("`text` at ElevenLabs, `prompt` at Kokoro — and neither is a synonym", () => {
    expect(JSON.parse(JSON.stringify(tts({
      endpoint: "fal-ai/elevenlabs/tts/eleven-v3",
      text: "A probe.",
    })))).toEqual({ text: "A probe." });
    expect(JSON.parse(JSON.stringify(tts({
      endpoint: "fal-ai/kokoro/american-english",
      prompt: "A probe.",
    })))).toEqual({ prompt: "A probe." });

    // The other spelling is an unknown parameter, reported as one.
    const crossed = tts.safe({ endpoint: "fal-ai/kokoro/american-english", text: "A probe." } as never);
    expect(crossed.ok).toBe(true);
    if (!crossed.ok) return;
    expect(crossed.warnings.some((w) => w.code === "unknown_param" && w.path?.[0] === "text")).toBe(
      true,
    );
  });

  test("`fal-ai/qwen-3-tts` declares BOTH, and they mean different things", () => {
    const params = tts({
      endpoint: "fal-ai/qwen-3-tts/text-to-speech/1.7b",
      text: "A probe.",
      prompt: "whispered, close-mic",
    });
    // `text` is spoken; `prompt` is a style instruction. Both go out.
    expect(JSON.parse(JSON.stringify(params))).toEqual({
      text: "A probe.",
      prompt: "whispered, close-mic",
    });
  });
});

describe("the voice lists are per endpoint", () => {
  test("Kokoro publishes nine different arrays, and picking the ref picks the language", () => {
    const american = ROWS["fal-ai/kokoro/american-english"]?.voices ?? [];
    const japanese = ROWS["fal-ai/kokoro/japanese"]?.voices ?? [];
    const french = ROWS["fal-ai/kokoro/french"]?.voices ?? [];
    expect(american).toHaveLength(20);
    expect(japanese).toHaveLength(5);
    // A `const` in the schema: one voice, and it lowers to a single-value enum.
    expect(french).toEqual(["ff_siwis"]);
    expect(american.filter((voice) => japanese.includes(voice))).toEqual([]);
  });

  test("a voice from the wrong language is refused, naming the ones that exist", () => {
    const bad = tts.safe({
      endpoint: "fal-ai/kokoro/japanese",
      prompt: "A probe.",
      voice: "af_heart",
    } as never);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((error) => error.path?.[0] === "voice");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("jf_alpha");
  });

  test("the endpoints with an OPEN voice field take a cloned id without complaint", () => {
    // ElevenLabs' catalog is per-account and includes clones, so its `voice` is
    // a bare string with a default and no enum — the row publishes no `voices`
    // and nothing gates.
    const params = tts({
      endpoint: "fal-ai/elevenlabs/tts/eleven-v3",
      text: "A probe.",
      voice: "JBFqnCBsd6RMkjVDRZzb",
    });
    expect(JSON.parse(JSON.stringify(params))).toMatchObject({ voice: "JBFqnCBsd6RMkjVDRZzb" });
  });
});

describe("`output_format` means three different things", () => {
  test("a codec at Gemini, a DELIVERY switch at MiniMax, an OBJECT at xAI", () => {
    expect(
      JSON.parse(JSON.stringify(tts({ endpoint: "fal-ai/gemini-tts", prompt: "A probe.", output_format: "ogg_opus" }))),
    ).toMatchObject({ output_format: "ogg_opus" });
    expect(
      JSON.parse(JSON.stringify(tts({ endpoint: "fal-ai/minimax/speech-02-hd", text: "A probe.", output_format: "hex" }))),
    ).toMatchObject({ output_format: "hex" });
    expect(
      JSON.parse(
        JSON.stringify(
          tts({
            endpoint: "xai/tts/v1",
            text: "A probe.",
            output_format: { codec: "wav", sample_rate: 24000 },
          }),
        ),
      ),
    ).toMatchObject({ output_format: { codec: "wav", sample_rate: 24000 } });
  });

  test("each one's vocabulary is its own — `hex` is not a codec at Gemini", () => {
    const bad = tts.safe({ endpoint: "fal-ai/gemini-tts", prompt: "A probe.", output_format: "hex" } as never);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.some((error) => error.path?.[0] === "output_format")).toBe(true);
  });
});

describe("the `model` field that is not the route", () => {
  test("`fal-ai/gemini-tts` keeps its tier on the wire while `endpoint` routes", () => {
    const params = tts({
      endpoint: "fal-ai/gemini-tts",
      prompt: "A probe.",
      model: "gemini-2.5-pro-tts",
    });
    expect(JSON.parse(JSON.stringify(params))).toMatchObject({ model: "gemini-2.5-pro-tts" });
    expect(params.request.url).toBe("https://queue.fal.run/fal-ai/gemini-tts");
  });

  test("its two-value enum is enforced", () => {
    const bad = tts.safe({
      endpoint: "fal-ai/gemini-tts",
      prompt: "A probe.",
      model: "gemini-3.0-tts",
    } as never);
    expect(bad.ok).toBe(false);
  });
});

describe("cost", () => {
  test("twenty-two of the twenty-three publish a per-character rate, and it reaches the catalog", () => {
    expect(CATALOG["fal-ai/kokoro/american-english"]?.cost).toEqual({
      perMillionCharacters: 20,
    });
    // Gemini is the exception: fal quotes it per million TOKENS, doubled for
    // the pro tier, and no request body counts those.
    expect(CATALOG["fal-ai/gemini-tts"]?.cost).toBeUndefined();
    const priced = Object.values(CATALOG).filter((row) => row.cost !== undefined);
    expect(priced).toHaveLength(22);
  });

  test("the estimate is EXACT here, which it is at no other fal address", () => {
    // The billed quantity is the characters, and the request states them.
    const result = tts.safe({ endpoint: "fal-ai/kokoro/american-english", prompt: "x".repeat(1000) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate?.costUSD).toBeCloseTo(0.02, 8);
  });
});

describe("degradation", () => {
  test("an endpoint outside the roster still routes, with a warning", () => {
    const result = tts.safe({ endpoint: "fal-ai/kokoro/german", prompt: "A probe." } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((issue) => issue.code === "unknown_model")).toBe(true);
    expect(result.params.request.url).toBe("https://queue.fal.run/fal-ai/kokoro/german");
  });
});
