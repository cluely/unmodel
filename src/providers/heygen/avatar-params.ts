/**
 * The avatar adapter's **data**: two engines, and the third one is missing for
 * a reason the spec states.
 *
 * A leaf rather than a section of the adapter beside it, for `sync`'s reason:
 * `unmodel/heygen/values` publishes these for client-side pickers and the
 * adapter reads the very same objects, so what is published and what is sent
 * cannot drift.
 *
 * ## Two rows where the catalog has three
 *
 * `heygen.avatar` (the wire address) serves all three engines. This table
 * serves two, because `unmodel/avatar` compiles the **raw-image arm** (`type:
 * "image"`) and `AvatarIIIEngineConfig`'s own description says "Not supported
 * for raw image input (`type: "image"`)". A row for `avatar_iii` here would be
 * a row that cannot compile the request this adapter builds. It stays fully
 * typed and callable at the wire address.
 *
 * ## Why the raw-image arm and not the catalogued-look arm
 *
 * `POST /v3/videos` is one URL with a `oneOf` on `type`, and unmodel's avatar
 * rows can say exactly three things about `image`: required (`sources:
 * ["image"]`), forbidden (`sources: []`), or unknown. There is no
 * "optional" — that is the replacement-arm law in
 * `core/unified/vocabulary/model-params.ts`, and it exists so that a still sent
 * to a route with no field for one is a compile error rather than a silent
 * drop. `avatar_iv` and `avatar_v` serve BOTH arms, so one row cannot describe
 * both, and the choice is which arm the unified surface compiles.
 *
 * It compiles the image arm, for three reasons. It is the arm that uses this
 * category's own word (`image`) rather than routing around it. Its inputs are
 * values a caller HAS — an `avatar_id` is an account-scoped look you first
 * train ($1.00 per Digital Twin) and discover at `GET /v3/avatars/looks`, and
 * HeyGen publishes no global roster, so a canonical call would depend on a
 * value no type in this library can offer. And it is the only route in the
 * category with a real inline-bytes arm on the wire (see the adapter).
 *
 * The catalogued-look arm is one line away for a caller who wants it —
 * `heygen.avatar({ type: "avatar", avatar_id, audio_url })` — and it is where
 * HeyGen's own price table is keyed, which is recorded in `./models.ts`.
 *
 * ## The per-engine narrowing is real, and both directions of it are here
 *
 * `expressiveness` is Avatar IV only ("rejected when engine.type is
 * 'avatar_v'", and Avatar III's config excludes it too). `reference_look_id` is
 * Avatar V only — it is a field INSIDE that engine's own config object, which
 * is why the adapter nests it back under `engine`. Two rows, two disjoint
 * extras, and neither is expressible as a provider-wide claim.
 */

import { EXTRA } from "../../core/unified/derive";
import type { AvatarModelParamTable } from "../../core/unified/vocabulary/avatar";
import type {
  HeygenAspectRatio,
  HeygenBackground,
  HeygenCaption,
  HeygenExpressiveness,
  HeygenFit,
  HeygenOutputFormat,
  HeygenResolution,
} from "./shared";

/** Every id `unmodel/avatar` reaches at HeyGen — the two image-capable engines. */
export const MODELS = ["avatar_iv", "avatar_v"] as const;

/** A still, and it is required — this adapter compiles the raw-image arm. */
const INPUTS = ["image"] as const;

/**
 * The dials both engines share.
 *
 * `voice_settings`, `script`, `voice_id` and `brand_glossary_id` are all
 * deliberately absent. Each of them belongs to the SYNTHESIS half of this
 * route, and `unmodel/avatar` requires an `audio` track — uploaded audio
 * "bypasses TTS", in HeyGen's own words, and every one of those four fields is
 * then ignored. A row that declared them would let an editor offer four dials
 * that do nothing. (`heygen.avatar` still types them, because a raw caller can
 * send a script instead of a track.)
 */
const COMMON_EXTRAS = {
  /** `"720p" | "1080p" | "4k"`. Not every engine and look reaches 4K. */
  resolution: EXTRA as HeygenResolution,
  /** Default `"16:9"`. `"auto"` follows the still's own shape. */
  aspect_ratio: EXTRA as HeygenAspectRatio,
  /** `"contain"` or `"cover"`. Omitted lets HeyGen pick from the orientations. */
  fit: EXTRA as HeygenFit,
  /** A solid colour or an image. Rejected alongside `output_format: "webm"`. */
  background: EXTRA as HeygenBackground,
  /** Video avatars must have been trained with matting enabled. */
  remove_background: EXTRA as boolean,
  /** Default `"mp4"`. `"webm"` returns an alpha channel. */
  output_format: EXTRA as HeygenOutputFormat,
  /** A sidecar subtitle file is always produced; `style` burns them in too. */
  caption: EXTRA as HeygenCaption,
  /** Body motion and gestures, in words. Photo-avatar rules apply per look. */
  motion_prompt: EXTRA as string,
  /** Display title in the HeyGen dashboard. */
  title: EXTRA as string,
  /** Destination folder; omit for the workspace root. */
  folder_id: EXTRA as string,
  /** HeyGen POSTs the finished video here instead of making you poll. */
  callback_url: EXTRA as string,
  /** Echoed back in the webhook payload. */
  callback_id: EXTRA as string,
} as const;

export const HEYGEN_AVATAR_MODEL_PARAMS = {
  // The default engine — `POST /v3/videos` runs it when `engine` is omitted —
  // and the only one that reads `expressiveness`.
  avatar_iv: {
    sources: INPUTS,
    extras: {
      ...COMMON_EXTRAS,
      /**
       * `"high" | "medium" | "low"`, default `"low"`. **Avatar IV only** —
       * HeyGen REJECTS it on Avatar V rather than ignoring it, which is why
       * `avatar_v`'s row below does not declare it.
       */
      expressiveness: EXTRA as HeygenExpressiveness,
    },
  },
  // Cross-reference-driven animation, and the one engine with a field inside
  // its own config object.
  avatar_v: {
    sources: INPUTS,
    extras: {
      ...COMMON_EXTRAS,
      /**
       * `engine.reference_look_id` — a `digital_twin` look in the same avatar
       * group to animate FROM. Declared flat here and nested back under
       * `engine` by the adapter, because that is where it lives on the wire and
       * a caller should not have to build the engine object to reach one field
       * of it.
       */
      reference_look_id: EXTRA as string,
    },
  },
} as const satisfies AvatarModelParamTable;
