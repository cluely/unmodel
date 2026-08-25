/**
 * Type-level tests for `unmodel/upscale`'s ready-made pack. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc --noEmit).
 *
 * The four properties every category entry has are here, and then the two that
 * are this category's own: `source` narrows by MEDIUM inside one category, and
 * `factor` narrows three ways — a range, a closed set, and nothing at all.
 */
import { createUpscale, upscale } from "../../src/unified/upscale";
import { upscale as falUpscale } from "../../src/providers/fal/unified-upscale";
import { upscale as topazUpscale } from "../../src/providers/topaz/unified";
import type { UnifiedRef } from "../../src/core/unified/types";
import type { UpscaleParams } from "../../src/core/unified/vocabulary/upscale";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

type PackRefs = UnifiedRef<typeof falUpscale | typeof topazUpscale>;

expectAssignable<PackRefs>("fal/fal-ai/clarity-upscaler");
expectAssignable<PackRefs>("fal/fal-ai/aura-sr");
expectAssignable<PackRefs>("fal/fal-ai/esrgan");
expectAssignable<PackRefs>("fal/fal-ai/recraft/upscale/crisp");
expectAssignable<PackRefs>("fal/fal-ai/seedvr/upscale/image");
expectAssignable<PackRefs>("fal/fal-ai/seedvr/upscale/video");
expectAssignable<PackRefs>("fal/topaz/upscale/image/precision");
expectAssignable<PackRefs>("fal/topaz/upscale/image/generative");
expectAssignable<PackRefs>("fal/topaz/upscale/video/precision");
expectAssignable<PackRefs>("fal/blackforestlabs/flux-video-upscale");
// @ts-expect-error — Topaz's other image tools are not upscalers and are not curated.
expectAssignable<PackRefs>("fal/topaz/denoise/image");
// @ts-expect-error — background removal is an EDIT: `unmodel/image-edit`'s question.
expectAssignable<PackRefs>("fal/fal-ai/birefnet");

// The native half. The ids have SPACES in them because Topaz's `model` field
// takes product names rather than slugs — see src/providers/topaz/models.ts.
expectAssignable<PackRefs>("topaz/Standard V2");
expectAssignable<PackRefs>("topaz/Upscale High Fidelity V3");
expectAssignable<PackRefs>("topaz/Text Refine");
expectAssignable<PackRefs>("topaz/Redefine");
expectAssignable<PackRefs>("topaz/Wonder 3.5");
expectAssignable<PackRefs>("topaz/Bloom Realism");
// @ts-expect-error — in the published OpenAPI enum only: no page, no credit table.
expectAssignable<PackRefs>("topaz/Recovery V2");
// @ts-expect-error — denoise is a separate route and does not upscale.
expectAssignable<PackRefs>("topaz/Denoise Max");

const STILL = { url: "https://example.com/portrait.png" } as const;
const CLIP = { url: "https://example.com/take-3.mp4" } as const;

function refUnionTests(): void {
  upscale({ model: "fal/fal-ai/clarity-upscaler", source: STILL });
  upscale({ model: "fal/topaz/upscale/video/precision", source: CLIP, factor: 2 });
  // A model newer than this snapshot still works, with a runtime warning.
  upscale({ model: "fal/fal-ai/clarity-upscaler-v2", source: STILL, factor: 3 });
  // A provider with no adapter is a runtime structural error, not a type error.
  upscale({ model: "clipdrop/image-upscaling", source: STILL });

  // @ts-expect-error — `source` is not optional; there is nothing to enlarge.
  upscale({ model: "fal/fal-ai/clarity-upscaler", factor: 2 });
  // @ts-expect-error — a typo'd canonical field is caught by ExactKeys.
  upscale({ model: "fal/fal-ai/clarity-upscaler", sorce: STILL });
  // @ts-expect-error — and so is a word from a neighbouring category.
  upscale({ model: "fal/fal-ai/clarity-upscaler", source: STILL, aspectRatio: "16:9" });
  // @ts-expect-error — `size` belongs to `unmodel/image-edit`; here the answer is a multiple.
  upscale({ model: "fal/fal-ai/clarity-upscaler", source: STILL, size: "1024x1024" });
}

