---
"unmodel": patch
---

veed: the published enums, response types and provenance now match VEED's 2026-11-12 OpenAPI document (https://api.veed.io/openapi.json)

- `VEED_ERROR_CODES` gains `insufficient_tokens` (third, in the spec's
  `ErrorBody.code` order), so `VeedErrorCode` is nine members.
- `VEED_ERROR_REASONS` gains `api_key_workspace_unavailable`,
  `insufficient_credits`, `model_access_required` and `oauth_token_invalid`
  (`ErrorDetail.reason`, nine members), and `VeedErrorResponse`'s detail
  entries gain the spec's untyped `value`.
- `VEED_JOB_ERROR_CODES` gains `insufficient_credits` — "The balance ran out
  before the job could be paid for" — identical across all five
  `JobError*ErrorCode` schemas, so `VeedJobErrorCode` is eight members.
- `VeedJob` gains `credits_estimated` (on the submit response only, "an
  estimate, not the price") and `credits_charged` (once `COMPLETED`). No cost
  is derived from them: VEED publishes no credits-to-USD conversion.
- New `VEED_MEDIA_EXPIRATION_MAX_SECONDS` (2592000, thirty days) beside the
  default, on `unmodel/veed` and `unmodel/veed/values`. A larger
  `X-Veed-Media-Expiration-Seconds` is capped by VEED, not rejected
  (https://api.veed.io/docs/media-retention).
- Issue `meta.source` on `veed.lipsync`, `veed.avatar` and the
  `unmodel/avatar` resolution refusal now cites the live reference pages
  (https://api.veed.io/docs/api/post-v1-lipsync-2-0,
  https://api.veed.io/docs/api/post-v1-fabric-1-0); the `/models/<id>` pages
  they cited answer 404.
- The `seed` refusals at `veed/lipsync-2.0` and `veed/fabric-1.0` no longer
  count VEED's operations (the document has eighteen, and none has a seed).
- Docs: VEED keys are self-serve from the workspace dashboard
  (https://api.veed.io/docs/quickstart, https://api.veed.io/docs/accounts);
  VEED publishes official SDKs generated from its spec (npm
  `@veedstudio/sdk`, PyPI `veed`, Go `veed-sdk-go`); `lipsync-2.0` takes one
  speaker per clip; submits also answer 402 and polls 404. Rates are
  unchanged — $0.07/sec for `lipsync-2.0`, $0.08/$0.15 per second at
  480p/720p for `fabric-1.0` (https://api.veed.io/pricing).
