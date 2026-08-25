import { expect, test } from "bun:test";
import { LYRIA_PRICE_PER_SONG_USD, lyriaRealtimeModel, musicModels } from "./lyria-models";
import { LYRIA_REALTIME_MODEL_ID, MODELS } from "./music-params";
// TEST-ONLY import of the generated catalog. `./lyria-models` deliberately
// does NOT import it (see that file's header: `unmodel/music` asserts a
// generated-catalog-free graph), which is exactly why the drift has to be
// caught here instead — the mirror's "cross-check on each codegen refresh"
// instruction, made mechanical.
import { models } from "../../catalog/google.gen";

/**
 * The two batch rows are the generated rows, field for field, with NO
 * exemptions — even `cost: { input: 0, output: 0 }` is mirrored as-is (a
 * models.dev artifact the mirror's header documents; the real per-song rate
 * rides in LYRIA_PRICE_PER_SONG_USD because ModelCost has no per-request
 * unit). A models.dev refresh that moves ANY field on these rows must land
 * here, not drift silently.
 */
test("both batch Lyria rows mirror their generated rows exactly", () => {
  for (const id of MODELS) {
    const generated = models[id];
    expect(generated, `${id} vanished from the generated catalog`).toBeDefined();
    expect(musicModels[id]).toEqual(generated as never);
  }
});

/**
 * The realtime id is the one HAND row: models.dev does not track it, which is
 * the only reason it is hand-written. The day the generated catalog grows a
 * `lyria-realtime-exp` row, this fails and says "reconcile" — the hand row
 * should then become a mirror (or vanish in favour of the generated one).
 */
test("lyria-realtime-exp stays absent from the generated catalog", () => {
  expect(LYRIA_REALTIME_MODEL_ID).toBe("lyria-realtime-exp");
  expect(
    (models as Record<string, unknown>)[LYRIA_REALTIME_MODEL_ID],
    "models.dev now tracks lyria-realtime-exp — reconcile the hand row in ./lyria-models",
  ).toBeUndefined();
  expect(musicModels[LYRIA_REALTIME_MODEL_ID]).toBe(lyriaRealtimeModel);
});

test("the music catalog is exactly the two batch ids plus the realtime row", () => {
  expect(Object.keys(musicModels).sort()).toEqual(
    [...MODELS, LYRIA_REALTIME_MODEL_ID].sort(),
  );
});

/** The per-song price table covers exactly the batch ids — no orphan rates. */
test("LYRIA_PRICE_PER_SONG_USD covers exactly the batch model ids", () => {
  expect(Object.keys(LYRIA_PRICE_PER_SONG_USD).sort()).toEqual([...MODELS].sort());
  expect(LYRIA_PRICE_PER_SONG_USD["lyria-3-clip-preview"]).toBe(0.04);
  expect(LYRIA_PRICE_PER_SONG_USD["lyria-3-pro-preview"]).toBe(0.08);
});
