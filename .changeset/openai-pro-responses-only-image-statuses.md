---
"unmodel": patch
---

openai: the six `-pro` models leave `unmodel/chat`, `safety_identifier` reaches every GPT image model, and `gpt-image-2` and DALL·E carry their deprecation (vendor pages read 2026-11-12/13)

- `gpt-5-pro`, `gpt-5.2-pro`, `gpt-5.4-pro`, `gpt-5.5-pro`, `o1-pro` and
  `o3-pro` are Responses-only. Each model page reads "| Chat Completions |
  `v1/chat/completions` | Not supported |", and the prose agrees: "GPT-5.5 Pro
  is available for Responses API requests", "o3-pro is available in the
  Responses API only". They now behave like the codex and Daybreak families:
  - `unmodel/chat` no longer generates refs for them, so `"openai/o3-pro"` and
    the other five are compile errors.
  - `OpenaiChatModelId` excludes them.
  - `openai.chat` still sends the request but warns `unsupported_capability`,
    naming `POST /v1/responses`. The match is the `-pro` suffix, dated
    snapshots included.

  `openai.chat` now warns on 17 catalog rows.
- `safety_identifier` is typed on every GPT image arm of `openai.image` and
  `openai.imageEdit`, not only GPT-Image-2.6. It is also an extra on every GPT
  row of `unmodel/image` and `unmodel/image-edit`. Both image references
  document it for every model ("A non-empty value takes precedence over the
  deprecated `user` parameter.", `maxLength: 128`) and mark `user` "Deprecated:
  use `safety_identifier` instead." `user` is now flagged `@deprecated` in the
  types.
- A model-less `openai.imageEdit` body is checked against its server default
  ("Defaults to `gpt-image-2.5-sunburst`."), and that includes the default's
  free-form `size` bounds. So `size: "1000x1000"` without a model is refused,
  just as it is with `model: "gpt-image-2.5-sunburst"`.
- `gpt-image-2` and `gpt-image-2-2026-04-21` are now `status: "deprecated"` and
  validate with a `deprecated_model` warning. The deprecations page lists "|
  **Feb 10, 2027** | `gpt-image-2`, `gpt-image-2-2026-04-21` | Deprecated |
  `gpt-image-2.6-sunburst` or `gpt-image-2.6-flare` |". models.dev does not
  carry the status yet, so it is set on the hand image catalog.
- `dall-e-2` and `dall-e-3` are now `status: "deprecated"` too: "Status: Shut
  down" and "DALL·E 3 has been deprecated and removed from the API." on their
  model pages, shut down on May 12, 2026. `deprecated` is the strongest status
  `ModelInfo` has; the rows themselves stay for now.

Sources: https://developers.openai.com/api/docs/models/gpt-5-pro.md,
…/gpt-5.2-pro.md, …/gpt-5.4-pro.md, …/gpt-5.5-pro.md, …/o1-pro.md,
…/o3-pro.md, …/dall-e-2.md, …/dall-e-3.md,
https://developers.openai.com/api/docs/deprecations,
https://developers.openai.com/api/reference/resources/images/methods/generate.md,
https://developers.openai.com/api/reference/resources/images/methods/edit.md.
