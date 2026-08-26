/**
 * `lightricks.video` → fal: the overlap table and the mapping.
 *
 * **Reached only from `./index.ts`** — see `core/translate/media-retarget.ts`
 * for why the seam is placed there and not in `./video.ts`.
 *
 * ## What fal serves
 *
 * One LTX endpoint, `lightricks/ltx-2.5/text-to-video/pro`, verified against
 * fal's curated roster on 2026-08-25 (`data/fal/curation.json`; the drift
 * guard in `fal-target.test.ts` re-asserts the id against
 * `FAL_VIDEO_ENDPOINTS`). Source page:
 * https://fal.ai/models/lightricks/ltx-2.5/text-to-video/pro/api
 *
 * That it is `ltx-2-5-pro` and not one of the other five ids is not read off
 * the path segment — it is read off the enums, which match that model's
 * support-matrix row and no other: `resolution` is `["720p","1080p"]` (only
 * `ltx-2-5-pro` caps at 1080p), `duration` is `[6,8,10]` (both `fast` rows
 * reach 20s), and `fps` is `[24,25,50]` (only `ltx-2-5-pro` drops 48). fal's
 * own catalog *name* for the row says "Fast"; the id routes, and the enums
 * settle it.
 *
 * ## The one derivation
 *
 * LTX spells the output size as a single `WIDTHxHEIGHT` string; fal splits it
 * into `resolution` + `aspect_ratio`. For this model the four documented
 * strings are exactly `{720p, 1080p} × {16:9, 9:16}`, so the split is total —
 * every value round-trips, nothing is snapped, and the mapping stays
 * warning-free. A `${number}x${number}` outside the published tiers is refused
 * rather than rounded: the nearest tier is a different frame size and a
 * different price.
 */
import type { ApiRetargeter } from "../../core/request";
import {
  createMediaToApi,
  refuseParam,
  type MediaMapContext,
} from "../../core/translate/media-retarget";
import { FAL_MEDIA_TARGET } from "../../core/translate/media-endpoints";
import type { FalVideoBodyById } from "../fal/interop";
import { DEFAULT_FPS } from "./shared";
import type { TextToVideoParams } from "./video";

// The per-endpoint aliases below are `export`ed rather than private, and it is
// not decoration: they are the exact symbols `<Provider>…FalOverlap`'s
// `ReturnType` resolves to, so a consumer that emits declarations around a
// result carrying `.toApi("fal")` cannot name it without them (TS4023, "has or
// is using name 'FalAiFlux2ProInput' … but cannot be named"). Type-only, and
// re-exported one line from ./index.ts. See src/core/carriers.ts.
export type FalLtx25Pro = FalVideoBodyById["lightricks/ltx-2.5/text-to-video/pro"];

const ENDPOINT = "lightricks/ltx-2.5/text-to-video/pro";

/** fal's `maxLen` for this endpoint's prompt; LTX itself publishes no cap. */
const PROMPT_MAX_CHARS = 5000;

/**
 * `WIDTHxHEIGHT` → fal's `{ resolution, aspect_ratio }` pair.
 *
 * Only the four combinations `ltx-2-5-pro` actually serves are listed. The
 * 1440p and 4K strings are in `LTX_RESOLUTION_TIERS` for other models and are
 * absent here on purpose — a table that answered for them would be answering
 * for an endpoint fal does not publish.
 */
const RESOLUTION_SPLIT: Readonly<
  Record<string, { readonly resolution: "720p" | "1080p"; readonly aspect_ratio: "16:9" | "9:16" }>
> = Object.freeze({
  "1280x720": { resolution: "720p", aspect_ratio: "16:9" },
  "720x1280": { resolution: "720p", aspect_ratio: "9:16" },
  "1920x1080": { resolution: "1080p", aspect_ratio: "16:9" },
  "1080x1920": { resolution: "1080p", aspect_ratio: "9:16" },
});

/**
 * `lightricks.video` params → `lightricks/ltx-2.5/text-to-video/pro`.
 *
 * Two facts worth stating because both are silent if you get them wrong:
 *
 * - **`fps` is always emitted.** LTX defaults to 24, fal defaults to 25. An
 *   omitted `fps` that rode the source default would come back at a different
 *   frame rate, so the source default is written out explicitly and the
 *   mapping stays exact.
 * - **`duration: null` becomes the literal `"auto"`.** Both mean "let the
 *   model choose" — `ltx-2-5-pro` is in `AUTOMATIC_DURATION_MODELS` and fal's
 *   default is `"auto"` — but fal's enum has no `null` member, so the rename
 *   is required, not optional.
 *
 * `api_version` is refused rather than dropped: `"v1"` names LTX's
 * *synchronous* route, and fal's queue has no synchronous arm on this
 * endpoint. Answering a request for a blocking call with a queued job is a
 * different control flow, not a lossier one.
 */
