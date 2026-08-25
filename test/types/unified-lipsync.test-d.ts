/**
 * Type-level tests for `unmodel/lipsync`'s ready-made pack. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc --noEmit).
 *
 * The category is five words and two providers, so most of what is worth
 * pinning is the same four properties every category entry has: the ref union
 * comes from BOTH adapters, the result is the ref'd provider's own `Validated`,
 * `providerOptions` is keyed by the pack, and there is no `.toApi`.
 *
 * What is NOT shared with the other entries — and is the reason this wave
 * happened — is the per-model `source` narrowing, at the bottom.
 */
import { createLipsync, lipsync } from "../../src/unified/lipsync";
import { lipsync as falLipsync } from "../../src/providers/fal/unified-lipsync";
import { lipsync as heygenLipsync } from "../../src/providers/heygen/unified-lipsync";
import { lipsync as syncLipsync } from "../../src/providers/sync/unified-lipsync";
import { lipsync as veedLipsync } from "../../src/providers/veed/unified-lipsync";
import type { UnifiedRef } from "../../src/core/unified/types";
import type { LipsyncParams } from "../../src/core/unified/vocabulary/lipsync";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

type PackRefs = UnifiedRef<
  typeof falLipsync | typeof heygenLipsync | typeof syncLipsync | typeof veedLipsync
>;

expectAssignable<PackRefs>("fal/fal-ai/sync-lipsync/v3");
expectAssignable<PackRefs>("fal/fal-ai/sync-lipsync/v2");
expectAssignable<PackRefs>("fal/fal-ai/sync-lipsync/v2/pro");
expectAssignable<PackRefs>("fal/veed/lipsync");
expectAssignable<PackRefs>("fal/veed/lipsync/v2");
expectAssignable<PackRefs>("fal/fal-ai/latentsync");
expectAssignable<PackRefs>("fal/fal-ai/kling-video/lipsync/audio-to-video");
expectAssignable<PackRefs>("fal/fal-ai/pixverse/lipsync");
// @ts-expect-error — the still-driven arm of the same product is `unmodel/avatar`.
expectAssignable<PackRefs>("fal/fal-ai/sync-lipsync/v3/image-to-video");
// @ts-expect-error — the text+voice arm is TTS composed with lipsync; not curated.
expectAssignable<PackRefs>("fal/fal-ai/kling-video/lipsync/text-to-video");

// The native half: the same vendor's own ids, four of which fal is reselling
// above under paths of its own devising.
expectAssignable<PackRefs>("sync/lipsync-2");
expectAssignable<PackRefs>("sync/lipsync-2-pro");
expectAssignable<PackRefs>("sync/lipsync-1.9.0-beta");
expectAssignable<PackRefs>("sync/sync-3");
expectAssignable<PackRefs>("sync/react-1");
// @ts-expect-error — in the full backend spec only: no docs page, no rate, no SDK type.
expectAssignable<PackRefs>("sync/lipsync-2-mini");
// @ts-expect-error — fal's path for sync.'s model is not sync.'s own id.
expectAssignable<PackRefs>("sync/fal-ai/sync-lipsync/v2");

// VEED natively: ONE id, and it is the vendor's own slug rather than either of
// fal's two paths for the same family.
expectAssignable<PackRefs>("veed/lipsync-2.0");
// @ts-expect-error — the still-driven model is `unmodel/avatar`.
expectAssignable<PackRefs>("veed/fabric-1.0");
// @ts-expect-error — fal's paths for VEED's models are not VEED's own ids.
expectAssignable<PackRefs>("veed/lipsync/v2");

// HeyGen natively: two ids that are ONE wire field. `mode: "speed" |
// "precision"` is the only thing separating two products with two pages and a
// 2× price difference, so the ids are HeyGen's own doc slugs and the adapter
// writes `mode` back from the ref.
expectAssignable<PackRefs>("heygen/lipsync-speed");
expectAssignable<PackRefs>("heygen/lipsync-precision");
// @ts-expect-error — the wire VALUE is not the id; `mode` is not a ref.
expectAssignable<PackRefs>("heygen/speed");
// @ts-expect-error — the avatar engines are the other category.
expectAssignable<PackRefs>("heygen/avatar_iv");

