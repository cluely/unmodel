/**
 * Type-level tests for `unmodel/image`'s ready-made pack. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc --noEmit).
 *
 * The runtime suites next door prove what a call *does*; these prove what an
 * editor knows before the call is made:
 *
 *  1. **The ref union comes from the fifteen adapters' `as const` model
 *     arrays.** `"black-forest-labs/flux-2-pro"` is in it,
 *     `"black-forest-labs/flux-3"` is not — but an unregistered ref is still
 *     *callable*, because a model released after this snapshot must not need a
 *     library upgrade.
 *  2. **`aspectRatio` and `dimensions` are exclusive**, and the union that
 *     states it survives `UnifiedInput`'s substitution of `model`. This is the
 *     one invariant the vocabulary exists to carry, and a plain `Omit` would
 *     silently delete it.
 *  3. **The result is the ref'd provider's own `Validated`**, including for the
 *     providers whose `compile` dispatches between two routes — a union of two
 *     bodies, not one of them widened.
 *  4. **`providerOptions` is keyed by the providers in the pack.** A typo is a
 *     compile error rather than an override that silently never happens.
 *  5. **There is no `.toApi`.** Retargeting is a chat-dialect feature; a media
 *     result must not advertise one.
 *  6. **`size`, `aspectRatio`, `resolution` and the extras narrow per MODEL.**
 *     The adapters' `modelParams` tables are `as const`, the ref selects a row,
 *     and the row types four things at once — which is the whole feature.
 */
import { createImage, image } from "../../src/unified/image";
import { image as blackForestLabsImage } from "../../src/providers/black-forest-labs/unified";
import { image as stabilityImage } from "../../src/providers/stability/unified-image";
import { image as googleImage } from "../../src/providers/google/unified-image";
import type { GoogleImagenInstance } from "../../src/providers/google/image";
import { image as ideogramImage } from "../../src/providers/ideogram/unified";
import { image as openaiImage } from "../../src/providers/openai/unified-image";
import type { UnifiedRef } from "../../src/core/unified/types";
import type { ImageParams } from "../../src/core/unified/vocabulary/image";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

// ---------------------------------------------------------------------------
// 1 · The ref union
// ---------------------------------------------------------------------------

type PackRefs = UnifiedRef<
  | typeof openaiImage
  | typeof googleImage
  | typeof blackForestLabsImage
  | typeof ideogramImage
>;

expectAssignable<PackRefs>("openai/gpt-image-2");
expectAssignable<PackRefs>("openai/dall-e-3");
expectAssignable<PackRefs>("google/imagen-4.0-generate-001");
// Both FLUX generations are one provider, so both are in one union.
expectAssignable<PackRefs>("black-forest-labs/flux-2-pro");
expectAssignable<PackRefs>("black-forest-labs/flux-pro-1.1-ultra");
// Ideogram's refs are pseudo-ids: the route has no `model` wire param at all.
expectAssignable<PackRefs>("ideogram/ideogram-3.0-quality");
expectAssignable<PackRefs>("ideogram/ideogram-4.0-turbo");
// @ts-expect-error — a model no adapter declares is not in the union…
expectAssignable<PackRefs>("black-forest-labs/flux-3");
// @ts-expect-error — …and neither is a provider from another category.
expectAssignable<PackRefs>("elevenlabs/eleven_v3");

function refUnionTests(): void {
  // The union drives autocomplete…
  image({ model: "openai/gpt-image-2", prompt: "a lighthouse in fog" });
  image({ model: "krea/krea-2/large", prompt: "hi", aspectRatio: "1:1" });
  // …including for a model id that contains a slash of its own: the ref splits
  // on the FIRST slash, so `krea-2/large` survives intact.
  image({ model: "vidu/viduq2", prompt: "hi" });
  // …but does not gate the call: a model newer than this snapshot still works
  // and draws a runtime `unknown_model` warning.
  image({ model: "openai/gpt-image-3", prompt: "hi" });
  // A provider with no adapter is a runtime structural error, not a type error:
  // the ref tail is `(string & {})`, deliberately.
  image({ model: "elevenlabs/eleven_v3", prompt: "hi" });

  // @ts-expect-error — `prompt` is not optional; there is nothing to draw.
  image({ model: "openai/gpt-image-2" });
  // @ts-expect-error — a typo'd canonical field is caught by ExactKeys.
  image({ model: "openai/gpt-image-2", prompt: "hi", aspecRatio: "16:9" });
  // @ts-expect-error — `"1024x1024"` is a provider spelling; the vocabulary has tiers.
  image({ model: "openai/gpt-image-2", prompt: "hi", resolution: "1024x1024" });
  // @ts-expect-error — and `"8k"` is not one of the three tiers.
  image({ model: "openai/gpt-image-2", prompt: "hi", resolution: "8k" });

  // A field the provider does not support is a RUNTIME error (declared on the
  // adapter), never a compile error: the vocabulary is one shape for everyone.
  image({ model: "openai/gpt-image-2", prompt: "hi", seed: 7 });
}

