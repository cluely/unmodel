import { expect, test } from "bun:test";
import { ttsModels } from "./tts-models";
import { GEMINI_TTS_CONTEXT_TOKENS, GEMINI_TTS_MODEL_IDS } from "./tts-constraints";
// TEST-ONLY import of the generated catalog. `./tts-models` deliberately does
// NOT import it (see that file's header: `unmodel/tts` asserts a catalog-free
// graph), which is exactly why the drift has to be caught here instead.
import { models } from "../../catalog/google.gen";
import type { ModelInfo } from "../../core/catalog-types";

/** The generated catalog with its literals widened, so a hand id can index it. */
const generated: Readonly<Record<string, ModelInfo | undefined>> = models;

/** The TTS ids models.dev carries (mirrors) and the ones it does not (hand rows). */
const MIRRORED = GEMINI_TTS_MODEL_IDS.filter((id) => generated[id] !== undefined);
const HAND = GEMINI_TTS_MODEL_IDS.filter((id) => generated[id] === undefined);

/**
 * The mirrored rows are the generated rows, field for field, with TWO
 * documented corrections. Both halves of each are asserted, because only the
 * pair is meaningful: if models.dev is fixed upstream, a correction stops being
 * a correction and this test is where that shows up.
 */
test("every mirrored row equals its generated row except the two doc corrections", () => {
  expect(MIRRORED.length).toBeGreaterThanOrEqual(3);
  for (const id of MIRRORED) {
    const hand: Record<string, unknown> = ttsModels[id];
    const row = generated[id];
    expect(row, `${id} vanished from the generated catalog`).toBeDefined();
    if (row === undefined) continue;

    // Correction 1: the 32k context window, and the fact that makes it one.
    expect(hand["limit"]).toEqual({ ...row.limit, context: GEMINI_TTS_CONTEXT_TOKENS });
    expect(row.limit.context).toBe(8192);
    expect(GEMINI_TTS_CONTEXT_TOKENS).toBe(32768);

    // Correction 2: the November 17, 2026 shutdown, which models.dev does not carry.
    expect(hand["status"]).toBe("deprecated");
    expect(row.status).toBeUndefined();

    // …and nothing else differs.
    const { limit: _handLimit, status: _handStatus, ...handRest } = hand;
    const { limit: _genLimit, ...genRest } = row as unknown as Record<string, unknown>;
    expect(handRest).toEqual(genRest);
  }
});

/**
 * The hand rows are exactly the Gemini 3.8 TTS pair, and they carry their model
 * pages' own limits rather than the 32k correction. The day models.dev grows
 * either id, this fails and says "reconcile": the row should become a mirror.
 */
test("the Gemini 3.8 TTS pair is hand-written because models.dev lacks it", () => {
  expect([...HAND].sort()).toEqual(["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"]);
  for (const id of HAND) {
    expect(generated[id], `models.dev now tracks ${id} — reconcile the hand row`).toBeUndefined();
    const row: ModelInfo = ttsModels[id];
    expect(row.limit).toEqual({ context: 8192, output: 16384 });
    expect(row.reasoning).toBe(false);
    expect(row.modalities).toEqual({ input: ["text"], output: ["audio"] });
  }
  // "$9.00 (audio)" and "$6.00 (audio)" through 2026-12-31, on $0.50 text in.
  expect(ttsModels["gemini-3.8-flash-tts"].cost).toEqual({ input: 0.5, output: 9 });
  expect(ttsModels["gemini-3.8-flash-lite-tts"].cost).toEqual({ input: 0.5, output: 6 });
});

test("the hand catalog is exactly the documented TTS ids", () => {
  expect(Object.keys(ttsModels).sort()).toEqual([...GEMINI_TTS_MODEL_IDS].sort());
});

/**
 * The no-unlisted-id guard: any generated model that is text-in / audio-out is
 * a TTS model, and it must be in the hand catalog rather than silently
 * unreachable from `google.tts`.
 *
 * `input` is compared as an exact `["text"]` on purpose — the Live API models
 * also emit audio, but they take audio in and are served by
 * bidiGenerateContent, so they are not this endpoint's business.
 */
test("no text-in/audio-out generated model is missing from the hand catalog", () => {
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
  expect(audioOnly).toEqual([...MIRRORED].sort());
});