const URL_SOURCE = { url: "https://example.com/take-3.mp4" } as const;
const URL_AUDIO = { url: "https://example.com/vo.wav" } as const;

function refUnionTests(): void {
  lipsync({ model: "fal/fal-ai/sync-lipsync/v3", source: URL_SOURCE, audio: URL_AUDIO });
  lipsync({ model: "fal/veed/lipsync/v2", source: URL_SOURCE, audio: URL_AUDIO });
  // A model newer than this snapshot still works, with a runtime warning.
  lipsync({ model: "fal/fal-ai/sync-lipsync/v4", source: URL_SOURCE, audio: URL_AUDIO });
  // A provider with no adapter is a runtime structural error, not a type error.
  lipsync({ model: "topaz/Standard V2", source: URL_SOURCE, audio: URL_AUDIO });

  // @ts-expect-error — `audio` is not optional; there is nothing to sync to.
  lipsync({ model: "fal/fal-ai/sync-lipsync/v3", source: URL_SOURCE });
  // @ts-expect-error — nor is `source`; there is nothing to redub.
  lipsync({ model: "fal/fal-ai/sync-lipsync/v3", audio: URL_AUDIO });
  // @ts-expect-error — a typo'd canonical field is caught by ExactKeys.
  lipsync({ model: "fal/fal-ai/sync-lipsync/v3", sorce: URL_SOURCE, audio: URL_AUDIO });
  // @ts-expect-error — and so is a word from a neighbouring category.
  lipsync({ model: "fal/fal-ai/sync-lipsync/v3", source: URL_SOURCE, audio: URL_AUDIO, prompt: "hi" });
}

/**
 * The source narrowing — the reason `LipsyncParamsBase` omits `source` and
 * `LipsyncModelNarrowing` replaces it rather than intersecting with it.
 *
 * `{ url }` is structurally identical whichever medium is behind it, so the
 * type can only speak where the caller does: the INLINE arm carries a
 * `mimeType` and that is what separates a clip from a still. Every fal lipsync
 * row declares `sources: ["video"]`, so an `image/*` payload is refused here
 * and accepted one category over.
 */
function sourceShapeTests(): void {
  lipsync({
    model: "fal/fal-ai/sync-lipsync/v3",
    source: { data: "AAAA", mimeType: "video/mp4" },
    audio: URL_AUDIO,
  });
  lipsync({
    model: "fal/fal-ai/sync-lipsync/v3",
    // @ts-expect-error — a still handed to a clip-only model, caught at the keystroke.
    source: { data: "AAAA", mimeType: "image/png" },
    audio: URL_AUDIO,
  });
  lipsync({
    model: "fal/veed/lipsync/v2",
    // @ts-expect-error — inline bytes need the media type; a bare `data` cannot build a data: URI.
    source: { data: "AAAA" },
    audio: URL_AUDIO,
  });
  // The audio arm is deliberately looser: nothing needs disambiguating there,
  // and `toMediaUri` asks for the type by name when it is missing.
  lipsync({ model: "fal/fal-ai/sync-lipsync/v3", source: URL_SOURCE, audio: { data: "AAAA" } });
}

function resultTypeTests(): void {
  const result = lipsync({
    model: "fal/fal-ai/sync-lipsync/v3",
    source: URL_SOURCE,
    audio: URL_AUDIO,
  });
  expectAssignable<string | undefined>(result.video_url);
  expectAssignable<string | undefined>(result.audio_url);
  expectAssignable<string>(result.request.url);
  result.toSdk("fal");
  // `endpoint` is the route selector and is stripped into `.request.url`.
  expectTrue<IsNever<KeyIn<typeof result, "endpoint">>>();
  expectAssignable<readonly { code: string }[]>(result.warnings);
}

