---
"unmodel": patch
---

atlascloud: Seedance 2.5 native `4k`, nine corrected listed figures, and a pricing caveat that cites what Atlas says today

- **Native `4k` on Seedance 2.5.** All three Seedance 2.5 schemas on Atlas
  (`bytedance/seedance-2.5/text-to-video`, `/image-to-video`,
  `/reference-to-video`, read 2026-11-12) now list `"4k"` in `resolution`
  beside `"4k-esr"`. `atlascloud.video` was refusing it with
  `invalid_enum_value`; it is accepted, typed (`AtlasSeedance25Resolution`) and
  listed in `SEEDANCE_25_RESOLUTIONS`, now twelve values. `unmodel/video` still
  compiles canonical `4k` to `4k-esr` on these rows — native 4k and the enhanced
  rung are different products at different prices — and native 4k is
  `providerOptions.atlascloud.resolution: "4k"`. The three snapshots under
  `data/atlascloud/openapi/` are refreshed; every one of the 31 committed
  snapshots now matches its live document (canonical diff, 2026-11-12), and
  `VIDEO_VERIFIED` is `"2026-11-12"`.
- **Listed figures.** `ATLASCLOUD_LISTED_BASE_PRICE_USD` (and
  `data/atlascloud/pricing.json`) now read what
  `https://api.atlascloud.ai/api/v1/models` returned on 2026-11-12, still
  unit-less and still not a `cost`:
  - Seedance 2.5 ×3: `{ actual: 0.134, origin: 0.167, discount: 80 }` (was
    `0.134 / 0.134 / 100`);
  - Seedance 2.0 ×3: `{ actual: 0.09, origin: 0.112, discount: 80 }` (was
    `0.112 / 0.112 / 100`);
  - Seedance 2.0-mini ×3: `{ actual: 0.045, origin: 0.056, discount: 80 }` (was
    `0.039 / 0.056 / 70`).
- **`ATLASCLOUD_PRICING_CAVEAT` is rewritten.** The model page's meta
  description now reads "Starting from $0.134/second", so the "/1M tokens"
  sentence the caveat quoted is gone. Cost stays omitted on stronger evidence:
  Atlas's billing page (`https://www.atlascloud.ai/docs/models/price`) says
  video pricing "Varies by model, duration, and resolution; some models are
  billed by output video tokens", and Atlas's own cost test
  (`https://www.atlascloud.ai/blog/tips/seedance-2-5-draft-mode-cost-test`)
  prices one Seedance 2.5 render at "$0.134 per second" as a 480p draft and
  "$0.596 for direct 1080p". The catalog counts are restated: 608 rows, no
  curated row with a `unit`, 389 of 470 media rows unit-less, 223 rows
  discounted 30–95%. `ATLASCLOUD_PRICING_VERIFIED` is `"2026-11-12"`.