function mapLtx25Pro(params: TextToVideoParams, ctx: MediaMapContext): FalLtx25Pro {
  if (params.prompt.length > PROMPT_MAX_CHARS) {
    ctx.unsupported({
      path: ["prompt"],
      message:
        `\`prompt\` is ${params.prompt.length} characters, over the ${PROMPT_MAX_CHARS}-character cap ` +
        `${ENDPOINT} publishes. LTX itself sets no cap, so this is a limit the retarget introduces; ` +
        "shorten the prompt — unmodel will not truncate it for you.",
    });
  }
  if (params.api_version === "v1") {
    refuseParam(
      ctx,
      ["api_version"],
      ENDPOINT,
      'is a queue submit with no synchronous arm — `api_version: "v1"` asks LTX for a blocking call, which is a different control flow rather than a lossier one',
    );
  }
  const split = Object.hasOwn(RESOLUTION_SPLIT, params.resolution)
    ? RESOLUTION_SPLIT[params.resolution]
    : undefined;
  if (split === undefined) {
    ctx.unsupported({
      path: ["resolution"],
      message:
        `\`resolution: "${params.resolution}"\` has no equivalent at ${ENDPOINT}, which serves 720p and ` +
        "1080p in 16:9 and 9:16 only. The four values it does serve are 1280x720, 720x1280, 1920x1080 " +
        "and 1080x1920; rounding to the nearest tier would change both the frame size and the price.",
    });
  }
  const duration = params.duration === null ? ("auto" as const) : params.duration;
  if (duration !== "auto" && duration !== 6 && duration !== 8 && duration !== 10) {
    ctx.unsupported({
      path: ["duration"],
      message:
        `\`duration: ${duration}\` has no equivalent at ${ENDPOINT}, which serves 6, 8, 10 or "auto". ` +
        "Duration is the billing unit here, so unmodel refuses rather than snapping to the nearest.",
    });
  }
  const fps = params.fps ?? DEFAULT_FPS;
  if (fps !== 24 && fps !== 25 && fps !== 50) {
    ctx.unsupported({
      path: ["fps"],
      message: `\`fps: ${fps}\` has no equivalent at ${ENDPOINT}, which serves 24, 25 and 50.`,
    });
  }
  return {
    prompt: params.prompt,
    ...(split ?? {}),
    duration: duration as 6 | 8 | 10 | "auto",
    // Written out even when the caller omitted it: LTX defaults to 24 and fal
    // to 25, so silence would change the frame rate.
    fps: fps as 24 | 25 | 50,
    ...(params.generate_audio !== undefined && { generate_audio: params.generate_audio }),
    ...(params.camera_motion !== undefined && { camera_motion: params.camera_motion }),
  };
}

/** LTX model id → the fal endpoint that serves it. */
export const LIGHTRICKS_VIDEO_FAL_OVERLAP = {
  "ltx-2-5-pro": { endpoints: [ENDPOINT], map: mapLtx25Pro },
} as const;

/**
 * The five LTX ids fal does not serve, with the reason.
 *
 * `ltx-2-5-fast` is the one a reader will reach for: it is the same generation
 * and the fal row's *display name* even says "Fast". The enums say otherwise —
 * `ltx-2-5-fast` runs to 20s and 48fps, neither of which fal's row accepts —
 * so routing it there would swap the model.
 */
export const LIGHTRICKS_VIDEO_FAL_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  "ltx-2-5-fast":
    "fal's single LTX row is ltx-2-5-pro: its duration enum stops at 10s and its fps enum omits 48, both of which ltx-2-5-fast serves. Routing there would swap the model, not the transport.",
  "ltx-2-3-pro": "fal's curated LTX roster is LTX-2.5 only.",
  "ltx-2-3-fast": "fal's curated LTX roster is LTX-2.5 only.",
  "ltx-2-pro": "fal's curated LTX roster is LTX-2.5 only.",
  "ltx-2-fast": "fal's curated LTX roster is LTX-2.5 only.",
});

/** The type half of {@link LIGHTRICKS_VIDEO_FAL_OVERLAP}, derived from it. */
export type LightricksVideoFalOverlap = {
  [K in keyof typeof LIGHTRICKS_VIDEO_FAL_OVERLAP]: ReturnType<
    (typeof LIGHTRICKS_VIDEO_FAL_OVERLAP)[K]["map"]
  >;
};

/** The `.toApi("fal")` retargeter `./index.ts` hangs on `lightricks.video`. */
export const lightricksVideoToFal: (params: TextToVideoParams) => ApiRetargeter = createMediaToApi({
  endpoint: "lightricks.video",
  target: FAL_MEDIA_TARGET,
  modelId: (params: TextToVideoParams) => params.model,
  overlap: LIGHTRICKS_VIDEO_FAL_OVERLAP,
  refusals: LIGHTRICKS_VIDEO_FAL_REFUSALS,
});
