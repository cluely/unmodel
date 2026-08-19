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
 */
import { createImage, image } from "../../src/unified/image";
import { image as blackForestLabsImage } from "../../src/providers/black-forest-labs/unified";
import { image as googleImage } from "../../src/providers/google/unified";
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
  expectAssignable<Record<string, unknown>[]>(google.instances);
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
// The adapters satisfy the category contract
// ---------------------------------------------------------------------------

expectAssignable<"image">(openaiImage.category);
expectAssignable<"openai">(openaiImage.provider);
expectAssignable<readonly string[]>(openaiImage.models);
expectAssignable<"image">(blackForestLabsImage.category);
expectAssignable<readonly string[]>(ideogramImage.models);

export { refUnionTests, sizingXorTests, resultTypeTests, providerOptionsTests, noToApiTests };
