# Photoroom — wire research

Researched 2026-11-24 for a native `unmodel/photoroom` provider. Research only:
nothing under `src/` was written. Three sources, per the provider-work rule —
the docs, the API reference (a published OpenAPI 3.1 document), and, because
Photoroom ships **no SDK**, keyless probes of the live API for the things the
other two leave open (error shapes, the JSON-body question).

| Source | URL | What it settles |
| --- | --- | --- |
| Docs index | https://docs.photoroom.com/llms.txt (every page is also served as `<page>.md`) | the page list; feature prose |
| OpenAPI | https://image-api.photoroom.com/openapi (`openapi: 3.1.0`, `info.version: 1.0.0`, 116,884 bytes, sha256 `c2eee99cad17b623f48154d6918c34bfdaf116dc684ff43b5155db902b45de6a`, fetched 2026-11-24) | every path, every parameter name, enum, range, default, response header and error schema |
| Rendered reference | https://docs.photoroom.com/getting-started/api-reference-openapi.md | the same spec, **lossy** — see "Source hierarchy" |
| Agent prompt | https://docs.photoroom.com/getting-started/integrating-with-claude-code-codex-or-cursor.md | the request headers that are NOT in the OpenAPI; status-code semantics |
| Pricing | https://www.photoroom.com/api/pricing, https://docs.photoroom.com/getting-started/pricing.md, `…/image-editing-api-plus-plan/pricing.md`, `…/remove-background-api-basic-plan/pricing.md` | per-call rates |
| Live API (no key / a made-up key) | `image-api.photoroom.com`, `sdk.photoroom.com` | 401 / 400 bodies, "multipart only", `image_file_b64` |

**SDK: none.** The docs' own integration prompt says "Prefer the platform's
standard HTTP client … with multipart/form-data; no SDK is required." The npm
registry search for `photoroom` (2026-11-24) returns only Photoroom's own UI
packages (`@photoroom/ui`, `@photoroom/icons`) and third-party wrappers
(`photoroom-sdk`, `photoroom-cli`, assorted `piece-photoroom` connectors) — none
official, none read as a source. The OpenAPI document is therefore the
SDK-equivalent tie-breaker.

(verified 2026-11-24) "None" needs two footnotes, both from Photoroom's own
GitHub org (https://github.com/Photoroom): (a) `PhotoRoomKit-Swift` was an
official iOS SDK (CocoaPods/Carthage) for `/v1/segment` only — its README says
"Please note that `PhotoRoomKit` has been **deprecated**" and the repo was last
pushed 2023-03-03, so it is not a source; (b) `Photoroom/api-code-samples`
(Node / Python / web / iOS, last pushed 2026-04-23) is official sample code,
not an SDK — it covers `/v1/segment` only and agrees with the spec on host
(`sdk.photoroom.com`), field (`image_file`) and header (sent as `X-Api-Key` in
the web and iOS samples, `x-api-key` in Python — HTTP headers are
case-insensitive). PyPI has no `photoroom` package (404).

**Not verified with a key.** No Photoroom credential was used. Everything
marked *unverified* below is settled by one `sandbox_` call (free, 1,000/month)
and is listed again under Open questions.

## Source hierarchy, and where the sources disagree

1. **The raw OpenAPI beats the rendered reference page.** The GitBook page
   embeds a compressed copy of the spec: its POST `/v2/edit` fragment has
   **every enum, default, minimum and maximum stripped** (`shadow.mode` is a
   bare `string` there), drops the `x-uncertainty-score` response header, drops
   `securitySchemes` (it shows `security: [{}]`), and omits four whole paths (`/v1/account`, both `visual-qa` routes, `/v1/render`).
   Type from `https://image-api.photoroom.com/openapi`, never from the page.
2. **Within the raw OpenAPI, the GET parameter list is the typed one.** POST
   `/v2/edit`'s `multipart/form-data` schema lists the same 86 properties with
   only `type` / `format` / `description`; the constraints live on the 87 GET
   query parameters. The two operations are documented as "Both endpoints
   accept the same parameters" (agent prompt), so the GET schemas are the
   source for POST field constraints.
3. **Feature prose beats the spec for the request HEADERS**, because the spec
   does not declare any request header besides the key (§1.4).

Contradictions found, and which side wins:

| # | Topic | Source A | Source B | Wins / what to do |
| --- | --- | --- | --- | --- |
| C1 | Lossy export quality | OpenAPI `export.format`: "Jpeg exports with a quality of 80, WebP and AVIF export with a quality of 90." | `…/file-size-resolution-and-format.md`: "JPEG, WebP export with a quality of 90. AVIF uses 75" | Neither — not a wire fact, there is no quality param. State no number anywhere. |
| C2 | `outputSize` default | OpenAPI: `default: "auto"` | Agent prompt: "originalImage (default)" | OpenAPI. Not a real conflict: `auto` "behave[s] like `originalImage` when templateId isn't defined". |
| C3 | Colour syntax (`background.color`, `outline.color`) | OpenAPI description: "hex color without the hash sign (example: `FF0000`, `FF0000EE`) or color name" | `background.color`'s own `examples: ["#FF0000", "red"]` — **only `background.color`**; `outline.color`'s examples are `["FF0000", "red"]`, consistent with its description (verified 2026-11-24). `/v1/segment` `bg_color`: "a hex code (`#FF00FF`)" while its remove.bg example sends `bg_color=FFFFFF` | Unresolvable from docs for `background.color` and `bg_color`. Type all three as `string`, **no pattern check**. |
| C4 | `padding` upper bound | OpenAPI: "a number between 0 and 0.49" | `…/positioning.md`: "its value must be strictly less than `0.5`"; the schema itself has no `minimum`/`maximum` | Do not enforce a numeric bound; the real rule is per-axis (opposing sides summing to ≥ 100% errors). Server-side. |
| C5 | Out-of-credit status | OpenAPI: `402` on `/v2/edit` and `/v1/segment` | Agent prompt + `…/troubleshooting.md`: zero balance → `403` `{"error":{"message":"Unauthorized"}}`; prompt also lists "402: payment required (no credits)" | Both exist in the docs. A response checker must treat 402 **and** 403 as "auth or credits". (verified 2026-11-24) The spec's own status lists are thinner than the docs: `/v2/edit` declares only 200/400/402/500 — its 401, 403 and 429 come from the agent prompt, the FAQ and the probes; `/v1/segment` declares 200/400/402 and a body-less `403 Forbidden`. |
| C6 | URL inputs on POST | OpenAPI POST lists `imageFile` only ("The POST endpoint accepts `imageFile` only"), and omits `background.imageUrl`, `background.guidance.imageUrl`, `editWithAI.additionalImages.{key}.imageUrl` | `…/edit-with-ai.md` shows `--form editWithAI.additionalImages.styleRef.imageUrl=https://…` on a POST; `…/preview-templating-mode.md` shows `--form 'layers.product.image.imageUrl=…'` on a POST; `…/static-background.md` marks only `background.imageFile` as POST-only | Split: top-level `imageUrl` on POST is refused by the spec in so many words → **not typed on POST**. Nested `*.imageUrl` on POST is exampled by the docs → **typed on POST**. `background.imageUrl` / `background.guidance.imageUrl` on POST is *unverified* (open question Q3). |
| C7 | `background.guidance.imageFile` | OpenAPI lists it as a GET **query** parameter with `format: binary` | Its own description: "Only available in the POST request" | Description. A spec artefact (the GET list is generated from the shared schema); bytes cannot ride a query string. |
| C8 | Sandbox scope | `…/remove-background-api-basic-plan/sandbox-mode.md` shows a `sandbox_` call to `/v1/segment` (its first sentence says "Image Editing API" — a copy-paste) ; `getting-started/pricing.md`: "Sandbox mode on both" | Pricing page FAQ: "1,000 sandbox calls a month on the Image Editing API" | Docs (both APIs) — but *unverified*; irrelevant to validation since unmodel never sees the key. |
| C9 | `/v2/account` body | Current docs/spec: `{"images":{"available","subscription"},"plan"}` | Changelog 2023-06-26: `{"credits":{…}}` | Current spec; `credits` is the `/v1/account` shape. Out of scope anyway. |
| C10 | Upscale factor | OpenAPI `upscale.mode`: "enlarge the input image **up to** 4 times" | `…/preview-ai-upscale.md`: "increases the resolution of your input image by 4 … 300x400 … into … 1200x1600" | Docs page for the default behaviour (4×); "up to" is what `upscale.downscaleIfNeeded` introduces. There is **no factor parameter** either way. |
| C11 | Perspective Correction plan (verified 2026-11-24) | `…/perspective-correction.md`: "Perspective Correction is only available for Enterprise plans." | https://www.photoroom.com/api/pricing feature matrix (JSON-LD `additionalProperty`): `"Control Perspective"` is `true` for **Plus** and Enterprise, `false` for Basic | Irrelevant to typing — neither source documents a parameter or header for it, so nothing can be typed. Do not repeat either plan claim in `docs/providers.md`; say only "no documented parameter". |
| C12 | `/v2/edit` input formats (verified 2026-11-24) | Agent prompt: "Input: PNG, JPEG or WEBP" | `…/file-size-resolution-and-format.md` and the pricing-page FAQ: "four formats: PNG, JPEG, WEBP and AVIF" | The feature page (two sources agree). Not a validator concern — unmodel does not sniff a `Blob`'s format — but the module header must say four. |
| C13 | AI Upscale input cap (verified 2026-11-24) | OpenAPI `upscale.mode`: "`ai.fast`: maximum 1,000,000 input pixels", "`ai.slow`: maximum 262,144 input pixels" (a **pixel-count** rule, and only "With the default model") | `…/preview-ai-upscale.md`: "1,000x1,000 pixels for the mode `ai.fast`", "512x512 for the mode `ai.slow`" (a **per-side** rule) | Same numbers squared, different rules (2000×400 passes one and fails the other). Neither is checkable from a `Blob` without decoding; quote the OpenAPI wording in JSDoc, enforce nothing. |

## 1. Hosts, auth, transport, responses

### 1.1 Hosts and paths (OpenAPI `paths` + per-operation `servers`)

| Method + path | Host | Plan | In scope? |
| --- | --- | --- | --- |
| `POST /v2/edit` | `https://image-api.photoroom.com` | Plus | **yes** |
| `GET /v2/edit` | `https://image-api.photoroom.com` | Plus | yes, with a core decision (§4.5) |
| `POST /v1/segment` | `https://sdk.photoroom.com` | Basic | **yes** |
| `GET /v2/account` (and `/v1/account`) | `https://image-api.photoroom.com` | any | no — balance read, not a generation |
| `POST /v3/visual-qa`, `POST /v2/visual-qa` | `https://image-api.photoroom.com` | Enterprise | no — "requests authenticated with a non-Enterprise API key receive a 403 with a link to contact our sales team" (OpenAPI) ; JSON analysis, not media |
| `GET`/`POST /v1/render` | `https://image-api.photoroom.com` | Plus | no — titled "[LEGACY] Image Editing v1" |

Note the two hosts: the Basic endpoint is on `sdk.photoroom.com`, not the
`image-api` host. `GET /v1/segment` answers `405` (probed).

No endpoint is documented for the Video API or the Visual Agent API
(`…/video-api-enterprise-plan/overview.md`, `…/visual-agent-api-enterprise-plan/overview.md`
are sales pages); "Perspective Correction is only available for Enterprise
plans" and documents no parameter (`…/perspective-correction.md`). None of
these can be typed, so none is in the library.

### 1.2 Auth

- Header **`x-api-key: <key>`** — OpenAPI `securitySchemes`:
  `{"type":"apiKey","name":"x-api-key","in":"header"}`, global `security`.
  Lower-case in every doc example. Same header on both hosts.
- Sandbox: "To use sandbox mode, prepend `sandbox_` to your API key. (Example:
  `sandbox_xxxxxxxxxxxxxxxx`)" — "up to 1,000 free calls by month … (the max
  per day is 100 calls)", "will produce an image with a watermark"
  (`…/image-editing-api-plus-plan/sandbox-mode.md`). It is a property of the
  **key**, so unmodel has nothing to model; it belongs in the module header as
  a fact a caller would otherwise have to find elsewhere.
