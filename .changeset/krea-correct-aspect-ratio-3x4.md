---
"unmodel": patch
---

krea: `krea.image` accepts `aspect_ratio: "3:4"`, and the catalog and error copy match what Krea serves (verified 2026-11-12)

- **False refusal fixed.** All three Krea 2 routes (`krea-2/medium`,
  `krea-2/large`, `krea-2/medium-turbo`) accept a ninth aspect ratio, `"3:4"`.
  The spec Krea serves at https://api.krea.ai/openapi.json reads
  `"enum":["1:1","4:3","3:2","16:9","2.35:1","4:5","3:4","2:3","9:16"]`.
  Until now `krea.image` rejected it with `invalid_enum_value`.
  `KREA_ASPECT_RATIOS` (and so `KreaAspectRatio`, `unmodel/krea/values` and
  the `unmodel/image` ratio row) now lists all nine values in the served order.
  `unmodel/image` sends `aspectRatio: "3:4"` as is, and portrait 3:4 pixel
  `dimensions` map onto it exactly. Krea's developers/krea-2/overview page and
  `@krea-ai/sdk` 0.1.2 still list only eight values. The served spec is the
  API's own description and wins.
- **Turbo's display name.** `models["krea-2/medium-turbo"].name` is now
  `"Krea 2 Turbo"`, as in the route's OpenAPI summary and its API-reference
  page. The id and the route stay `krea-2/medium-turbo`.
- **Pricing provenance.** Turbo's rates ($0.015 / $0.0175 / $0.02) are
  unchanged, but they are now cited from
  https://www.krea.ai/docs/api-reference/krea/krea-2-turbo and the route's
  `x-krea-pricing`. The developers/krea-2/overview pricing table covers only
  Medium and Large. The old `krea-2-medium-turbo` refresh URL redirects
  (308) there.
- **Status code in the error copy.** The strict-schema refusal for an
  unknown key now says Krea answers it with a `422` (`unrecognized_keys`),
  not a `400`. Krea's errors page
  (https://www.krea.ai/docs/developers/errors-and-debugging) says "Invalid JSON
  (`400`) and validation (`422`)". The refusal itself is unchanged.
