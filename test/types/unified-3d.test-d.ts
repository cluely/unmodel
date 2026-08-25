/**
 * Type-level tests for `unmodel/3d`'s ready-made pack. NOT run by `bun test` —
 * this file is only type-checked (`bun run check` / tsc --noEmit).
 *
 * The four properties every category entry has are here, and then the one that
 * is this category's own and is unlike anything else in the library: `prompt`
 * and `image` are ALTERNATIVES, and one row field moves them in opposite
 * directions. Three arms, all populated:
 *
 * | row `inputs` | `prompt` | `image` | witness |
 * |---|---|---|---|
 * | `["text"]` | required | `never` | `fal/tripo3d/h3.1/text-to-3d` |
 * | `["image"]` | `never` | required | `fal/fal-ai/trellis` |
 * | both | optional | optional | `fal/fal-ai/hyper3d/rodin/v2.5`, every `tripo3d/…` |
 */
import { createThreeD, threeD } from "../../src/unified/3d";
import { threeD as falThreeD } from "../../src/providers/fal/unified-3d";
import { threeD as tripoThreeD } from "../../src/providers/tripo3d/unified";
import type { UnifiedRef } from "../../src/core/unified/types";
import type { ThreeDParams } from "../../src/core/unified/vocabulary/3d";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

type PackRefs = UnifiedRef<typeof falThreeD | typeof tripoThreeD>;

expectAssignable<PackRefs>("fal/fal-ai/trellis");
expectAssignable<PackRefs>("fal/fal-ai/trellis-2");
expectAssignable<PackRefs>("fal/fal-ai/triposr");
expectAssignable<PackRefs>("fal/fal-ai/hunyuan3d/v2");
expectAssignable<PackRefs>("fal/fal-ai/hyper3d/rodin/v2.5");
expectAssignable<PackRefs>("fal/tripo3d/h3.1/text-to-3d");
expectAssignable<PackRefs>("fal/tripo3d/p1/image-to-3d");
expectAssignable<PackRefs>("fal/meshy/v7/text-to-3d");
expectAssignable<PackRefs>("fal/hitem3d/hi3d/v3.0/image-to-3d");
expectAssignable<PackRefs>("tripo3d/v3.1-20260211");
expectAssignable<PackRefs>("tripo3d/P1-20260311");
// @ts-expect-error — the multiview route needs two views; `image` is one reference.
expectAssignable<PackRefs>("fal/tripo3d/h3.1/multiview-to-3d");
// @ts-expect-error — mesh-in / mesh-out is a different question; see curation.json.
expectAssignable<PackRefs>("fal/tripo3d/tripo/remesh");
// @ts-expect-error — the short alias form is not what the endpoint pages publish.
expectAssignable<PackRefs>("tripo3d/tripo-v3.1");

const PHOTO = { url: "https://example.com/chair.png" } as const;
const PROMPT = "a brass astrolabe on a walnut stand";

function refUnionTests(): void {
  threeD({ model: "fal/tripo3d/h3.1/text-to-3d", prompt: PROMPT });
  threeD({ model: "fal/fal-ai/trellis", image: PHOTO });
  threeD({ model: "tripo3d/v3.1-20260211", prompt: PROMPT });
  // A model newer than this snapshot still works, with a runtime warning.
  threeD({ model: "fal/fal-ai/trellis-3", image: PHOTO });
  // A provider with no adapter is a runtime structural error, not a type error.
  threeD({ model: "meshy/meshy-5", prompt: PROMPT });

  // @ts-expect-error — a typo'd canonical field is caught by ExactKeys.
  threeD({ model: "fal/fal-ai/trellis", imge: PHOTO });
  // @ts-expect-error — and so is a word from a neighbouring category.
  threeD({ model: "fal/fal-ai/trellis", image: PHOTO, aspectRatio: "16:9" });
  // @ts-expect-error — a mesh has no frame, so no sizing word reaches this vocabulary.
  threeD({ model: "fal/fal-ai/trellis", image: PHOTO, resolution: "4k" });
  // @ts-expect-error — nor an output-container word: it has five spellings and no home here.
  threeD({ model: "fal/fal-ai/trellis", image: PHOTO, format: "glb" });
}

/**
 * The input narrowing — the property this category exists to make expressible,
 * and the first in the library where one row field decides TWO canonical words.
 */
