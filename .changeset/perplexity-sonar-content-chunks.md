---
"unmodel": patch
---

perplexity: `perplexity.chat` accepts the Sonar reference's `file_url` and `pdf_url` chunks and string `image_url`, and refuses `video_url` by modality rather than shape

`perplexity.chat` refused four content-part shapes that the
[Sonar API reference](https://docs.perplexity.ai/api-reference/legacy/sonar-post)
documents, each with a bare `invalid_shape`. The four shapes are
`ChatMessageContentFileChunk`, `ChatMessageContentPDFChunk`,
`ChatMessageContentVideoChunk`, and `ChatMessageContentImageChunk` in its
plain-string form. In each chunk the URL field is "anyOf: URL | string", read
2026-11-12. The [media guide](https://docs.perplexity.ai/docs/legacy/sonar/media)
documents file uploads: "Files can be provided as publicly accessible URLs or
base64 encoded bytes without any prefix."

What changes for `perplexity.chat`:

- User messages now validate these chunks:
  - `{ type: "file_url", file_url: { url } | string, file_name?: string | null }`
  - `{ type: "pdf_url", pdf_url: { url } | string }`
  - `{ type: "image_url", image_url: { url } | string }`
- `{ type: "video_url", video_url: { url, frame_interval?: string | integer } | string }`
  is shape-checked the same way (a fractional `frame_interval` is still
  `invalid_shape`). Whether a model takes video is then the catalog's call, as
  on every OpenAI-compatible overlay, and no sonar row has video input:
  Perplexity's [media guide](https://docs.perplexity.ai/docs/legacy/sonar/media)
  documents no video input (its only video section is `return_videos`, a
  response option; 2026-11-13). A well-formed chunk is therefore refused
  `unsupported_capability` naming the modality, where it was a bare
  `invalid_shape`.
- The shared dialect's `input_audio` and `file` parts still validate as before.
- Only perplexity changes. Every other OpenAI-compatible overlay, and
  `openai.chat`, still refuses string `image_url` and `file_url`.
- `unmodel/perplexity/types`: `ChatBody` is now `PerplexityChatCompletionsBody`,
  the shared dialect with the Sonar chunks in user content, and the new
  `ChatMessageContentImageChunk`, `ChatMessageContentFileChunk`,
  `ChatMessageContentPDFChunk`, `ChatMessageContentVideoChunk`, `VideoURL`,
  `PerplexityUserContentPart`, `PerplexityChatUserMessage` and
  `PerplexityChatMessage` are exported (from `unmodel/perplexity` too).
  `perplexity.chat` is typed with the same body, so the chunks also
  type-check, and every shared-dialect body still satisfies it.
- `.toApi("openrouter" | "vercel")` forwards the chunks unchanged. To check
  them on the gateway, compose the result with that gateway's own validator.

What changes in `unmodel/openai-compatible`:

- `toSdk("ai-sdk")` translates a plain-string `image_url` the same way as the
  object form.
- `toSdk("ai-sdk")` drops a user part that is outside the dialect, such as
  perplexity's `file_url`, with a `dropped_content` warning that names the
  part.
