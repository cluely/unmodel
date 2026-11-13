/**
 * The Runway video routes' published lists, on an **import-free** leaf.
 *
 * `unmodel/runway/values` re-exports these five, and `./constraints.ts` — the
 * per-model deny / enum / shape tables for every route — is ~60 KiB that a
 * picker reading one model list must not pay for. `./constraints.ts`
 * re-exports every name, so the wire modules and their tests are unchanged.
 * The same split as `google/image-constraints.ts`.
 */

/**
 * Which models each route's request union actually has an arm for
 * (openapi.json, verified 2026-11-12). The catalog is provider-wide, so a
 * model can be "known" yet have no arm on the route being called — e.g.
 * `gen4_turbo` is image_to_video-only, `aleph2` is video_to_video-only, and
 * the Kling 2.5 / 3.0 arms are on image_to_video and text_to_video only.
 */
export const IMAGE_TO_VIDEO_MODELS = [
  "gen4.5",
  "gen4_turbo",
  "veo3.1",
  "veo3.1_fast",
  "hailuo3",
  "happyhorse_1_0",
  "seedance2",
  "seedance2_fast",
  "seedance2_mini",
  "seedance2_5",
  "grok_imagine_1_5",
  "gemini_omni_flash",
  "kling2.5_turbo_pro",
  "kling3.0_standard",
  "kling3.0_pro",
  "kling3.0_4k",
  "klingO3_standard",
  "klingO3_pro",
  "klingO3_4k",
  "kling_4",
  "kling_4_flash",
  "wan3",
  "wan3_prime",
  "h3_max",
  "grok_imagine_1_5_lite",
  "gemini_omni_flash_1.1",
  "gemini_omni_flash_1.2",
] as const;

export const TEXT_TO_VIDEO_MODELS = [
  "gen4.5",
  "veo3.1",
  "veo3.1_fast",
  "hailuo3",
  "happyhorse_1_0",
  "seedance2",
  "seedance2_fast",
  "seedance2_mini",
  "seedance2_5",
  "grok_imagine_1_5",
  "gemini_omni_flash",
  "kling2.5_turbo_pro",
  "kling3.0_standard",
  "kling3.0_pro",
  "kling3.0_4k",
  "klingO3_standard",
  "klingO3_pro",
  "klingO3_4k",
  "kling_4",
  "kling_4_flash",
  "wan3",
  "wan3_prime",
  "h3_max",
  "grok_imagine_1_5_lite",
  "gemini_omni_flash_1.1",
  "gemini_omni_flash_1.2",
] as const;

export const VIDEO_TO_VIDEO_MODELS = [
  "aleph2",
  "hailuo3",
  "seedance2",
  "seedance2_fast",
  "seedance2_mini",
  "seedance2_5",
  "gemini_omni_flash",
  "klingO3_standard",
  "klingO3_pro",
  "klingO3_4k",
  "kling_4",
  "kling_4_flash",
  "gemini_omni_flash_1.1",
  "gemini_omni_flash_1.2",
] as const;

/** seedance2_fast / seedance2_mini full enum; seedance2's 480p/720p tier. */
export const SEEDANCE2_SMALL_RATIOS = [
  "992:432",
  "864:496",
  "752:560",
  "640:640",
  "560:752",
  "496:864",
  "1470:630",
  "1280:720",
  "1112:834",
  "960:960",
  "834:1112",
  "720:1280",
] as const;

/** `targetAspectRatio` (aleph2 expand/outpaint) — openapi.json. */
export const ALEPH2_TARGET_ASPECT_RATIOS = [
  "16:9",
  "4:3",
  "3:2",
  "1:1",
  "2:3",
  "3:4",
  "9:16",
  "21:9",
] as const;
