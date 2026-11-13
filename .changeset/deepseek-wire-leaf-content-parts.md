---
"unmodel": patch
---

deepseek: `deepseek.chat` types DeepSeek's own params and content parts, stops refusing its documented image shapes, and `checkChat` flags interrupted completions

- `thinking`, `user_id`, `safety_check` and `title` are typed on `chat()` and
  on `ChatBody` / `ChatCompletionsBody` from `unmodel/deepseek/types`, and
  validate without an `unknown_param` warning. `thinking: { type: "disabled" }`
  — the fix the forced-`tool_choice` refusal names — now compiles.
  `thinking.type` outside `enabled` / `disabled` and `safety_check.level`
  outside `low` / `high` are refused.
- `reasoning_effort` is typed as DeepSeek's values (`none`, `minimal`, `low`,
  `medium`, `high`, `xhigh`, `max`, `ultra`); a plain `string` no longer
  type-checks there.
- Three documented request shapes that were refused now validate:
  `image_url.detail: "original"`, DeepSeek's flat `file` part
  (`{ type: "file", file_id }` or `{ type: "file", file_data, filename? }`),
  and image parts in tool and system messages.
- A `file` part with neither or both of `file_id` / `file_data` is refused (a
  documented 400), and the message for OpenAI's nested `file: {…}` form says
  where the fields go. An image in a system, user or tool message — an
  `image_url` part, or a `file` part with `file_data` — is refused on
  text-only `deepseek-v4-pro`; a `file_id` part is not, since the id may name
  a document the Files API parsed. The JPEG/PNG/GIF/WebP, 32 MiB and 8192 px
  limits now reach `file_data` images and images in system and tool messages,
  and skip `file_id` parts, which DeepSeek allows up to 64 MiB.
- An `input_audio` part fails as `invalid_shape`: DeepSeek documents no audio
  part.
- `unmodel/deepseek/types` exports DeepSeek's `ChatMessage`,
  `ChatSystemMessage`, `ChatUserMessage`, `ChatToolMessage`,
  `ChatUserContentPart`, `ChatImagePart`, `ChatFilePart` and
  `ChatFinishReason` in place of the dialect's, and no longer exports
  `ChatAudioPart`.
- `response_format: { type: "json_schema" }` warns: DeepSeek documents only
  `text` and `json_object`. The warning names JSON Output and strict function
  tools on the `/beta` base URL.
- `checkChat` warns on `finish_reason` `insufficient_system_resource` and
  `aborted`, with `meta.kind: "interrupted"`; both completions are incomplete.
- `.toSdk("ai-sdk")` maps DeepSeek's parts onto the AI SDK message shape; an
  image in a system or tool message is dropped there with a `dropped_content`
  warning.

`unmodel/openai-compatible`, for providers composed from the dialect's pieces:

- `chatCompletionsChecks(spec, slots)` takes the checks a provider replaces as
  an object, `{ sampling, inputModalities, inlineImages }`, in place of the
  positional `sampling` check.
- `createInlineImagesCheck(spec, imagesOf?)` takes where the body carries
  images (`ChatImageRef[]`); the default is still the `image_url` parts of
  user messages.
- `createChatFinalize` takes an `encode` for `.toSdk("ai-sdk")` and
  cross-dialect `.toApi`.
- `OpenAICompatibleChat` takes the endpoint's body as a fourth type parameter.
- `ChatCompletionsCheck`, `ChatCompletionsCheckSlots` and `ChatImageRef` are
  exported.

Sources, checked 2026-11-13:
https://api-docs.deepseek.com/api/create-chat-completion,
https://api-docs.deepseek.com/guides/vision,
https://api-docs.deepseek.com/guides/document_parsing,
https://api-docs.deepseek.com/guides/tool_calls.