// ---------------------------------------------------------------------------
// 2 · aspectRatio XOR dimensions
// ---------------------------------------------------------------------------

function sizingXorTests(): void {
  // Either arm alone is fine…
  image({ model: "openai/gpt-image-2", prompt: "hi", aspectRatio: "16:9" });
  image({ model: "openai/gpt-image-2", prompt: "hi", dimensions: { width: 1344, height: 768 } });
  // …and a tier rides on both arms.
  image({ model: "openai/gpt-image-2", prompt: "hi", aspectRatio: "16:9", resolution: "2k" });

  // @ts-expect-error — but never both: they are two spellings of one decision.
  image({
    model: "openai/gpt-image-2",
    prompt: "hi",
    aspectRatio: "16:9",
    dimensions: { width: 1344, height: 768 },
  });

  // The preset union drives autocomplete without closing the domain: a ratio
  // no preset names is still legal, and which ones a model accepts is the
  // adapter's business at runtime.
  image({ model: "openai/gpt-image-2", prompt: "hi", aspectRatio: "5:4" });
  // @ts-expect-error — but a non-ratio string is not a ratio.
  image({ model: "openai/gpt-image-2", prompt: "hi", aspectRatio: "widescreen" });
  // @ts-expect-error — and `dimensions` needs both edges.
  image({ model: "openai/gpt-image-2", prompt: "hi", dimensions: { width: 1024 } });
}

/** The XOR survives `UnifiedInput`'s substitution of `model` — the whole point. */
expectAssignable<ImageParams>({ model: "openai/gpt-image-2", prompt: "hi", aspectRatio: "16:9" });
expectAssignable<ImageParams>({
  model: "openai/gpt-image-2",
  prompt: "hi",
  dimensions: { width: 1024, height: 1024 },
});

// ---------------------------------------------------------------------------
// 3 · The result is the ref'd provider's own
// ---------------------------------------------------------------------------

function resultTypeTests(): void {
  const openai = image({ model: "openai/gpt-image-2", prompt: "hi" });
  expectAssignable<string>(openai.prompt);
  expectAssignable<string>(openai.request.url);
  openai.toSdk("openai");
  // @ts-expect-error — "google" is not one of openai.image's SDK targets.
  openai.toSdk("google");

  const google = image({ model: "google/imagen-4.0-generate-001", prompt: "hi" });
  // Imagen's body nests the prompt and strips the model into the URL.
  expectAssignable<GoogleImagenInstance[]>(google.instances);
  expectTrue<IsNever<KeyIn<typeof google, "prompt">>>();
  google.toSdk("google");

  // Warnings ride on every result, whichever provider answered.
  expectAssignable<readonly { code: string }[]>(openai.warnings);
  expectAssignable<readonly { code: string }[]>(google.warnings);
}

// ---------------------------------------------------------------------------
// 4 · providerOptions is keyed by the pack
// ---------------------------------------------------------------------------

function providerOptionsTests(): void {
  // One literal may carry blocks for every provider it might be pointed at.
  image({
    model: "openai/gpt-image-2",
    prompt: "hi",
    providerOptions: {
      openai: { quality: "high" },
      google: { parameters: { personGeneration: "allow_adult" } },
    },
  });
  // @ts-expect-error — but not for a provider this pack does not have.
  image({ model: "openai/gpt-image-2", prompt: "hi", providerOptions: { opneai: { n: 1 } } });
  // @ts-expect-error — nor for one that is simply not an image provider.
  image({ model: "openai/gpt-image-2", prompt: "hi", providerOptions: { elevenlabs: { n: 1 } } });

  // A hand-built pack narrows the key set to exactly its own adapters.
  const pair = createImage([openaiImage, ideogramImage]);
  pair({ model: "openai/gpt-image-2", prompt: "hi", providerOptions: { openai: {} } });
  // @ts-expect-error — google is not in THIS pack, even though it is in the full one.
  pair({ model: "openai/gpt-image-2", prompt: "hi", providerOptions: { google: {} } });
  // @ts-expect-error — and its ref union is narrower too.
  expectAssignable<UnifiedRef<typeof openaiImage | typeof ideogramImage>>("google/imagen-4.0-generate-001");
}

