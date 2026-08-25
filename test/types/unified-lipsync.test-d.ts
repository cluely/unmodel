/**
 * Type-level tests for `unmodel/lipsync`'s ready-made pack. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc --noEmit).
 *
 * The category is five words and one provider, so most of what is worth pinning
 * is the same four properties every category entry has: the ref union comes
 * from the adapter, the result is the ref'd provider's own `Validated`,
 * `providerOptions` is keyed by the pack, and there is no `.toApi`.
 *
 * What is NOT shared with the other entries — and is the reason this wave
 * happened — is the per-model `source` narrowing, at the bottom.
 */
import { createLipsync, lipsync } from "../../src/unified/lipsync";
import { lipsync as falLipsync } from "../../src/providers/fal/unified-lipsync";
import type { UnifiedRef } from "../../src/core/unified/types";
import type { LipsyncParams } from "../../src/core/unified/vocabulary/lipsync";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

type PackRefs = UnifiedRef<typeof falLipsync>;

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

const URL_SOURCE = { url: "https://example.com/take-3.mp4" } as const;
const URL_AUDIO = { url: "https://example.com/vo.wav" } as const;

function refUnionTests(): void {
  lipsync({ model: "fal/fal-ai/sync-lipsync/v3", source: URL_SOURCE, audio: URL_AUDIO });
  lipsync({ model: "fal/veed/lipsync/v2", source: URL_SOURCE, audio: URL_AUDIO });
  // A model newer than this snapshot still works, with a runtime warning.
  lipsync({ model: "fal/fal-ai/sync-lipsync/v4", source: URL_SOURCE, audio: URL_AUDIO });
  // A provider with no adapter is a runtime structural error, not a type error.
  lipsync({ model: "sync/lipsync-3", source: URL_SOURCE, audio: URL_AUDIO });

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
    model: "fal/fal-ai/pixverse/lipsync",
    source: URL_SOURCE,
    audio: URL_AUDIO,
    // @ts-expect-error — not for a provider this pack does not have.
    providerOptions: { sync: {} },
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
