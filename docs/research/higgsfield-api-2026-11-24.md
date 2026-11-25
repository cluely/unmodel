# Higgsfield — wire research

Researched 2026-11-24 for a native `unmodel/higgsfield` provider. Research only:
nothing here was sent to the API (no credentials), so every statement is a
*published-contract* fact, not a live-verified one. Section 8 lists what a
keyed probe still has to settle.

## 0. Sources, and which one wins

Higgsfield publishes the same model through up to four surfaces that do **not**
agree. All were fetched 2026-11-24.

| # | Source | URL | What it is |
| --- | --- | --- | --- |
| D | Docs site (Mintlify) | https://docs.higgsfield.ai/docs/llms.txt (index), `…/docs/<page>.md` | Shared lifecycle pages + one page per model workflow with a "Complete JSON schema" |
| O | Shared OpenAPI | https://docs.higgsfield.ai/docs/openapi.json (`openapi 3.1.0`, `info.version 2.0.0`) | 6 model routes + status/cancel/delete |
| C | Console per-model doc | `https://dash.higgsfield.ai/models/<endpoint-id>/llms.txt` (linked from every `open.higgsfield.ai/models/<id>/api-reference` page) | "Input JSON Schema", output schema, pricing sentence |
| C2 | Console per-model OpenAPI | `https://dash.higgsfield.ai/api/v2/app-models/<id>/openapi/` | Exists only for `soul-id` and `higgsfield-ai/soul/standard` (404 for the others probed) |
| P | Console pages | https://open.higgsfield.ai/quick-start, `/explore`, `/pricing`, `/models/<id>/api-reference` | Catalog cards, price cards, embedded model metadata |
| S-js | JS SDK | npm `@higgsfield/client@0.2.6` (published 2026-09-17 per `npm view … time`; 2026-10-06 is the registry's `time.modified`), https://github.com/higgsfield-ai/higgsfield-js | Transport + three legacy input types + an Agent API client (`dist/agents/`, see §1.6) (verified 2026-11-24) |
| S-py | Python SDK | PyPI `higgsfield-client==0.2.0` (uploaded 2026-09-17), https://github.com/higgsfield-ai/higgsfield-client | Transport only, no model types; also ships the Agent API client (`agents/resources.py`) (verified 2026-11-24) |

`open.higgsfield.ai`, `console.higgsfield.ai` and `dash.higgsfield.ai` are one
product under three hostnames (the quick-start says: "Use `open.higgsfield.ai`
for the platform website and `https://api.higgsfield.ai` for REST requests, even
if a documentation page still links to an older website domain").
`open.higgsfield.ai/openapi.json` and `/llms.txt` are 404.

**Precedence used in this document**

1. **D (the model's own docs page) wins for the field set and constraints.**
   Higgsfield says so itself: "Use the selected model's documentation for its
   endpoint, request schema, supported parameters, and examples" and "Treat
   `/docs/openapi.json` as supplementary reference, not the authoritative model
   catalog" (https://docs.higgsfield.ai/docs/llms.txt). D's Soul schemas carry
   server-model titles (`SoulParamsSchema`, `SoulV2ParamsSchema`,
   `CreateCustomReferenceSchema`) and runtime usage notes; C's Soul schemas are
   titled "Soul Playground" / "Soul V2 Playground" and are the playground form.
2. **C wins where D has no page** (Soul 2 image-to-image, Genjutsu Light, AI
   Influencer) and for pricing sentences.
3. **O loses whenever it disagrees** — its `/higgsfield-ai/soul/standard` body
   is a different model's schema (see §5).
4. **SDKs settle transport only.** Neither SDK types any current model input.

The SDKs do not resolve body ambiguities here, which is unusual for this repo's
research rule: S-js's `EndpointInputMap` types only three *legacy* routes
(`/v1/image2video/dop`, `/v1/speak/higgsfield`, `/v1/text2image/soul`), none of
which appears in D, O, C or P today. S-py types no inputs at all (`arguments`
is a free dict).

---

## 1. Transport

### 1.1 Base URL

`https://api.higgsfield.ai` — D `how-to/introduction.md` ("**Base URL:**
`https://api.higgsfield.ai`"), O `servers[0].url`, S-js `Config.baseURL`, S-py
`BASE_URL`. No version prefix on model routes; the model path *is* the route.

### 1.2 Auth

```
Authorization: Key <KEY_ID>:<KEY_SECRET>
```

- D `authentication.md`: "Each credential consists of a key ID and a secret" and
  "`Authorization: Key YOUR_KEY_ID:YOUR_KEY_SECRET`".
- O `components.securitySchemes.authKey`: `apiKey` in header `Authorization`,
  "Use `Key {api_key_id}:{api_key_secret}`."
- S-js v2 builds ``Authorization: `Key ${apiKey}:${apiSecret}` ``; S-py builds
  `Authorization: Key {HF_KEY}` where `HF_KEY` is `id:secret`.
- **Legacy alternative, still accepted:** headers `hf-api-key` (key id) and
  `hf-secret` (secret). D: "The API also accepts the legacy `hf-api-key` and
  `hf-secret` headers. New integrations should use the `Authorization` header."
  S-js v1 client sends exactly these. C2's Soul ID and Soul-styles operations
  declare `hf-api-key` (required, `format: uuid`) and `hf-secret` (optional) as
  header parameters while the same file's `securitySchemes` says `Authorization`.
- **Apparent contradiction, not a real one:** P quick-start says
  "`Authorization: Key <api-key>` … the complete copied credential" and "do not
  … require a colon in the UI". The copied credential is the `id:secret` pair;
  it is a UI instruction, not a second scheme.

Other request headers (D `api-reference/headers.md`):

| Header | Applies to | Rule |
| --- | --- | --- |
| `Content-Type: application/json` | requests with a body | |
| `Idempotency-Key` | generation submissions | 1–255 visible ASCII chars, no whitespace; replay returns the original `request_id`; reuse with different params → `422` |
| `Hf-Expires-After` | generation submissions | seconds, `3600` … account retention; can only shorten; out of range → `422` |

Idempotency fingerprint (verified 2026-11-24): "Reuse the key only when the endpoint, JSON body,
webhook, and `Hf-Expires-After` header are unchanged" and "JSON object field
order does not matter. Array order, omitted fields, explicit `null` values, and
different URLs do matter" (D `concepts/idempotency.md`). An omitted field and an
explicit default are therefore *different requests* to Higgsfield — one more
reason the wire layer must never inject defaults or strip nulls.

Response headers: `X-Correlation-ID` (every response), `Retry-After` (on `429`),
`Cache-Control: no-store` (on `403` for a disabled/expired key).

unmodel never sees a credential, so the deliverable here is documentation plus,
at most, exported constants for the header names.

### 1.3 Submit

`POST https://api.higgsfield.ai/<endpoint-id>` with the model's params as a
**flat JSON body** — no `{ params }` / `{ input }` wrapper, no `model` field.

- S-js v2: `const requestBody = { ...input }` with the comment "send input
  directly (not wrapped in params)".
- Every D and C cURL sample posts the flat object.
- The `{ "params": {…}, "webhook": {url, secret} }` envelope belongs to the
  **legacy v1** client only (S-js `dist/client.js` `generate()`), which also
  polls `/v1/job-sets/{id}` and returns `{ id, jobs: [{ id, status, results:
  { raw: {url,type}, min: {url,type} } }] }`. Not documented anywhere in D/O/C.
  Out of scope.

Query parameter: `hf_webhook=<url-encoded https URL>` (§1.7).

**Submit response** (D `concepts/requests.md`):

```json
{
  "status": "queued",
  "request_id": "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff",
  "status_url": "https://api.higgsfield.ai/requests/d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff/status",
  "cancel_url": "https://api.higgsfield.ai/requests/d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff/cancel",
  "expires_after": 604800
}
```

`expires_after` (seconds of retention after finish) appears in
`concepts/requests.md` and `enterprise/data-retention.md` but **not** in
`quickstart.md`'s sample, not in any model page's "Accepted" sample, and not in
O's `RequestStatus`. Type it optional. O documents the submit `200` response as
`RequestStatus` (same schema as polling). An idempotent replay "can contain
`"status": "queued"` even when the original request has already finished"
(D `concepts/idempotency.md`).

### 1.4 Status

`GET https://api.higgsfield.ai/requests/{request_id}/status` — `request_id` is
a UUID. D says "Use the URLs from the response instead of constructing them
manually."

Status enum (D `concepts/requests.md`, O `RequestStatus.status`, S-js
`JobStatus`, S-py `StatusEnum` — all agree on six values):

| Status | Terminal | Meaning |
| --- | :-: | --- |
| `queued` | no | waiting; still cancelable |
| `in_progress` | no | started; not cancelable |
| `completed` | yes | output URLs present |
| `failed` | yes | "The response may include an `error`" |
| `nsfw` | yes | rejected by moderation |
| `canceled` | yes | canceled before processing (American spelling, one `l`) |

O `RequestStatus` (the shape to type):

```
status      enum above                       required
request_id  string uuid                      required
status_url  string uri
cancel_url  string uri
error       string | null
images      MediaOutput[]
video       MediaOutput
audio       MediaOutput
audios      MediaOutput[]
expires_at  string date-time | null   "Present once the request has finished."
MediaOutput = { url: string uri }  (additionalProperties: false, url required)
```

Completed samples (D `concepts/requests.md`):

```json
{ "status": "completed", "request_id": "…", "expires_at": "2026-10-31T12:05:12.481Z",
  "images": [ { "url": "https://cdn.example.com/image-1.jpg" }, { "url": "https://cdn.example.com/image-2.jpg" } ] }
```
```json
{ "status": "completed", "request_id": "…", "video": { "url": "https://cdn.example.com/video.mp4" } }
```
```json
{ "status": "completed", "request_id": "…", "audio": { "url": "https://cdn.example.com/audio.mp3" },
  "audios": [ { "url": "https://cdn.example.com/audio.mp3" } ] }
```

"Some video and 3D operations can return additional artifacts such as `zip`,
`mov`, `jsx`, `fbx`, or `ply`." C's per-model output schema spells those five as
optional `{ url }` objects beside `video` on every video model.

C's output schema is a three-way `oneOf` — `PendingRequestStatus` (status enum
`queued | in_progress | nsfw | canceled`), `FailedRequestStatus` (`error:
string` **required**), `CompletedRequestStatus` (`images` required for image
models, `video` required for video models). Note C files `nsfw` and `canceled`
under "Pending"; they are terminal per D. The `nsfw` status carries no `error`.

**Per-model extension — Ads Studio (verified 2026-11-24).** D `models/ads-studio/generate.md`
shows a completed status whose `images[]` items carry a zero-based `index` and
which has a top-level `errors` array:

```json
{ "request_id": "REQUEST_ID", "status_url": "…", "cancel_url": "…", "status": "completed",
  "images": [ {"index": 0, "url": "https://example.com/ad-1.png"}, {"index": 1, "url": "https://example.com/ad-2.png"} ],
  "errors": [] }
```

"Use its zero-based `index` to identify its batch slot and inspect `errors` for
unsuccessful slots." So a `completed` Ads Studio request can be *partially*
successful (fewer than `batch_size` images). The item type of `errors` is not
published (the doc's Python sample only `print(error)`s each one). This
contradicts O's `MediaOutput` (`additionalProperties: false`, `url` only) and
C's Ads Studio output schema (no `index`, no `errors`); D's model page wins, so
the response type must tolerate extra keys on media objects and on the status.

Failed sample (D `concepts/errors.md`):

```json
{ "status": "failed", "request_id": "…", "error": "Generation failed" }
```

"Failed and NSFW requests are not charged; any reserved amount is refunded."

### 1.5 Cancel and delete

- `POST /requests/{request_id}/cancel` → `202 Accepted`, **empty body**. `400`
  if processing has started, `401`, `404`. "Cancellation is available only while
  every job in the request remains queued." Canceled queued requests are
  refunded.
- `DELETE /requests/{request_id}` → `200` `{"request_id": "...", "status":
  "deleted"}` (idempotent). `401`, `404` (unknown or another account's request),
  `409` while `queued`/`in_progress`, `503` "Deletion is temporarily
  unavailable" (verified 2026-11-24). Deletes files, prompt and parameters; billing
  records are kept. Retention default is seven days.

### 1.6 Auxiliary endpoints

| Endpoint | Source | Notes |
| --- | --- | --- |
| `POST /estimate/<endpoint-id>` | D `concepts/billing-and-retention.md` | same body as the generation; returns `{ "usd": "0.094" }` (a **string**). "Use the estimate returned for your authenticated account as the authoritative amount." |
| `POST /files/generate-upload-url` | D `concepts/file-uploads.md`, both SDKs | body `{ "content_type": "image/jpeg" }` → `{ public_url, upload_url, content_type, upload_headers: { "Content-Type", "x-amz-tagging" } }`; then `PUT upload_url` with every `upload_headers` entry and **no** API credentials. URL expires in one hour. Accepted types: `image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `image/gif`, `audio/wav`, `audio/x-wav`, `video/mp4`. |
| `GET /v1/text2image/soul-styles` | D `models/soul-standard/generate.md`, C2, S-js | array of `{ id: uuid, name, description: string|null, preview_url }` |
| `GET /v1/text2image/soul-styles/v2` | D `models/soul-2/generate.md` | same item shape |
| `GET /models/higgsfield/genjutsu/restyle/v1.0/presets` | D `models/genjutsu/restyle.md` | `{ model, items: [{ id, name, preview_url }] }` |
| `GET /marketing-studio/image/presets?search&size&cursor` | D `models/marketing-studio-image/*.md` | `{ total, cursor: int|null, items: [{ id, type, name, cover_image, metadata: { aspect_ratio, group_name }, format_slugs }] }`; `search` 1–100 chars, `size` 1–100 default 50, `cursor` ≥ 0 default 0 (a zero-based *offset*; response `cursor` is `null` on the last page); `cover_image` is `null` in the sample (verified 2026-11-24) |
| `GET /models/higgsfield/ai-influencer/options` | C `higgsfield/ai-influencer` | unauthenticated while the model is public (`404` while hidden); `{ config_revision, categories: [{ key, label, tiers, max, options: [{ key, label, img, color, tiers, slot, exclusive }] }] }`. Live-fetched without credentials 2026-11-24 → `200`: 28 categories over 18 distinct `key`s (matching `selection`'s `maxProperties: 18`), 283 options; `img`, `color`, `slot` are `string \| null`, option `tiers` is `string[] \| null`, `exclusive` boolean (verified 2026-11-24) |
| `GET /v1/motions` | S-js v1 only | legacy DoP motions; undocumented elsewhere |
| `GET /models/usage` (verified 2026-11-24) | D `enterprise/usage-and-billing.md` (https://docs.higgsfield.ai/docs/enterprise/usage-and-billing.md) | usage analytics, "not a billing record". Query: `start`, `end` (ISO 8601, default last 24 h, range ≤ 31 days), `timeframe` (`hour` default \| `day` \| `week` \| `month`), `bound_to_timeframe` (default `true`), `model` (repeatable), `expand` (`time_series` default; add `auth_method`), `page` (1), `limit` (50, max 100). Response `{ time_series: [{ bucket, results: [{ model, unit, quantity, unit_price, cost, currency, auth_method }] }], total, page, limit }` — `quantity`, `unit_price`, `cost` are decimal **strings**. Omitted from the first pass. |
| `POST /v1/agent/sessions`, `POST`/`GET /v1/agent/sessions/{id}/messages`, `POST /v1/agent/sessions/{id}/interrupt`, `POST /v1/agent/media`, `POST /v1/agent/media/{id}/confirm` (verified 2026-11-24) | S-js `dist/agents/resources.js`, S-py `agents/resources.py` only | "Agent API" (multi-step creative sessions; account must have Agent API access; `402` = not enough credits, `403` = access disabled, `409` = session busy). In **neither** D, O nor C. S-js README calls it "V2 preview". Omitted from the first pass; out of scope (not a validated generation body), recorded so it is not rediscovered. |

Every `style_id` / `preset_id` is a **dynamic UUID** from one of these lists.
The validator can check UUID *format*, never membership.

### 1.7 Webhooks

Param: query `hf_webhook`, a URL-encoded HTTPS endpoint (D
`api-reference/headers.md`, `how-to/webhooks.md`; S-js and S-py both append
`?hf_webhook=`). "The webhook URL must use HTTPS and resolve only to public IP
addresses, without credentials in the URL. Other URLs are rejected when the
request is submitted."

Deliveries fire on `completed`, `failed`, `nsfw` (not on `canceled` — the page
lists only those three). **The envelope is not the status shape**: output is
nested under `payload`, and media objects carry `content_type`.

```json
{ "request_id": "9417a243-e457-4075-895b-b68f3cda5303", "status": "completed", "error": null,
  "expires_at": "2026-10-31T12:05:12.481Z",
  "payload": { "images": [ { "url": "https://cdn.example.com/generated-image.jpg", "content_type": "image/jpeg" } ] } }
```
```json
{ "request_id": "…", "status": "completed", "error": null,
  "payload": { "video": { "url": "https://cdn.example.com/generated-video.mp4", "content_type": "video/mp4" } } }
```
```json
{ "request_id": "…", "status": "failed", "error": "Generation failed", "payload": null }
```
```json
{ "request_id": "…", "status": "nsfw", "error": null, "payload": null }
```

"Audio responses contain `payload.audio`. Some video and 3D operations can also
include `zip`, `mov`, `jsx`, `fbx`, or `ply` artifacts."

Signing: Standard Webhooks (https://www.standardwebhooks.com/). Headers
`webhook-id`, `webhook-timestamp` (unix seconds), `webhook-signature`
(space-separated `v1,<base64>`). Secret starts `whsec_`, one per account,
revealed in console Settings; "until then, deliveries for your account are not
signed". Manual check: strip `whsec_`, base64-decode → HMAC-SHA256 over
`{webhook-id}.{webhook-timestamp}.{raw body}`, base64, constant-time compare
against any `v1,` entry, reject timestamps more than five minutes off. Rotation
keeps the old secret valid 24 h (two signatures per delivery). Legacy
`X-Webhook-Secret-Key` header echoes a body-supplied secret "and will be
retired". Endpoint must answer within ten seconds; network failures and `5xx`
retry for up to two hours; `4xx` is permanent.

This is the same shape of job `revana.verifyWebhook` does. A
`higgsfield.verifyWebhook` is feasible but is new scope, not v1 (see §6).

### 1.8 Errors

FastAPI envelope (D `concepts/errors.md`): `{ "detail": "Invalid credentials" }`.
"Validation errors may return a list in `detail`" — C2 gives the list item:
`{ loc: (string|integer)[], msg: string, type: string }`. And `detail` can be
an **object** on `429`/`503` (D `concepts/rate-limits.md`):

```json
{ "detail": { "code": "account_queue_full", "message": "Too many queued generations for this account",
              "retryable": true, "limit": 40, "retry_after_seconds": 30 } }
```

So `detail: string | ValidationError[] | { code, message, retryable, … }`.
`503` uses `"code": "admission_control_unavailable"`.

| Status | Meaning |
| --- | --- |
| 400 | invalid parameters / rejected input; cancel after start |
| 401 | missing or invalid credentials |
| 403 | insufficient balance (S-js maps to `NotEnoughCreditsError`); disabled/expired key |
| 404 | request or model not found for this account |
| 409 | delete while still running |
| 422 | validation failed; idempotency key reused with different params; `Hf-Expires-After` out of range |
| 423 | model temporarily blocked |
| 429 | account queue full or endpoint limit; honour `Retry-After` |
| 500 | unexpected |
| 503 | model disabled / not ready; admission control unavailable |

Concurrency (P `/pricing`): 2 concurrent generations by default, 10 at ≥$25
added in the past 28 days, 20 at ≥$100, 40 at ≥$1,000. Over-limit submissions
are *queued*, not rejected, until the queue (a multiple of the concurrency
limit) is full.

---

## 2. Catalog

D `models.md`: "The catalog documents 84 entries: 17 Image and 67 Video."
P shows more than D documents (Kling 4.0, Kling Image 4.0, Seedream 5.0 Pro,
MAGI-2, Genjutsu Light, AI Influencer, Soul 2 image-to-image appear on P/C and
have no D page). The roster is moving: release dates in P's `/explore` data run
to 2026-11-24 — MAGI-2's `released_on` is the day of this research (verified 2026-11-24);
the first pass said 2026-10-20, which is only the newest *first-party* date
(Genjutsu Light).

### 2a. First-party endpoints

"Higgsfield Exclusive" is P's own badge. Body fields are **snake_case, flat**.
Unless stated, a field is optional. `uri` strings are public HTTPS URLs; no
base64 or multipart input exists on any route.

#### Soul — text to image — `POST /higgsfield-ai/soul/standard`

Source: D https://docs.higgsfield.ai/docs/models/soul-standard/generate.md
(`SoulParamsSchema`). Schema does **not** declare `additionalProperties`.

| Field | Type | Constraint | D default |
| --- | --- | --- | --- |
| `prompt` | string | **required** | |
| `aspect_ratio` | enum | `9:16` `16:9` `4:3` `3:4` `1:1` `2:3` `3:2` | `4:3` |
| `resolution` | enum | `720p` `1080p` | `720p` |
| `enhance_prompt` | boolean | | `false` |
| `style_id` | string uuid | from `GET /v1/text2image/soul-styles` | `464ea177-8d40-4940-8d9d-b438bab269c7` |
| `style_strength` | number | 0–1 | `1.0` |
| `seed` | integer \| null | 1–1000000 | `null` (random) |
| `custom_reference_id` | string uuid \| null | a completed Soul ID owned by the account | `null` |
| `custom_reference_strength` | number | 0–1; "0 uses the selected style's default character strength; it does not disable the character reference" | `1.0` |
| `image_reference_url` | string uri \| null | length 1–2083; "guides prompt enhancement; it is distinct from custom_reference_id" | `null` |
| `batch_size` | integer enum | `1` or `4` only | `1` |

Output: `images[]`. Also from D's usage notes (verified 2026-11-24): "Short prompts using the
general style can be enhanced automatically even when enhance_prompt=false"
(same sentence on Soul V2) — `enhance_prompt: false` is not a guarantee.

#### Soul V2 — text to image — `POST /higgsfield-ai/soul/v2/standard`

Source: D https://docs.higgsfield.ai/docs/models/soul-2/generate.md
(`SoulV2ParamsSchema`).

| Field | Type | Constraint | D default |
| --- | --- | --- | --- |
| `prompt` | string | **required** | |
| `aspect_ratio` | enum | same seven ratios | `1:1` |
| `resolution` | enum | `720p` `1080p` | `720p` |
| `enhance_prompt` | boolean | | `false` |
| `custom_reference_id` | string uuid \| null | Soul ID trained with `model_version: "v2"` | `null` |
| `custom_reference_strength` | number | 0–1; "The schema accepts 0, but the current runtime fails to process it for a character reference" | `1.0` |
| `style_id` | string uuid | from `GET /v1/text2image/soul-styles/v2` | `3db34ab5-3439-4317-9e03-08dc30852e69` |
| `style_strength` | number | 0–1; "accepted by the request schema but currently has no effect on generation" | `1.0` |
| `seed` | integer | 1–1000000; "explicit null is invalid" | random |
| `batch_size` | integer enum | `1` or `4` | `1` |

Output: `images[]`.

#### Soul Cinema — text to image — `POST /higgsfield-ai/soul/cinema`

Source: D https://docs.higgsfield.ai/docs/models/soul-cinema/generate.md
(`SoulCinemaParamsSchema`). **Not on C or P** (`dash…/llms.txt` and the P
api-reference page both 404); D: "This model may be absent from model discovery;
authorized requests can use the endpoint ID directly."

Fields: `prompt` (required), `aspect_ratio` (seven ratios, default `1:1`),
`enhance_prompt` (default `false`), `resolution` (`720p`|`1080p`),
`custom_reference_id` (uuid|null), `custom_reference_strength` (0–1), `seed`
(integer 1–1000000, "explicit null is invalid"), `batch_size` (`1`|`4`).
No `style_id` in the schema — "Cinema uses a fixed style; client-supplied
style_id is ignored" (i.e. accepted and dropped, so unknown keys are not
rejected on this route). "Providing a custom_reference_id enables prompt
enhancement … even if enhance_prompt is false."

#### Soul 2 — image to image — `POST /higgsfield-ai/soul/v2/image-to-image`

Source: **C only** —
https://dash.higgsfield.ai/models/higgsfield-ai/soul/v2/image-to-image/llms.txt
and https://open.higgsfield.ai/models/higgsfield-ai/soul/v2/image-to-image/api-reference.
No D page. Schema title "Soul V2 Image to Image"; P metadata
`operation_type: "image_edit"`.

| Field | Type | Constraint | C default |
| --- | --- | --- | --- |
| `prompt` | string | **required** | |
| `image_url` | string uri | **required**, minLength 1; "Required even when using a Soul ID" | |
| `seed` | integer | 1–1000000 | `null` |
| `style_id` | string uuid | | |
| `batch_size` | integer enum | `1` `4` | `1` |
| `resolution` | enum | `720p` `1080p` | `720p` |
| `aspect_ratio` | enum | seven ratios | `4:3` |
| `enhance_prompt` | boolean | "Reference-image prompt processing is always enabled for this model" | `true` |
| `custom_reference_id` | string uuid \| null | Soul ID trained with `model_version` v2 | `null` |
| `custom_reference_strength` | number | 0–1 | `1.0` |

Output: `images[]`. No `strength`/denoise field exists.

#### Soul ID — character training — `POST /v1/custom-references`

Sources: D https://docs.higgsfield.ai/docs/models/soul-id/create-character.md
(`CreateCustomReferenceSchema`), C2
https://dash.higgsfield.ai/api/v2/app-models/soul-id/openapi/, S-js
`createSoulId`. **Not a generation endpoint**: no `request_id`, no `images`, its
own lifecycle. "do not POST to /soul-id" (D) — although C's overview line lists
`https://api.higgsfield.ai/soul-id` as the endpoint with an empty input schema;
that line is a catalog artefact.

Body:

| Field | Type | Constraint |
| --- | --- | --- |
| `name` | string | **required**, maxLength 100 |
| `input_images` | array | **required**, 1–100 items of `{ "type": "image_url", "image_url": <uri, 1–2083 chars> }` (`type` is the constant `"image_url"`) |
| `model_version` | enum | `v1` `v2` `cinema`; default `v1`. "Choose the matching generation family." |

Response (C2, `200`): `{ id: uuid, name, status, created_at, thumbnail_url:
string|null, in_progress_at: date-time|null }` (`additionalProperties: false`;
required `id`, `name`, `created_at`). D additionally lists `model_version` and
`fail_reason`.

- `GET /v1/custom-references/{reference_id}` → the same plus `reference_media:
  [{ id: uuid, media_url: string }]`.
- `GET /v1/custom-references/list?page=1&page_size=20` → `{ total, page,
  page_size, total_pages, items[] }`.
- `DELETE /v1/custom-references/{reference_id}` → `204`, no body.
- Status enum: `not_ready` `queued` `in_progress` `completed` `failed`.
- Over the training-concurrency limit → `429` + `Retry-After`, body
  `{ "detail": "Maximum number of concurrent requests (2) has been reached" }`.

#### Genjutsu — video to video — three routes

Sources: D https://docs.higgsfield.ai/docs/models/genjutsu/{motion-transfer,object-swap,restyle}.md
and C `…/models/higgsfield/genjutsu/<workflow>/v1.0/llms.txt`. D and C schemas
are **identical** for all three. All three declare `additionalProperties: false`.

`POST /higgsfield/genjutsu/motion-transfer/v1.0` (`MotionTransferParams`) and
`POST /higgsfield/genjutsu/object-swap/v1.0` (`ObjectSwapParams`) — same body:

| Field | Type | Constraint | Default |
| --- | --- | --- | --- |
| `video_url` | string uri | **required**, length 1–2083 | |
| `image_urls` | string uri[] | **required**, 1–8 items, each 1–2083 chars | |
| `prompt` | string | maxLength 10000 | `""` |
| `resolution` | enum | `480p` `720p` `1080p` | `720p` |

Runtime rules (not expressible from the body alone): source ≥ 4 s; > 30 s is
trimmed to 30 s; output duration follows the source. Object swap additionally
needs ≥ 409,600 pixels per source frame. A **misspelled legacy path**
`higgsfiled/genjutsu/{motion-transfer,object-swap}/v1.0` "remains callable for
existing clients but is hidden from model discovery" — and P's own Genjutsu
workflow page (https://open.higgsfield.ai/models/workflows/genjutsu/playground;
`open.higgsfield.ai/workflows/genjutsu` itself is 404) and `/explore` data
(`default_mode_id: "higgsfiled/genjutsu/motion-transfer/v1.0"`) still embed the
misspelled path (verified 2026-11-24). Its `dash…/llms.txt` is 404. Use the correct one.

`POST /higgsfield/genjutsu/restyle/v1.0` ("Genjutsu Restyle"):

| Field | Type | Constraint | Default |
| --- | --- | --- | --- |
| `video_url` | string uri | **required**, minLength 1 (no maxLength) | |
| `preset_id` | string uuid | **required**; from `GET /models/higgsfield/genjutsu/restyle/v1.0/presets` | |
| `image_urls` | string uri[] | 0–5 character references | `[]` |
| `prompt` | string | maxLength 10000 | `""` |
| `resolution` | enum | `480p` `720p` `1080p` | `720p` |

"Use [] or an empty string where appropriate; null is not accepted." Source
≥ 4 s and ≤ 200 MiB; trimmed to the first 30 s; each character image ≤ 64 MiB
(67,108,864 bytes) (verified 2026-11-24). "Batch size, duration, aspect
ratio, FPS, scene mode, a separate background image, seed, and provider
selection are not exposed by this model."

Output for all three: `video` (+ optional artefacts).

#### Genjutsu Light — video to video — two routes

Source: **C only** —
https://dash.higgsfield.ai/models/higgsfield/genjutsu-light/motion-transfer/v1.0/llms.txt
and `…/object-swap/v1.0/llms.txt`. No D page; no `restyle` (404).
`POST /higgsfield/genjutsu-light/motion-transfer/v1.0` and
`POST /higgsfield/genjutsu-light/object-swap/v1.0`. Same four fields and
constraints as full Genjutsu, but the schema declares
**`additionalProperties: true`**. "Uses the first 15 seconds of the source
video and preserves source audio." Released 2026-10-20 per P metadata.

#### Cinema Studio 4.0 — text/reference to video — `POST /higgsfield/cinema-studio/4.0`

Sources: D https://docs.higgsfield.ai/docs/models/cinema-studio-4/generate.md,
C https://dash.higgsfield.ai/models/higgsfield/cinema-studio/4.0/llms.txt —
schemas identical, `additionalProperties: false`.

| Field | Type | Constraint | Default |
| --- | --- | --- | --- |
| `prompt` | string | **required**, minLength 1, pattern `\S` | |
| `duration` | integer | 4–30 | `5` |
| `resolution` | enum | `480p` `720p` | `720p` |
| `aspect_ratio` | enum | `16:9` `4:3` `1:1` `3:4` `9:16` `21:9` | `16:9` |
| `generate_audio` | boolean | | `true` |
| `image_urls` | string uri[] | ≤ 30 | |
| `video_urls` | string uri[] | ≤ 10 | |
| `audio_urls` | string uri[] | ≤ 10 | |
| `era` | enum | `1960s` `1980s` `1990s` `2000s` `2020s` | (director picks) |
| `genre` | enum | `epic` `drama` `noir` `comedy` `horror` `action` | |
| `light` | enum | `silhouette` `practicals` `window` `overhead-fall` `contre-jour` `soft-cross` | |
| `pacing` | enum | `chaotic` `dynamic` `calm` `single-shot` | |
| `camera_lens` | enum | `clean-sharp` `anamorphic` `vintage-anamorphic` `warm-vintage` `halation-vintage` | |
| `camera_model` | enum | `modern` `35mm-film` `8mm-film` `dv-camcorder` | |
| `camera_aperture` | enum | `f14-wide-open` `f4-moderate` `f11-deep-focus` | |
| `camera_movement` | enum (33) | `snorricam` `robot-arm` `tilt-up` `rack-focus` `tilt-down` `pov` `pan-left` `crane-up` `pan-right` `crane-down` `side-tracking` `pedestal-up` `pedestal-down` `handheld` `tracking` `drone-orbit` `dolly-zoom` `aerial-pullback` `static-shot` `bullet-time` `whip-pan` `slow-zoom-in` `arc-left` `slow-zoom-out` `arc-right` `truck-right` `dolly-in` `truck-left` `dolly-out` `slider-right` `crush-zoom` `slider-left` `helicopter-shot` | |
| `color_palette` | enum (50) | copy verbatim from the D schema — includes vendor spellings such as `crimson-vigi` and `dont-turn-it-off-im-watching` | |

Rules: "the literal value "auto" is not accepted for these enum fields" — omit
to let the director choose. References total ≤ 50 items. Prompt tokens
`<<<image_1>>>`, `<<<video_1>>>`, `<<<audio_1>>>` are one-based and "must refer
to an attached item of the same media type". "Video and audio may be normalized
to separate 30-second total budgets" (verified 2026-11-24). "Editing and extension use the
separate Seedance 2.5 endpoints." P metadata gives `system_name:
"seedance-2-5-sale"` — it is a directed wrapper over Seedance 2.5.

Output: `video`.

#### Marketing Studio Image — text to image + edit — three routes

Sources: D https://docs.higgsfield.ai/docs/models/marketing-studio-image/{generate-and-edit,flare,sunburst}.md,
C `…/models/marketing-studio/image[/flare|/sunburst]/llms.txt`. Schemas agree.
All `additionalProperties: false`.

| Route | D name | P `system_name` |
| --- | --- | --- |
| `POST /marketing-studio/image` | 2.0 Alpha | `gpt_image_2` |
| `POST /marketing-studio/image/flare` | 2.5 Flare ("GPT Image 2.5 Flare" in C) | `marketing-studio/image/flare` |
| `POST /marketing-studio/image/sunburst` | 2.5 Sunburst ("GPT Image 2.5 Sunburst" in C) | `marketing-studio/image/sunburst` (verified 2026-11-24) |

| Field | Type | Constraint | Default |
| --- | --- | --- | --- |
| `prompt` | string | **required**, length 1–5000 | |
| `quality` | enum | 2.0 Alpha: `low` `medium` `high`. Flare/Sunburst: `low` `medium` `high` `xhigh` `max` | `high` |
| `preset_id` | string uuid | from `GET /marketing-studio/image/presets` | |
| `image_urls` | string uri[] | 0–16 | |
| `moderation` | enum | `auto` `low` | `auto` |
| `resolution` | enum | `1k` `2k` `4k` (lower-case) | `2k` |
| `aspect_ratio` | enum | `auto` `1:1` `3:2` `2:3` `4:3` `3:4` `16:9` `9:16` `21:9` | `auto` |
| `enhance_prompt` | boolean | | `false` |

Conditional (JSON-Schema `if/then`): when `enhance_prompt === true`, `preset_id`
and `image_urls` become **required** and `image_urls` is limited to 1–2 items
("product first, optional person/model reference second"). On 2.0 Alpha only,
`enhance_prompt: true` also forces `quality: "high"`. No `seed`, no batch field.
`aspect_ratio: "auto"` (verified 2026-11-24): "With enhancement enabled, aspect_ratio=auto
uses the preset ratio. With enhancement disabled, current production mappings
use square output for auto" (D, all three pages). "A second image is treated as
the optional model reference. Without a second image, the composition stays
product-only" (C).
Reference images must be JPEG/PNG/WebP. These are GPT-Image-family models
behind a Higgsfield preset/prompt layer — "first-party" as a *product*, not as
weights.

P's "workflows" (`workflows/product-shots`, `/graphic-ads`,
`/marketplace-design`) are playground presets over `marketing-studio/image`,
and `workflows/genjutsu`, `/cinema-studio-4-0`, `/ads-studio` are presets over
the routes above. They have no endpoints of their own (their `llms.txt` is 404).
Their pages live at `https://open.higgsfield.ai/models/workflows/<id>/playground`
(verified 2026-11-24).

#### Ads Studio — brief to ad images — `POST /higgsfield/ads-studio/v1.0`

Sources: D https://docs.higgsfield.ai/docs/models/ads-studio/generate.md, C
https://dash.higgsfield.ai/models/higgsfield/ads-studio/v1.0/llms.txt.
`additionalProperties: false`.

| Field | Type | Constraint | Default |
| --- | --- | --- | --- |
| `prompt` | string | **required**, length 1–8000, pattern `\S` | |
| `image_urls` | string[] | ≤ 10, each pattern `^https?://`, length 1–8192 | `[]` |
| `batch_size` | integer | 1–8 (a *range* here, unlike Soul's `1|4`) | `1` |
| `aspect_ratio` | enum | D: `1:1` `4:5` `5:4` `16:9` `9:16` `4:3` `3:4` `21:9` `3:2` `2:3` `2:1` `1:2` `3:1` `1:3`. C omits `3:1` and `1:3` (§5) | `1:1` |
| `niche` | string | maxLength 1000 | `""` |
| `language` | string | maxLength 80 | `""` |
| `target_audience` | string | maxLength 2000 | `""` |

"Rendering uses GPT Image 2.5 Flare with fixed 2k resolution and high quality."
"The value auto is not supported" for `aspect_ratio`. Output (verified 2026-11-24): `images[]`,
one per *successful* concept, each `{ index, url }` (zero-based batch slot), plus
a top-level `errors[]` for failed slots — see §1.4. Outputs are PNG.

#### AI Influencer — character sheet — `POST /higgsfield/ai-influencer`

Source: **C only** —
https://dash.higgsfield.ai/models/higgsfield/ai-influencer/llms.txt. No D page.
`additionalProperties: false`; **no required fields**.

| Field | Type | Constraint | Default |
| --- | --- | --- | --- |
| `tier` | enum | `normal` `freak` `total` `insects` `frogs` `cats` `dogs` `capybaras` `birds` | `normal` |
| `selection` | object | ≤ 18 keys, each value `string[]`; keys from the options endpoint | `{}` |
| `image_url` | string uri \| null | length 1–2083 (identity photo) | `null` |
| `item_image_urls` | string uri[] | ≤ 3, each 1–2083 | `[]` |
| `brief` | string | maxLength 4000 | `""` |
| `seed` | integer \| null | 1–1000000 | `null` |
| `variation_index` | integer | 0–2147483647 | `0` |
| `body_color` | string \| null | pattern `^#[0-9a-fA-F]{6}$` | |
| `pinned_species` | string \| null | length 1–64 | |
| `trait_variants` | object \| null | `{ version: "appearance-v2", choices: { [k]: "original"|"v1"…"v5" } (≤ 512 keys; key `pr_centaur` takes `v1`…`v10`), animal_choices: { [k]: 0…4 } (≤ 64) | null }`, `additionalProperties: false`; required `version`, `choices` | `null` |

Conditionals: for `tier` in `normal|freak|total` → `body_color` null,
`pinned_species` null, `trait_variants.animal_choices` null,
`variation_index === 0`. For any `tier` other than `insects` → `pinned_species`
null. Output: one 2K 16:9 image in `images[0]`. Both `if` clauses lack
`required: ["tier"]`, so they also apply when `tier` is omitted (default
`normal`) (verified 2026-11-24). Image inputs must be "non-animated JPEG, PNG or WebP", ≤ 64 MiB
each. `selection` values are further limited per category by the options
endpoint's `max`, `slot` and `exclusive` — not checkable offline.

#### Named in the brief, not found

- **DoP** (`/v1/image2video/dop`, models `dop-lite|dop-turbo|dop-standard`) and
  **Speak** (`/v1/speak/higgsfield`): typed in S-js `dist/v2/types.d.ts` and
  shown in its README, but absent from D, O, C and P; `dash…/models/higgsfield-ai/dop/*/llms.txt`
  and `…/higgsfield-ai/speak/llms.txt` are 404. Legacy v1 surface. Not in scope.
- **Upscale**: no first-party upscale route exists on any surface.
- **Marketing Studio video**: `marketing-studio/video` is 404 on C.

### 2b. Hosted third-party models

From D's 84-entry catalog (https://docs.higgsfield.ai/docs/models/video-generation.md,
`…/image-generation.md`), by vendor, with route prefix:

| Vendor | Families (workflows) | Route prefix |
| --- | --- | --- |
| ByteDance | Seedance 2.0 (t2v, i2v, reference), Seedance 2.5 (t2v, i2v, reference, video-edit, video-extend) | `/bytedance/seedance-2.0/…`, `/bytedance/seedance-2.5/…` |
| Kling | 2.5 Turbo (3), 2.6 (2), 2.6 Motion Control (2), 3.0 std/pro/4k/turbo × t2v/i2v (8), 3.0 Motion Control (2), O3 (4), Omni (4) | `/kling-video/…` |
| Alibaba | Happy Horse 1.0 (3), HappyHorse 1.1 (3), Wan 2.6 (3), Wan 2.7 (3), Wan 3.0 (3), Wan 3.0 Prime (3), Qwen Image 3 (2), Z-Image Turbo (1) | `/alibaba/…`, `/wan/v2.6|v2.7/…`, `/z-image/turbo` |
| MiniMax | H3 (3), Hailuo 2.3 Standard (2) | `/minimax/…` |
| Lightricks | LTX-2.5 fast/pro × t2v/i2v (4) | `/lightricks/ltx-2.5/…` |
| PixVerse | V6 (2) | `/pixverse/v6/…` |
| xAI | Grok Imagine Video 1.5 (1), Grok Image 2.0 (1) | `/xai/…` |
| Recraft | V4.1, V4.1 Pro, V4.1 Utility, V4.1 Utility Pro (4) | `/recraft/v4.1/…` |
| Ideogram | 4.0 (1) | `/ideogram/v4.0` |

On P but not in D: Kling 4.0 and 4.0 Flash (t2v, i2v, reference-to-video,
video-edit), Kling Image 4.0 (text-to-image, edit, each with a `series`
variant), Seedream 5.0 Pro (`/bytedance/seedream/v5.0/pro/text-to-image`),
MiniMax H3 Highspeed / Lite (`/minimax/h3-highspeed/…`, `/minimax/h3-lite/…`),
and Sand AI MAGI-2 — three routes, `/sand/magi-2/text-to-video`,
`/image-to-video`, `/reference-to-video` (badged "Higgsfield Exclusive" but a
Sand AI model; "USD 0.08/sec. 1 concurrent generation per account across all
MAGI-2 modes. Contact sales to increase the limit." —
https://open.higgsfield.ai/models/sand/magi-2/text-to-video/api-reference,
2026-11-24) (verified 2026-11-24). The S-js README's example id
`flux-pro/kontext/max/text-to-image` appears in no current catalog surface.

Each hosted route has **its own Higgsfield-shaped schema**, not the vendor's —
e.g. Seedance 2.5 t2v here takes `{ prompt, duration (4–30), resolution,
aspect_ratio, bitrate_mode, output_format, generate_audio }`
(https://docs.higgsfield.ai/docs/models/seedance-2-5/text-to-video.md), which
is not BytePlus's `content[]` wire.

---

## 3. Pricing

Billing is **USD against a prepaid balance** (D `concepts/billing-and-retention.md`:
"Higgsfield charges successful generation requests to your account balance";
the estimate endpoint answers `{ "usd": "…" }`). Not credits. Funds expire one
year after being added. All quotes below read 2026-11-24.

| Endpoint | Published statement (exact quote) | Source | Verdict |
| --- | --- | --- | --- |
| Genjutsu motion-transfer, object-swap | "Standard self-serve rates in USD per video second: 480p: $0.1540; 720p: $0.3446; 1080p: $0.8346. Billed duration is the source video duration rounded up to a whole second. Total price = selected rate × billed duration in seconds." | C `…/genjutsu/motion-transfer/v1.0/llms.txt` (same sentence on object-swap) | **Catalogable** as per-second rates keyed by resolution. A request cost is not computable from the body (duration is the *source clip's*). |
| Genjutsu restyle | "Roughly costs $0.318 per second at 480p, $0.681 per second at 720p, or $1.632 per second at 1080p." and "These are approximate per-second rates, not an exact total quote. Source duration is rounded up to whole seconds after trimming to 30 seconds" | C `…/genjutsu/restyle/v1.0/llms.txt`; D `models/genjutsu/restyle.md` | Vendor labels it approximate. **Omit cost**, or record with an explicit approximate flag if the repo has one (open question). |
| Genjutsu Light (both) | "Price per second (output): 480p — $0.0739; 720p — $0.1471; 1080p — $0.2936." | C `…/genjutsu-light/motion-transfer/v1.0/llms.txt` | **Catalogable**, same caveat on duration. |
| Cinema Studio 4.0 (P page data also gives `price_range: 0.1234–0.2774 USD/sec` (verified 2026-11-24)) | "Token-metered pricing. Billable video tokens = ceil((input video seconds + generated video seconds) × output width × output height × 24 fps / 1024). … At 480p or 720p, each 1,000 video tokens cost $0.0214 without video input or $0.01284 with video input (0.6× the standard rate)." | C `…/cinema-studio/4.0/llms.txt` | Formula is exact but needs output pixel dimensions per resolution × aspect ratio, which are **not published**. **No cost.** (P's card says "from 0.123 / s".) |
| AI Influencer | "The price is **$0.05 per sheet** for every character type, before any account-specific discounts." | C `…/ai-influencer/llms.txt` — in its header line ("$0.05 per sheet.") and "Additional Documentation" body; P metadata `amount:"0.0500", unit:"generation"` and "Images cost $0.05 each at medium quality." | **Catalogable**: $0.05 per image, one image per request. Caveat (verified 2026-11-24): the *same* C file's `## Pricing` section reads "Public pricing information is not available for this model." — the generated section is stale against the hand-written body; three statements agree on $0.05, so the number stands. |
| Ads Studio; Marketing Studio 2.5 Flare / Sunburst | "Per 1M tokens: text input $5, cached text input $1.25, text output $10; image input $8, cached image input $2, image output $30. … Final cost uses actual token usage and standard credit rounding. The initial charge is an estimate reconciled on completion." D adds "**Illustrative estimate: approximately $0.084 per image.** This is a budgeting example, not a fixed charge or maximum price." | C llms.txt for each; D `models/ads-studio/generate.md` | Token-metered with no per-image figure. **No cost.** |
| Marketing Studio 2.0 Alpha | "Public pricing information is not available for this model." (C `## Pricing`); but P's page data says "Images cost $0.0162 each at 1k, low quality, auto aspect ratio, $0.0222 each at 2k, low quality, auto aspect ratio and $0.7219 each at 4k, high quality, auto aspect ratio." and C's body says "Enhanced requests cost 10% more than the equivalent direct request." (verified 2026-11-24) | C `…/marketing-studio/image/llms.txt`; https://open.higgsfield.ai/models/marketing-studio/image/api-reference (`related_models_description`), 2026-11-24 | **No cost** — three sample points out of 3 resolutions × 3 qualities × 9 ratios is not a price table. |
| Soul, Soul V2, Soul 2 image-to-image | "Public pricing information is not available for this model." (C `## Pricing`); but P's page data says, for Soul, "Images cost $0.0938 each at 720p and $0.1875 each at 1080p." and, for both Soul 2 routes, "Images cost $0.0032 each at 720p and $0.0057 each at 1080p." (verified 2026-11-24) | C llms.txt for each; https://open.higgsfield.ai/models/higgsfield-ai/soul/standard/api-reference, `…/soul/v2/standard/api-reference`, `…/soul/v2/image-to-image/api-reference` (`related_models_description`), 2026-11-24 | **Owner call** — a per-resolution quote exists after all; see the corrected contradiction below. |
| Soul Cinema | no surface states a price | — | **No cost.** |
| Soul ID training | "Public pricing information is not available for this model." | C `…/soul-id/llms.txt` | **No cost** (P metadata carries `amount:"2.5000", unit:"generation"`, unquoted in prose). |

**Soul price contradiction (corrected, verified 2026-11-24).** The first pass
said P gives "no resolution or `batch_size` breakdown". That is wrong: P's
model pages carry a per-resolution sentence in their embedded page data
(`related_models_description`), quoted in the table above — Soul $0.0938 (720p)
/ $0.1875 (1080p) per image; Soul 2 (both routes) $0.0032 / $0.0057. The
`/explore` cards agree after rounding ("from $0.094 per image" for Soul
Standard, "from $0.003 per image" for Soul 2), and Revana's resale prices
($0.13/$0.26 soul; $0.01 soul-2 — `data/revana/models.json`) sit a consistent
~38% above the Soul figures, close to its ~36% markup on Genjutsu.

What still argues for caution:

- C's `## Pricing` section for all three routes says "Public pricing
  information is not available for this model."
- P's machine field disagrees with P's own sentence for Soul: `price: { amount:
  "0.0313", unit: "image" }` is one third of $0.0938 (and one sixth of $0.1875) to
  rounding, so `amount` is some base unit, not the per-image price; for Soul 2
  the same field (`"0.0032"`) *is* the 720p per-image price. Do not catalog
  from `price.amount`.
- "each" is not tied to `batch_size` anywhere (presumably × 1 or × 4;
  unverified), and D's illustrative samples use `0.094` for *Soul V2*
  (`{ "usd": "0.094" }` in `concepts/billing-and-retention.md`, `unit_price:
  "0.0940"` in `enterprise/usage-and-billing.md`) — the Soul Standard number
  under the Soul V2 id, explicitly labelled as format illustrations.
- Soul Cinema has no price on any surface.

So this is no longer "no defensible number": there is an exact vendor quote
with URL and date for Soul and Soul 2 per resolution. Whether one P sentence
against C's refusal clears the provenance bar is an **owner decision** (§8 #6);
until then `cost` stays omitted and `POST /estimate/<endpoint-id>` is the
honest pointer.

P also publishes a comparison table against fal ("Comparison is based on prices
as of 16 September, 2026") — third-party models only, not needed here.

---

## 4. Revana's view of the same models

`data/revana/models.json` lists six rows with `maker: "Higgsfield"`:
`genjutsu-motion-transfer`, `genjutsu-object-swap` (video, `video_to_video`,
resolutions 480p/720p/1080p, $0.21/$0.46/$1.12 per second),
`marketing-studio-image` (image, qualities low/medium/high, $0.04/$0.16/$0.59),
`soul` ($0.13/$0.26), `soul-2` and `soul-cinema` ($0.01). Revana's contract
(`{ model, input }`, `max_images: 4`, its own option names) is **not**
Higgsfield's wire: Higgsfield has no `model` field, takes `batch_size ∈ {1,4}`
not 1–4, and Revana exposes neither `style_id`, `custom_reference_id`,
`preset_id`, Restyle, Cinema Studio, Ads Studio, AI Influencer, Soul ID nor
Soul 2 image-to-image. Revana's markup over Genjutsu list is ~36% ($0.21 vs
$0.1540 at 480p).

---

## 5. Discrepancies

| # | Subject | Source A | Source B | Wins / handling |
| --- | --- | --- | --- | --- |
| 1 | `/higgsfield-ai/soul/standard` body | O: `{ prompt, num_images (1–4, default 1), resolution: "2K"|"4K", aspect_ratio: 10 ratios incl. 5:4, 4:5, 21:9 }` | D model page: `batch_size ∈ {1,4}`, `resolution: 720p|1080p`, seven ratios, plus style/seed/reference fields | **D.** O is declared supplementary and its body matches no Soul surface. Do not type from O. |
| 2 | Soul field set | D: includes `custom_reference_id`, `custom_reference_strength`, `image_reference_url`, nullable `seed` | C ("Soul Playground"): none of those four; has `style_strength` with `format: float` | **D** for the field set (server schema vs playground form). |
| 3 | Soul `enhance_prompt` default | D: `false` | C: `true` | Unresolved. unmodel does not inject defaults, so it only affects docs — do not state one. |
| 4 | Soul V2 `aspect_ratio` default | D: `1:1` | C: `4:3` | Same handling as #3. |
| 5 | Soul V2 `style_strength` | D: present (0–1, "no effect") | C: absent | **D**; keep the field, mention it is inert. |
| 6 | Soul V2 `enhance_prompt` default | D: `false` | C: `true` | Same as #3. |
| 7 | `seed: null` | D Soul V2 / Cinema: "explicit null is invalid" | C Soul 2 image-to-image **and C Soul V2 standard** (verified 2026-11-24): schema `type: integer, default: null`, and the vendor's own "Required Parameters Example" / cURL / TS / Python samples send `"seed": null` and `"custom_reference_id": null` — i.e. C's samples for `higgsfield-ai/soul/v2/standard` do the very thing D's page for that same route calls invalid | Unresolved on V2 standard: D's prose and C's examples contradict each other on one route, so D's "explicit null is invalid" cannot be treated as settled. Because a false refusal is the worse failure, type `seed` as `integer | null` on Soul standard (D schema), V2 standard and image-to-image (vendor samples send it), and at most *warn* on `null` for V2 standard; Cinema `integer` only (D statement, no counter-example). Needs a live probe. |
| 8 | Ads Studio `aspect_ratio` | D: 14 values incl. `3:1`, `1:3` | C: 12 values, without those two | **D** (wider; D is authoritative). Probe to confirm. |
| 9 | Genjutsu vs Genjutsu Light strictness | Genjutsu: `additionalProperties: false` | Light: `additionalProperties: true` | Type each as published; Light must not reject unknown keys. |
| 10 | Unknown keys on Soul routes | no `additionalProperties` declared | D Cinema: "client-supplied style_id is ignored" | Soul routes accept-and-ignore extras. A strict validator there would refuse fulfilled requests. |
| 11 | Soul ID `model_version` | D schema: `v1|v2|cinema`, default `v1` | C2 request schema and C prose table: no `model_version` field at all; S-js `SoulIdCreateData`: `{ name, input_images }` only | **D** (and P's Soul 2 page instructs `model_version: "v2"`). C2/SDK are stale. |
| 12 | Soul ID response fields | D: adds `model_version`, `fail_reason` | C2: `additionalProperties: false` without them | Type both as optional. |
| 13 | Soul ID auth | C2 operations: `hf-api-key` required header | everything else: `Authorization: Key` | Both work per D; document `Authorization`. |
| 14 | Soul ID endpoint | C overview: `https://api.higgsfield.ai/soul-id` | D: "do not POST to /soul-id"; real route `/v1/custom-references` | **D.** |
| 15 | Status enum in the SDK | S-js `V2RequestStatus`: `queued|in_progress|completed|failed|nsfw` — no `canceled`; its poll loop stops only on `completed|nsfw|failed` | D, O, S-js `JobStatus`, S-py `StatusEnum`: six values incl. `canceled` | **Six values.** The JS v2 type is an SDK bug (a canceled request polls until `maxPollTime`). |
| 16 | S-js `V2Response` | `{ status, request_id, status_url, cancel_url, images?, video? }` — all four ids required; no `error`, `audio`, `audios`, `expires_at` | O `RequestStatus`: only `status` + `request_id` required; adds those four | **O/D.** |
| 17 | S-js README result shape | `jobSet.jobs[0].results?.raw.url`, `jobSet.isCompleted` | S-js v2 code returns the raw `V2Response` (`result.images?.[0]?.url`) | README is stale v1 prose; ignore. |
| 18 | Webhook secret | S-js v2 `subscribe({ webhook: { url, secret } })` — code sends only `hf_webhook=<url>` and silently drops `secret` | D: signing secret is account-level (`whsec_`), not per request | **D.** `secret` is a v1 body concept. |
| 19 | Webhook media vs status media | webhook `payload.images[]` items: `{ url, content_type }` | O `MediaOutput`: `{ url }`, `additionalProperties: false` | Different shapes; type separately. |
| 20 | `expires_after` on submit | D `concepts/requests.md`: present | D `quickstart.md`, model pages, O: absent | Optional. |
| 21 | `error` type | O: `string | null` | C `FailedRequestStatus`: `string`, required | `error?: string | null`. |
| 22 | `nsfw` / `canceled` classification | C groups them under `PendingRequestStatus` | D: terminal | **D.** |
| 23 | Genjutsu path spelling | `higgsfield/genjutsu/…` | legacy `higgsfiled/genjutsu/…` still callable; P workflow page uses it | Ship only the correct spelling. |
| 24 | Soul Cinema discoverability | D documents it | C/P: 404 | Real per D; flag access as unverified. |
| 25 | Cinema Studio modality label | P/C: `Category: video2video` | D: "text-to-video when references are absent and reference-to-video when any media array is nonempty"; "produces a new video" | **D.** It is a generation route (`video`), not an edit. |
| 26 | SDK credential env names | S-js: `HF_CREDENTIALS` or `HF_KEY`, else `HF_API_KEY` + `HF_API_SECRET` | S-py: `HF_KEY`, else the same pair; D cURL: `HF_API_KEY_ID` + `HF_API_KEY_SECRET` | Informational only. |
| 27 | Soul V2 `custom_reference_strength: 0` | schema: minimum 0 | D: "the current runtime fails to process it for a character reference" | Schema accepts → validator accepts; candidate for a *warning*, not an error. |
| 28 | Ads Studio completed shape (verified 2026-11-24) | D model page: `images[]` items `{ index, url }` plus top-level `errors[]` | O `MediaOutput` (`additionalProperties: false`, `url` only) and C's Ads Studio output schema: neither `index` nor `errors` | **D.** Response types stay open (extra keys allowed) on the status and on media objects. |
| 29 | AI Influencer price (verified 2026-11-24) | C body + header + P: $0.05 per sheet | the same C file's `## Pricing`: "Public pricing information is not available for this model." | The explicit number, stated three times, wins over a stale generated section. |
| 30 | Soul price field (verified 2026-11-24) | P sentence: $0.0938 / $0.1875 per image | P `price.amount: "0.0313"` (about ⅓ of the 720p figure); C: not public | Never catalog from `price.amount`; see §3. |
| 31 | Marketing Studio enhancement surcharge (verified 2026-11-24) | C 2.0 Alpha: "Enhanced requests cost 10% more than the equivalent direct request" | C Flare/Sunburst: "Direct and enhanced requests use the same token rates, with no separate enhancement surcharge" | Per route as published; neither is catalogable. |
| 32 | 2.0 Alpha `quality` under enhancement (verified 2026-11-24) | D/C schema `then: quality const "high"` — with `quality` omitted (default `high`) the clause passes | D note: "With enhance_prompt=true, quality must be high" | Only an explicit `low`/`medium` with `enhance_prompt: true` is an error. |
| 33 | Insufficient-balance status (verified 2026-11-24) | D errors table and S-js generation client: `403` | both SDKs' Agent API mappers: `402` → not enough credits, `403` → agent access disabled | `403` for generation routes; `402` is Agent-API-only. |
| 34 | `upload_headers` on the upload-URL response (verified 2026-11-24) | D sample: always present | S-py: `response.get('upload_headers') or {'Content-Type': content_type}` | Type it optional. |

---

## 6. Recommended scope for unmodel v1

### 6.1 Addresses (wire-exact validators)

Higgsfield has no `model` body field — the model is the route, as at Krea
(`src/providers/krea/models.ts`: "each id … doubles as the URL segment"). So a
catalog id is the endpoint ID and each address is a view over the ids of one
kind, with the body discriminated by id.

| Address | Models (endpoint IDs) | Wire |
| --- | --- | --- |
| `higgsfield.image` | `higgsfield-ai/soul/standard`, `higgsfield-ai/soul/v2/standard`, `higgsfield-ai/soul/cinema`, `marketing-studio/image`, `marketing-studio/image/flare`, `marketing-studio/image/sunburst` | `POST /<id>`, flat body |
| `higgsfield.imageEdit` | `higgsfield-ai/soul/v2/image-to-image`; the three `marketing-studio/image*` ids with `image_urls` | same |
| `higgsfield.video` | `higgsfield/cinema-studio/4.0` | same |
| `higgsfield.videoEdit` | `higgsfield/genjutsu/{motion-transfer,object-swap,restyle}/v1.0`, `higgsfield/genjutsu-light/{motion-transfer,object-swap}/v1.0` | same |

Naming notes against decisions.md §2:

- Three existing spellings cover "make a video from a finished clip":
  `runway.videoFromVideo`, `luma.videoModify`, `xai.videoEdit`. Genjutsu
  (restyle / swap / re-skin a clip) is closest to `xai.videoEdit`; recommended.
  If the owner prefers the from-what form, `videoFromVideo` is the alternative.
- Marketing Studio on both `image` and `imageEdit` is §4's "a wide surface
  never gets narrower because a modality view exists": the route takes zero or
  more `image_urls`. If two views over one route is unwanted, keep it on
  `image` only and reach references through the wire validator.

Second tier — real, but provider-specific; ship wire-only or defer:

| Candidate | Why it is separate |
| --- | --- |
| Ads Studio (`higgsfield/ads-studio/v1.0`) | A brief → N concepts. Fits `image` mechanically (prompt, aspect ratio, `batch_size` 1–8) and could join the `image` model list wire-only. |
| AI Influencer (`higgsfield/ai-influencer`) | No prompt; `selection` keys come from a live catalog. Wire-only if at all. |
| Soul ID (`POST /v1/custom-references`) | A training job with its own lifecycle and no generation envelope. No uniform verb exists for "train a character reference"; the address needs a name that is not the product name (§2) — owner call. |

### 6.2 Unified packs

| Pack | Higgsfield models | Compiles | Must refuse (typed) |
| --- | --- | --- | --- |
| `unmodel/image` | Soul, Soul V2, Soul Cinema | `prompt`; `aspectRatio` → `aspect_ratio` (seven ratios); `n` → `batch_size`; `seed` → `seed`. Soul's wire `resolution` is `720p`/`1080p`, which is **not** in the image pack's `ResolutionTier` (`"1k" | "2k" | "4k"`, `src/core/unified/vocabulary/common.ts`) — it travels as `providerOptions.higgsfield.resolution`, never mapped from a tier | canonical `resolution` (no defensible 1k/2k/4k ↔ 720p/1080p mapping); `n` other than 1 or 4 (`invalid_enum_value` listing `1, 4`); `seed` outside 1–1000000; `negativePrompt`; `outputFormat`; `outputDelivery`; `size`/`dimensions` (no pixel sizing) |
| | Marketing Studio ×3 | `prompt`; `aspectRatio`; `resolution` → `1k`/`2k`/`4k` (an exact match for `ResolutionTier`) | `n` (no batch field); `seed`; `negativePrompt`; `outputFormat` |
| `unmodel/image-edit` | Soul 2 image-to-image | `prompt`; `image: { url }` → `image_url`; `n` → `batch_size`; `seed`; `aspectRatio` | `image: { file }` / `{ data }` (`imageInputs: ["url"]` — URL only, upload via `/files/generate-upload-url` is the caller's transport); `strength` (no such field); `outputFormat` |
| `unmodel/video` | Cinema Studio 4.0 | `prompt`; `duration` (integer 4–30); `resolution` (`480p`/`720p`); `aspectRatio` (six ratios); `image` with `role: "reference"` → `image_urls[]` | `image` with `role: "first"`/`"last"` (the route has no frame slots — references only); `video` (the pack's `video` means a source clip to transform; here clips are references → `providerOptions.higgsfield.video_urls`); `seed`; `negativePrompt`; `n` |
| `unmodel/upscale`, lipsync, avatar, tts, music, 3d | — | — | Higgsfield has no first-party route in these categories. |

One-provider params stay typed under `providerOptions.higgsfield` (§8, the
two-witness rule): `style_id`, `style_strength`, `custom_reference_id`,
`custom_reference_strength`, `image_reference_url`, `enhance_prompt`,
`preset_id`, `quality`, `moderation`, `generate_audio`, `audio_urls`,
`video_urls`, and the eight Cinema Studio direction enums.

**Genjutsu in the video pack — recommend wire-only for v1.** It would need
`video: { url }` → `video_url` plus reference images → `image_urls`, with
`duration` and `aspectRatio` refused outright and (for Restyle) a required
`providerOptions.higgsfield.preset_id`. Whether the pack already reaches a
video-edit route this way (`xai.videoEdit`, `runway.videoFromVideo`) was not
traced in this stage; follow that precedent if it exists, otherwise leave
Genjutsu on the substrate.

### 6.3 Checks worth encoding (all from published schemas)

- Marketing Studio: `enhance_prompt: true` ⇒ `preset_id` + 1–2 `image_urls`
  (and `quality: "high"` on 2.0 Alpha only).
- AI Influencer: the two `tier` conditionals.
- Cinema Studio: ≤ 30 / 10 / 10 per array, ≤ 50 total; `<<<image_N>>>` /
  `<<<video_N>>>` / `<<<audio_N>>>` tokens must index an attached item of that
  type.
- UUID format on `style_id`, `preset_id`, `custom_reference_id`.
- Not checkable from a body, document only: source duration/size/pixel floors,
  Soul ID readiness and ownership, preset membership.

### 6.4 Response surface

- `checkRequestStatus`-style checker over §7.2's shape: six-value status;
  `failed` and `nsfw` reported as distinct outcomes; `canceled` terminal.
- No usage or cost is ever in a response. The only authoritative number is
  `POST /estimate/<endpoint-id>` — export a URL builder beside the submit URL.
- Webhook verification (`verifyWebhook`, Standard Webhooks) is a clean,
  self-contained follow-up; not required for v1.

### 6.5 Hosted third-party models — owner decision

Roughly 70 of D's 84 entries plus P's newer ones are other vendors' models
behind Higgsfield-specific bodies.

**Include (as atlascloud / revana / fal are):**

- Higgsfield markets itself as a hub ("one API for leading image and video
  models") and prices under fal on its own comparison table; adopters migrating
  from fal are its stated audience.
- Precedent: `atlascloud` (27 curated hosted video models), `revana`, `fal`.
- Machine-readable JSON Schemas exist per route (C `llms.txt`), so a generated
  tier is feasible.

**Exclude for v1 (recommended):**

- `docs/providers.md` coverage is "providers with a public developer API,
  addressed natively"; Kling, ByteDance, Alibaba, MiniMax, Lightricks, PixVerse,
  xAI, Recraft and Ideogram are already native. Krea's catalog header records
  the same call: its proxied third-party routes are "NOT modeled here … Those
  belong to their own providers' catalogs."
- There is **no snapshot source to generate from**: O covers 6 routes and calls
  itself supplementary; the full set exists only as ~90 separate `llms.txt` /
  Mintlify pages, and D and C already disagree on first-party schemas (§5). A
  generated tier needs one committed, refreshable artefact; hand-typing 70
  routes would drift within weeks (roster release dates run to 2026-10-20).
- Hosted bodies are Higgsfield's own shapes, so nothing is reused from the
  native providers — it is 70 new validators, not 70 aliases.
- Pricing for most is "from" cards.

**Middle path if demand appears:** curate a handful on request (owner precedent:
"demand-driven curation beats roster tidiness"), starting with what has no
native home in unmodel — Sand AI MAGI-2 (`/sand/magi-2/text-to-video`,
"USD 0.08/sec", exclusive to Higgsfield) is the one clear candidate. Record the
exclusion of the rest in `docs/providers.md` with this date.

---

## 7. Shapes to type

Wire-shaped names keep Higgsfield's spelling (decisions.md §2).

### 7.1 Submit response

```ts
interface RequestAccepted {
  status: "queued";              // replay may also say "queued" after completion
  request_id: string;            // uuid
  status_url: string;            // https://api.higgsfield.ai/requests/{id}/status
  cancel_url: string;            // https://api.higgsfield.ai/requests/{id}/cancel
  expires_after?: number;        // seconds; not on every documented sample
}
```

### 7.2 Status response (`GET /requests/{id}/status`)

```ts
type RequestStatusValue = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";
interface MediaOutput { url: string; index?: number }   // index: Ads Studio batch slot (verified 2026-11-24)
interface RequestStatus {
  status: RequestStatusValue;
  request_id: string;
  status_url?: string;
  cancel_url?: string;
  error?: string | null;         // on "failed"
  images?: MediaOutput[];        // image models
  video?: MediaOutput;           // video models
  audio?: MediaOutput;
  audios?: MediaOutput[];
  zip?: MediaOutput; mov?: MediaOutput; jsx?: MediaOutput; fbx?: MediaOutput; ply?: MediaOutput;
  expires_at?: string | null;    // ISO date-time, once finished
  errors?: unknown[];            // Ads Studio failed batch slots; item shape not published (verified 2026-11-24)
}
```

### 7.3 Other bodies

```ts
interface DeletedRequest { request_id: string; status: "deleted" }
interface EstimateResponse { usd: string }                       // decimal string
interface UploadUrlResponse { public_url: string; upload_url: string; content_type: string; upload_headers?: Record<string, string> }  // optional: S-py falls back when absent (verified 2026-11-24)
interface WebhookDelivery {
  request_id: string;
  status: "completed" | "failed" | "nsfw";
  error: string | null;
  expires_at?: string;
  payload: null | {
    images?: { url: string; content_type: string }[];
    video?: { url: string; content_type: string };
    audio?: { url: string; content_type: string };
    // zip / mov / jsx / fbx / ply "can also" appear; item shape not published
  };
}
interface ErrorResponse {
  detail:
    | string
    | { loc: (string | number)[]; msg: string; type: string }[]
    | { code: string; message: string; retryable: boolean; limit?: number; retry_after_seconds?: number };
}
interface CustomReference {                                      // Soul ID
  id: string; name: string;
  status: "not_ready" | "queued" | "in_progress" | "completed" | "failed";
  created_at: string;
  thumbnail_url: string | null;
  in_progress_at: string | null;
  model_version?: "v1" | "v2" | "cinema";                        // D only
  fail_reason?: string | null;                                   // D only; type not published
  reference_media?: { id: string; media_url: string }[];        // GET by id only
}
```

---

## 8. Open questions (need a keyed probe or an owner call)

1. `seed: null` on Soul V2 standard / Cinema / image-to-image (§5 #7) — on V2
   standard D's prose and C's own samples contradict each other (verified 2026-11-24).
2. Whether Soul routes reject unknown keys (§5 #10) — decides strict vs
   passthrough objects.
3. Ads Studio `3:1` / `1:3` (§5 #8).
4. Is `higgsfield-ai/soul/cinema` reachable on a self-serve account (§5 #24)?
5. Does Soul 2 image-to-image accept `style_strength` (absent from its schema,
   present on V2 standard)?
6. Soul / Soul 2 prices (verified 2026-11-24): P publishes a per-resolution, per-image
   sentence ($0.0938/$0.1875; $0.0032/$0.0057) while C says no public price
   (§3). Catalog from the P sentence, or keep omitting? `POST /estimate/<id>`
   on a real account would also settle the `batch_size` multiplier — but an
   account-specific estimate is not a public list price. Marketing Studio 2.0
   Alpha has only three sample points and stays uncatalogued either way.
7. Cinema Studio output pixel dimensions per resolution × aspect ratio — the
   only thing missing to make its token formula computable.
8. Genjutsu Restyle's "approximate" rates: omit, or record with a caveat?
9. Address name for Genjutsu (`videoEdit` vs `videoFromVideo`) and for Soul ID.
10. Hosted third-party models: exclude, curate MAGI-2 only, or generate (§6.5).
11. Whether Marketing Studio / Ads Studio (GPT-Image-family behind a Higgsfield
    layer) count as first-party for the roster.
12. Do webhook deliveries fire for `canceled`? The docs list three statuses.
13. Ads Studio `errors[]` item shape, and whether any other batch route
    (`batch_size: 4` on Soul) also returns `index`/`errors` (verified 2026-11-24).

---

## 9. Verification log

Adversarial re-check on 2026-11-24, independent of the first pass. Every source
below was re-fetched raw (curl, no summariser) and diffed against this document;
JSON Schemas were extracted from the pages and compared structurally (D vs C,
and both vs the tables in §2a).

### What was re-fetched

- **D**: `llms.txt`; `openapi.json`; `how-to/{introduction,webhooks,sdk}`;
  `authentication`; `quickstart`; `models`; `api-reference/{overview,headers}`
  and the three `requests/*` pages; `concepts/{requests,polling,errors,
  rate-limits,idempotency,billing-and-retention,file-uploads}`; every
  `enterprise/*` page; `help/faq`; `models/{image-generation,video-generation}`;
  every first-party workflow page (Soul, Soul V2, Soul Cinema, Soul ID, three
  Genjutsu, Cinema Studio 4.0, three Marketing Studio, Ads Studio); all 28
  hosted family index pages (to check §2b's route prefixes);
  `models/seedance-2-5/text-to-video`.
- **C**: `dash.higgsfield.ai/models/<id>/llms.txt` for all 15 first-party ids
  (plus the 404s: `soul/cinema`, `genjutsu-light/restyle`,
  `marketing-studio/video`, `higgsfield-ai/dop/standard`, `higgsfield-ai/speak`,
  the misspelled `higgsfiled/…`); MAGI-2 and Seedream 5.0 Pro (200).
- **C2**: `…/app-models/soul-id/openapi/` and `…/higgsfield-ai/soul/standard/openapi/`
  (200); `…/soul/v2/standard/…` and `…/higgsfield/ai-influencer/…` (404).
- **P**: `/pricing`, `/quick-start`, `/explore`, 14 `/models/<id>/api-reference`
  pages, four `/models/workflows/<id>/playground` pages; `/openapi.json` and
  `/llms.txt` (404).
- **S-js** `@higgsfield/client@0.2.6` tarball and **S-py**
  `higgsfield-client==0.2.0` sdist, read as source (not executed).
- **Live, unauthenticated**: `GET https://api.higgsfield.ai/models/higgsfield/ai-influencer/options`
  (the one documented credential-free endpoint) → 200.
- Repo references: `data/revana/models.json` (six Higgsfield rows and prices),
  `ResolutionTier` in `src/core/unified/vocabulary/common.ts`,
  `revana.verifyWebhook`, the Krea catalog header.

### Confirmed unchanged

Base URL; `Authorization: Key <id>:<secret>` and the legacy `hf-api-key` /
`hf-secret` pair; `Idempotency-Key`, `Hf-Expires-After`, `hf_webhook`; the
submit, status, cancel and delete paths, status codes and bodies; the six-value
status enum on all four sources and the S-js `V2RequestStatus` omission of
`canceled`; O's `RequestStatus` / `MediaOutput` / `DeletedRequest`; C's
three-way `oneOf` with the five artefact keys; the webhook envelope, signing
scheme and retry rules; the three `detail` shapes; the upload-URL flow and
accepted content types; every field name, type, enum, bound, default and
`required` list in the §2a tables for Soul, Soul V2, Soul Cinema, Soul 2
image-to-image, Soul ID, Genjutsu ×3, Genjutsu Light ×2, Cinema Studio 4.0
(all 33 `camera_movement` and 50 `color_palette` values counted), Marketing
Studio ×3 (including the `if/then`), Ads Studio and AI Influencer (including
`TraitVariants`); D = C structurally for Genjutsu, Cinema Studio and Marketing
Studio (titles differ only); the Ads Studio `3:1`/`1:3` D-vs-C gap; the Genjutsu,
Genjutsu Light, Restyle, Cinema Studio and token-rate price quotes, character
for character; the concurrency tiers; O's stale Soul body; §2b's vendor table
and the 84 = 17 + 67 count; the Revana figures.

### What changed

| # | Section | Change |
| --- | --- | --- |
| 1 | §1.4, Ads Studio, §5 #28, §7.2 | **Omission.** Ads Studio's completed status carries `images[].index` and a top-level `errors[]` (partial batches). Added, and the response types opened accordingly. |
| 2 | §3, §5 #30, §8 #6 | **Error.** "No resolution breakdown" for Soul prices was wrong: P publishes $0.0938/$0.1875 (Soul) and $0.0032/$0.0057 (Soul 2) per image by resolution. Quotes added; verdict moved from "omit" to "owner call"; `price.amount` shown to be a base unit (⅓ of the 720p price) for Soul. |
| 3 | §3 | **Omission.** Marketing Studio 2.0 Alpha: three published sample prices and the "10% more" enhancement sentence; Flare/Sunburst say no surcharge (§5 #31). Verdict unchanged (no cost). |
| 4 | §3, §5 #29 | **Attribution.** The AI Influencer $0.05 quote is in C's header and body, while C's own `## Pricing` section says no public price. Verdict unchanged. |
| 5 | §5 #7, §8 #1 | **Error.** C's samples send `seed: null` / `custom_reference_id: null` for Soul V2 **standard** too, not only image-to-image — contradicting D on the same route. Handling changed to accept-and-warn. |
| 6 | §1.6 | **Omission.** `GET /models/usage` (documented, authenticated) added. |
| 7 | §0, §1.6, §5 #33 | **Omission.** Both SDKs ship an Agent API client (`/v1/agent/sessions…`, `/v1/agent/media…`) absent from D/O/C. Recorded as out of scope. |
| 8 | §0 | **Error.** `@higgsfield/client@0.2.6` was published 2026-09-17; 2026-10-06 is the registry `modified` time. |
| 9 | §2, §2b | **Error/omission.** Roster dates run to 2026-11-24, not 2026-10-20; MAGI-2 has three routes and a 1-concurrent limit; MiniMax H3 Highspeed/Lite are on P only. |
| 10 | §2a Genjutsu, Marketing Studio | **Error.** `open.higgsfield.ai/workflows/<id>` is 404; workflow pages are `/models/workflows/<id>/playground`. |
| 11 | §1.2 | **Omission.** Idempotency fingerprint rules (omitted field ≠ explicit default; `null` and array order matter). |
| 12 | §1.5 | **Omission.** `401`/`404` on delete. |
| 13 | §1.6 | **Detail.** Presets `search` 1–100 chars, `cursor` default 0 and offset semantics, nullable `cover_image`; AI Influencer options live-verified with nullability. |
| 14 | §2a | **Omissions.** Soul auto-enhancement of short prompts; Restyle and AI Influencer 64 MiB image limits; Cinema Studio 30-second media budgets; Marketing Studio `auto` aspect-ratio behaviour and Sunburst `system_name`; AI Influencer `if` clauses apply when `tier` is omitted; Ads Studio rejects `auto`. |
| 15 | §5 #32, #34, §7.3 | **Detail.** 2.0 Alpha `quality` clause passes when `quality` is omitted; `upload_headers` typed optional. |

### Not verifiable without a key (unchanged)

Everything in §8. No authenticated request was sent; all generation-body facts
remain published-contract facts.

One first-pass quote could not be re-found: §3's fal comparison sentence
("Comparison is based on prices as of 16 September, 2026") is not in the
server-rendered HTML of https://open.higgsfield.ai/pricing fetched 2026-11-24
(the compare view is client-rendered). Left in place, unconfirmed; nothing in
this document depends on it.

