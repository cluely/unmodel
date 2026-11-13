---
"unmodel": patch
---

runway: 29 new models validate, price and compile — Kling 2.5 / 3.0 / O3 / 4.0, WAN 3.0, MiniMax H3 Max, Grok Imagine 1.5 Lite, Gemini Omni Flash 1.1 / 1.2, Muse, Nano Banana 2.1 / 2 Lite, GPT Image 2.5 / 2.6, FIBO, Ideogram and Seedream 5.0 Flash / Pro Layers

Every row was read off Runway's OpenAPI document (spec version 2024-11-06),
`guides/models.md`, `guides/pricing.md` and `assets/inputs.md` on 2026-11-12.

- **Video** (`runway.video`, `runway.videoFromImage`, and for the O3 / 4.0 /
  Gemini 1.x arms `runway.videoFromVideo`): `kling2.5_turbo_pro`,
  `kling3.0_standard` / `_pro` / `_4k`, `klingO3_standard` / `_pro` / `_4k`,
  `kling_4`, `kling_4_flash`, `wan3`, `wan3_prime`, `h3_max`,
  `grok_imagine_1_5_lite`, `gemini_omni_flash_1.1`, `gemini_omni_flash_1.2`.
  New wire params: `cfgScale`, `providerSettings` (Kling multishot;
  `keepOriginalSound` on Kling O3 video-to-video), `promptExpansionMode`
  (H3 Max), `references` / `referenceVideos` on image-to-video, `duration:
  "auto"` (Gemini Omni 1.x), `mode: "edit"`, `auto_480p` / `auto_720p` /
  `auto_1080p` ratios, a `"middle"` prompt-image position (Kling 4.0), and the
  `360p` / `4k` / `768p` resolutions.
- **Image** (`runway.image`): `muse_image`, `gemini_image3.1_flash_lite`,
  `nano_banana_2.1`, `gpt_image_2_5_flare` / `_sunburst`,
  `gpt_image_2_6_flare` / `_sunburst`, `bria_fibo_1_5`, `bria_fibo_edit_1_5`,
  `ideogram_4_0`, `ideogram_4_5`, `ideogram_vector`, `seedream5_flash`,
  `seedream5_pro_layers`. New wire params: `thinkingLevel`,
  `reasoningEffort`, `frameCount`, `frameDurationMs`, `preciseEdit`,
  `contextWindow`, `maskUri`, `resolution` and `optimizePromptMode`;
  `outputFormat` gains `webp` / `gif` / `svg`, `quality` gains `xhigh` /
  `max` / `very_low`, and `background` `transparent` (on the arms that offer
  it). `promptText` and `ratio` are now required per model rather than by the
  route — `seedream5_pro_layers` needs only its source image, and the Ideogram
  and FIBO Edit arms make `ratio` optional.
- **Documented rules, now enforced**: Kling 4.0's first / ≤8 middle / last
  frame layout and its 10-image budget (frames plus references); Kling O3's
  7-image budget, and no `last` keyframe with `multiPrompt`; multishot
  segments totalling 3–15 s and `shotType: "intelligence"` needing
  `promptText`; `promptText` with references on Kling 4.0 / 4.0 Flash; WAN 3.0
  keyframes needing an `auto_*` ratio and never mixing with references; H3
  Max's last frame needing a first; Gemini Omni 1.2's extend / edit modes;
  GPT Image 2.6's GIF / SVG / JPEG rules; Ideogram 4.5's editing rules; FIBO
  Edit's two-image minimum for a chosen size; and the 31-bit `seed` on the FIBO
  and Ideogram Vector arms.
- **Pricing** (`guides/pricing.md`): flat and documented-default rates in the
  catalog; request-aware estimates for the tiered ones — the GPT Image 2.5 /
  2.6 quality × size × aspect tables (GIF and SVG included), Nano Banana 2.1
  and FIBO by size, Ideogram by quality (with 4.5's reference-dependent
  default), Seedream Pro Layers at its 17-image reservation, WAN / Grok Lite /
  Gemini Omni 1.x by ratio tier, and Kling 4.0 at list price (an upper bound
  until its promotion ends on 2026-11-30 UTC), rounded up where the page says
  so. Kling O3 video-to-video and Gemini Omni 1.x edits bill the input video's
  length and get no estimate.
- **Unified surfaces**: the new video models join `unmodel/video` (with the
  documented ratio tiers — Kling 4.0's `1440:1440` is its 1080p square — and a
  tier alone compiling to the model's `auto_<tier>` token), and the new
  generating image models join `unmodel/image`, which now sends `outputFormat:
  "webp"` to the arms that take it and sends no `ratio` to an arm that makes it
  optional when no size was asked for. `bria_fibo_edit_1_5` and
  `seedream5_pro_layers` edit an image rather than generate one, so they stay
  on `runway.image`.
- `referenceVideos` items type `type` as optional: the seedance / hailuo3 /
  wan3 arms still require `type: "video"`, the Kling 4.0 Flash and Gemini
  Omni 1.x arms refuse it.

Not catalogued: `hailuo3_highspeed`, `hailuo3_lite`, `recraft_v4_1_flash` and
`recraft_v4_1_vector` have arms in the spec but are on neither
`guides/models.md` nor `guides/pricing.md`; `ruby`, `enhance_frame_rate`,
`mirelo_sfx_2_0`, `eleven_music_v2_5` and `POST /v1/image_to_vector` live on
routes unmodel does not validate yet.
