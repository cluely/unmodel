import { expect, test } from "bun:test";
import { SPEECH_MAX_INPUT_CHARACTERS, speechModels } from "./audio-models";
// TEST-ONLY import of the generated catalog. `./audio-models` deliberately
// does NOT import it (see that file's header: `unmodel/tts` asserts a
// catalog-free graph), which is exactly why the drift has to be caught here
// instead — the mirror's "cross-check on each codegen refresh" instruction,
// made mechanical.
import { models } from "../../catalog/stepfun.gen";
import type { StepfunAudioModelId } from "../../catalog/stepfun.gen";

/**
 * Each mirrored row is the generated row, field for field, with the
 * documented divergences and nothing else. Both halves of each divergence are
 * asserted, because only the pair is meaningful: if models.dev grows the same
 * fact upstream, the divergence stops being one and this test is where that
 * shows up.
 */
test("stepaudio-2.5-tts mirrors its generated row except the character cap", () => {
  const hand: Record<string, unknown> = speechModels["stepaudio-2.5-tts"];
  const generated = models["stepaudio-2.5-tts"];
  expect(generated, "stepaudio-2.5-tts vanished from the generated catalog").toBeDefined();

  // The divergence itself, and the fact that makes it one: the create-speech
  // reference's endpoint-wide 1,000-character input cap, which models.dev
  // does not track.
  expect(hand["limit"]).toEqual({ ...generated.limit, characters: SPEECH_MAX_INPUT_CHARACTERS });
  expect(SPEECH_MAX_INPUT_CHARACTERS).toBe(1000);
  expect("characters" in generated.limit).toBe(false);

  // …and nothing else differs.
  const { limit: _handLimit, ...handRest } = hand;
  const { limit: _genLimit, ...genRest } = generated as unknown as Record<string, unknown>;
  expect(handRest).toEqual(genRest);
});

test("step-tts-2 mirrors its generated row except the cap and the deprecation", () => {
  const hand: Record<string, unknown> = speechModels["step-tts-2"];
  const generated = models["step-tts-2"];
  expect(generated, "step-tts-2 vanished from the generated catalog").toBeDefined();

  // Divergence 1: the same endpoint-wide character cap.
  expect(hand["limit"]).toEqual({ ...generated.limit, characters: SPEECH_MAX_INPUT_CHARACTERS });
  expect("characters" in generated.limit).toBe(false);

  // Divergence 2: the mirror deprecates the id (the create-speech reference
  // says the endpoint "Currently supports stepaudio-2.5-tts"); models.dev
  // carries no status. If the generated row ever gains one, reconcile.
  expect(hand["status"]).toBe("deprecated");
  expect("status" in generated).toBe(false);

  // …and nothing else differs.
  const { limit: _handLimit, status: _handStatus, ...handRest } = hand;
  const { limit: _genLimit, ...genRest } = generated as unknown as Record<string, unknown>;
  expect(handRest).toEqual(genRest);
});

/**
 * The no-third-id guard: `StepfunAudioModelId` is the generated union of
 * audio-OUT stepfun ids, and the mirror must carry exactly that set — a new
 * speech id landing in models.dev must fail here rather than stay silently
 * unreachable from `stepfun.tts`'s catalog. (`stepaudio-2.5-asr` is audio-IN
 * and lives in `StepfunTextModelId`, so it is not this file's business.)
 */
test("the mirror carries exactly the generated audio ids", () => {
  const generatedAudioIds = Object.values(models)
    .filter((info) => (info.modalities.output as readonly string[]).includes("audio"))
    .map((info) => info.id)
    .sort();
  expect(Object.keys(speechModels).sort()).toEqual(generatedAudioIds);
  // Pin the union the types promise, so a rename shows up by name.
  const pinned: StepfunAudioModelId[] = ["step-tts-2", "stepaudio-2.5-tts"];
  expect(generatedAudioIds).toEqual(pinned);
});