function inputArmTests(): void {
  // Text-only: `prompt` is REQUIRED, and an intersection could not have made it
  // so — which is why `ThreeDParamsBase` omits both fields (the replacement-arm
  // law in `vocabulary/model-params.ts`).
  threeD({ model: "fal/tripo3d/h3.1/text-to-3d", prompt: PROMPT });
  // @ts-expect-error — a text-driven route with nothing to build from.
  threeD({ model: "fal/tripo3d/h3.1/text-to-3d" });
  threeD({
    model: "fal/tripo3d/h3.1/text-to-3d",
    prompt: PROMPT,
    // @ts-expect-error — …and no field for a reference picture.
    image: PHOTO,
  });

  // Image-only: the mirror image, and the arm the majority of the roster is on.
  threeD({ model: "fal/fal-ai/trellis", image: PHOTO });
  // @ts-expect-error — a reconstruction route with nothing to reconstruct.
  threeD({ model: "fal/fal-ai/trellis" });
  threeD({
    model: "fal/fal-ai/trellis",
    image: PHOTO,
    // @ts-expect-error — TRELLIS builds from the picture and reads no words.
    prompt: PROMPT,
  });

  // Both: neither required, because Rodin publishes both fields and marks
  // neither. A body with NEITHER is a runtime refusal rather than a type error
  // — the row cannot express "at least one of two optional fields".
  threeD({ model: "fal/fal-ai/hyper3d/rodin/v2.5", prompt: PROMPT, image: PHOTO });
  threeD({ model: "fal/fal-ai/hyper3d/rodin/v2.5", prompt: PROMPT });
  threeD({ model: "fal/fal-ai/hyper3d/rodin/v2.5", image: PHOTO });
  threeD({ model: "fal/fal-ai/hyper3d/rodin/v2.5" });

  // The native provider is on the both-arm at every model, because there the
  // ROUTE follows the input rather than the id.
  threeD({ model: "tripo3d/v2.5-20250123", prompt: PROMPT });
  threeD({ model: "tripo3d/v2.5-20250123", image: PHOTO });
}

/** The image ref's two shapes, and the media type the inline arm needs. */
function imageShapeTests(): void {
  threeD({ model: "fal/fal-ai/trellis", image: { data: "AAAA", mimeType: "image/png" } });
  threeD({
    model: "fal/fal-ai/trellis",
    // @ts-expect-error — inline bytes need the media type; a bare `data` cannot build a data: URI.
    image: { data: "AAAA" },
  });
  threeD({
    model: "fal/fal-ai/trellis",
    // @ts-expect-error — a mesh is not a reference picture; the arm is `image/*`.
    image: { data: "AAAA", mimeType: "model/gltf-binary" },
  });
}

/**
 * The result is each provider's own `Validated`, and its BODY keys are
 * deliberately not on it here — a fact about this category rather than a gap.
 *
 * `Omit<T, "endpoint">` over a union of nineteen fal bodies plus two Tripo ones
 * keeps only the keys they all share, and these share none: nine take a
 * `prompt`, four spellings of the image are in play, and Tripo's body carries a
 * `model` field the fal ones do not. A caller who wants the body keys typed
 * narrows the ENDPOINT at the hand surface instead:
 * `FalThreeDArm<"fal-ai/trellis">` has `mesh_simplify` and nothing of Meshy's,
 * and `TextToModelParams` has all three of Tripo's seeds.
 */
function resultTypeTests(): void {
  const result = threeD({ model: "fal/fal-ai/trellis", image: PHOTO });
  expectAssignable<string>(result.request.url);
  result.toSdk("fal");
  // `endpoint` is fal's route selector and is stripped into `.request.url`.
  expectTrue<IsNever<KeyIn<typeof result, "endpoint">>>();
  expectAssignable<readonly { code: string }[]>(result.warnings);

  const native = threeD({ model: "tripo3d/v3.1-20260211", prompt: PROMPT });
  native.toSdk("tripo3d");
  expectAssignable<string>(native.request.url);
}

function providerOptionsTests(): void {
  threeD({
    model: "fal/fal-ai/trellis",
    image: PHOTO,
    providerOptions: { fal: { ss_sampling_steps: 20 } },
  });
  threeD({
    model: "tripo3d/v3.1-20260211",
    prompt: PROMPT,
    providerOptions: { tripo3d: { export_uv: false } },
  });
  threeD({
    model: "fal/fal-ai/trellis",
    image: PHOTO,
    // @ts-expect-error — not for a provider this pack does not have.
    providerOptions: { meshy: {} },
  });

  const falOnly = createThreeD([falThreeD]);
  falOnly({ model: "fal/fal-ai/triposr", image: PHOTO, providerOptions: { fal: {} } });
  const nativeOnly = createThreeD([tripoThreeD]);
  nativeOnly({ model: "tripo3d/v3.1-20260211", prompt: PROMPT, providerOptions: { tripo3d: {} } });
  // A ref from outside a hand-built pack still COMPILES — it takes the degraded
  // arm, the same one an unreleased model takes — and is refused at run time as
  // a structural `TranslationUnavailableError`. That asymmetry is deliberate:
  // making it a type error would also make every model newer than this snapshot
  // uncallable. What the pack DOES narrow is `providerOptions`:
  nativeOnly({ model: "fal/fal-ai/trellis", image: PHOTO });
  nativeOnly({
    model: "tripo3d/v3.1-20260211",
    prompt: PROMPT,
    // @ts-expect-error — a pack built from one adapter knows only that provider's options.
    providerOptions: { fal: {} },
  });
}

