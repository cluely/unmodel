// Hand-maintained — HeyGen is not in models.dev; refresh from
//   https://developers.heygen.com/openapi/external-api.json   (OpenAPI 3.1.0 — the CURRENT one; see below)
//   https://developers.heygen.com/reference/create-video      (POST /v3/videos)
//   https://developers.heygen.com/reference/create-lipsync    (POST /v3/lipsyncs)
//   https://developers.heygen.com/models                      (engine comparison: which engine takes which input)
//   https://developers.heygen.com/avatar-iii                  (engine pages: iii, iv, v)
//   https://developers.heygen.com/lipsync-speed               (and /lipsync-precision)
//   https://platform.heygen.com/pricing                       (USD rates, sign-in required — see PRICING below)
//   https://developers.heygen.com/docs/usage-limits           (10 concurrent jobs, 429 + Retry-After)
//   https://developers.heygen.com/docs/quick-start            (x-api-key, v1/v2 sunset)
// Verified 2026-08-25, re-verified 2026-11-12. Every docs route also serves raw
// Markdown at `<route>.md`, which is what was read.
//
// TWO SPECS, AND THE WRONG ONE ALSO ANSWERS 200.
// `${DOCS_BASE}/openapi.yaml` is a v4.0.8 document with 52 paths, all v1/v2 —
// its only `/v3` path is `/v3/template/{id}` and it contains no `/v3/videos`.
// `openapi/external-api.json` (1.96 MB, 136 paths, 517 schemas on 2026-11-12) is
// the current one and is what this provider was typed against. See ./shared.ts.
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
// pages and a twelve-fold price spread, so they are three catalog ids under their
// own wire spellings. `POST /v3/lipsyncs` has `mode: "speed" | "precision"`
// (default "speed"), two products with two pages and a 2× price difference, so
// they are two more, spelled the way HeyGen's own doc slugs spell them
// (`/lipsync-speed`, `/lipsync-precision`). The wire values are recovered from
// the ids in `finalize`, never the other way round.
//
// PRICING IS USD BEHIND A SIGN-IN, AND IS READ FROM THE PLATFORM'S OWN DATA.
// The public page is gone: https://developers.heygen.com/docs/pricing answers
// 404 ("The requested page could not be found.", 2026-11-12), and
// https://developers.heygen.com/llms.txt now reads "[Self-Serve
// Pricing](https://platform.heygen.com/pricing): Per-operation API pricing and
// credit packs. Sign in to the API dashboard at platform.heygen.com to see
// current prices." That route renders a sign-in form for an anonymous session.
// The rates themselves ship as data in the platform's catalog module —
// https://platform.heygen.com/assets/catalogText-1niwFpkW.js, the module
// https://platform.heygen.com/assets/index-BgfG1htF.js loads — and every rate
// below is quoted from it (2026-11-12). They are byte-identical in the two
// earlier builds, catalogText-mQHkbAZ4.js and catalogText-C39nvOfF.js, which
// still answer 200. The file name is content-hashed and rotates with each
// deploy: refresh by fetching https://platform.heygen.com/, following the
// index module it loads, and reading the catalogText module that one names.
//
// The engine table is keyed by ENGINE × AVATAR TYPE (tiers labelled "Custom
// Video Avatar", "Studio Avatar", "Photo Avatar"), and the avatar type is a
// property of the `avatar_id` — it lives on `GET /v3/avatars/looks`, not in the
// request — so an engine row has a rate a request body cannot settle.
// Following the sync. precedent, `avatar_iii` and `avatar_iv` carry the TOP of
// their band and the whole band is quoted above them: an estimate built from
// them is an UPPER BOUND, which is the right direction for one. `avatar_v`
// publishes one tier only; its row says what that does and does not cover.
// The engine tiers share one note — "Rates apply to 720p and 1080p output."
// (`pricing_avatar_resolution_note` in the index module) — so a 4K render has
// no published rate at all. The two lipsync rows are exact, because `mode` is
// the only thing their price depends on and it is in the body.
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
// thing and is past its October 31, 2026 sunset besides.)
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
// THE SECOND WITNESS HAS SINCE LANDED, and it does not change the answer.
// `elevenlabs.dub` / `elevenlabs.dubLanguage` ship as WIRE-ONLY addresses
// (src/providers/elevenlabs/dubbing.ts), which makes ElevenLabs Dubbing the
// second vendor doing "same clip, new language" in the tree. Two witnesses is
// the bar for a vocabulary, but the bar is two witnesses that AGREE, and these
// two share no request shape: ElevenLabs is a two-request project/target model
// with an editable transcript, a monotonic `revision`, a `stale` output state,
// `keyterms`, `translations`, `cloning_strength` and `webhook_ids`; HeyGen's
// is a one-shot job. A canonical `{ source, targetLanguage }` would have
// nowhere to put either half of that — the "vocabulary of one" refusal applied
// twice rather than once. Revisit when a third witness lands, or when these
// two shapes converge.
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
   * $0.01 per second for a Custom Video Avatar, $0.0165 for a Studio Avatar or
   * a Photo Avatar (720p and 1080p).
   *
   * Source: https://platform.heygen.com/assets/catalogText-1niwFpkW.js (the
   * data behind https://platform.heygen.com/pricing) — verified 2026-11-12.
   * Quote: “id:"avatar-iii",…,apiId:"avatar_iii",…tiers:[{id:"custom-video-avatar",
   * labelKey:"pricing_tier_custom_video_avatar",usd:.01,unit:"second"},
   * {id:"studio-avatar",labelKey:"pricing_tier_studio_avatar",usd:.0165,
   * unit:"second"},{id:"photo-avatar",labelKey:"pricing_tier_photo_avatar",
   * usd:.0165,unit:"second"}]”
   *
   * The row carries $0.0165, the top of the band — the avatar type is a
   * property of the look rather than of the request, so a body cannot settle
   * which rate applies, and an upper bound is the right kind of wrong. This is
   * the cheap engine — twelve times cheaper than Avatar V for the same Custom
   * Video Avatar — and it is the one to reach for when the look is a trained
   * twin.
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
    cost: { perVideoSecond: 0.0165 },
    // Does NOT render raw image input ("Not supported for raw image input
    // (type: \"image\")"), and the one engine that reads neither
    // `motion_prompt` nor `expressiveness`. Cheap, narrow, and a dedicated
    // photo-to-video pipeline.
  },
  /**
   * $0.0385 per second for a Photo Avatar, $0.0805 for a Custom Video Avatar or
   * a Studio Avatar (720p and 1080p).
   *
   * Source: https://platform.heygen.com/assets/catalogText-1niwFpkW.js —
   * verified 2026-11-12. Quote: “id:"avatar-iv",…,apiId:"avatar_iv",…
   * tiers:[{id:"photo-avatar",labelKey:"pricing_tier_photo_avatar",usd:.0385,
   * unit:"second"},{id:"custom-video-avatar",
   * labelKey:"pricing_tier_custom_video_avatar",usd:.0805,unit:"second"},
   * {id:"studio-avatar",labelKey:"pricing_tier_studio_avatar",usd:.0805,
   * unit:"second"}]”
   *
   * The row carries $0.0805, the top of the band, for `avatar_iii`'s reason.
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
    cost: { perVideoSecond: 0.0805 },
    // **The default**: `POST /v3/videos` runs this engine when `engine` is
    // omitted, and the only engine that renders the `image` arm, which
    // declares no `engine` at all. The only engine that reads `expressiveness`.
  },
  /**
   * $0.12 per second for a Custom Video Avatar (720p and 1080p) — the one tier
   * HeyGen publishes for this engine.
   *
   * Source: https://platform.heygen.com/assets/catalogText-1niwFpkW.js —
   * verified 2026-11-12. Quote: “id:"avatar-v",…,apiId:"avatar_v",…
   * pricing:{kind:"metered",noteKey:"pricing_avatar_resolution_note",
   * tiers:[{id:"custom-video-avatar",labelKey:"pricing_tier_custom_video_avatar",
   * usd:.12,unit:"second"}]}”
   *
   * NOT exact, and not a band either: the engine serves three look types —
   * https://developers.heygen.com/avatar-v (2026-11-12): "`digital_twin`,
   * `studio_avatar`, and `photo_avatar` looks that list `avatar_v` in
   * `supported_api_engines`" — and the table prices one of them. The row
   * carries the one published number; for a Studio or Photo Avatar look on this
   * engine HeyGen publishes no rate.
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
    cost: { perVideoSecond: 0.12 },
    // Cross-reference-driven animation: it animates from a `digital_twin` look
    // in the same avatar group, optionally named with `reference_look_id`.
    // Reads `motion_prompt` and REJECTS `expressiveness`. The `avatar` arm
    // only — https://developers.heygen.com/models marks "Arbitrary image
    // input" ✗ for it. Check `supported_api_engines` on the look before naming
    // it — eligibility is a property of the look, not of the account.
  },
  /**
   * $0.014 per second of output. Exact — `mode` is the only thing the price
   * depends on and it is in the body.
   *
   * Source: https://platform.heygen.com/assets/catalogText-1niwFpkW.js —
   * verified 2026-11-12. Quote: “path:"/v3/lipsyncs"},
   * docsUrl:"https://developers.heygen.com/lipsync-speed",icon:"voice",
   * pricing:{kind:"metered",tiers:[{id:"speed",labelKey:"pricing_tier_speed",
   * usd:.014,unit:"second"},{id:"precision",labelKey:"pricing_tier_precision",
   * usd:.029,unit:"second"}]}”
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
    cost: { perVideoSecond: 0.014 },
    // `mode: "speed"` on the wire, and what an omitted `mode` means.
    // https://developers.heygen.com/lipsync-speed
  },
  /**
   * $0.029 per second of output — about twice the speed mode, exact for its
   * reason.
   *
   * Source: https://platform.heygen.com/assets/catalogText-1niwFpkW.js —
   * verified 2026-11-12. Quote: “{id:"precision",labelKey:"pricing_tier_precision",
   * usd:.029,unit:"second"}”
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
    cost: { perVideoSecond: 0.029 },
    // `mode: "precision"` on the wire — "higher quality, uses avatar
    // inference", which is why it costs what an avatar render costs.
    // https://developers.heygen.com/lipsync-precision
  },
} as const satisfies Record<string, ModelInfo>;

export type HeygenCatalogModelId = keyof typeof models;