- The live 401 says the key may also travel "as a parameter"
  (`{"error":{"message":"API key not provided or invalid. Provide it as x-api-key header or as a parameter."}}`).
  (verified 2026-11-24) The parameter is the **query-string** `apiKey`: the
  OpenAPI declares it only on the legacy `GET /v1/render`
  (`{"name":"apiKey","in":"query"}`) and echoes it in the `/v2/account` 400
  example (`"apiKey: Required"`); probed with a made-up key,
  `?apiKey=<bad>` on `GET /v2/account`, `GET /v2/edit` and `POST /v2/edit`
  flips the 401 text from "API key not provided or invalid…" to "The API key
  could not be authenticated.", whereas `?api_key=`, `?x-api-key=` and a
  multipart form field `apiKey` do not. It is undocumented for `/v2/edit` and
  puts a credential in a URL — **do not type it**; unmodel never carries keys.
- unmodel never touches keys: `.request.headers` carries no `x-api-key`.

### 1.3 Content types, per endpoint

| Endpoint | Request framing | Evidence |
| --- | --- | --- |
| `POST /v2/edit` | **`multipart/form-data` only.** Every parameter is a form field; nothing in the query string. | OpenAPI: "all parameters must be passed via the request body using multipart/form-data encoding. Parameters must not be passed using the query string." Probed: `Content-Type: application/json` → `400 {"error":{"message":"Only multipart form data is supported by this endpoint."}}` |
| `GET /v2/edit` | **Query string only**, no body; the image is `imageUrl`. | OpenAPI: all 87 parameters are `in: query`. |
| `POST /v1/segment` | `multipart/form-data` (`image_file`), **or** `application/json` `{"image_file_b64": "<base64>"}` | Multipart: OpenAPI. JSON: `…/troubleshooting.md` ("sending your image in Base64 format is possible for the Remove Background API"), plus two more docs sources (verified 2026-11-24): the agent prompt ("Base64 input is also accepted as JSON: {"image_file_b64": "..."} with Content-Type: application/json") and `tutorials/how-to-migrate-from-remove.bg-api-before-it-shuts-down.md` ("`image_file_b64` — Supported, but only when the request is sent as JSON rather than as a form") — **not in the OpenAPI**; probed: a JSON body with an empty `image_file_b64` → `400 {"detail":"Please provide a valid image. The value set for the argument image_file_b64 is not a valid image.","status_code":400,"type":"invalid_image"}`, so the server does read the field. Whether `format`/`size`/… may ride in the same JSON object is undocumented. |

There is no JSON body for `/v2/edit` in any form — nested or dotted.

**How structure is encoded.** Everything is flat, dotted field names — in the
form body for POST and in the query string for GET. The OpenAPI *schemas* for
four parameters are objects/arrays; the docs show how they flatten:

- object → dotted path: `background.expandPrompt.mode=ai.never`,
  `virtualModel.model.preset.name=avery`,
  `virtualModel.scene.custom.imageFile=@…` (`…/ai-backgrounds.md`, `…/virtual-model.md`).
- map with caller-chosen keys → the key is a path segment:
  `editWithAI.additionalImages.myFirstImage.imageFile`,
  `layers.<UNIQUE_ID>.text.content`, `layers.<UNIQUE_ID>.image.imageUrl`.
- array → written `virtualModel.additionalProductImages[].imageFile` in the
  docs' prose with **no worked example**; for `editWithAI.additionalImages`
  the docs say "Array-style notation is also supported:
  `editWithAI.additionalImages[0].imageFile` or `editWithAI.additionalImages.0.imageUrl`".
  The exact index syntax for `virtualModel.additionalProductImages` is
  *unverified* (Q4).
- booleans: "Booleans are the strings `true`/`false`" (agent prompt).
- numbers: decimal text (`padding=0.15`); `padding`/`margin` also take strings
  (`10%`, `100px`).

### 1.4 Request headers that select behaviour (NOT in the OpenAPI)

These are HTTP request headers, "not parameters in the body or query string"
(agent prompt). None appears in the spec; each is documented on its feature
page. Values listed are every value the docs name — no closed enum is published.

| Header | Documented values | Effect | Source |
| --- | --- | --- | --- |
| `pr-ai-background-model-version` | `3` (current default), `background-studio-beta-2025-03-17` (recommended), `2` (deprecated; the only one that honours `background.negativePrompt`) | AI Backgrounds model | `…/ai-backgrounds.md` |
| `pr-ai-shadows-model-version` | `2026-04-15` | New AI Shadows model. **Required** for `shadow.mode=ai.auto-with-overrides`, `ai.preset-soft`, `ai.preset-hard` and the five `shadow.*Override` fields; with it, `ai.soft` / `ai.hard` (legacy-only) and `ai.floating` ("Not compatible with the `2026-04-15` AI Shadows model") are wrong. | OpenAPI `shadow.mode` description; `…/ai-shadows.md` |
| `pr-hd-background-removal` | `auto` | HD Background Removal, "recommended … (≥ 2K)" | `…/hd-background-removal.md` |
| `pr-ai-upscale-model-version` | `ai-upscale-2025-07-29` | early-access model for `upscale.mode=ai.fast` | `…/preview-ai-upscale.md` |
| `pr-ironing-model-version` | `v2` | new AI Ironing model (changelog 2026-10-23). (verified 2026-11-24) The feature page makes the header part of the recipe, not an option: "To iron clothing in an image: 1. set the parameter `ironing.mode` to `ai.auto` 2. add the HTTP header `pr-ironing-model-version: v2`" — and the agent prompt's header list omits it. What `ironing.mode` does without the header is undocumented, so no cross-field rule. | `…/ai-ironing.md` |

"sending shadow.*Override parameters without the shadows header, or ai.soft
with the header, will fail or be ignored" (agent prompt) — a real, checkable
cross-field rule whose second half lives in a header.

### 1.5 Responses

- **200 = the image bytes.** `/v2/edit`: `image/png` by default, or whatever
  `export.format` asks for. `/v1/segment`: `image/png`, or — per the OpenAPI's
  second 200 content type — `application/json` `{"base64img": "<base64>"}`;
  the docs' base64 sample sends `Accept: application/json`, their multipart
  sample `Accept: image/png, application/json`. That the `Accept` header is
  what switches the body is implied, not stated (Q6).
