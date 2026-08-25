/**
 * `fal.stt` — the wire contract for six transcription endpoints.
 *
 * The routing contract is `fal.image`'s, asserted there and not repeated. What
 * is asserted HERE is the shape of the category: every route takes its audio by
 * REFERENCE and never as multipart, the language field has two names and two
 * kinds (a 99-member enum at Wizper, an open string at ElevenLabs), and the two
 * `const` properties at `fal-ai/wizper` are the single-value-enum lowering seen
 * from the wire side.
 */

import { describe, expect, test } from "bun:test";
import { stt } from "./stt";
import { FAL_STT_ENDPOINTS } from "./gen/endpoints.gen";
import { FAL_STT_SHAPES } from "./gen/stt-narrow.gen";
import type { ModelInfo } from "../../core/catalog-types";
import { sttModels } from "./gen/models-stt.gen";

const AUDIO = "https://example.com/interview.wav";

/**
 * The catalog slice, widened to `ModelInfo`.
 *
 * `as const satisfies Record<string, ModelInfo>` is what makes the generated
 * rows a literal table, which is the point of it — but a row with no `cost` has
 * no `cost` PROPERTY at all, so reading one off the union is a compile error
 * rather than `undefined`. Widening here is how the test asks the question the
 * catalog answers.
 */
const CATALOG = sttModels as Readonly<Record<string, ModelInfo>>;

describe("routing", () => {
  test("every curated endpoint routes to a queue URL that round-trips its id", () => {
    for (const endpoint of FAL_STT_ENDPOINTS) {
      const params = stt({ endpoint, audio_url: AUDIO } as never);
      expect(params.request.url).toBe(`https://queue.fal.run/${endpoint}`);
      expect(params.request.method).toBe("POST");
      expect(Object.keys(params)).not.toContain("endpoint");
    }
  });

  test("`fal-ai/speech-to-text` and its turbo arm are two ids, not one with a flag", () => {
    expect(stt({ endpoint: "fal-ai/speech-to-text", audio_url: AUDIO }).request.url).toBe(
      "https://queue.fal.run/fal-ai/speech-to-text",
    );
    expect(stt({ endpoint: "fal-ai/speech-to-text/turbo", audio_url: AUDIO }).request.url).toBe(
      "https://queue.fal.run/fal-ai/speech-to-text/turbo",
    );
  });
});

describe("audio arrives by reference, always", () => {
  test("an https URL and a `data:` URI are both accepted", () => {
    expect(JSON.parse(JSON.stringify(stt({ endpoint: "fal-ai/wizper", audio_url: AUDIO })))).toEqual({
      audio_url: AUDIO,
    });
    const inline = "data:audio/wav;base64,UklGRg==";
    expect(
      JSON.parse(JSON.stringify(stt({ endpoint: "fal-ai/wizper", audio_url: inline }))),
    ).toEqual({ audio_url: inline });
  });

  test("a bare identifier is refused, naming what the field takes", () => {
    const bad = stt.safe({ endpoint: "fal-ai/wizper", audio_url: "interview.wav" } as never);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const issue = bad.errors.find((error) => error.path?.[0] === "audio_url");
    expect(issue?.message).toContain("`https:` URL or a `data:` URI");
  });

  test("every endpoint declares exactly one audio INPUT, and it is `audio_url`", () => {
    // `tag_audio_events` at the two Scribe generations is a switch about what
    // the TRANSCRIPT says, not a second place to put a recording — which is why
    // the filter looks for the `_url` suffix rather than the word "audio".
    const shapes = FAL_STT_SHAPES as Readonly<Record<string, { props: Record<string, unknown> }>>;
    for (const endpoint of FAL_STT_ENDPOINTS) {
      const props = Object.keys(shapes[endpoint]?.props ?? {});
      expect(props.filter((name) => name.endsWith("_url")), endpoint).toEqual(["audio_url"]);
    }
  });
});

describe("the language field has two names and two kinds", () => {
  test("Wizper publishes a 99-member enum and enforces it", () => {
    expect(
      JSON.parse(JSON.stringify(stt({ endpoint: "fal-ai/wizper", audio_url: AUDIO, language: "pt" }))),
    ).toMatchObject({ language: "pt" });
    const bad = stt.safe({ endpoint: "fal-ai/wizper", audio_url: AUDIO, language: "xx" } as never);
    expect(bad.ok).toBe(false);
  });

  test("ElevenLabs takes any BCP-47 code, so the full tag survives", () => {
    // An OPEN string on the wire: `language_code` has no enum, which is what
    // lets `pt-BR` through where Wizper would have to drop the region.
    expect(
      JSON.parse(
        JSON.stringify(
          stt({
            endpoint: "fal-ai/elevenlabs/speech-to-text",
            audio_url: AUDIO,
            language_code: "pt-BR",
          }),
        ),
      ),
    ).toMatchObject({ language_code: "pt-BR" });
  });

  test("`fal-ai/speech-to-text` has no language field at all", () => {
    const result = stt.safe({
      endpoint: "fal-ai/speech-to-text",
      audio_url: AUDIO,
      language: "en",
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.code === "unknown_param" && w.path?.[0] === "language")).toBe(
      true,
    );
  });
});

describe("the two `const` properties at Wizper", () => {
  test("they lower to single-value enums, and the value is enforced", () => {
    expect(
      JSON.parse(
        JSON.stringify(
          stt({ endpoint: "fal-ai/wizper", audio_url: AUDIO, chunk_level: "segment", version: "3" }),
        ),
      ),
    ).toMatchObject({ chunk_level: "segment", version: "3" });
    const bad = stt.safe({ endpoint: "fal-ai/wizper", audio_url: AUDIO, chunk_level: "word" } as never);
    expect(bad.ok).toBe(false);
  });
});

describe("cost", () => {
  test("the per-second input rate reaches `perAudioMinute` through an exact x60", () => {
    // fal quotes $0.0008 per second; a minute is sixty of those, exactly.
    expect(CATALOG["fal-ai/speech-to-text"]?.cost).toEqual({ perAudioMinute: 0.048 });
    expect(CATALOG["fal-ai/elevenlabs/speech-to-text"]?.cost).toEqual({ perAudioMinute: 0.03 });
  });

  test("the conditional and compute-second rows carry no cost at all", () => {
    // Scribe v2 charges 30% more when `keyterms` are used, and Wizper is billed
    // per COMPUTE second — neither is a scalar a request settles.
    expect(CATALOG["fal-ai/elevenlabs/speech-to-text/scribe-v2"]?.cost).toBeUndefined();
    expect(CATALOG["fal-ai/wizper"]?.cost).toBeUndefined();
  });

  test("no estimate anywhere: the billed quantity is the recording's LENGTH", () => {
    // A submit body carries a URL, so unmodel never sees the audio.
    const result = stt.safe({ endpoint: "fal-ai/speech-to-text", audio_url: AUDIO });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate?.costUSD).toBeUndefined();
  });
});

describe("degradation", () => {
  test("an endpoint outside the roster still routes, with a warning", () => {
    const result = stt.safe({ endpoint: "fal-ai/whisper", audio_url: AUDIO } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((issue) => issue.code === "unknown_model")).toBe(true);
    // `fal-ai/whisper` is GONE from fal — retired between this plan's research
    // and its execution — and the degraded arm is what keeps that a warning
    // rather than a compile break. See data/fal/curation.json.
    expect(result.params.request.url).toBe("https://queue.fal.run/fal-ai/whisper");
  });
});
