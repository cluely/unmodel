// Hand-maintained — HeyGen is not in models.dev; refresh from
//   https://developers.heygen.com/openapi/external-api.json   (OpenAPI 3.1.0 — the CURRENT one; see below)
//   https://developers.heygen.com/reference/create-video      (POST /v3/videos)
//   https://developers.heygen.com/reference/create-lipsync    (POST /v3/lipsyncs)
//   https://developers.heygen.com/avatar-iii                  (engine pages: iii, iv, v)
//   https://developers.heygen.com/lipsync-speed               (and /lipsync-precision)
//   https://developers.heygen.com/docs/pricing                (public USD, no login)
//   https://developers.heygen.com/docs/usage-limits           (10 concurrent jobs, 429 + Retry-After)
//   https://developers.heygen.com/docs/quick-start            (x-api-key, v1/v2 sunset)
// Verified 2026-08-25. Every docs route also serves raw Markdown at `<route>.md`,
// which is what was read.
//
// TWO SPECS, AND THE WRONG ONE ALSO ANSWERS 200.
// `${DOCS_BASE}/openapi.yaml` is a v4.0.8 document with 52 paths, all v1/v2 —
// its only `/v3` path is `/v3/template/{id}` and it contains no `/v3/videos`.
// `openapi/external-api.json` (1.16 MB, 98 paths, 300 schemas) is the current
// one and is what this provider was typed against. See ./shared.ts.
//
// THE DOC HOST MOVED AND THE OLD SLUGS DID NOT SURVIVE IT.
// docs.heygen.com 301s to developers.heygen.com, but the old canonical paths
// 404 at the new host (`/reference/create-an-avatar-video-v2` is gone; the page
// is `/reference/create-video`). Every URL above was re-resolved by fetching it,
// not by rewriting the hostname.
//
// WHAT A "MODEL" IS AT HEYGEN, AND WHY THESE FIVE IDS.
// Neither generation route has a `model` field. `POST /v3/videos` has an
// `engine` discriminated union — `avatar_iii`, `avatar_iv` (the default when
// omitted), `avatar_v` — and those three are separate products with separate
// pages and a four-fold price spread, so they are three catalog ids under their
// own wire spellings. `POST /v3/lipsyncs` has `mode: "speed" | "precision"`
// (default "speed"), two products with two pages and a 2× price difference, so
// they are two more, spelled the way HeyGen's own doc slugs spell them
// (`/lipsync-speed`, `/lipsync-precision`). The wire values are recovered from
// the ids in `finalize`, never the other way round.
//
// PRICING IS PUBLIC USD, AND TWO OF THE FIVE ROWS CARRY A BAND.
// HeyGen's price table is keyed by ENGINE × AVATAR TYPE, and the avatar type is
// a property of the `avatar_id` — it lives on `GET /v3/avatars/looks`, not in
// the request — so two of the three engine rows have a rate that a request body
// cannot settle. Following the sync. precedent, the row carries the TOP of the
// band and the whole table is quoted above it: an estimate built from these
// rows is an UPPER BOUND, which is the right direction for one. The two lipsync
// rows are exact, because `mode` is the only thing their price depends on and
// it is in the body.
//
// NOTHING HERE ESTIMATES, and the reason is the same everywhere in this
// category: every rate is per SECOND OF OUTPUT and the output's length follows
// the audio's, behind a URL unmodel never fetches. HeyGen reports the billed
// `duration` on the finished job, which is the only place the number is real.
//
// ---------------------------------------------------------------------------
// Deliberately NOT served
// ---------------------------------------------------------------------------
//
// `POST /v3/voices/speech` — TTS. This is the closest call in the file and it
// is an exclusion, because a `heygen.tts` would be a row that narrows nothing.
// The request is `{ text, voice_id, input_type?, speed?, language?, locale? }`
// and:
//   · there is no model id on the wire at all — the engine is fixed to Starfish
//     and is stated only in `voice_id`'s prose ("The voice must support the
//     starfish engine");
//   · `voice_id` is an ACCOUNT-SCOPED handle from `GET /v3/voices`, and HeyGen
//     publishes no global roster, so unmodel's `voice` word would be a bare
//     `string` where every other tts provider in the library narrows it to a
//     real enum;
//   · `input_type` is typed `string` — the two arms ("text", "ssml") live in a
//     description — so even the two-value switch is untyped;
//   · there is no output format, sample rate, codec or bitrate control, which
//     is most of what `unmodel/tts`'s vocabulary is made of.
// A row with no model, no voices, no formats and one numeric dial is a me-too
// entry that would make the tts capability matrix look wider while telling a
// caller nothing. It joins the day HeyGen publishes a voice roster or a second
// engine. (`POST /v1/audio/text_to_speech` is the v1 spelling of the same
// thing and is on the October 31, 2026 sunset list besides.)
//
// `type: "cinematic_avatar"` on `POST /v3/videos` — prompt-to-video, 4–15
// seconds, $7.00 flat, backed by Seedance, with 1–3 avatar looks as visual
// references and NO script and NO voice. It is a text-to-video model wearing an
// avatar route's URL: its required fields are `prompt` and an ARRAY of
// `avatar_id`s, it has no audio input, and `unmodel/avatar`'s vocabulary is
// `{ image, audio }`. It belongs to `unmodel/video` if anywhere, and it cannot
// go there while its performer references have no canonical word.
//
// `type: "studio"` on the same route — a `scenes` array of up to 50, each with
// its own avatar, script, background and timing. That is a timeline document,
// not a generation request; validating it would mean typing HeyGen's editor.
//
// `POST /v3/video-translations`, `/v3/background-removals`,
// `/v3/hyperframes/renders`, `/v3/ai-clipping`, `/v3/filler-word-removals` —
// five more real, priced products, and none of them matches a category unmodel
// has. Translation rewrites the speech in a finished video (no unmodel
// vocabulary for "same clip, new language"); background removal is the matting
// operation VEED also publishes and unmodel also declines; HyperFrames, AI
// Clipping and filler-word removal are post-production passes over a video you
// already have.
//
// `/v3/avatars`, `/v3/avatars/looks`, `/v3/voices`, `/v3/assets`,
// `/v3/brand-kits`, `/v3/brand-glossaries`, `/v3/folders`, `/v3/webhooks`,
// `/v3/templates`, `/v3/workflows`, `/v3/podcasts`, `/v3/video-agents`,
// `/v3/avatar-realtime` and the `/batches` and `/statuses` families — platform
// plumbing. They mint and list the ids a generation request names (`avatar_id`,
// `voice_id`, `asset_id`, `folder_id`, `brand_glossary_id`), which unmodel
// types, and they generate nothing themselves. `/v3/avatar-realtime` is a
// streaming session rather than a request; batches are envelopes around up to
// 100 copies of a body this provider already validates.