- **Response headers** (OpenAPI `responses.200.headers`):

  | Header | On | Meaning |
  | --- | --- | --- |
  | `x-uncertainty-score` | `/v2/edit`, `/v1/segment` | "a number between 0 and 1. 0 means the model is very confident that the cutout is accurate, 1 means the model is unsure … If an image contains humans, it will return the value -1." Not stable over time. Also the only one CORS-exposed besides `pr-debug` (live: `access-control-expose-headers: pr-debug,x-uncertainty-score`). |
  | `pr-ai-background-seed` | `/v2/edit` | "the seed used when generating the background" |
  | `pr-texts-detected` | `/v2/edit` | "When removing texts from an image, it will return the number of texts detected." |
  | `pr-unsupported-attributes` | `/v2/edit` | "[Temporary] If the request contains attributes that are not supported by the API, this header will be returned with a list of the unsupported attributes. Soon to be replaced by a 400 Bad Request response." Example value: `Unsupported attributes: background.inner` |
  | `pr-edit-further-url` | `GET /v2/edit` only | "A URL to open the result of the API call in the Photoroom webapp" |

  **No credits/usage header exists.** Balance is `GET /v2/account` →
  `{"images":{"available":N,"subscription":N},"plan":"basic"}`.
  (verified 2026-11-24) That is one arm of an `anyOf`: the OpenAPI's second
  arm, titled "Usage-based Enterprise plan", is
  `{"balance":{"amount":"1234.56","amountHundredths":123456,"currency":"usd"},"plan":"enterprise_usage_based"}`
  (`currency` nullable) — money, not images. See §3.

  `pr-unsupported-attributes` is the important one for a validator: today an
  unknown or misspelt field is **silently ignored with a 200**, which is
  exactly the failure unmodel exists to catch before the send.

- **Errors.** Two shapes, one per host — and no third (verified 2026-11-24):

  | Where | Shape | Evidence |
  | --- | --- | --- |
  | `image-api` 400 / 401 / 403 / 500 | `{"error":{"message": string}}` | OpenAPI `edit-image-bad-request` (400), `unknown-error` (500); 401 probed; 403 from `…/troubleshooting.md` — the spec declares neither 401 nor 403 on `/v2/edit` |
  | `image-api` 402 | `{"error":{"message": string}}` — **the same shape**, not `error.detail` (verified 2026-11-24): OpenAPI `payment-error` is `{error:{message}}` with `required: ["message"]`. Its two documented texts: "API credits exhausted. Visit https://app.photoroom.com/api-dashboard to purchase more API credits" (API credits) and "Your wallet balance is too low for this request. Contact our sales team at https://www.photoroom.com/contact-sales to add funds." (usage-based) | OpenAPI `payment-error` (*not observed*) |
  | `sdk` (`/v1/segment`) 400 / 402 | `{"detail": string, "status_code": number, "type": string}` — e.g. `type: "missing_image"`, `"invalid_image"`. The spec reuses the 400 schema (and its `missing_image` example) verbatim for 402 and declares a body-less 403. | OpenAPI; 400 probed |
  | either | `429` "The default rate limit is 60 images per minute." | `…/frequently-asked-questions.md` |

  Probed message texts: no key → `"API key not provided or invalid. Provide it as x-api-key header or as a parameter."`; bad key →
  `"The API key could not be authenticated."`. `/v1/segment` validates the
  body **before** the key (a keyless empty POST is a 400 `missing_image`, not a 401).
  "Calls that result in an error will **not** consume an image" (`getting-started/pricing.md`).

- **Limits.** `/v2/edit`: input PNG, JPEG, WEBP, AVIF; "Maximum File Size:
  30MB"; "Maximum Resolution: 5,000 pixels on the widest side" — larger is
  accepted under 30 MB and "resized down". `/v1/segment`: input PNG, JPEG,
  WEBP, HEIC; 50 MB; 6,000 px. Only the byte limits are checkable from a
  `Blob` without decoding. Both synchronous — one request, one image, no job
  id, no polling. "One image per call." (verified 2026-11-24) Both file-size
  pages add "We recommend limiting images to 25 megapixels for optimal
  performance", and the `/v2/edit` format list has a contradiction (C12).

## 2. Request parameters

### 2.1 `/v2/edit` — the full parameter table

Generated mechanically from the raw OpenAPI (GET parameter schemas for the
constraints; the last column says which operation lists the name). Casing is
exact — camelCase segments joined by dots; `editWithAI` has a capital `AI`.
**Nothing is `required`** in either operation: the server needs one of
`imageFile` / `imageUrl` / `imageFromPrompt.prompt` / `templateId`, and says
so only in prose.

| Wire name | Type / enum / range (GET schema) | Default | Listed under |
| --- | --- | --- | --- |
| `background.blur.mode` | enum: `gaussian`, `bokeh` |  | GET+POST |
| `background.blur.radius` | number (exclusiveMinimum=0, maximum=0.05) | `0.01` | GET+POST |
| `background.color` | string | `"transparent"` | GET+POST |
| `background.expandPrompt` | const `auto` \| const `never` \| object{mode} required:mode |  | GET+POST |
| `background.guidance.imageFile` | string (format=binary) |  | GET+POST |
| `background.guidance.imageUrl` | string |  | GET only |
| `background.guidance.scale` | number (maximum=1) | `0.6` | GET+POST |
| `background.imageFile` | string (format=binary) |  | POST only |
| `background.imageUrl` | string |  | GET only |
| `background.negativePrompt` | string |  | GET+POST |
| `background.prompt` | string |  | GET+POST |
| `background.scaling` | enum: `fit`, `fill` | `"fill"` | GET+POST |
| `background.seed` | number |  | GET+POST |
| `beautify.mode` | enum: `ai.auto`, `ai.food`, `ai.car` |  | GET+POST |
| `beautify.onSubjectMismatch` | enum: `ignore`, `error` |  | GET+POST |
| `beautify.seed` | number |  | GET+POST |
| `colorSpace` | enum: `original`, `sRGB` | `"sRGB"` | GET+POST |
| `describeAnyChange.mode` | const `ai.auto` |  | GET+POST |
| `describeAnyChange.prompt` | string (minLength=1) |  | GET+POST |
| `describeAnyChange.seed` | number |  | GET+POST |
| `editWithAI.additionalImages.{key}.imageFile` | string (format=binary) |  | POST only |
| `editWithAI.additionalImages.{key}.imageUrl` | string |  | GET only |
| `editWithAI.mode` | const `ai.auto` |  | GET+POST |
| `editWithAI.prompt` | string (minLength=1) |  | GET+POST |
| `editWithAI.seed` | number |  | GET+POST |
| `expand.mode` | const `ai.auto` |  | GET+POST |
| `expand.seed` | number |  | GET+POST |
| `export.dpi` | number (minimum=72, maximum=1200) |  | GET+POST |
| `export.format` | enum: `png`, `jpeg`, `jpg`, `webp`, `avif` | `"png"` | GET+POST |
| `flatLay.mode` | const `ai.auto` |  | GET+POST |
| `flatLay.prompt` | string |  | GET+POST |
| `flatLay.size` | enum: `PORTRAIT_HD_16_9`, `PORTRAIT_HD_4_3`, `PORTRAIT_HD_3_2`, `SQUARE_HD`, `LANDSCAPE_HD_3_2`, `LANDSCAPE_HD_4_3`, `LANDSCAPE_HD_16_9` | `"SQUARE_HD"` | GET+POST |
| `ghostMannequin.mode` | const `ai.auto` |  | GET+POST |
| `ghostMannequin.prompt` | string |  | GET+POST |
| `ghostMannequin.size` | enum: `PORTRAIT_HD_16_9`, `PORTRAIT_HD_4_3`, `PORTRAIT_HD_3_2`, `SQUARE_HD`, `LANDSCAPE_HD_3_2`, `LANDSCAPE_HD_4_3`, `LANDSCAPE_HD_16_9` | `"SQUARE_HD"` | GET+POST |
| `horizontalAlignment` | enum: `left`, `center`, `right` |  | GET+POST |
| `ignorePaddingAndSnapOnCroppedSides` | boolean | `true` | GET+POST |
| `imageFile` | string (format=binary) |  | POST only |
| `imageFromPrompt.prompt` | string (minLength=1) |  | GET+POST |
| `imageFromPrompt.seed` | number |  | GET+POST |
| `imageFromPrompt.size` | enum: `LANDSCAPE_16_9`, `LANDSCAPE_4_3`, `PORTRAIT_16_9`, `PORTRAIT_4_3`, `SQUARE_HD` |  | GET+POST |
| `imageUrl` | string |  | GET only |
| `ironing.mode` | const `ai.auto` |  | GET+POST |
| `keepExistingAlphaChannel` | enum: `auto`, `never` | `"never"` | GET+POST |
| `layers` | object, additionalProperties: {text:{backgroundColor,content,font,foregroundColor}} \| {image:{…}} (see 2.9) |  | GET+POST |
| `lighting.mode` | enum: `ai.auto`, `ai.preserve-hue-and-saturation`, `ai.optimize-portrait` |  | GET+POST |
| `margin` | number/string | `0` | GET+POST |
| `marginBottom` | number/string |  | GET+POST |
| `marginLeft` | number/string |  | GET+POST |
| `marginRight` | number/string |  | GET+POST |
| `marginTop` | number/string |  | GET+POST |
| `maxHeight` | number (minimum=3) |  | GET+POST |
| `maxWidth` | number (minimum=3) |  | GET+POST |
| `outline.blurRadius` | number (minimum=0, maximum=0.025) | `0` | GET+POST |
| `outline.color` | string |  | GET+POST |
| `outline.width` | number (minimum=0, maximum=0.1) | `0.03` | GET+POST |
| `outputSize` | string (pattern=^(auto\|\d+x\d+\|originalImage\|croppedSubject)$) | `"auto"` | GET+POST |
| `padding` | number/string | `0` | GET+POST |
| `paddingBottom` | number/string |  | GET+POST |
| `paddingLeft` | number/string |  | GET+POST |
| `paddingRight` | number/string |  | GET+POST |
| `paddingTop` | number/string |  | GET+POST |
| `preserveMetadata` | enum: `never`, `xmp`, `exifSubset`, `exifSubsetWithXmpCompatibility` | `"never"` | GET+POST |
| `referenceBox` | enum: `subjectBox`, `originalImage` | `"subjectBox"` | GET+POST |
| `removeBackground` | boolean | `true` | GET+POST |
| `scaling` | enum: `fit`, `fill` | `"fit"` | GET+POST |
| `segmentation.mode` | enum: `keepSalientObject`, `ignoreSalientObject` |  | GET+POST |
| `segmentation.negativePrompt` | string |  | GET+POST |
| `segmentation.prompt` | string |  | GET+POST |
| `shadow.directionOverride` | number \| enum: `behind`, `behindLeft`, `left`, `frontLeft`, `front`, `frontRight`, `right`, `behindRight` |  | GET+POST |
| `shadow.intensityOverride` | number (minimum=0, maximum=1) |  | GET+POST |
| `shadow.mode` | enum: `ai.soft`, `ai.hard`, `ai.floating`, `ai.preset-soft`, `ai.preset-hard`, `ai.auto-with-overrides` |  | GET+POST |
| `shadow.softnessOverride` | number (minimum=0, maximum=1) |  | GET+POST |
| `shadow.spreadOverride` | number \| enum: `short`, `medium`, `long` |  | GET+POST |
| `shadow.subjectPoseOverride` | number \| enum: `flatlay`, `upright` |  | GET+POST |
| `templateId` | string (format=uuid) |  | GET+POST |
| `textRemoval.mode` | enum: `ai.artificial`, `ai.natural`, `ai.all` |  | GET+POST |
| `uncrop.mode` | const `ai.auto` |  | GET+POST |
| `uncrop.seed` | number |  | GET+POST |
| `upscale.downscaleIfNeeded` | enum: `never`, `always`, `skipUpscaleIfNotNeeded` |  | GET+POST |
| `upscale.mode` | enum: `ai.fast`, `ai.slow` |  | GET+POST |
| `verticalAlignment` | enum: `top`, `center`, `bottom` |  | GET+POST |
| `virtualModel.additionalProductImages` | array[1..4] of object{imageFile, imageUrl} |  | GET+POST |
| `virtualModel.mode` | const `ai.auto` |  | GET+POST |
| `virtualModel.model` | object{preset} required:preset \| object{custom} required:custom | `{"preset": {"name": "avery"}}` | GET+POST |
| `virtualModel.pose` | enum: `random`, `standing`, `34turn`, `powerstance`, `walkingforward`, `handinpocket`, `crossedarms`, `back`, `overtheshoulder`, `seated`, `adjustingclothing`, `playfulspin` | `"random"` | GET+POST |
| `virtualModel.prompt` | string |  | GET+POST |
| `virtualModel.quality` | enum: `standard`, `advanced`, `premium` | `"standard"` | GET+POST |
| `virtualModel.scene` | object{preset} required:preset \| object{custom} required:custom | `{"preset": {"name": "random"}}` | GET+POST |
| `virtualModel.size` | enum: `PORTRAIT_HD_16_9`, `PORTRAIT_HD_4_3`, `PORTRAIT_HD_3_2`, `SQUARE_HD`, `LANDSCAPE_HD_3_2`, `LANDSCAPE_HD_4_3`, `LANDSCAPE_HD_16_9` | `"PORTRAIT_HD_3_2"` | GET+POST |