function providerOptionsTests(): void {
  lipsync({
    model: "fal/fal-ai/sync-lipsync/v3",
    source: URL_SOURCE,
    audio: URL_AUDIO,
    providerOptions: { fal: { sync_mode: "loop" } },
  });
  lipsync({
    model: "sync/lipsync-2",
    source: URL_SOURCE,
    audio: URL_AUDIO,
    providerOptions: { sync: { outputFileName: "take-3" } },
  });
  lipsync({
    model: "fal/fal-ai/pixverse/lipsync",
    source: URL_SOURCE,
    audio: URL_AUDIO,
    // @ts-expect-error — not for a provider this pack does not have.
    providerOptions: { topaz: {} },
  });

  const one = createLipsync([falLipsync]);
  one({ model: "fal/veed/lipsync", source: URL_SOURCE, audio: URL_AUDIO, providerOptions: { fal: {} } });
}

function noToApiTests(): void {
  const result = lipsync({
    model: "fal/fal-ai/sync-lipsync/v3",
    source: URL_SOURCE,
    audio: URL_AUDIO,
  });
  expectTrue<IsNever<KeyIn<typeof result, "toApi">>>();
  expectTrue<IsNever<KeyIn<typeof result, "toApiSafe">>>();
  expectTrue<KeyIn<typeof result, "toSdk"> extends "toSdk" ? true : false>();
  expectTrue<KeyIn<typeof result, "request"> extends "request" ? true : false>();
}

/**
 * Per-model extras — the half of the wave that makes `sync_mode` /
 * `loop_mode` usable without promoting either to vocabulary.
 *
 * `sync_mode` is sync.'s five-arm enum, `loop_mode` is LatentSync's two-arm
 * one, and neither exists at VEED. Each arrives typed from its own endpoint's
 * generated wire interface, so the values an editor offers on a sync. ref and
 * on a LatentSync ref are different lists — which is the argument for keeping
 * them per-model rather than inventing a canonical word that would have to pick
 * one spelling.
 */
