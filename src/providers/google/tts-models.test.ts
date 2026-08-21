import { expect, test } from "bun:test";
import { ttsModels } from "./tts-models";
import { GEMINI_TTS_CONTEXT_TOKENS, GEMINI_TTS_MODEL_IDS } from "./tts-constraints";
// TEST-ONLY import of the generated catalog. `./tts-models` deliberately does
// NOT import it (see that file's header: `unmodel/tts` asserts a catalog-free
// graph), which is exactly why the drift has to be caught here instead.
import { models } from "../../catalog/google.gen";

/**
 * The hand rows are the generated rows, field for field, with ONE documented
 * correction. Both halves are asserted, because only the pair is meaningful:
 * if models.dev is fixed upstream, the correction stops being a correction and
 * this test is where that shows up.
 */
test("every hand row equals its generated row except the doc-corrected context", () => {
  for (const id of GEMINI_TTS_MODEL_IDS) {
    const hand: Record<string, unknown> = ttsModels[id];
    const generated = models[id];
    expect(generated, `${id} vanished from the generated catalog`).toBeDefined();

    // The correction itself, and the fact that makes it one.
    expect(hand["limit"]).toEqual({ ...generated.limit, context: GEMINI_TTS_CONTEXT_TOKENS });
    expect(generated.limit.context).toBe(8192);
    expect(GEMINI_TTS_CONTEXT_TOKENS).toBe(32768);

    // …and nothing else differs.
    const { limit: _handLimit, ...handRest } = hand;
    const { limit: _genLimit, ...genRest } = generated as unknown as Record<string, unknown>;
    expect(handRest).toEqual(genRest);
  }
});

test("the hand catalog is exactly the three documented TTS ids", () => {
  expect(Object.keys(ttsModels).sort()).toEqual([...GEMINI_TTS_MODEL_IDS].sort());
});

/**
 * The no-fourth-id guard: any generated model that is text-in / audio-out is a
 * TTS model, and it must be in the hand catalog rather than silently
 * unreachable from `google.tts`.
 *
 * `input` is compared as an exact `["text"]` on purpose — the Live API models
 * also emit audio, but they take audio in and are served by
 * bidiGenerateContent, so they are not this endpoint's business.
 */
test("no fourth text-in/audio-out model is missing from the hand catalog", () => {
  const audioOnly = Object.entries(models)
    .filter(
      ([, info]) =>
        info.modalities.input.length === 1 &&
        info.modalities.input[0] === "text" &&
        info.modalities.output.length === 1 &&
        info.modalities.output[0] === "audio",
    )
    .map(([id]) => id)
    .sort();
  expect(audioOnly).toEqual([...GEMINI_TTS_MODEL_IDS].sort());
});
