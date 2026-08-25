/**
 * Type-level tests for `.toApi("fal")` on native media requests. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc --noEmit).
 *
 * The bar this file holds: **`.toApi("fal")` exists only on results whose
 * model is in the family's overlap table, and calling it anywhere else is a
 * compile error.** That is stricter than chat's `.toApi`, which degrades an
 * unrecognised model to the full target union because models.dev is a snapshot
 * that lags a release. There is no snapshot here — the overlap tables are hand
 * written from fal's endpoint pages — so a model that is not in one has no
 * hand-verified mapping by definition, and a member that does not exist is the
 * honest answer. See `MediaApiMember` in `src/retarget/types.ts`.
 */
import { video as klingVideo, videoFromImage as klingVideoFromImage } from "../../src/providers/kling";
import { video as pixverseVideo } from "../../src/providers/pixverse";
import { video as lightricksVideo } from "../../src/providers/lightricks";
import { tts as elevenlabsTts } from "../../src/providers/elevenlabs";
import { tts as minimaxTts } from "../../src/providers/minimax";
import {
  image as bflImage,
  imageFlux1 as bflImageFlux1,
} from "../../src/providers/black-forest-labs";
import { video as falVideo } from "../../src/providers/fal";
import type { RequestMeta } from "../../src/core/request";
import type { TranslationWarning } from "../../src/core/translate/warnings";
import { expectAssignable, expectTrue, type IsNever } from "./helpers";

// ---------------------------------------------------------------------------
// The member exists exactly where the overlap table says it does
// ---------------------------------------------------------------------------

function memberPresence(): void {
  // Mapped: the three Kling ids fal serves.
  klingVideo({ model_name: "kling-v3", prompt: "hi", mode: "pro" }).toApi("fal");
  klingVideo({ model_name: "kling-v2-6", prompt: "hi", mode: "pro" }).toApi("fal");
  klingVideo({ model_name: "kling-v2-5-turbo", prompt: "hi", mode: "pro" }).toApi("fal");

  // Not mapped: fal serves no Kling v1 generation, so the member is not on the
  // type at all. This is the whole point of the bar.
  const v1 = klingVideo({ model_name: "kling-v1", prompt: "hi" });
  // @ts-expect-error `.toApi` does not exist for a model with no overlap row
  v1.toApi("fal");
  // @ts-expect-error …and neither does the safe form
  v1.toApiSafe("fal");

  // An omitted `model_name` defaults to `kling-v1` server-side, and Kling's
  // own wide arm is what an unnamed model gets — no overlap row, no member.
  const unnamed = klingVideo({ prompt: "hi" });
  // @ts-expect-error an unnamed model has no hand-verified mapping
  unnamed.toApi("fal");

  // A model id discovered at run time gets no member either: the table is
  // hand-written, so "unknown" and "unmapped" are the same thing here.
  const dynamic = klingVideo({ model_name: String(Date.now()), prompt: "hi" });
  // @ts-expect-error a dynamic model id has no overlap row
  dynamic.toApi("fal");
}

function everyShippedFamilyOffersTheMember(): void {
  klingVideoFromImage({
    model_name: "kling-v3",
    image: "https://example.com/a.png",
    prompt: "hi",
    mode: "pro",
  }).toApi("fal");
  pixverseVideo({
    model: "v6",
    prompt: "hi",
    aspect_ratio: "16:9",
    quality: "720p",
    duration: 5,
  }).toApi("fal");
  lightricksVideo({
    model: "ltx-2-5-pro",
    prompt: "hi",
    resolution: "1280x720",
    duration: 6,
  }).toApi("fal");
  elevenlabsTts({ voice_id: "v", text: "hi", model_id: "eleven_v3" }).toApi("fal");
  minimaxTts({
    model: "speech-2.8-hd",
    text: "hi",
    voice_setting: { voice_id: "English_Graceful_Lady" },
  }).toApi("fal");
  bflImage({ model: "flux-2-pro", prompt: "hi" }).toApi("fal");
  bflImageFlux1({ model: "flux-dev", prompt: "hi" }).toApi("fal");
}

