---
"unmodel": patch
---

runway: corrected rates, bounds and false refusals on the existing models

Re-read against Runway's OpenAPI document, `guides/pricing.md` and
`assets/inputs.md` on 2026-11-12.

- **No longer refused** (requests the API accepts):
  - `seed` on `veo3.1` / `veo3.1_fast` and on every seedance arm, all routes
    (integer 0–4294967295).
  - `duration: "auto"` on `seedance2` / `_fast` / `_mini` / `seedance2_5`.
  - `seedance2_5`: the 1080p and 4K ratios (24 sizes on every route),
    `outputFormat: "mov"`, and `mode: "edit"` on video-to-video.
  - `promptText` up to 10000 characters on `seedance2` / `_fast` / `_mini`.
  - `resolution: "768p"` / `"2k"` on `hailuo3`, `"720p"` / `"1080p"` on
    `happyhorse_1_0` image-to-video.
  - gen4.5's nine 10-bit and HDR `outputFormat` profiles (`hdr10`, `hlg`,
    `sdr_rec709_10bit`, `hdr_prores`, …) and aleph2's `sdr_rec709_10bit`.
  - `background: "transparent"` on `gpt_image_2` (also on the unified
    `background` extra).
  - Prompts up to 45000 characters on `gemini_image3_pro`,
    `gemini_image3.1_flash` and `gemini_2.5_flash` (`gemini_image3_pro` now
    also enforces its minimum of 3).
  - Freeform `seedream5_lite` sizes: any `W:H` whose area is 3686400–16777216
    pixels, not only the 16 presets; `unmodel/image` sends such `dimensions`
    verbatim.
- **Tightened**: `seedance2` / `_fast` / `_mini` take at most 2
  `referenceVideos` on video-to-video (3 elsewhere).
- **Prices** (`guides/pricing.md`):
  - `seedance2` 14 / 30 / 40 / 150 credits/s at 480p / 720p / 1080p / 4K with
    a 56-credit minimum; `seedance2_fast` 11 / 24 (44 minimum);
    `seedance2_mini` 7 / 15 (28 minimum). The fast / mini catalog rates are
    removed (no documented default ratio).
  - `seedance2_5` gains its 1080p tier (68 credits/s); its 4K sizes get no
    estimate (no published 2.5 rate); the catalog now carries the default
    `1280:720` rate, $0.30/s.
  - `duration: "auto"` on the seedance arms is estimated at the variant
    maximum it reserves up front (15 s, 30 s on `seedance2_5`).
  - Documented defaults replace worst cases: `hailuo3` 2K ($0.15/s, now in the
    catalog), `grok_imagine_1_5` 480p ($0.10/s, now in the catalog),
    `happyhorse_1_0` image-to-video 720P; `happyhorse_1_0` text-to-video bills
    by its ratio's tier, and lower-case `768p` / `720p` price at their tier.
  - `gemini_image3.1_flash` is priced: 5 / 7 / 11 / 16 credits per 512px /
    1K / 2K / 4K image.
  - The professional-output surcharge is per format: 5 credits/s for
    `prores` / `png_sequence`, 20 for the 10-bit and HDR profiles, 40 above
    4 megapixels (`HDR_SURCHARGE_CREDITS_PER_SECOND`,
    `HDR_OVER_4MP_SURCHARGE_CREDITS_PER_SECOND`).
- The generation routes' 200 is documented as `{ id, estimatedCost: {
  credits } }` in the module headers.
