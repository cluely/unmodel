---
"unmodel": patch
---

upstage: record the 2026-10-30 retirement of `solar-pro3`, `solar-pro2` and `solar-mini`, and re-source the `solar-mini` `reasoning_effort` deny

- Upstage ended service for `solar-pro3`, `solar-pro2` and `solar-mini` (all
  versions) on 2026-10-30 (KST): "Support ended for `solar-pro3` and all of
  its versions", with the same line for `solar-pro2` and `solar-mini`. Source:
  https://console.upstage.ai/docs/resources/changelog. Move `solar-pro3` and
  `solar-pro2` to `solar-pro4`, and `solar-mini` to `solar-mini4`. Upstage
  answers a retired id with 400 `invalid_request_body` ("a model that is
  invalid or no longer supported",
  https://console.upstage.ai/docs/resources/error-codes). `upstage.chat` still
  validates and prices the three ids, with no `deprecated_model` warning,
  until models.dev marks their rows deprecated.
- The `unsupported_param` error for `reasoning_effort` on `solar-mini` (and
  its dated snapshots) has a new message and `meta.source`. The source is now
  the last capture of Upstage's reference,
  https://web.archive.org/web/20260414103038/https://console.upstage.ai/api/docs/for-agents/raw,
  because the live URL serves a 404 page. That capture says the parameter "is
  ignored" for solar-mini, so the message no longer claims it returned HTTP
  400; it names the retirement and points at `solar-mini4`. Which requests
  are refused is unchanged.