function refusedModelsHaveNoMember(): void {
  // Each of these has a RECORDED reason in its family's `*_FAL_REFUSALS`, and
  // the reason is reachable at run time through a loosely-typed model id — but
  // the typed call site never gets there, because the member is absent.
  const flex = bflImage({ model: "flux-2-flex", prompt: "hi" });
  // @ts-expect-error fal-ai/flux-2 is FLUX.2 [dev], a different checkpoint
  flex.toApi("fal");

  const flash = elevenlabsTts({ voice_id: "v", text: "hi", model_id: "eleven_flash_v2_5" });
  // @ts-expect-error fal serves no Flash v2.5 row
  flash.toApi("fal");

  const c1 = pixverseVideo({
    model: "c1",
    prompt: "hi",
    aspect_ratio: "16:9",
    quality: "720p",
    duration: 5,
  });
  // @ts-expect-error fal's curated PixVerse roster is v6 only
  c1.toApi("fal");
}

// ---------------------------------------------------------------------------
// The target vocabulary is closed to "fal"
// ---------------------------------------------------------------------------

function targetVocabulary(): void {
  const v = pixverseVideo({
    model: "v6",
    prompt: "hi",
    aspect_ratio: "16:9",
    quality: "720p",
    duration: 5,
  });
  // @ts-expect-error media retargeting ships one destination; "openrouter" is a CHAT target
  v.toApi("openrouter");
  // @ts-expect-error …and a typo is not a target either
  v.toApi("fall");
}

// ---------------------------------------------------------------------------
// The retargeted result is fal's own published body for the resolved endpoint
// ---------------------------------------------------------------------------

function retargetedShape(): void {
  const out = pixverseVideo({
    model: "v6",
    prompt: "hi",
    aspect_ratio: "16:9",
    quality: "720p",
    duration: 5,
  }).toApi("fal");

  // The enumerable half is fal's body: PixVerse's `quality` became fal's
  // `resolution`, and the source spelling is gone from the type.
  expectAssignable<{ prompt: string; resolution?: "720p" | "1080p" | "360p" | "540p" }>(out);
  // @ts-expect-error `quality` is the SOURCE spelling; the retargeted body has `resolution`
  out.quality;

  // The four non-enumerable members.
  expectAssignable<RequestMeta>(out.request);
  expectAssignable<"fal">(out.target);
  expectAssignable<readonly TranslationWarning[]>(out.warnings);
  expectAssignable<{ input: { prompt: string } }>(out.toSdk("fal"));

  // One hop only: the retargeted result carries no `.toApi` of its own.
  // @ts-expect-error a fal body has nowhere left to retarget to
  out.toApi("fal");
}

function retargetedBodiesAreTheGeneratedFalTypes(): void {
  // The strongest form of the honesty bar: the body `.toApi("fal")` produces is
  // assignable to the body `fal.video` itself takes for that endpoint, so a
  // retargeted request can be handed straight to fal's own validator.
  const kling = klingVideo({
    model_name: "kling-v2-5-turbo",
    prompt: "hi",
    mode: "pro",
    duration: "5",
  }).toApi("fal");
  falVideo({
    endpoint: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
    ...kling,
  });

  const ltx = lightricksVideo({
    model: "ltx-2-5-pro",
    prompt: "hi",
    resolution: "1280x720",
    duration: 6,
  }).toApi("fal");
  falVideo({ endpoint: "lightricks/ltx-2.5/text-to-video/pro", ...ltx });
}

// ---------------------------------------------------------------------------
// The member is absent from unified pack results, which is what keeps the
// packs free of the seam at run time too (asserted in bundle-budget).
// ---------------------------------------------------------------------------

function unifiedResultsHaveNoMember(): void {
  // `MediaApiMember` resolves to `unknown` off the table, and intersecting
  // `unknown` is a no-op — so an unmapped model's result type is byte-identical
  // to what it was before this wave.
  type Unmapped = ReturnType<typeof klingVideo<"kling-v1", { model_name: "kling-v1"; prompt: string }>>;
  expectTrue<IsNever<Extract<keyof Unmapped, "toApi">>>();
}

export {
  memberPresence,
  everyShippedFamilyOffersTheMember,
  refusedModelsHaveNoMember,
  targetVocabulary,
  retargetedShape,
  retargetedBodiesAreTheGeneratedFalTypes,
  unifiedResultsHaveNoMember,
};