// ---------------------------------------------------------------------------
// 5 · No retargeting on a media result
// ---------------------------------------------------------------------------

function noToApiTests(): void {
  const result = image({ model: "openai/gpt-image-2", prompt: "hi" });
  expectTrue<IsNever<KeyIn<typeof result, "toApi">>>();
  expectTrue<IsNever<KeyIn<typeof result, "toApiSafe">>>();
  // The members that DO exist, for contrast.
  expectTrue<KeyIn<typeof result, "toSdk"> extends "toSdk" ? true : false>();
  expectTrue<KeyIn<typeof result, "request"> extends "request" ? true : false>();
}

// ---------------------------------------------------------------------------
// 6 · Per-model narrowing
// ---------------------------------------------------------------------------

function sizeNarrowingTests(): void {
  // gpt-image-2's own presets, straight out of `GPT_IMAGE_2_SIZES` — the same
  // array `openai.image` validates against.
  image({ model: "openai/gpt-image-2", prompt: "hi", size: "3840x2160" });
  image({ model: "openai/gpt-image-2", prompt: "hi", size: "auto" });

  // `"1920x1080"` COMPILES and FAILS AT RUN TIME, and both halves are
  // deliberate. gpt-image-2's `size` is free-form — any `WIDTHxHEIGHT` inside
  // the documented rule space is legal — so the type carries a
  // `` `${number}x${number}` `` tail beside the presets, and a tail cannot
  // encode "both edges divisible by 16". 1080 is not, which is exactly why
  // 1920x1080 is absent from the preset list and 2560x1440 is in it.
  // `test/unified/image-e2e.test.ts` asserts the runtime refusal.
  image({ model: "openai/gpt-image-2", prompt: "hi", size: "1920x1080" });
  // @ts-expect-error — but a string that is not a size at all is not a size.
  image({ model: "openai/gpt-image-2", prompt: "hi", size: "enormous" });

  // dall-e-3's `size` is a CLOSED enum, so it gets no tail: the list is the
  // limit, and a template tail would promise otherwise.
  image({ model: "openai/dall-e-3", prompt: "hi", size: "1792x1024" });
  // @ts-expect-error — three values, and this is not one of them.
  image({ model: "openai/dall-e-3", prompt: "hi", size: "1920x1080" });
  // @ts-expect-error — nor is gpt-image-1's enum dall-e-3's.
  image({ model: "openai/gpt-image-1", prompt: "hi", size: "1792x1024" });
  image({ model: "openai/gpt-image-1", prompt: "hi", size: "1536x1024" });

  // A model whose API has no size field at all types `size` as `never`, so an
  // editor steers to `aspectRatio` — which is narrowed to Stability's nine.
  // @ts-expect-error — the three generate routes take a shape and nothing else.
  image({ model: "stability/stable-image-ultra", prompt: "hi", size: "1024x1024" });
  image({ model: "stability/stable-image-ultra", prompt: "hi", aspectRatio: "9:21" });
  // @ts-expect-error — 4:3 is not one of Stability's nine.
  image({ model: "stability/stable-image-ultra", prompt: "hi", aspectRatio: "4:3" });
  // …while a provider whose ratios are *derived* keeps the wide vocabulary.
  image({ model: "openai/gpt-image-2", prompt: "hi", aspectRatio: "5:4" });

  // `resolution` narrows to the tiers the model can actually reach.
  image({ model: "openai/gpt-image-2", prompt: "hi", resolution: "4k" });
  // @ts-expect-error — the gpt-image-1 family's sizes are all about a megapixel.
  image({ model: "openai/gpt-image-1", prompt: "hi", resolution: "2k" });
  // @ts-expect-error — Imagen Fast has no `sampleImageSize` field at all.
  image({ model: "google/imagen-4.0-fast-generate-001", prompt: "hi", resolution: "1k" });
  image({ model: "google/imagen-4.0-generate-001", prompt: "hi", resolution: "2k" });

  // The XOR now covers three fields rather than two.
  // @ts-expect-error
  image({ model: "openai/gpt-image-2", prompt: "hi", size: "1024x1024", aspectRatio: "1:1" });
  // @ts-expect-error
  image({
    model: "openai/gpt-image-2",
    prompt: "hi",
    size: "1024x1024",
    dimensions: { width: 1024, height: 1024 },
  });
}

