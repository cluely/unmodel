/**
 * Type-level tests for fal's RESULT surface. NOT run by `bun test` — this file
 * is only type-checked (`bun run check` / tsc --noEmit).
 *
 * Why this file exists at all: the ten `Fal<Verb>ResultById` maps shipped for
 * three waves and an adopter hand-rolled `{ video: { url: string } }` instead,
 * because nothing pointed at them. Discoverability is fixed in prose
 * (`src/providers/fal/types.ts`); this pins the properties that prose claims,
 * so the claim cannot rot:
 *
 * 1. every verb's result map is keyed by the SAME endpoint ids as its request
 *    map — the request key and the response key are one string,
 * 2. `FalQueueResult<T>` narrows on `"error" in body` to exactly two arms,
 * 3. the generated result shapes are real types rather than `any` or `never`.
 *
 * (1) is the one that catches a regression nobody would otherwise see: a
 * curated endpoint whose result rows are missing is `undefined` at the index,
 * which is assignable to nothing and reported nowhere.
 */
import type {
  FalAvatarBodyById,
  FalAvatarResultById,
  FalImageBodyById,
  FalImageEditArm,
  FalImageEditBodyById,
  FalImageEditResultById,
  FalImageResultById,
  FalLipsyncBodyById,
  FalLipsyncResultById,
  FalMusicBodyById,
  FalMusicResultById,
  FalQueueError,
  FalQueueResult,
  FalQueueSubmitResponse,
  FalSttBodyById,
  FalSttResultById,
  FalThreeDBodyById,
  FalThreeDResultById,
  FalTtsBodyById,
  FalTtsResultById,
  FalUpscaleBodyById,
  FalUpscaleResultById,
  FalVideoBodyById,
  FalVideoEndpointId,
  FalVideoResultById,
} from "../../src/providers/fal/types";
import { expectAssignable, expectNotAny, expectNotNever, expectTrue } from "./helpers";
import type { IsNever } from "./helpers";

/** `true` only when both objects are keyed by exactly the same id set. */
type SameKeys<A, B> = [Exclude<keyof A, keyof B>] extends [never]
  ? [Exclude<keyof B, keyof A>] extends [never]
    ? true
    : false
  : false;

/** Every verb: one endpoint id set, two maps. */
function falResultMapsMatchTheirRequestMaps(): void {
  expectTrue<SameKeys<FalImageBodyById, FalImageResultById>>();
  expectTrue<SameKeys<FalImageEditBodyById, FalImageEditResultById>>();
  expectTrue<SameKeys<FalVideoBodyById, FalVideoResultById>>();
  expectTrue<SameKeys<FalLipsyncBodyById, FalLipsyncResultById>>();
  expectTrue<SameKeys<FalAvatarBodyById, FalAvatarResultById>>();
  expectTrue<SameKeys<FalUpscaleBodyById, FalUpscaleResultById>>();
  expectTrue<SameKeys<FalThreeDBodyById, FalThreeDResultById>>();
  expectTrue<SameKeys<FalTtsBodyById, FalTtsResultById>>();
  expectTrue<SameKeys<FalSttBodyById, FalSttResultById>>();
  expectTrue<SameKeys<FalMusicBodyById, FalMusicResultById>>();

  // The id union routing requests is the same union indexing results.
  expectTrue<SameKeys<Record<FalVideoEndpointId, 0>, FalVideoResultById>>();
}

/** The generated shapes are real: not `any`, not `never`, not `undefined`. */
function falResultShapesAreReal(): void {
  expectNotAny<FalVideoResultById["fal-ai/veo3.1"]>();
  expectNotNever<FalVideoResultById["fal-ai/veo3.1"]>();
  expectAssignable<string>({} as FalVideoResultById["fal-ai/veo3.1"]["video"]["url"]);

  expectNotAny<FalImageResultById["fal-ai/flux/dev"]>();
  expectAssignable<number>({} as FalImageResultById["fal-ai/flux/dev"]["seed"]);

  expectNotAny<FalImageEditResultById["bria/fibo-edit/relight"]>();
  expectAssignable<string>(
    {} as FalImageEditResultById["bria/fibo-edit/relight"]["image"]["url"],
  );

  expectNotAny<FalTtsResultById["fal-ai/elevenlabs/tts/eleven-v3"]>();
  expectAssignable<string>(
    {} as FalTtsResultById["fal-ai/elevenlabs/tts/eleven-v3"]["audio"]["url"],
  );

  // A result document is NOT the queue envelope, and the types say so: the
  // envelope's `request_id` has no counterpart on a result.
  expectTrue<IsNever<Extract<keyof FalVideoResultById["fal-ai/veo3.1"], "request_id">>>();
  expectAssignable<string>({} as FalQueueSubmitResponse["request_id"]);
}

/** The prompt-less direct-only row keeps fal's exact request vocabulary. */
function falBriaRelightRequestIsExact(): void {
  const request: FalImageEditArm<"bria/fibo-edit/relight"> = {
    endpoint: "bria/fibo-edit/relight",
    image_url: "https://example.com/source.png",
    light_direction: "top-down",
    light_type: "starlight nighttime",
  };
  expectAssignable<"front" | "side" | "bottom" | "top-down" | null>(
    request.light_direction,
  );

  const badDirection: FalImageEditArm<"bria/fibo-edit/relight"> = {
    endpoint: "bria/fibo-edit/relight",
    image_url: "https://example.com/source.png",
    // @ts-expect-error — fal publishes exactly four light directions.
    light_direction: "behind",
    light_type: "midday",
  };
  const badLightType: FalImageEditArm<"bria/fibo-edit/relight"> = {
    endpoint: "bria/fibo-edit/relight",
    image_url: "https://example.com/source.png",
    light_direction: "front",
    // @ts-expect-error — free-form lighting prose is not this route's contract.
    light_type: "make it dramatic",
  };
  void badDirection;
  void badLightType;
}

/** `"error" in body` is the discriminant, because fal sends no other tag. */
function falQueueResultNarrows(): void {
  const body = {} as FalQueueResult<FalVideoResultById["fal-ai/veo3.1"]>;

  if ("error" in body) {
    expectAssignable<FalQueueError>(body);
    expectAssignable<string>(body.error);
    expectAssignable<string | undefined>(body.error_type);
    // @ts-expect-error the failure arm carries no result document
    body.video.url;
  } else {
    expectAssignable<string>(body.video.url);
    // @ts-expect-error the success arm carries no failure fields
    body.error;
  }

  // `error` is what makes the check work: no fal result schema declares it, so
  // the success arm cannot answer `true` and the narrowing is total.
  expectTrue<IsNever<Extract<keyof FalVideoResultById["fal-ai/veo3.1"], "error">>>();
}

export {
  falBriaRelightRequestIsExact,
  falQueueResultNarrows,
  falResultMapsMatchTheirRequestMaps,
  falResultShapesAreReal,
};