/**
 * The source narrowing — inside one category, which is what makes it different
 * from its lipsync and avatar cousins.
 *
 * `{ url }` is structurally identical whichever medium is behind it, so the
 * type can only speak where the caller does: the INLINE arm carries a
 * `mimeType` and that is what separates a still from a clip. Seven fal rows say
 * `sources: ["image"]` and three say `["video"]`, and two of them are the same
 * vendor's same product on two paths.
 */
function sourceShapeTests(): void {
  upscale({
    model: "fal/fal-ai/seedvr/upscale/image",
    source: { data: "AAAA", mimeType: "image/png" },
  });
  upscale({
    model: "fal/fal-ai/seedvr/upscale/video",
    source: { data: "AAAA", mimeType: "video/mp4" },
  });
  upscale({
    model: "fal/fal-ai/seedvr/upscale/video",
    // @ts-expect-error — a still handed to the clip arm of the same product.
    source: { data: "AAAA", mimeType: "image/png" },
  });
  upscale({
    model: "fal/fal-ai/seedvr/upscale/image",
    // @ts-expect-error — …and the other way round.
    source: { data: "AAAA", mimeType: "video/mp4" },
  });
  upscale({
    model: "fal/fal-ai/clarity-upscaler",
    // @ts-expect-error — inline bytes need the media type; a bare `data` cannot build a data: URI.
    source: { data: "AAAA" },
  });
}

/**
 * The factor narrowing — three arms, and each one is a different sentence.
 *
 * A RANGE keeps the wide `number` and the provider's own bounds check has the
 * last word; a closed SET is a compile error naming the values; and an EMPTY
 * list types the field `never`, which says "this route has no multiplier"
 * rather than "you picked the wrong one".
 */
function factorNarrowingTests(): void {
  // Range: any number compiles, and 12 is refused at run time by SeedVR's own
  // ceiling of 10 rather than here.
  upscale({ model: "fal/fal-ai/seedvr/upscale/image", source: STILL, factor: 8 });
  upscale({ model: "fal/fal-ai/clarity-upscaler", source: STILL, factor: 2.5 });

  // Closed set: `fal-ai/aura-sr` publishes a `const 4`.
  upscale({ model: "fal/fal-ai/aura-sr", source: STILL, factor: 4 });
  // @ts-expect-error — 2 is not 4, and there is nothing in between to round to.
  upscale({ model: "fal/fal-ai/aura-sr", source: STILL, factor: 2 });

  // Empty: `fal-ai/recraft/upscale/crisp` chooses its own output size.
  upscale({ model: "fal/fal-ai/recraft/upscale/crisp", source: STILL });
  // @ts-expect-error — `factor` is `never` here; there is nowhere to put it.
  upscale({ model: "fal/fal-ai/recraft/upscale/crisp", source: STILL, factor: 2 });
}

/**
 * The result is fal's own `Validated`, and its BODY keys are deliberately not
 * on it here — which is a fact about this category rather than a gap.
 *
 * `Omit<T, "endpoint">` over a union of ten endpoint bodies keeps only the keys
 * they all share, and these ten share none: seven declare `image_url` and three
 * declare `video_url`. At `unmodel/lipsync` the same expression keeps
 * `video_url` and `audio_url`, because all eight of those bodies have them.
 *
 * So the unified result exposes the four things every category's does —
 * `request`, `toSdk`, `warnings`, and the estimate — and a caller who wants the
 * body keys typed narrows the ENDPOINT instead, at the hand surface:
 * `FalUpscaleArm<"fal-ai/clarity-upscaler">` has `image_url` and
 * `upscale_factor` and nothing of Topaz's.
 */
function resultTypeTests(): void {
  const result = upscale({ model: "fal/fal-ai/clarity-upscaler", source: STILL, factor: 2 });
  expectAssignable<string>(result.request.url);
  result.toSdk("fal");
  // `endpoint` is the route selector and is stripped into `.request.url`.
  expectTrue<IsNever<KeyIn<typeof result, "endpoint">>>();
  expectAssignable<readonly { code: string }[]>(result.warnings);
}

