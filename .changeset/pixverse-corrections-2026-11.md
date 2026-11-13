---
"unmodel": patch
---

pixverse: corrected credit rate and v5.6 prices, no estimate for the legacy models, template requests without `img_id`, `webhook_id` on both routes, and a 2048-character image-to-video prompt

All checked against PixVerse's current docs on 2026-11-12.

- **Every estimate was 2.25× too high.** `CREDIT_USD` is now `1 / 225`.
  The pricing page gives "225 Credits = USD 1; 1 Credit ≈ USD 0.004444" and
  works out every USD figure as "total Credits ÷ 225"
  ([pricing](https://docs.platform.pixverse.ai/pixverse-api-pricing-2394995m0)).
  The $0.01-per-credit pack table the old rate came from is no longer on the
  page. Your plan, volume deals or promotions can change what you actually
  pay, so treat an estimate as PixVerse's list price.
- **v5.6, 5 seconds with audio** now costs 80 credits at 540p, 90 at 720p and
  120 at 1080p, which is a flat 45 credits on top of the silent price. The
  catalog had 90, 80 and 150, the figures from the earlier pricing page.
- **v4.5 / v4 / v3.5 return no estimate.** The pricing page now lists only
  C1, V6, V6 Max, V5.6, V5.5 and V5, and it says "Legacy-model availability
  depends on the active endpoint and your account". The three ids still
  validate, because both routes still accept them.
- **Retired: `VideoCostInputs.motionMode`.** It only chose a column of the
  v4.5 / v4 / v3.5 price table, and PixVerse no longer publishes that table.
  `videoCredits` / `videoCostUSD` callers should stop passing it.
- **`pixverse.videoFromImage` accepts template requests without `img_id`.**
  The schema's `anyOf` asks for `img_id` without `template_id`, or for
  `template_id` plus whatever image field the template takes. A multi-image
  template takes `img_ids` and rejects `img_id`
  (`SINGLE_IMAGE_INPUT_UNSUPPORTED`,
  [error details](https://docs.platform.pixverse.ai/error-details-2490131m0)).
  The validator used to require `img_id` in every request, so the only
  multi-image template request it let through was one the API refuses.
  `ImageToVideoParams` is now a union of the two shapes, so a request
  without `template_id` still needs `img_id`, at compile time and at run time.
- **`webhook_id` is typed on both routes.** It is the id of a webhook you
  set up in your PixVerse account, not a callback URL. It used to be a
  compile error and an `unknown_param` warning. `.toApi("fal")` refuses it,
  because fal's v6 endpoint has no webhook field and dropping it would mean
  no callback ever arrives.
- **`lip_sync_switch` is typed on `pixverse.videoFromImage`**, the spelling
  that route's schema uses, with the same v5-and-below gate as the other
  legacy lip-sync fields. `lip_sync_tts_switch` is still accepted.
- **The image-to-video `prompt` limit is 2048 characters** (`IMAGE_PROMPT_MAX_CHARS`).
  The validator used to apply text-to-video's 5000.
- The `.toApi("fal")` refusal message for `motion_mode` no longer says the
  motion mode changes the price, since PixVerse no longer prices it on this
  route.
- Source links point at the current docs pages. The old pricing, model
  overview, capability matrix, V6 matrix and API key pages now return 404.