90 names: 83 shared, 4 GET-only (`imageUrl`, `background.imageUrl`,
`background.guidance.imageUrl`, `editWithAI.additionalImages.{key}.imageUrl`),
3 POST-only (`imageFile`, `background.imageFile`,
`editWithAI.additionalImages.{key}.imageFile`). See C6/C7 for why those two
lists are not to be trusted literally.

### 2.2 Notes per group (what the table cannot say)

Every quote is from the parameter's OpenAPI `description` unless a page is named.

**Input.** `imageFile` (POST, binary, ≤ 30 MB) / `imageUrl` (GET). Neither is
needed when `imageFromPrompt.prompt` generates the image ("Instead of starting
from an existing image … you can choose to generate a new AI image using a
prompt", `…/create-any-image.md`) or when a `templateId` supplies the layout.

**`removeBackground`** — default **`true`**. This is the trap for any
"edit the whole picture" use: every docs example for AI Upscale, AI Relight,
AI Text Removal, AI Expand, Ironing and Virtual Model sends
`removeBackground=false` **and** `referenceBox=originalImage`, because the
default would return a cutout. (verified 2026-11-24) **Edit With AI is the
exception**: all five curl examples on `…/edit-with-ai.md` send
`removeBackground=false`, but only the first also sends
`referenceBox=originalImage`; the Product Staging, Other Angle and both
additional-image examples omit it. Create Any Image likewise sends
`removeBackground=false` alone. So `removeBackground=false` is the constant;
`referenceBox=originalImage` is frequent, not universal. Dependencies stated
against it:
`background.imageUrl` / `background.imageFile` / `background.guidance.*`,
`ignorePaddingAndSnapOnCroppedSides` and `referenceBox` each "Can't be
provided if `removeBackground` is set to `false`" — yet the docs' own examples
send `referenceBox=originalImage` with `removeBackground=false` on nine
feature pages (verified 2026-11-24: eight in curl examples — `ai-expand`,
`ai-relight`, `ai-ironing`, `ai-text-removal`, `edit-with-ai`,
`preview-ai-upscale`, `subject-outline`, `virtual-model` — and `virtual-try-on`
in prose: "please also set the parameters `removeBackground=false` and
`referenceBox=originalImage`"; the pair also recurs in tutorials and the changelog).
**The examples win; do not enforce that sentence for `referenceBox`**
(a validator refusing what the API's own docs send is the forbidden failure).
For the three `background.*` image fields the agent prompt independently lists
"`background.imageUrl` with `removeBackground=false`" as a 400, so that one is
enforceable.

**Background (`background.*`).** Mutual exclusion, stated three times: "If
`background.prompt` is provided, neither `background.imageUrl` nor
`background.imageFile` can be provided, and vice versa." `background.scaling`
"Can only be provided if `background.imageUrl` or `background.imageFile` is
provided". `background.prompt` **may** be combined with
`background.guidance.image*` ("It's possible to provide both a Text prompt and
an Image prompt", `…/ai-backgrounds.md`). `background.expandPrompt` is a union:
the legacy bare strings `auto` / `never` ("legacy values that will be removed
in the next major version") or the object, sent as
`background.expandPrompt.mode` = `ai.auto` | `ai.never`. `background.negativePrompt`
is "(LEGACY) … only … when … `pr-ai-background-model-version: 2`".
`background.seed`: "any positive integer" (`…/ai-backgrounds.md`; the schema
says only `number`). `background.blur.radius` is `exclusiveMinimum: 0`,
`maximum: 0.05` — the POST description's "Minimum: 0" is the loose wording.

**Shadows (`shadow.*`).** See §1.4 for the header coupling. The three
angle-or-preset overrides are `number | enum`; "do not add the `°` character"
(`…/ai-shadows.md`). `intensityOverride` / `softnessOverride` are 0–1. All five
"require setting `shadow.mode` to `ai.auto-with-overrides`".

**Positioning.** `padding*` / `margin*` are `number | string`: "a number
between 0 and 0.49, a percentage string between 0% and 49% (e.g., "30%"), or a
pixel value string (e.g., "100px")" (C4). `maxWidth` / `maxHeight`
(`minimum: 3`) "Can only be provided if `outputSize` is `originalImage` or
`croppedSubject`". `scaling` "Can only be provided if `imageUrl` or
`imageFile` is provided". A custom alignment "will implicitly set
`ignorePaddingAndSnapOnCroppedSides` to `false`" for that axis.

**Export.** `export.format`: `png` | `jpeg` | `jpg` | `webp` | `avif` — `jpg`
and `jpeg` are both in the enum. "Asking the Image Editing API to export in
JPEG while also setting a background color with transparency will result in
an error" (`…/file-size-resolution-and-format.md`) — only detectable for an
8-digit hex, and C3 says the colour syntax is not pinned down, so leave it
server-side. `export.dpi` 72–1200 inclusive. `colorSpace: "original"` is "Only
valid when the request is a background removal with PNG output" and 400s
"naming the conflicting parameter" with any background, shadow, non-PNG
format, `export.dpi`, `keepExistingAlphaChannel: "auto"` or an EXIF-subset
`preserveMetadata` — a documented, enforceable exclusion set.
`preserveMetadata: "exifSubset"` is "**Deprecated** — use
`exifSubsetWithXmpCompatibility`".

**AI edits.** Each is switched on by its `*.mode`:

| Feature | Switch | Other fields | Notes |
| --- | --- | --- | --- |
| Edit With AI | `editWithAI.mode=ai.auto` **and** `editWithAI.prompt` (`minLength: 1`) | `editWithAI.seed`, `editWithAI.additionalImages.{key}.imageFile\|imageUrl` | "up to 5 total images per request, including the main input image" → ≤ 4 additional; each entry "must contain exactly one of `imageFile` … or `imageUrl`". Output 1K (`1024x1024`); "2K and 4K are available for Enterprise plans". |
| Describe Any Change | `describeAnyChange.*` | | "(DEPRECATED) Use `editWithAI.*` instead." Type it, mark it deprecated. |
| AI Upscale *(Preview)* | `upscale.mode` = `ai.fast` \| `ai.slow` | `upscale.downscaleIfNeeded` | 4×, no factor field. Input caps: "`ai.fast`: maximum 1,000,000 input pixels", "`ai.slow`: maximum 262,144 input pixels". "there could be breaking changes with a 2-week notice period". |
| AI Relight | `lighting.mode` | | "limited to images with a maximum resolution of 3,500x3,500 pixels" (`…/ai-relight.md`) |
| AI Text Removal | `textRemoval.mode` | | reports `pr-texts-detected` |
| AI Expand | `expand.mode=ai.auto` | `expand.seed` | fills transparent pixels from the current background; relies on `outputSize` |
| AI Uncrop | `uncrop.mode=ai.auto` | `uncrop.seed` | no-op when no edge is cropped |
| AI Beautifier | `beautify.mode` = `ai.auto` \| `ai.food` \| `ai.car` | `beautify.seed`, `beautify.onSubjectMismatch` | `onSubjectMismatch=error` is 400 for any mode but `ai.food` ("because the check is not supported there") — enforceable |
| Ironing | `ironing.mode=ai.auto` | | header `pr-ironing-model-version: v2` for the new model. (verified 2026-11-24) "AI Ironing handles images up to 2K. Larger inputs will be downscaled to 2K." (`…/ai-ironing.md`) |
| Flat Lay / Ghost Mannequin | `flatLay.mode` / `ghostMannequin.mode` = `ai.auto` | `.prompt`, `.size` (7 `*_HD_*` presets, default `SQUARE_HD`) | |
| Virtual Model / Try-On | `virtualModel.mode=ai.auto` | `.model` (`preset.name`, 17 names, or `custom.imageFile\|imageUrl`), `.scene` (`preset.name`, 23 names, or `custom.…`), `.pose` (12), `.prompt`, `.size`, `.quality`, `.additionalProductImages` (1–4) | `quality`: "`standard` outputs ~1K, `advanced` ~2K, and `premium` ~4K"; the feature page says 2K/4K are "available for Enterprise plans" |
| Create Any Image | `imageFromPrompt.prompt` (`minLength: 1`) | `.seed`, `.size` (5 presets: `LANDSCAPE_16_9`, `LANDSCAPE_4_3`, `PORTRAIT_16_9`, `PORTRAIT_4_3`, `SQUARE_HD`) | these are **not** the `*_HD_*` presets of flat lay / virtual model — two different size enums. (verified 2026-11-24) `…/create-any-image.md` gives `SQUARE_HD` as the `.size` default ("`SQUARE_HD` (default)"); the OpenAPI declares none. Its one example sends `removeBackground=false` and no input image. |
| Text-Guided Segmentation *(Preview)* | `segmentation.prompt` | `.negativePrompt`, `.mode` | comma-separated, "use singular rather than plural" |

Preset enums in full (OpenAPI): `virtualModel.model.preset.name` — `avery`,
`sam`, `taylor`, `kendall`, `jordan`, `casey`, `alex`, `maya`, `reece`, `lena`,
`julia`, `jackson`, `sophia`, `emma`, `ava`, `zoe`, `fiona`.
`virtualModel.scene.preset.name` — `random`, `street`, `bedroom`, `sunset`,
`factory`, `studio`, `coloredstudio`, `concretestudio`, `beach`, `tropical`,
`library`, `forest`, `businessdistrict`, `countryside`, `flowers`,
`goldenlight`, `mountain`, `pool`, `latincity`, `cafe`, `asiancity`,
`nightlights`, `desert`.

**Templating *(Preview)*.** `templateId` (uuid) plus `layers.<id>.text.{content, foregroundColor, backgroundColor, font}`
or `layers.<id>.image.{imageFile, imageUrl, imageFromPrompt.{prompt,seed,size}, removeBackground, useForAIBackground, horizontalAlignment, verticalAlignment, margin*, padding*, segmentation.{prompt,negativePrompt,mode}}`.
Inside a layer `removeBackground` is the **enum** `auto` | `never`, not the
top-level boolean. "maximum of 10 replaceable images".
(verified 2026-11-24) From `…/preview-templating-mode.md`, not in the spec:
layer `removeBackground` and `useForAIBackground` "defaults to `auto`"; layer
`segmentation.mode` is "default `ignoreSalientObject`"; a layer image "can
only specify one of `imageFile` and `imageUrl`"; the template must be shared
by "Public link" or the API cannot read it. The spec's layer schema makes
`imageFromPrompt.prompt` and `segmentation.prompt` `required` inside their
objects, and both layer arms are `additionalProperties: false`.

**Plan gating.** The whole of `/v2/edit` is the Plus plan; a Basic key may
call it and is billed the Plus rate (§3). Enterprise-only, by the docs: 2K/4K
outputs for Edit With AI, Beautifier, Uncrop, Flat Lay, Ghost Mannequin,
Virtual Model; the "advanced" upscale model; Perspective Correction (but see
C11 — the pricing page lists it under Plus). None of
these has a documented parameter except `virtualModel.quality`.

### 2.3 `/v1/segment`

`multipart/form-data`; names are **snake_case** (the endpoint is
remove.bg-compatible by design: "the name of the arguments and the format of
the result both stay the same", `…/remove.bg-compatibility.md`). OpenAPI
`remove-background-post-params`:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `image_file` | binary — **required** | | PNG/JPEG/WEBP/HEIC, ≤ 50 MB, ≤ 6,000 px widest side. EXIF rotation is not applied — rotate before sending. |
| `format` | `png` \| `jpg` \| `webp` | `png` | note `jpg`, **not** `jpeg` (the opposite spelling from `ImageOutputFormat`) |
| `channels` | `rgba` \| `alpha` | `rgba` | `alpha` returns the grayscale mask, without matting |
| `bg_color` | string | | "a hex code (`#FF00FF`) or a HTML color (`red`, `green`, etc.)" — C3 |
| `size` | `preview` \| `medium` \| `hd` \| `full` | `full` | 0.25 MP / 1.5 MP / 4 MP / 36 MP |
| `crop` | **string** `"true"` \| `"false"` | `"false"` | typed as a string enum in the spec, not a boolean |
| `despill` | **string** `"true"` \| `"false"` | `"false"` | green-screen only; "currently in beta" |

Plus the JSON alternative `{"image_file_b64": string}` (§1.3) — outside the
spec. No URL input: "The Remove Background API requires you to upload the
content of your image file".

(verified 2026-11-24) The migration tutorial
(`tutorials/how-to-migrate-from-remove.bg-api-before-it-shuts-down.md`) is the
one page that states the boundary of the remove.bg compatibility, and it is
what a validator's "what the provider DOES offer" messages should quote:
"The Remove Background API accepts these arguments of Remove.bg: `image_file`,
`format`, `channels`, `bg_color`, `size` and `crop`." (`despill` is
Photoroom's own seventh field.) Named as **not** carried over: `image_url`,
`bg_image_url`, `bg_image_file`, `roi`, `scale`, `position`, `crop_margin`,
`add_shadow`, `shadow_type`, `shadow_opacity`, `type`, `type_level`,
`semitransparency`; and the values `format=zip`, `format=auto` ("Use `png`,
`jpg` or `webp`"), `size=auto`, `size=50MP` ("Use `preview`, `medium`, `hd` or
`full`"). That confirms both enums as closed.

## 3. Pricing

Read 2026-11-24. Flat per successful call; no per-feature surcharge.

| What | Rate | Exact quote | Source |
| --- | --- | --- | --- |
| `POST /v1/segment` | **$0.02** per call | "The Remove Background API is part of our "Basic plan" and each API call is priced at $0.02" | https://docs.photoroom.com/remove-background-api-basic-plan/pricing.md |
| `/v2/edit` (GET or POST) | **$0.10** per call | "The Image Editing API is part of our "Plus plan" and each API call is priced at $0.10. This means that an API call can include as many edit options as needed, **with no impact on the price**." | https://docs.photoroom.com/image-editing-api-plus-plan/pricing.md |
| Rate follows the endpoint, not the plan | | "If you're on the Basic API plan … and make a Plus call (which is the Image Editing API), you'll be charged the Plus price per image of $0.10. If you're on the Plus API plan and call the Remove Background API, you'll be charged the Basic price per image of $0.02." | https://www.photoroom.com/api/pricing (FAQ) |
| Same thing in quota units | | "1 call to the Image Editing API is worth 5 calls to the Remove Background API … on the Basic plan, a call to the Image Editing API will consume 5 images … on the Plus plan, a call to the Remove Background API will consume 0.2 image" | https://docs.photoroom.com/getting-started/pricing.md |
| Errors | free | "Calls that result in an error will **not** consume an image." | same |
| Repeats | billed | "Calling the API twice with the same input image and the same edit options will be billed as 2 separate calls." | image-editing pricing page |
| Sandbox | free, watermarked | "up to 1,000 free calls by month … (the max per day is 100 calls)" | `…/sandbox-mode.md` |

The pricing page's structured data agrees: `Photoroom API — Basic` `price: "0.02"`,
`Photoroom API — Plus` `price: "0.10"`, `priceCurrency: "USD"`,
`referenceQuantity: 1 image`. Its FAQ example confirms the Basic arithmetic at
two volumes: "a $20 Basic API plan (1000 images) … the $40 Basic API plan
(2000 images)".

Caveats that must reach the catalog header:

- **Prepaid monthly subscription, not metered.** Images are bought in fixed
  blocks ("You can purchase a fixed amount (for example, 1000, 2000, etc.)"),
  "Unused images will not roll over month-to-month". `$0.02` / `$0.10` is the
  unit price of a block, which is what a pre-send estimate should say.
- **Volume tiers above the two the FAQ quotes are not readable.** The page's
  "How many images do you process per month?" selector renders client-side;
  the served HTML carries only the `{price} per image` template.
  (verified 2026-11-24) There **is** evidence against a self-serve discount:
  the pricing page's feature matrix (JSON-LD `additionalProperty`, fetched
  2026-11-24 from https://www.photoroom.com/api/pricing) lists "Scalable
  Pricing with Volume-Based Discounts" as `false` for `Photoroom API — Basic`
  and `Photoroom API — Plus` and `true` only for `Photoroom API — Enterprise`.
  Still not a per-tier price table, so Q8 stays open, but the flat-rate
  reading is the documented one. Enterprise ("from 200K images/year") is
  custom.
- (verified 2026-11-24) **Enterprise can be billed in money, not images.**
  Three sources: the OpenAPI `payment-error` description ("It depends on how
  the team is billed: API credits … Usage-based: `Your wallet balance is too
  low for this request…`"), the `/v2/account` "Usage-based Enterprise plan"
  response (`balance.amount` in "the contract currency", `plan:
  "enterprise_usage_based"`), and the pricing FAQ ("On Photoroom's new
  Enterprise pricing, you get a committed wallet in EUR, USD or GBP that you
  can spend across both apps and APIs."). No per-call usage-based rate is
  published anywhere. The `$0.02` / `$0.10` rows are therefore the
  **self-serve Basic/Plus** rates and the catalog header must say so; an
  Enterprise caller's real cost is unknowable from public sources.
- **`virtualModel.quality` ≠ `standard`** is described as Enterprise-only
  resolution on the feature page and has no published price. If the estimate
  is `$0.10` for every `/v2/edit` call, that one field is where it could be a
  guess (Q7).
- Free trial: "10 free production calls on the Remove Background API".
  (verified 2026-11-24) The same page words it a second way in its pricing
  cards — "you can edit 10 Basic API plan images per month (or the Plus
  equivalent)" — i.e. one-off vs monthly, RB-only vs either API. Not a
  catalog fact; do not state either.

Proposed catalog rows (hand catalog, `limit.context: 0`, synthetic ids because
neither wire has a model field): the `/v1/segment` row `cost.perImage: 0.02`,
every `/v2/edit` row `cost.perImage: 0.10`.

## 4. Fit with the repo

### 4.1 Precedent for binary/multipart validators

- `RequestMeta.body: "form"` + `ValidatedForm` + a provider-level
  `toFormData(validated)` helper; `.request.headers` deliberately `{}` so
  `fetch` derives the boundary; `toRequestInit` refuses form results
  (`src/core/request.ts`, `src/core/request-init.ts`). Users: `stability`
  (`image`, all six edit routes), `topaz` (`upscale`, `upscaleGenerative`),
  `openai.imageEdit`, `recraft.imageEdit*` (dual multipart/JSON), `lmnt`,
  `cartesia`, `fish-audio`, `speechmatics`.
- The closest sibling is `src/providers/stability/image-edit.ts`: file fields
  typed `Blob` and schema'd `z.instanceof(Blob)`; one validator per route; a
  synthetic catalog id pinned with `modelId: () => "stable-image-remove-background"`;
  "No response checker: … these endpoints respond with raw bytes, not JSON"
  (`stability/index.ts`). `stability.imageEditRemoveBackground` is the direct
  precedent — and the only existing address — for background removal.
- Query-string params on a POST: `deepgram.stt` and `elevenlabs.tts` encode
  them into `.request.url` in `finalize`.
- A param that is really a **request header**: `smallest-ai.tts`'s
  `x_expire_content` is typed on the params, "stripped from the wire body onto
  `.request.headers["x-expire-content"]`" (`src/providers/smallest-ai/tts.ts`).
  That is the precedent for the five `pr-*` headers.
- Dotted wire names need nothing special: the params ARE the wire, so the
  interface keys are the quoted dotted strings (`"background.prompt"?: string`)
  and `toFormData` appends each enumerable key verbatim. The three
  caller-keyed families (`editWithAI.additionalImages.<key>.…`,
  `layers.<id>.…`, `virtualModel.additionalProductImages…`) and the nested
  `virtualModel.model|scene.…` paths are template-literal keys
  (`` `editWithAI.additionalImages.${string}.imageFile` ``) — which fits the
  existing loose-schema convention ("unknown keys pass through with a
  warning") but needs a deliberate choice, see Q5.
- Core gap: `RequestMeta.method` is the literal `"POST"`; only `SocketMeta`
  has `"GET"`, and it means "WebSocket upgrade". **`GET /v2/edit` cannot be
  expressed today** (§4.5).

### 4.2 `unmodel/image-edit` — yes, one adapter

`ImageEditParams` is `operation: "edit"`, a `prompt`, one `image`, no mask.
Edit With AI is exactly that.

| Canonical | Photoroom wire | Verdict |
| --- | --- | --- |
| `prompt` | `editWithAI.prompt` (+ `editWithAI.mode: "ai.auto"`) | compile |
| `image: { file }` | `imageFile` | compile — `imageInputs: ["file"]` on POST |
| `image: { url }` | `imageUrl` | only via `GET /v2/edit` (§4.5); otherwise a typed refusal naming `{ file }` |
| `image: { data }` | — | refuse; no base64 field on `/v2/edit` |
| `seed` | `editWithAI.seed` | compile |
| `outputFormat` | `export.format` (`png`/`jpeg`/`webp` all present) | compile |
| `n` | — | refuse > 1: "One image per call" |
| `strength` | — | refuse: no such dial |
| `size` / `aspectRatio` / `dimensions` | — | refuse. `outputSize` is a **canvas** the edited subject is positioned in, not the generation size (Edit With AI renders at `1024x1024`); mapping `dimensions` onto it would compile a different operation |
| — | `removeBackground: false` (+ maybe `referenceBox: "originalImage"`) | (verified 2026-11-24) **The adapter must emit `removeBackground: false`** — the default (`true`) returns a cutout of the edit, and all five Edit With AI examples send it. `referenceBox: "originalImage"` is in **only the first** of the five; four omit it, and the OpenAPI says `referenceBox` "Can't be provided if `removeBackground` is set to `false`". The earlier claim that every example sends the pair was wrong. Recommended: emit `removeBackground: false` alone — it is the form the docs send most and the only one that agrees with the spec — and settle the difference with one sandbox call (Q11). |
| per-model extras | `editWithAI.additionalImages.*`, the `pr-*` headers | `providerOptions.photoroom` / extras |

Synthetic model id: `photoroom/edit-with-ai`. Everything else `/v2/edit` does
(relight, shadows, AI backgrounds, text removal, expand, uncrop, beautify,
ironing, flat lay, ghost mannequin, virtual model/try-on, templating) is
either geometry-, second-image- or preset-driven with **no prompt-plus-image
shape** — the same reason Stability's six routes and BFL's tools stay
wire-only (`src/unified/image-edit.ts`, "Masked operations are wire-only in v1").
They stay reachable at `unmodel/photoroom`.

### 4.3 `unmodel/upscale` — expressible, but blocked on input shape

`upscale.mode` is a real 4× super-resolution: `factors: [4]` (the `aura-sr`
row shape), no `prompt` (refuse by name), two ids — one per mode. Two problems:

1. `UpscaleSource` is `UrlRef | DataRef` — it "cannot express a `Blob`"
   (`src/providers/topaz/unified.ts`, which refuses inline bytes for this
   exact reason). Photoroom's POST takes **only** a Blob and its GET takes
   only a URL, so a Photoroom upscale adapter can compile `{ url }` **only if
   `GET /v2/edit` is addressable** (§4.5). Without it there is no legal source
   shape at all.
2. It is a **Preview** feature with "breaking changes with a 2-week notice
   period", and `ai.slow` caps input at 262,144 px (512×512).

Recommendation: do not register a Photoroom adapter in the `upscale` pack in
v1. The route stays wire-reachable (`upscale.mode` on `photoroom.imageEdit`).
Revisit when the GET decision lands and the feature leaves Preview.

### 4.4 Other packs, and what is refused outright

- `unmodel/image` (text-to-image): Create Any Image is `imageFromPrompt.prompt`
  + `.seed` + `.size` (5 presets) on POST `/v2/edit` with no image, plus the
  mandatory `removeBackground: false`. It would compile cleanly
  (`aspectRatio` → the five presets, everything else refused). It is a
  side-door on an editing endpoint with no published resolution or model
  name; **defer** — nothing about the wire work blocks adding it later.
- **Background removal has no unified pack and v1 should not invent one.**
  The witnesses now exist — `stability.imageEditRemoveBackground`,
  `photoroom` (`/v1/segment` and `/v2/edit`), Bria's unmodelled
  `/v2/image/edit/remove_background`, Reve's `ReveRemoveBackgroundOperation`
  — so §8's two-witness bar is cleared for a future
  `operation: "removeBackground"` arm of `ImageEditParams` (the discriminant
  exists "so they can join later"). That is a vocabulary decision for the
  owner (Q1), not part of adding a provider.
- One-provider concepts with **no second witness** — stay wire-only, never
  canonical: `shadow.*`, `lighting.mode`, `textRemoval.mode`, `beautify.*`,
  `ironing.mode`, `flatLay.*`, `ghostMannequin.*`, `outline.*`,
  `background.blur.*`, `segmentation.*`, `templateId`/`layers`, all
  positioning (`padding`, `margin`, `scaling`, `referenceBox`, alignments),
  `export.dpi`, `preserveMetadata`, `colorSpace`, `keepExistingAlphaChannel`,
  and on `/v1/segment` `channels`, `despill`, `crop`, `size`.
  `virtualModel.*` has a cousin in `black-forest-labs.imageEditVto`, but the
  image-edit pack already rules try-on out ("need a second image … this
  vocabulary has no word for").
- Not in the library at all: `/v2/account`, `/v1/account` (balance reads),
  `/v2/visual-qa`, `/v3/visual-qa` (Enterprise-gated JSON analysis),
  `/v1/render` (legacy), the Video / Visual Agent APIs and Perspective
  Correction (no documented endpoint or parameter).

### 4.5 The one core decision: `GET /v2/edit`

`imageUrl` is reachable **only** on the GET operation, and `RequestMeta.method`
is pinned to `"POST"` so that "endpoints that speak HTTP keep proving
`.request.method === "POST"` at the type level" (`src/core/request.ts`).
Options:

- **A — POST only in v1.** No core change. Cost: no URL input anywhere, so
  `image: { url }` is a typed refusal and the upscale pack is unreachable.
  The docs themselves call GET "the simplest integration", so this drops the
  route most callers with hosted images would use.
- **B — a second address over a widened core.** e.g. `photoroom.imageEditFromUrl`
  (the naming law's "what it is made from" qualifier), whose `finalize`
  URL-encodes every param into `.request.url` (the `deepgram.stt` pattern)
  with `method: "GET"` and no body. Needs a sibling of `RequestMeta` for a
  body-less HTTP GET (a third meta type next to `SocketMeta`, so the POST
  proof survives) and a `toRequestInit` branch. This is the long-term-correct
  shape and the only one that makes the URL inputs real.
- **C — encode GET as `.request.url` under the existing POST meta.** Wrong:
  it would send a POST to a URL the spec says "must not" carry parameters.

B is recommended, but it is a `src/core` change with type-level consequences
and belongs to the owner (Q2). The research supports shipping A first and B
as a follow-up without rework: the two addresses share one params table minus
the binary fields.

## 5. Recommended v1 scope

**Addresses** (CLI ids `photoroom.<name>`; `src/cli-registry.test.ts` gets
both):

| Address | Wire | Catalog id (synthetic) | Rate |
| --- | --- | --- | --- |
| `photoroom.imageEdit` | `POST https://image-api.photoroom.com/v2/edit`, multipart | `image-editing` (the route) — plus the view ids below | $0.10 |
| `photoroom.imageEditRemoveBackground` | `POST https://sdk.photoroom.com/v1/segment`, multipart | `remove-background` | $0.02 |

Naming follows `stability.imageEditRemoveBackground` exactly, and
`imageEdit` is the bare verb because `/v2/edit` is the provider's primary
route in the category. Wire-shaped names keep Photoroom's spelling:
`EDIT_URL` / `SEGMENT_URL`, `EditParams` (or `ImageEditingParams`),
`SegmentParams`.

**`photoroom.imageEdit` — the wide, wire-truthful surface** (decisions §4: it
never gets narrower):

- All 86 POST form fields under their exact dotted names, with the GET-schema
  enums, ranges and defaults in JSDoc; `imageFile` and the other binaries as
  `Blob`; deprecated `describeAnyChange.*`, `background.negativePrompt`,
  `preserveMetadata: "exifSubset"` typed and marked.
- The five `pr-*` request headers as typed params lifted onto
  `.request.headers` (`smallest-ai` precedent), with values open
  (`"2026-04-15" | (string & {})`) because Photoroom publishes examples, not
  enums.
- Loose schema, unknown keys → warning. Here that warning is the product:
  the server answers 200 and a `pr-unsupported-attributes` header.
- Cross-field checks that are documented and safe (each cites its source):
  1. `background.prompt` ⊕ `background.imageFile` (and `background.imageUrl`
     where typed);
  2. `background.scaling` requires a background image;
  3. `background.imageFile` / `background.guidance.imageFile` with
     `removeBackground: false`;
  4. `maxWidth` / `maxHeight` only with `outputSize` ∈ {`originalImage`,
     `croppedSubject`} — **and** unset (`auto` behaves as `originalImage`
     without a template);
  5. `shadow.*Override` require `shadow.mode: "ai.auto-with-overrides"`;
  6. shadow mode ↔ `pr-ai-shadows-model-version` (new modes need the header;
     `ai.soft` / `ai.hard` / `ai.floating` are refused with it);
  7. `editWithAI.mode` ⇔ `editWithAI.prompt`; ≤ 4 additional images, each
     exactly one of `imageFile` / `imageUrl`;
  8. `colorSpace: "original"` exclusion set;
  9. `beautify.onSubjectMismatch: "error"` only with `beautify.mode: "ai.food"`;
  10. an input must exist: `imageFile` or `imageFromPrompt.prompt` or
      `templateId`;
  11. `imageFile` ≤ 30 MB (the one input limit checkable from a `Blob`).
- Deliberately **not** checked: colour syntax (C3), `padding`/`margin`
  numeric bounds (C4), JPEG-with-transparency, pixel limits (upscale,
  relight), `referenceBox` with `removeBackground: false` (the docs' own
  examples send it).
- Preview features (`upscale.*`, `segmentation.*`, `templateId`/`layers`)
  typed, each with its "2-week notice" quote.

**`photoroom.imageEditRemoveBackground`** — the seven `/v1/segment` fields,
`image_file` required and ≤ 50 MB, `crop` / `despill` as the spec's string
enums. Multipart only in v1 (the `image_file_b64` JSON body is outside the
OpenAPI).

**Unified.** One adapter leaf, `unified-image-edit.ts`, registering
`photoroom/edit-with-ai` in `unmodel/image-edit` with `imageInputs: ["file"]`
and the forced `removeBackground: false` from §4.2 (`referenceBox` pending
Q11 — verified 2026-11-24). Nothing in `upscale` or `image` in v1.

**Catalog and docs.** Hand catalog `src/providers/photoroom/models.ts` per
`HAND_CATALOGS.md` (header with the four refresh URLs and the §3 quotes;
`provider.env: ["PHOTOROOM_API_KEY"]` — the variable name the docs use);
`docs/providers.md` tier **native**, with the exclusions of §4.4 by name;
snapshot the OpenAPI at `data/photoroom/openapi.json` (the `revana`
precedent) so the next refresh is a diff; a changeset.

**No response checker** — success is raw bytes on both routes (the Stability
precedent). The response *headers* of §1.5 and the two error shapes (one per
host — verified 2026-11-24, there is no separate 402 shape) are
facts the package knows and should say at the surface: exported constants for
the header names and a documented error union are cheap; a header reader is
optional scope.

**Follow-ups, not v1:** `GET /v2/edit` (Q2) → then `{ url }` inputs and an
`upscale` adapter; `unmodel/image` for Create Any Image; narrowed views in
the `revana.upscale` style (`photoroom.upscale` over the same URL) if a pack
needs a uniform-named file to reach.

## Open questions

- **Q1 (owner — vocabulary).** Background removal now has four witnesses (two of them unmodelled routes) and
  no unified word. Add `operation: "removeBackground"` to `ImageEditParams` in
  a later wave, a separate pack, or leave it wire-only?
- **Q2 (owner — core).** Widen the request-meta family for a body-less HTTP
  `GET` so `GET /v2/edit` (the only route that takes `imageUrl`) is
  addressable — option B in §4.5 — or ship POST-only? If B: is the address
  `photoroom.imageEditFromUrl`?
- **Q3 (needs a `sandbox_` key).** Does POST `/v2/edit` accept
  `background.imageUrl` and `background.guidance.imageUrl` as form fields?
  The spec omits them from POST; the docs show sibling nested `*.imageUrl`
  fields working on POST (C6). Until probed, type them on POST? Recommended
  default: **yes, typed** — omitting them risks refusing a request the API
  fulfils, typing them risks at worst a `pr-unsupported-attributes` no-op —
  with the uncertainty stated in JSDoc. And does POST really reject top-level
  `imageUrl`, or just not document it? (verified 2026-11-24) Two more docs
  hints for "typed": `…/static-background.md` restricts only the file variant
  ("`background.imageFile` (available only when using the `POST` endpoint) or
  `background.imageUrl`"), and `…/virtual-model.md` does the same for every
  nested pair ("The parameter `virtualModel.model.custom.imageFile` is only
  available when using the POST endpoint" — no such note on `.imageUrl`).
  No docs example anywhere sends top-level `imageUrl` on a POST.
- **Q4 (needs a key).** The index syntax for
  `virtualModel.additionalProductImages` in multipart — `[0].imageFile`,
  `.0.imageFile`, or literal `[].imageFile`? Docs write `[]` and give no
  example; only `editWithAI.additionalImages` has the syntax spelled out.
- **Q5 (design).** How to type the open-keyed dotted families
  (`editWithAI.additionalImages.<key>.…`, `layers.<id>.…`, nested
  `virtualModel.…`): template-literal index signatures on the flat wire type
  (exact, but weak on `ExactKeys` and autocomplete), or accept them as
  unknown-key passthroughs in v1? Templating is Preview and needs a template
  built in Photoroom's editor, so `layers.*` is the natural one to leave loose.
- **Q6 (needs a key).** `/v1/segment`: is the JSON `{"base64img"}` response
  selected by `Accept: application/json`, by the JSON request body, or both?
  May `format`/`size`/`crop`/… accompany `image_file_b64` in the JSON body?
  This decides whether a JSON-body variant is ever worth an address.
- **Q7 (pricing).** Is `virtualModel.quality: "advanced" | "premium"` (and
  the Enterprise 2K/4K outputs generally) billed at the flat $0.10? No source
  says. Proposal under "unverifiable → caveat": estimate `undefined` when
  `virtualModel.quality` is set to anything but `standard`.
- **Q8 (pricing).** Self-serve volume tiers beyond 1,000 / 2,000 images are
  rendered client-side on the pricing page and were not readable. The docs
  state the unit rates flatly; confirm from a logged-in dashboard that Plus
  blocks are $0.10/image at every size before the catalog header claims it.
  (verified 2026-11-24) The page's own feature matrix marks volume-based
  discounts Enterprise-only (§3), which supports the flat reading; and
  usage-based Enterprise wallets have no published rate at all, so the
  catalog rows are self-serve rates by construction.
- **Q9 (roster).** `GET /v2/account` is the only way to read usage and there
  is no usage header. Out of scope by default (no other provider ships a
  balance address) — confirm.
- **Q10 (drift).** `pr-unsupported-attributes` is "[Temporary] … Soon to be
  replaced by a 400 Bad Request response." When that lands, an unknown key
  stops being a silent no-op and becomes a hard failure; unmodel's
  warning-not-error stance for unknown keys stays correct either way, but the
  module header should carry the quote and the date.
- **Q11 (needs a `sandbox_` key — verified 2026-11-24).** Edit With AI with
  `removeBackground=false`: does adding `referenceBox=originalImage` change
  the output, get ignored, or surface in `pr-unsupported-attributes`? One of
  five docs examples sends it, the spec says it "Can't be provided". Decides
  whether the unified adapter emits one forced field or two (§4.2).

## Verification log

Adversarial re-verification, 2026-11-24. Every primary source was re-fetched
independently; nothing below was taken from the first pass.

**Sources re-fetched**

- `https://image-api.photoroom.com/openapi` — 116,884 bytes, sha256
  `c2eee99c…45de6a`, identical to the recorded hash. Parsed mechanically: 7
  paths / 9 operations, `securitySchemes`, every `/v2/edit` GET parameter
  schema and POST property, all component schemas, all response blocks.
- `https://docs.photoroom.com/llms.txt` and 70 pages as `.md` — all of
  getting-started, tutorials, image-editing-api-plus-plan,
  remove-background-api-basic-plan and the three Enterprise overviews
  (integrations/ and resources/ benchmark pages were not read).
- `https://www.photoroom.com/api/pricing` — served HTML, its JSON-LD
  (`ItemList` of plans, `FAQPage`).
- npm registry search `photoroom`, PyPI `photoroom`, the `Photoroom` GitHub
  org repo list, `PhotoRoomKit-Swift` README, `api-code-samples` sources.
- Keyless / made-up-key probes of `image-api.photoroom.com` and
  `sdk.photoroom.com` (no credential used, nothing billed).

**Checked and confirmed unchanged**

- §2.1 table, by script against the spec: all 90 names present, none extra;
  every enum/const value, default, `minimum`/`maximum`/`exclusiveMinimum`/
  `minLength`/`format`/`pattern` and every "Listed under" cell match. 87 GET
  query parameters, 86 POST properties, 4 GET-only, 3 POST-only; no parameter
  is `required`; POST properties carry only `type`/`format`/`description`.
- Preset lists: 17 model names, 23 scene names, 12 poses, 7 `*_HD_*` sizes,
  5 `imageFromPrompt.size` values; layer schema fields.
- `/v1/segment`: 7 fields, `image_file` the only `required`, `format`
  `png|jpg|webp`, `crop`/`despill` string enums, two 200 content types.
- Hosts, paths, per-operation `servers`, `x-api-key` scheme, response headers
  per operation (`pr-edit-further-url` on GET only).
- All five `pr-*` request headers and their values, against each feature page
  and the agent prompt; none is in the OpenAPI.
- Probes reproduced verbatim: both 401 texts, the JSON-body 400 on
  `POST /v2/edit`, `GET /v1/segment` 405 (`allow: OPTIONS, POST`), the
  `missing_image` / `invalid_image` 400s, body-before-key ordering on
  `/v1/segment`, `access-control-expose-headers: pr-debug,x-uncertainty-score`.
- Rendered reference page: 4 operations only (`/v1/segment`, `/v2/account`,
  `/v2/edit` ×2), `security: [{}]`, no `securitySchemes`, no
  `x-uncertainty-score`.
- Every price quote in §3, word for word, and the JSON-LD `0.02` / `0.10`.
- C1, C2, C4, C6, C7, C8, C9, C10; limits (30 MB / 5,000 px; 50 MB / 6,000 px);
  60 images per minute / 429; sandbox 1,000 per month, 100 per day.

**Changed**

1. §1.5 + §5 — the `image-api` 402 body is `{"error":{"message"}}`, not
   `{"error":{"detail"}}`. There are two error shapes, not three. Added the
   two documented 402 message texts.
2. §1.2 — the key-as-parameter name is not "documented nowhere": it is the
   query parameter `apiKey` (declared on `GET /v1/render`, echoed in the
   account 400 example, confirmed by probe). Still not to be typed.
3. C3 — `outline.color`'s examples are hash-less; only `background.color`
   carries the contradicting `#FF0000` example.
4. §2.2, §4.2, §5 — "every Edit With AI example sends `removeBackground=false`
   and `referenceBox=originalImage`" was false: 5 of 5 send the first, 1 of 5
   the second. The adapter recommendation changed from two forced fields to
   one, with Q11 added. The "nine feature pages" count was confirmed and
   itemised.
5. §3 — "no evidence of a self-serve discount, none of its absence" was
   wrong: the pricing matrix marks volume discounts Enterprise-only.
6. §3 + §1.5 — omission: usage-based Enterprise billing (wallet in
   EUR/USD/GBP, `/v2/account` `balance` arm, second 402 text). The catalog
   rates are self-serve rates.
7. C5 — recorded which statuses the spec actually declares per operation.
8. New contradictions C11 (Perspective Correction plan), C12 (`/v2/edit`
   input formats), C13 (upscale cap: pixel count vs per-side).
9. SDK section — a deprecated official Swift SDK and an official samples repo
   exist; neither changes the "OpenAPI is the tie-breaker" conclusion.
10. §1.3 — two further docs sources for `image_file_b64`.
11. §2.3 — omission: the migration tutorial's explicit list of accepted and
    rejected remove.bg arguments and values.
12. §1.4 / §2.2 — omissions: the Ironing page treats the `v2` header as part
    of the recipe; Ironing's 2K input cap; templating layer defaults and the
    public-template requirement; the 25 MP recommendation; the second
    free-trial wording.

**Searched for and not found**

- No request field, header or endpoint in any docs example that is absent
  from both the OpenAPI and this document (script over every `--form`, `-F`,
  query-string and `append(` name in the 70 pages).
- No endpoint for the Video API, Visual Agent API or Perspective Correction.
- No job/polling/webhook surface, no status enum: both in-scope routes are
  synchronous and answer with image bytes.
- No maintained official SDK on npm, PyPI or GitHub.

**Still unverified** (unchanged; all need a `sandbox_` key): Q3, Q4, Q6, Q11,
and the 402/403 bodies, which were not observed.