function noToApiTests(): void {
  const result = threeD({ model: "fal/fal-ai/trellis", image: PHOTO });
  expectTrue<IsNever<KeyIn<typeof result, "toApi">>>();
  expectTrue<IsNever<KeyIn<typeof result, "toApiSafe">>>();
  expectTrue<KeyIn<typeof result, "toSdk"> extends "toSdk" ? true : false>();
  expectTrue<KeyIn<typeof result, "request"> extends "request" ? true : false>();
}

/**
 * Per-model extras — every word this category deliberately kept OUT of the
 * vocabulary, arriving typed from each route's own wire interface.
 *
 * `texture` is the one to read: it is a `boolean` at Tripo, spelled
 * `textured_mesh` at Hunyuan3D, `enable_texture` at Hi3D and `should_texture`
 * at Meshy, and it is `never` at TRELLIS, which has no texture switch at all.
 * One idea, five names, and no two vendors agreeing — which is the whole
 * argument for five canonical words.
 */
function extrasNarrowingTests(): void {
  threeD({ model: "fal/fal-ai/trellis", image: PHOTO, mesh_simplify: 0.95, texture_size: 1024 });
  threeD({ model: "fal/fal-ai/hunyuan3d/v2", image: PHOTO, textured_mesh: true, octree_resolution: 512 });
  threeD({ model: "fal/meshy/v7/text-to-3d", prompt: PROMPT, target_polycount: 30000, ultra_mode: true });
  threeD({ model: "tripo3d/v3.1-20260211", prompt: PROMPT, texture: false, pbr: false, smart_low_poly: true });

  threeD({
    model: "fal/fal-ai/trellis",
    image: PHOTO,
    // @ts-expect-error — TRELLIS has no texture switch of any spelling.
    textured_mesh: true,
  });
  threeD({
    model: "tripo3d/v2.5-20250123",
    prompt: PROMPT,
    // @ts-expect-error — the legacy generation takes none of the version-gated seven.
    geometry_quality: "detailed",
  });

  // The REAL `model` wire field, at the one endpoint that has one. `model` is
  // the unified REF at every category, so an extras key of the same name would
  // reduce the whole call to `never` — which is why `NEVER_AN_EXTRA` in
  // scripts/codegen-fal.ts drops it from the row and it is named through the
  // escape hatch instead.
  threeD({
    model: "fal/hitem3d/hi3d/v3.0/image-to-3d",
    image: PHOTO,
    providerOptions: { fal: { model: "hi3dv3.0" } },
  });
}

/** A dynamic or unknown ref degrades to the wide vocabulary, never to `never`. */
function degradedRefTests(): void {
  const dynamic: string = process.env["MODEL"] ?? "fal/fal-ai/trellis";
  threeD({ model: dynamic, image: PHOTO });
  // Degraded, BOTH content words are legal and neither is required — the type
  // cannot say which mood this route reads, so it must not refuse either.
  threeD({ model: dynamic, prompt: PROMPT });
  threeD({ model: dynamic, prompt: PROMPT, image: PHOTO, seed: 7 });
  // Extras degrade to "every name in the build, typed `unknown`"…
  threeD({ model: "fal/fal-ai/trellis-3", image: PHOTO, mesh_simplify: 0.9 });
  // @ts-expect-error — …and a typo is still caught by `ExactKeys`.
  threeD({ model: "fal/fal-ai/trellis-3", image: PHOTO, mesh_simplfy: 0.9 });
}

expectAssignable<"3d">(falThreeD.category);
expectAssignable<"fal">(falThreeD.provider);
expectAssignable<"3d">(tripoThreeD.category);
expectAssignable<"tripo3d">(tripoThreeD.provider);
expectAssignable<readonly string[]>(falThreeD.models);
expectAssignable<ThreeDParams["model"]>("fal/fal-ai/trellis");
expectAssignable<ThreeDParams["model"]>("tripo3d/v3.1-20260211");

export {
  refUnionTests,
  inputArmTests,
  imageShapeTests,
  resultTypeTests,
  providerOptionsTests,
  noToApiTests,
  extrasNarrowingTests,
  degradedRefTests,
};