function providerOptionsTests(): void {
  upscale({
    model: "fal/fal-ai/clarity-upscaler",
    source: STILL,
    providerOptions: { fal: { resemblance: 0.8 } },
  });
  upscale({
    model: "topaz/Redefine",
    source: STILL,
    providerOptions: { topaz: { output_format: "png" } },
  });
  upscale({
    model: "fal/fal-ai/esrgan",
    source: STILL,
    // @ts-expect-error — not for a provider this pack does not have.
    providerOptions: { sync: {} },
  });

  const one = createUpscale([falUpscale]);
  one({ model: "fal/fal-ai/aura-sr", source: STILL, providerOptions: { fal: {} } });
}

function noToApiTests(): void {
  const result = upscale({ model: "fal/fal-ai/clarity-upscaler", source: STILL });
  expectTrue<IsNever<KeyIn<typeof result, "toApi">>>();
  expectTrue<IsNever<KeyIn<typeof result, "toApiSafe">>>();
  expectTrue<KeyIn<typeof result, "toSdk"> extends "toSdk" ? true : false>();
  expectTrue<KeyIn<typeof result, "request"> extends "request" ? true : false>();
}

/**
 * Per-model extras — the dials that make one upscaler's output look different
 * from another's, and the reason none of them is a canonical word.
 *
 * `creativity` is a 0..1 NUMBER at Clarity, a 1..6 INTEGER at Topaz generative,
 * and a two-member `0 | 1` enum at FLUX. One name, three types, three vendors —
 * which is a coincidence with a shape rather than a vocabulary, and it arrives
 * typed from each endpoint's own wire interface.
 */
function extrasNarrowingTests(): void {
  upscale({ model: "fal/fal-ai/clarity-upscaler", source: STILL, creativity: 0.35, resemblance: 0.6 });
  upscale({ model: "fal/topaz/upscale/image/generative", source: STILL, creativity: 4, texture: 3 });
  upscale({
    model: "fal/fal-ai/esrgan",
    source: STILL,
    // @ts-expect-error — ESRGAN's schema has no creativity dial at all.
    creativity: 0.35,
  });
  upscale({ model: "fal/fal-ai/seedvr/upscale/image", source: STILL, upscale_mode: "target", noise_scale: 0.2 });

  // The REAL `model` wire field, at the four endpoints that have one — and the
  // one wire parameter this provider's generator refuses to make an extra.
  //
  // `model` is the unified REF at every category, so an extras key of the same
  // name lands in the same intersection and reduces the whole call to `never`.
  // So `NEVER_AN_EXTRA` in scripts/codegen-fal.ts drops it from the row, and
  // the network is named through the escape hatch instead:
  upscale({
    model: "fal/topaz/upscale/image/precision",
    source: STILL,
    providerOptions: { fal: { model: "High Fidelity V3" } },
  });
  upscale({
    model: "fal/fal-ai/esrgan",
    source: STILL,
    // @ts-expect-error — …and NOT as a top-level key, which is the collision.
    model_name: "RealESRGAN_x4plus",
  });
  // At the HAND surface it is an ordinary body field with its own enum, which
  // is the half that must keep working: see src/providers/fal/upscale.test.ts.
}

/** A dynamic or unknown ref degrades to the wide vocabulary, never to `never`. */
function degradedRefTests(): void {
  const dynamic: string = process.env["MODEL"] ?? "fal/fal-ai/clarity-upscaler";
  upscale({ model: dynamic, source: STILL, factor: 2 });
  // Degraded, BOTH source shapes are legal and `factor` is any number — the
  // type cannot say which route this is, so it must not refuse either.
  upscale({ model: dynamic, source: { data: "AAAA", mimeType: "video/mp4" }, factor: 7 });
  // Extras degrade to "every name in the build, typed `unknown`"…
  upscale({ model: "fal/fal-ai/clarity-upscaler-v2", source: STILL, creativity: 0.5 });
  // @ts-expect-error — …and a typo is still caught by `ExactKeys`.
  upscale({ model: "fal/fal-ai/clarity-upscaler-v2", source: STILL, creativty: 0.5 });
}

expectAssignable<"upscale">(falUpscale.category);
expectAssignable<"fal">(falUpscale.provider);
expectAssignable<readonly string[]>(falUpscale.models);
expectAssignable<UpscaleParams["model"]>("fal/fal-ai/clarity-upscaler");

export {
  refUnionTests,
  sourceShapeTests,
  factorNarrowingTests,
  resultTypeTests,
  providerOptionsTests,
  noToApiTests,
  extrasNarrowingTests,
  degradedRefTests,
};