function extrasNarrowingTests(): void {
  lipsync({
    model: "fal/fal-ai/sync-lipsync/v3",
    source: URL_SOURCE,
    audio: URL_AUDIO,
    sync_mode: "bounce",
  });
  lipsync({
    model: "fal/fal-ai/sync-lipsync/v3",
    source: URL_SOURCE,
    audio: URL_AUDIO,
    // @ts-expect-error — "pingpong" is LatentSync's word, on LatentSync's field.
    sync_mode: "pingpong",
  });
  lipsync({
    model: "fal/fal-ai/latentsync",
    source: URL_SOURCE,
    audio: URL_AUDIO,
    loop_mode: "pingpong",
    guidance_scale: 1.5,
  });
  lipsync({
    model: "fal/veed/lipsync/v2",
    source: URL_SOURCE,
    audio: URL_AUDIO,
    // @ts-expect-error — VEED's schema has neither field.
    loop_mode: "loop",
  });

  // The fourth spelling of the duration mismatch, and the reason there is still
  // no canonical word for it: HeyGen's is a BOOLEAN.
  lipsync({
    model: "heygen/lipsync-precision",
    source: URL_SOURCE,
    audio: URL_AUDIO,
    enable_dynamic_duration: false,
    start_time: 2,
    end_time: 8,
  });
  lipsync({
    model: "heygen/lipsync-speed",
    source: URL_SOURCE,
    audio: URL_AUDIO,
    // @ts-expect-error — sync.'s five-arm enum is not HeyGen's on/off switch.
    enable_dynamic_duration: "bounce",
  });
  lipsync({
    model: "heygen/lipsync-speed",
    source: URL_SOURCE,
    audio: URL_AUDIO,
    // @ts-expect-error — deprecated AND ignored, so no row declares it.
    enable_caption: true,
  });
  // `fps_mode`'s tail is OPEN, because HeyGen's schema types the field as a
  // plain string and the three values live only in its description.
  lipsync({ model: "heygen/lipsync-speed", source: URL_SOURCE, audio: URL_AUDIO, fps_mode: "cfr" });
  lipsync({ model: "heygen/lipsync-speed", source: URL_SOURCE, audio: URL_AUDIO, fps_mode: "vfr2" });

  // The other end of the range: VEED's row has NO extras at all, because
  // `Lipsync20Input` is two required URLs and `additionalProperties: false`.
  lipsync({ model: "veed/lipsync-2.0", source: URL_SOURCE, audio: URL_AUDIO });
  lipsync({
    model: "veed/lipsync-2.0",
    source: URL_SOURCE,
    audio: URL_AUDIO,
    // @ts-expect-error — there is no third field on this wire to put it in.
    enable_dynamic_duration: false,
  });
  // `seed` is a canonical word rather than an extra, so it stays type-legal
  // everywhere and is refused at run time by the adapter that has no field for
  // it. That asymmetry is deliberate: the vocabulary is the same five words at
  // every provider, and which of them a route can honour is a run-time answer
  // with a message. VEED publishes no seed on any of its ten operations.
  lipsync({ model: "veed/lipsync-2.0", source: URL_SOURCE, audio: URL_AUDIO, seed: 7 });

  // The REAL `model` wire field, on the one endpoint that has one — and the
  // one wire parameter this provider's generator refuses to make an extra.
  //
  // `model` is the unified REF at every category, so an extras key of the same
  // name lands in the same intersection and reduces the whole call to `never`:
  // `("fal/fal-ai/sync-lipsync/v2" | (string & {})) & ("lipsync-2" |
  // "lipsync-2-pro" | undefined)` has no members. Measured, and the symptom is
  // as bad as it sounds — every field in the call reports "not assignable to
  // type 'never'" and none of them names the cause. So `NEVER_AN_EXTRA` in
  // scripts/codegen-fal.ts drops it from the row, and it is reached here:
  lipsync({
    model: "fal/fal-ai/sync-lipsync/v2",
    source: URL_SOURCE,
    audio: URL_AUDIO,
    providerOptions: { fal: { model: "lipsync-2-pro" } },
  });
  lipsync({
    model: "fal/fal-ai/sync-lipsync/v2",
    source: URL_SOURCE,
    audio: URL_AUDIO,
    // @ts-expect-error — …and NOT as a top-level key, which is the collision.
    model_name: "lipsync-2-pro",
  });
  // At the HAND surface it is an ordinary body field with its own enum, which
  // is the half that must keep working: see src/providers/fal/lipsync.test.ts.
}

/** A dynamic or unknown ref degrades to the wide vocabulary, never to `never`. */
function degradedRefTests(): void {
  const dynamic: string = process.env["MODEL"] ?? "fal/fal-ai/sync-lipsync/v3";
  lipsync({ model: dynamic, source: URL_SOURCE, audio: URL_AUDIO });
  // Degraded, BOTH source shapes are legal — the type cannot say which route
  // this is, so it must not refuse one.
  lipsync({
    model: dynamic,
    source: { data: "AAAA", mimeType: "image/png" },
    audio: URL_AUDIO,
  });
  // Extras degrade to "every name in the build, typed `unknown`"…
  lipsync({ model: "fal/fal-ai/sync-lipsync/v9", source: URL_SOURCE, audio: URL_AUDIO, sync_mode: "loop" });
  // @ts-expect-error — …and a typo is still caught by `ExactKeys`.
  lipsync({ model: "fal/fal-ai/sync-lipsync/v9", source: URL_SOURCE, audio: URL_AUDIO, sync_mdoe: "loop" });
}

expectAssignable<"lipsync">(falLipsync.category);
expectAssignable<"fal">(falLipsync.provider);
expectAssignable<readonly string[]>(falLipsync.models);
expectAssignable<LipsyncParams["model"]>("fal/fal-ai/sync-lipsync/v3");

export {
  refUnionTests,
  sourceShapeTests,
  resultTypeTests,
  providerOptionsTests,
  noToApiTests,
  extrasNarrowingTests,
  degradedRefTests,
};
