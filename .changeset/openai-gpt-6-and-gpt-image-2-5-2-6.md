---
"unmodel": patch
---

openai: GPT-6 generation on `openai.chat`, GPT-Image-2.5 / 2.6 on `openai.image` and `openai.imageEdit`, `gpt-image-1` retired (models.dev snapshot 2026-11-12, every rule read off the vendor's pages the same day)

- `openai.chat` and `unmodel/chat` gain `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`,
  `gpt-6.1-sol` and `gpt-6.1-terra`, with the rules their model pages state:
  - `reasoning_effort` is narrowed to each page's own list — `low` … `max` on
    GPT-6 Astra and GPT-6.1 Sol (`none` "returns HTTP 400", `minimal` is not
    listed), `none` … `max` on GPT-6 Sol, Luna and GPT-6.1 Terra (no `minimal`).
  - Tool calling is refused on GPT-6 Astra, GPT-6.1 Sol and GPT-6.1 Terra
    ("Tool calling requires the Responses API.") and accepted on GPT-6 Sol and
    Luna only with `reasoning_effort: "none"`.
  - `logprobs` / `top_logprobs` are refused on GPT-6 Astra ("does not support …
    log probabilities") and accepted on GPT-6 Sol and Luna only at `none`.
  - `temperature` / `top_p` are accepted at `reasoning_effort: "none"` on GPT-6
    Sol, Luna and GPT-6.1 Terra ("When reasoning effort is not `none`, remove
    `temperature`, `top_p`…"); the catalog's fixed-sampling refusal stands at
    every other effort.
  - `prompt_cache_retention` is `24h`-only on `gpt-5.5`, the four `gpt-5.6`
    rows (`gpt-5.6`, `-sol`, `-luna`, `-terra`) and the GPT-6 rows ("For
    `gpt-5.5`, `gpt-5.5-pro`, and future models, only `24h` is supported.").
- `openai.image` and `openai.imageEdit` gain `gpt-image-2.5-sunburst`,
  `gpt-image-2.5-flare` (each with its `-2026-09-08` snapshot),
  `gpt-image-2.6-sunburst` and `gpt-image-2.6-flare` as hand catalog rows
  ($5 text input / $1.25 cached / $30 image output per 1M tokens, the mapping
  the generated `gpt-image-2` row already uses). Both families take the
  `xhigh` and `max` quality levels; 2.5 shares gpt-image-2's free-form `size`
  bounds, 2.6's size is unchecked (no page states its rules). 2.6 adds
  `complexity`, `output_format: "gif" | "svg"`, `frame_count`,
  `frame_duration_ms` and `svg` (author `model` plus `reasoning.effort`
  `none` … `max`, `minimal` included, both levels nullable), with the documented
  pairings enforced (GIF controls only with GIF output; GIF: no streaming,
  partial images, mask or custom compression; SVG: `n` must be 1, no
  streaming, partial images or compression). Edits on 2.5 / 2.6 take `markup`,
  which "Cannot be combined with mask". `unmodel/image` and
  `unmodel/image-edit` list all six.
- Retired: `gpt-image-1` ("GPT Image 1 was shut down on October 23, 2026 and
  is no longer available."). Its wire arms `GptImage1Body` and
  `GptImage1EditBody` are gone; use `gpt-image-2.5-sunburst` or
  `gpt-image-2.5-flare`, the replacements the create reference names.
  `gpt-5.2-chat-latest` and `gpt-5.3-chat-latest` ("Status: Shut down") leave
  the generated catalog and the `unmodel/chat` refs.
- `gpt-daybreak-blue-latest` and `gpt-daybreak-red-latest` (new in models.dev,
  "Chat Completions … Not supported", "Status: Deprecated") join the
  non-chat families: `openai.chat` warns and names POST /v1/responses,
  `unmodel/chat` generates no ref for them.
- The slice also marks `gpt-image-1-mini`, `gpt-image-1.5` and
  `chatgpt-image-latest` deprecated (removal 2026-12-01), so they now validate
  with a `deprecated_model` warning.

Sources: https://developers.openai.com/api/docs/models/gpt-6-astra.md,
…/gpt-6-sol.md, …/gpt-6-luna.md, …/gpt-6.1-sol.md, …/gpt-6.1-terra.md,
https://developers.openai.com/api/docs/guides/latest-model.md,
https://developers.openai.com/api/docs/guides/reasoning.md,
https://developers.openai.com/api/docs/changelog,
https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create.md,
https://developers.openai.com/api/reference/resources/images/methods/generate.md,
https://developers.openai.com/api/reference/resources/images/methods/edit.md,
https://developers.openai.com/api/docs/guides/image-generation.md,
https://developers.openai.com/api/docs/pricing,
https://developers.openai.com/api/docs/models/gpt-image-1.md,
https://developers.openai.com/api/docs/models/gpt-daybreak-blue-latest.md.
