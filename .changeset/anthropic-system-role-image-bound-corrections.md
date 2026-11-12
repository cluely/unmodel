---
"unmodel": patch
---

anthropic: corrections to `anthropic.chat` — mid-conversation `system` messages, the many-image bound, `inference_geo: null`, auth docs (vendor pages read 2026-11-12)

- `messages[].role` accepts `"system"`. A mid-conversation system message is
  a stable, no-beta-header request on Claude Fable 5 / 5.1 / 5.2, Opus 4.8 /
  5 / 5.5, Sonnet 5.5 and Haiku 5.5 (not on Sonnet 5 or earlier, which take
  the top-level `system` only), and the validator refused it as
  `invalid_shape`. It still cannot be `messages[0]` or sit between a
  `tool_use` and its `tool_result`. `.toApi(...)` and `.toSdk("ai-sdk")` drop
  it with a `dropped_content` warning: the other dialects have no such
  message role.
  (platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages)
- Requests with more than 20 images: the per-image bound moves from 2,000 px
  to the documented 3,000 px safe figure, and an image above it is now a
  `media_dimensions_exceeded` **warning**, not an error. The vision docs no
  longer state the exact limit, so a 2,001–3,000 px image the API accepts
  used to validate as an error.
  (platform.claude.com/docs/en/build-with-claude/vision)
- `inference_geo` accepts `null` (the workspace's default geography), as the
  SDK types it; the schema refused it.
- `chat`'s docs no longer claim `x-api-key` is the only auth header: the
  Claude API accepts the key in `x-api-key` or `Authorization: Bearer`, and
  the current SDKs send the latter.
  (platform.claude.com/docs/en/api/migration-2026-10-21)
