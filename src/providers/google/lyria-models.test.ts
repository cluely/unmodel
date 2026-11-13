import { expect, test } from "bun:test";
import {
  LYRIA_PRICE_PER_SONG_USD,
  lyria35Model,
  lyriaRealtimeModel,
  musicModels,
} from "./lyria-models";
import { LYRIA_REALTIME_MODEL_ID, MODELS } from "./music-params";
// TEST-ONLY import of the generated catalog. `./lyria-models` deliberately
// does NOT import it (see that file's header: `unmodel/music` asserts a
// generated-catalog-free graph), which is exactly why the drift has to be
// caught here instead — the mirror's "cross-check on each codegen refresh"
// instruction, made mechanical.
import { models } from "../../catalog/google.gen";
import type { ModelInfo } from "../../core/catalog-types";

/** The generated catalog with its literals widened, so a hand id can index it. */
const generated: Readonly<Record<string, ModelInfo | undefined>> = models;

/** The two Lyria 3 batch ids models.dev carries; `lyria-3.5` is the hand row. */
const MIRRORED = MODELS.filter((id) => id !== "lyria-3.5");

/**
 * The two batch rows are the generated rows, field for field, with NO
 * exemptions — even `cost: { input: 0, output: 0 }` is mirrored as-is (a
 * models.dev artifact the mirror's header documents; the real per-song rate
 * rides in LYRIA_PRICE_PER_SONG_USD because ModelCost has no per-request
 * unit). A models.dev refresh that moves ANY field on these rows must land
 * here, not drift silently.
 */
test("both batch Lyria 3 rows mirror their generated rows exactly", () => {
  expect(MIRRORED).toHaveLength(2);
  for (const id of MIRRORED) {
    const row = generated[id];
    expect(row, `${id} vanished from the generated catalog`).toBeDefined();
    expect(musicModels[id]).toEqual(row as never);
  }
});

/**
 * `lyria-3.5` is a HAND row for the same reason the realtime id is: models.dev
 * does not track it (2026-11-12). The day the generated catalog grows a
 * `lyria-3.5` row, this fails and says "reconcile" — the hand row should then
 * become a mirror.
 */
test("lyria-3.5 stays absent from the generated catalog and is the hand row", () => {
  expect(
    generated["lyria-3.5"],
    "models.dev now tracks lyria-3.5 — reconcile the hand row in ./lyria-models",
  ).toBeUndefined();
  expect(musicModels["lyria-3.5"]).toBe(lyria35Model);
  // "Input token limit 131,072"; text and image in, MP3 plus lyrics out.
  expect(lyria35Model.limit).toEqual({ context: 131072 });
  expect(lyria35Model.modalities).toEqual({ input: ["text", "image"], output: ["text", "audio"] });
});

/**
 * The realtime id is the other HAND row: models.dev does not track it, which
 * is the only reason it is hand-written. The day the generated catalog grows a
 * `lyria-realtime-exp` row, this fails and says "reconcile".
 */
test("lyria-realtime-exp stays absent from the generated catalog", () => {
  expect(LYRIA_REALTIME_MODEL_ID).toBe("lyria-realtime-exp");
  expect(
    generated[LYRIA_REALTIME_MODEL_ID],
    "models.dev now tracks lyria-realtime-exp — reconcile the hand row in ./lyria-models",
  ).toBeUndefined();
  expect(musicModels[LYRIA_REALTIME_MODEL_ID]).toBe(lyriaRealtimeModel);
});

test("the music catalog is exactly the batch ids plus the realtime row", () => {
  expect(Object.keys(musicModels).sort()).toEqual(
    [...MODELS, LYRIA_REALTIME_MODEL_ID].sort(),
  );
});

/** The per-song price table covers exactly the batch ids — no orphan rates. */
test("LYRIA_PRICE_PER_SONG_USD covers exactly the batch model ids", () => {
  expect(Object.keys(LYRIA_PRICE_PER_SONG_USD).sort()).toEqual([...MODELS].sort());
  expect(LYRIA_PRICE_PER_SONG_USD["lyria-3-clip-preview"]).toBe(0.04);
  expect(LYRIA_PRICE_PER_SONG_USD["lyria-3-pro-preview"]).toBe(0.08);
  // "Lyria 3.5 (Full Song) — $0.08 per song" (pricing page, 2026-11-12).
  expect(LYRIA_PRICE_PER_SONG_USD["lyria-3.5"]).toBe(0.08);
});
