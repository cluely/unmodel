import { expect, test } from "bun:test";
import {
  IMAGE_2_0_PER_IMAGE_USD,
  imageModels,
  videoModels,
} from "./models";
// TEST-ONLY import of the generated catalog. `./models` deliberately does NOT
// import it (see that file's header: the `unmodel/image` and `unmodel/video`
// pack graphs pin their generated catalogs), which is exactly why the drift
// has to be caught here instead — the mirror's "cross-check on each codegen
// refresh" instruction, made mechanical.
import { models as generatedModels } from "../../catalog/xai.gen";

/** The five snapshot-tracked Imagine ids the mirror carries, per route. */
const MIRRORED = [
  ["grok-imagine-image", imageModels],
  ["grok-imagine-image-2.0", imageModels],
  ["grok-imagine-image-quality", imageModels],
  ["grok-imagine-video", videoModels],
  ["grok-imagine-video-1.5", videoModels],
] as const;

/**
 * Each mirrored row is the generated row, field for field, with ONE
 * documented divergence: the docs-quoted `cost` the models.dev snapshot does
 * not carry. Both halves are asserted, because only the pair is meaningful —
 * the mirror's header says "if models.dev ever grows real cost data for these
 * ids, reconcile the rates here", and this is where that day shows up.
 */
test("every mirrored Imagine row equals its generated row except the added cost", () => {
  for (const [id, table] of MIRRORED) {
    const hand: Record<string, unknown> = (table as Record<string, Record<string, unknown>>)[id]!;
    const generated = (generatedModels as Record<string, Record<string, unknown>>)[id];
    expect(generated, `${id} vanished from the generated catalog`).toBeDefined();

    // The divergence itself, and the fact that makes it one.
    expect(hand["cost"], `${id} lost its docs-quoted cost`).toBeDefined();
    expect(
      "cost" in generated!,
      `models.dev now carries cost for ${id} — reconcile the rate in ./models`,
    ).toBe(false);

    // …and nothing else differs.
    const { cost: _handCost, ...handRest } = hand;
    expect(handRest).toEqual(generated!);
  }
});

/**
 * The docs-quoted rate for the id the capability guide recommends. Kept as its
 * own case because the generated row carries no cost at all: the mirror test
 * above proves the row matches, this one proves the rate is the documented
 * per-image price rather than whatever a refresh might invent.
 */
test("grok-imagine-image-2.0 carries the docs-quoted per-image rate", () => {
  expect(imageModels["grok-imagine-image-2.0"].cost).toEqual({
    perImage: IMAGE_2_0_PER_IMAGE_USD,
  });
});

/**
 * The no-fifth-id guard: any generated xai model that outputs images or video
 * is an Imagine model and must appear in a mirror, rather than staying
 * silently unreachable from `xai.image` / `xai.video`.
 */
test("every image/video-emitting generated id appears in a mirror", () => {
  const generatedImagine = Object.values(generatedModels)
    .filter((info) => {
      const output = info.modalities.output as readonly string[];
      return output.includes("image") || output.includes("video");
    })
    .map((info) => info.id)
    .sort();
  const mirrored = MIRRORED.map(([id]) => id).sort();
  expect(generatedImagine).toEqual(mirrored);
});

test("the route split matches the generated modalities", () => {
  for (const info of Object.values(imageModels)) {
    expect(info.modalities.output).toContain("image");
  }
  for (const info of Object.values(videoModels)) {
    expect(info.modalities.output).toEqual(["video"]);
  }
});