import type { ModelInfo, ProviderInfo } from "../../core/catalog-types";

export const provider = {
  id: "heygen",
  name: "HeyGen",
  // `x-api-key: <HEYGEN_API_KEY>` — https://developers.heygen.com/docs/quick-start,
  // where the key comes from Settings → API at https://app.heygen.com/home?nav=API.
  // The spec declares the header lowercase (`ApiKeyAuth`) and the quick-start
  // writes it `X-Api-Key`; header names are case-insensitive per RFC 9110.
  // A `BearerAuth` (OAuth2) scheme also exists and is not what a dashboard key
  // is, so the API key is what this provider documents.
  env: ["HEYGEN_API_KEY"],
  doc: "https://developers.heygen.com/reference/create-video",
} as const satisfies ProviderInfo;

/** A catalogued look plus a track (or a script) in, a clip out. */
const avatarModality = { input: ["audio", "image", "text"], output: ["video"] } as const;

/** Clip in, track in, clip out. */
const clipModality = { input: ["audio", "video"], output: ["video"] } as const;

export const models = {
  /**
   * $0.0167 per second for a Digital Twin or Studio Avatar, $0.0433 for a Photo
   * Avatar.
   *
   * Source: https://developers.heygen.com/docs/pricing — verified 2026-08-25.
   * Quote: “### Video Generation — Avatar III … | Digital Twin | \$0.0167 / sec
   * | | Studio Avatar | \$0.0167 / sec | | Photo Avatar | \$0.0433 / sec |”
   *
   * The row carries $0.0433, the top of the band — the avatar type is a
   * property of the look rather than of the request, so a body cannot settle
   * which rate applies, and an upper bound is the right kind of wrong. This is
   * the cheap engine by a factor of four and it is the one to reach for when
   * the look is a trained twin.
   */
  avatar_iii: {
    id: "avatar_iii",
    name: "Avatar III",
    family: "avatar",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: avatarModality,
    limit: { context: 0 },
    cost: { perVideoSecond: 0.0433 },
    // The one engine that does NOT render raw image input ("Not supported for
    // raw image input (type: \"image\")"), and the one that reads neither
    // `motion_prompt` nor `expressiveness`. Cheap, narrow, and a dedicated
    // photo-to-video pipeline.
  },
  /**
   * $0.05 per second for a Photo Avatar, $0.0667 for a Digital Twin or Studio
   * Avatar.
   *
   * Source: https://developers.heygen.com/docs/pricing — verified 2026-08-25.
   * Quote: “### Video Generation — Avatar IV … | Photo Avatar | \$0.05 / sec |
   * | Digital Twin | \$0.0667 / sec | | Studio Avatar | \$0.0667 / sec |”
   *
   * The row carries $0.0667, the top of the band, for `avatar_iii`'s reason.
   */
  avatar_iv: {
    id: "avatar_iv",
    name: "Avatar IV",
    family: "avatar",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: avatarModality,
    limit: { context: 0 },
    cost: { perVideoSecond: 0.0667 },
    // **The default**: `POST /v3/videos` runs this engine when `engine` is
    // omitted, which is why unmodel writes the engine out on every request
    // rather than leaving a four-fold price decision implicit. The only engine
    // that reads `expressiveness`.
  },
  /**
   * $0.0667 per second. Digital Twins only, so this rate is EXACT.
   *
   * Source: https://developers.heygen.com/docs/pricing — verified 2026-08-25.
   * Quote: “### Video Generation — Avatar V … Avatar V supports Digital Twins
   * only. | Digital Twin | \$0.0667 / sec |”
   *
   * The one engine row with a single number rather than a band, and it is
   * single because the engine only serves one avatar type.
   */
  avatar_v: {
    id: "avatar_v",
    name: "Avatar V",
    family: "avatar",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: avatarModality,
    limit: { context: 0 },
    cost: { perVideoSecond: 0.0667 },
    // Cross-reference-driven animation: it animates from a `digital_twin` look
    // in the same avatar group, optionally named with `reference_look_id`.
    // Reads `motion_prompt` and REJECTS `expressiveness`. Check
    // `supported_api_engines` on the look before naming it — eligibility is a
    // property of the look, not of the account.
  },
  /**
   * $0.0333 per second of output. Exact — `mode` is the only thing the price
   * depends on and it is in the body.
   *
   * Source: https://developers.heygen.com/docs/pricing — verified 2026-08-25.
   * Quote: “### Lipsync | Mode | Rate | | Speed | \$0.0333 / sec | | Precision
   * | \$0.0667 / sec |”
   */
  "lipsync-speed": {
    id: "lipsync-speed",
    name: "Lipsync (Speed)",
    family: "lipsync",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: clipModality,
    limit: { context: 0 },
    cost: { perVideoSecond: 0.0333 },
    // `mode: "speed"` on the wire, and what an omitted `mode` means.
    // https://developers.heygen.com/lipsync-speed
  },
  /**
   * $0.0667 per second of output — twice the speed mode, exact for its reason.
   *
   * Source: https://developers.heygen.com/docs/pricing — verified 2026-08-25.
   * Quote: “| Precision | \$0.0667 / sec |”
   */
  "lipsync-precision": {
    id: "lipsync-precision",
    name: "Lipsync (Precision)",
    family: "lipsync",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: clipModality,
    limit: { context: 0 },
    cost: { perVideoSecond: 0.0667 },
    // `mode: "precision"` on the wire — "higher quality, uses avatar
    // inference", which is why it costs what an avatar render costs.
    // https://developers.heygen.com/lipsync-precision
  },
} as const satisfies Record<string, ModelInfo>;

export type HeygenCatalogModelId = keyof typeof models;