function extrasNarrowingTests(): void {
  // THE case this whole mechanism exists for. The OpenAI SDK's own type offers
  // `transparent` on every GPT image model; gpt-image-2 answers a recorded 400
  // (test/fixtures/provider-errors/openai/images-gpt-image-2-background.json).
  image({ model: "openai/gpt-image-1", prompt: "hi", background: "transparent" });
  // @ts-expect-error — and the same word on gpt-image-2 does not compile.
  image({ model: "openai/gpt-image-2", prompt: "hi", background: "transparent" });
  image({ model: "openai/gpt-image-2", prompt: "hi", background: "opaque" });
  image({ model: "openai/gpt-image-2", prompt: "hi", background: null });

  // `style` exists on exactly one model on this endpoint.
  image({ model: "openai/dall-e-3", prompt: "hi", style: "vivid" });
  // @ts-expect-error — not on gpt-image-1…
  image({ model: "openai/gpt-image-1", prompt: "hi", style: "vivid" });
  // @ts-expect-error — …and not on gpt-image-2 either.
  image({ model: "openai/gpt-image-2", prompt: "hi", style: "natural" });
  // @ts-expect-error — and a value outside dall-e-3's two is not a style.
  image({ model: "openai/dall-e-3", prompt: "hi", style: "cinematic" });

  // The quality ladders differ per model, and so do the types.
  image({ model: "openai/gpt-image-2", prompt: "hi", quality: "high" });
  // @ts-expect-error — dall-e-3's ladder is "auto" | "standard" | "hd".
  image({ model: "openai/dall-e-3", prompt: "hi", quality: "high" });
  image({ model: "openai/dall-e-3", prompt: "hi", quality: "hd" });

  // Cross-provider: an extra one adapter has is not a key on another's models.
  image({ model: "stability/sd3.5-large", prompt: "hi", cfg_scale: 4 });
  // @ts-expect-error — ultra is a different route with no `cfg_scale`.
  image({ model: "stability/stable-image-ultra", prompt: "hi", cfg_scale: 4 });
  // @ts-expect-error — and `background` is not a Stability param at all.
  image({ model: "stability/stable-image-ultra", prompt: "hi", background: "opaque" });

  // A typo is still a typo, per model.
  // @ts-expect-error
  image({ model: "openai/gpt-image-2", prompt: "hi", bakcground: "opaque" });
}

function degradedRefTests(): void {
  // A model this snapshot does not carry degrades to the wide vocabulary: the
  // union drives autocomplete, it does not gate the API.
  image({ model: "openai/gpt-image-9", prompt: "hi", size: "1920x1080" });
  image({ model: "openai/gpt-image-9", prompt: "hi", background: "transparent" });
  image({ model: "openai/gpt-image-9", prompt: "hi", aspectRatio: "5:4", resolution: "4k" });

  // …and so does a ref built at run time, for the same reason.
  const dynamic: string = "openai/gpt-image-2";
  image({ model: dynamic, prompt: "hi", size: "1920x1080" });
  image({ model: dynamic, prompt: "hi", style: "vivid" });

  // Degraded is not unchecked: a key no model in the pack declares is still a
  // typo, and `ExactKeys` still says so.
  // @ts-expect-error
  image({ model: dynamic, prompt: "hi", bakcground: "opaque" });
}

// ---------------------------------------------------------------------------
// The adapters satisfy the category contract
// ---------------------------------------------------------------------------

expectAssignable<"image">(openaiImage.category);
expectAssignable<"openai">(openaiImage.provider);
expectAssignable<readonly string[]>(openaiImage.models);
expectAssignable<"image">(blackForestLabsImage.category);
expectAssignable<readonly string[]>(ideogramImage.models);

expectAssignable<"image">(stabilityImage.category);
expectAssignable<Readonly<Record<string, object>>>(openaiImage.modelParams);
expectAssignable<Readonly<Record<string, object>>>(stabilityImage.modelParams);

export {
  refUnionTests,
  sizingXorTests,
  resultTypeTests,
  providerOptionsTests,
  noToApiTests,
  sizeNarrowingTests,
  extrasNarrowingTests,
  degradedRefTests,
};
