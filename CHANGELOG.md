# unmodel

## 0.6.0

### Minor Changes

- e6bafbc: New provider: **Revana** (`unmodel/revana`, `unmodel/revana/types`, `unmodel/revana/unified`, `unmodel/revana/values`) — a router that serves image, video, speech, music and language models from two dozen makers behind one key.

  Thirteen addresses over three routes:
  - `revana.video`, `revana.image`, `revana.tts`, `revana.music` — every media model, on `POST /v1/generations`. One `{ model, input }` body for all of them; `input` is typed per model from Revana's own catalog (`resolution`, `aspect_ratio`, `duration`, `quality`, `voice`, `language_code`, which media fields the model takes).
  - `revana.imageEdit`, `revana.upscale`, `revana.lipsync`, `revana.avatar` — narrower views of the same route, for the models and inputs that make a request an edit, an upscale, a lip-sync or an avatar.
  - `revana.videoQueue`, `revana.imageQueue`, `revana.ttsQueue`, `revana.musicQueue` — the same media models on `POST /v1/queue/revana/{model_id}`, Revana's fal-convention route and the one with completion webhooks. The params are the input fields with no `input` wrapper; `model` and `fal_webhook` are moved into `.request.url`, where that route reads them, and `fal_webhook` is checked against the URL rules the API enforces at submit (public `https:`, port 443, no credentials, no fragment, no IPv6). The per-model rules are the generation route's, plus the two fields the queue reads its own way: `num_images` only as `1`, and `duration` also as fal's `"8"` / `"8s"`.
  - `revana.chat` — the OpenAI-compatible `POST /v1/chat/completions`, with the params the endpoint refuses (`web_search_options`, `prediction`, `audio`, non-text `modalities`, non-function tools) caught before sending. `revana.checkChat` reports the charge the response itself states (`usage.cost_usd`).

  The per-model surface is generated from Revana's keyless model catalog (`bun run codegen:revana`) and refreshed weekly. Every rule is one the API states about the model; refusals that depend on which route is up that day are not turned into errors, and the one that is reported (`negative_prompt`) is a warning.

  Cost estimates are Revana's **listed** price — a lower bound, since a backup route can cost more — and only when the request states what it is priced by. `REVANA_PRICING_CAVEAT` says so; `POST /v1/generations/quote` (`GENERATIONS_QUOTE_URL`) answers the exact figure for free.

  `revana/<model>` is also a ref in eight category packs — `unmodel/video` (69 models), `unmodel/image` (56), `unmodel/image-edit` (46), `unmodel/tts` (4), `unmodel/avatar` (4), `unmodel/lipsync`, `unmodel/upscale` and `unmodel/music` (one each) — with per-model narrowing generated from the same catalog and published on `unmodel/revana/values`:

  ```ts
  import { video } from "unmodel/video";

  video({
    model: "revana/veo-3.1",
    prompt: "A fox walks through snow",
    duration: 8,
    resolution: "4k",
    audio: true,
  });
  // → { model: "veo-3.1", input: { prompt: "…", duration: 8, resolution: "4K", audio: true } }
  ```

  Things to know before reaching for one:
  - Every media reference must be a public `https://` URL. Inline bytes are refused, naming `POST /v1/uploads` (`UPLOADS_URL`).
  - A canonical size tier maps to a model's resolution only when it is the same word (`"4k"` → `"4K"`). Sizes Revana spells its own way (`2K` on a video model, `1MP` on a picture one) go through `providerOptions.revana.input.resolution`.
  - `unmodel/music` needs the `style` or `lyrics` extra at Revana: a prompt alone is not a request its API takes.
  - No Revana model takes `outputFormat`; `unmodel/upscale` takes a still and no `factor`; a speech `dialogue` is `revana.tts`'s, not `unmodel/tts`'s.

  ```ts
  import { videoQueue } from "unmodel/revana";

  const body = videoQueue({
    model: "veo-3.1",
    prompt: "A fox walks through snow",
    duration: 8,
    fal_webhook: "https://your-app.example/revana",
  });
  body.request.url; // "https://api.revana.si/v1/queue/revana/veo-3.1?fal_webhook=https%3A%2F%2Fyour-app.example%2Frevana"
  JSON.stringify(body); // {"prompt":"A fox walks through snow","duration":8}
  ```

  What comes back is typed by its own verdict, and checked:
  - `Generation` is a union on `status`: `output.urls` and a numeric `cost_usd` exist on `"succeeded"`, `error` on `"failed"`. `revana.checkGeneration` reports `status` and the charge the document states.
  - On the queue route a request that failed is `COMPLETED` too. `QueueEnvelope` narrows on `error`, and `revana.checkQueueStatus` reports that outcome as `ERROR`, so `finishReason === "COMPLETED"` means it worked. `QueueResult` is `images`, `video` or `audio`, each arm ruling the others out.
  - `revana.verifyWebhook({ body, headers, secret })` is the receiving end of `fal_webhook`: it checks `Revana-Signature` (HMAC-SHA256, 300-second tolerance, WebCrypto) and returns the delivery typed. It takes the raw body and the account's signing secret — not the API key — and tells a forgery (`authentic: false`) from a genuine delivery it does not recognise.

  ```ts
  import { verifyWebhook } from "unmodel/revana";

  // POST https://your-app.example/revana
  const verdict = await verifyWebhook({
    body: await request.text(),
    headers: request.headers,
    secret,
  });
  if (!verdict.authentic) return new Response(verdict.message, { status: 400 });
  if (verdict.ok && verdict.delivery.status === "OK")
    save(verdict.delivery.request_id, verdict.delivery.payload);
  return new Response(null, { status: 204 });
  ```

  Also exported: `generationUrl(id)` / `generationContentUrl(id, n)` for polling and download; `queueUrl`, `queueStatusUrl`, `queueResultUrl` and `WEBHOOKS_SECRET_URL` for the queue route, with its `QueueEnvelope`, `QueueResult` and `QueueWebhookDelivery` types and the two signature header names; the `Generation` / `Quote` response types and the `RevanaErrorCode` union; the shape and price tables; and `REVANA_VOICES`.

- e6bafbc: Register Revana in `unmodel/chat`, including model refs, discovery profiles, authentication metadata, and its OpenAI-compatible endpoint. Shared chat calls compile to the existing Revana validator.

### Patch Changes

- ef3a622: alibaba: wan3.0 takes 21:9 and is priced, HappyHorse 1.1 takes 480P, and the Qwen-Audio-TTS refusal names its HTTP route

  Corrections read off Alibaba Cloud Model Studio's international docs on
  2026-11-12:
  - `wan3.0-video` and `wan3.0-video-prime` accept `parameters.ratio: "21:9"`
    (and `aspectRatio: "21:9"` through `unmodel/video`), which `alibaba.video`
    refused. The wan3 reference lists "adaptive (Default value) … 21:9 | 16:9 |
    4:3 | 1:1 | 3:4 | 9:16". `WAN3_RATIOS` is exported from
    `unmodel/alibaba/values` beside `WAN_RATIOS`.
  - `wan3.0-video` now has a cost: the Singapore pricing table lists
    "480P | List price $0.05/second … 720P | List price $0.1/second … 1080P |
    List price $0.2/second". Estimates use the list price; the table's
    "(Limited-time 30% off)" promotion is not reflected, so they read high
    while it runs. `cost.perVideoSecond` is 0.2 (the 1080P default).
  - `happyhorse-1.1-t2v`, `happyhorse-1.1-i2v` and `happyhorse-1.1-r2v` accept
    `resolution: "480P"` (`"480p"` through `unmodel/video`), which was refused:
    the references list "480P, 720P, and 1080P", and the pricing page prices
    480P at $0.07/second on all three. The 1.0 generation keeps 720P/1080P (the
    pricing page has no 480P row for it).
  - `alibaba.tts` still refuses `qwen-audio-3.0-tts-plus` and
    `qwen-audio-3.0-tts-flash` (the multimodal-generation route cannot serve
    them), but the message now names the HTTP route that does — POST
    `/api/v1/services/audio/tts/SpeechSynthesizer` — besides the realtime
    WebSocket. `SPEECH_SYNTHESIZER_PATH` and `SPEECH_SYNTHESIZER_TTS_MODEL_IDS`
    are exported from `unmodel/alibaba`.

  Sources: https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference,
  https://www.alibabacloud.com/help/en/model-studio/model-pricing,
  https://www.alibabacloud.com/help/en/model-studio/happyhorse-text-to-video-api-reference,
  https://www.alibabacloud.com/help/en/model-studio/happyhorse-image-to-video-api-reference,
  https://www.alibabacloud.com/help/en/model-studio/happyhorse-reference-to-video-api-reference,
  https://www.alibabacloud.com/help/en/model-studio/qwen-audio-tts-http-api.

- cf0e0ab: alibaba: models.dev refresh (2026-11-12), wan3.0-video-prime + wan2.7-r2v, and the Kimi / Qwen3.8 chat rules

  Every fact below was read off Alibaba Cloud Model Studio's international docs
  on 2026-11-12.

  CATALOG (`alibaba.chat`, generated from models.dev)
  - New rows: `kimi-k3`, `qwen3.5-flash`, `qwen3.7-flash` and
    `qwen3.8-omni-flash`, so they validate without an `unknown_model` warning
    and price from their rows. `qwen3.7-flash` prices at its ≤32K tier only (the
    generated catalog carries no context tiers yet), so above 32K input tokens
    its estimate is low.
  - Repriced or re-limited rows follow the snapshot, e.g. `qwen3.7-plus`
    ($0.4 / $1.6, output 131,072), `qwen3.6-flash`, `qwen-vl-ocr`
    ($0.07 / $0.16) and `deepseek-v4-flash-0731` (the busy-hours rate,
    $0.44 / $1.32).
  - `qwen2-5-14b-instruct`, `qwen2-5-32b-instruct`, `qwen2-5-72b-instruct`,
    `qwen2-5-7b-instruct`, `qwen2-5-vl-72b-instruct` and
    `qwen2-5-vl-7b-instruct` left the catalog: Model Studio decommissioned the
    Qwen2.5 open-source snapshots on 2026-05-13 ("Applications and services that
    continue to call the decommissioned models will fail to return results").
    Use the Qwen3.6 series. Requests naming them still validate, with an
    `unknown_model` warning and no cost estimate.
  - Several older rows now carry `status: "deprecated"` (the six ids retired on
    2026-10-10 among them: `qwen2-5-omni-7b`, `qwen-omni-turbo`,
    `qwen-omni-turbo-realtime`, `qwen3-omni-flash-realtime`, `qwen-mt-turbo`,
    `qwen3-livetranslate-flash-realtime`), so requests naming them draw a
    `deprecated_model` warning.

  CHAT RULES (`alibaba.chat`)
  - `kimi-k3`: `reasoning_effort` must be `max`, `high` or `low` (the Chat
    Completions reference lists no mapped values for it); `parallel_tool_calls`
    draws an `unsupported_param` warning, never an error ("kimi-k3 does not
    support using this parameter to control whether tool calls are parallel").
    `top_p` accepts its documented default 0.95 (and 1); other values are
    refused. `temperature` stays at 1 only, per its catalog row.
  - `kimi-k3.1-pro` (no catalog row yet): `temperature` 1, `top_p` 0.95 and
    `presence_penalty` 0 only ("Passing a non-default value for any of these
    parameters returns an error"), and `reasoning_effort` `max` / `high` /
    `medium` / `low`.
  - `qwen3.8-omni-flash`, `qwen3.8-max`, `qwen3.8-max-0902`, `qwen3.8-flash`,
    `qwen3.8-2.4t-a95b` and `qwen3.8-27b`: `reasoning_effort` must be one of
    `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, and sending it
    together with DashScope's `thinking_budget` is refused ("Setting both will
    cause an error").
  - `qwen3.8-omni-flash` with `response_format: { type: "json_schema" }` now
    draws an `unsupported_capability` warning: the model offers JSON Mode only
    ("Qwen3.8-Omni-Flash does not support JSON Schema mode").

  VIDEO (`alibaba.video`, `unmodel/video`)
  - `wan3.0-video-prime`, the high-speed wan3.0 tier, takes the wan3.0-video
    request surface and prices at $0.068 / $0.14 / $0.28 per second for
    480P / 720P / 1080P.
  - `wan2.7-r2v` and `wan2.7-r2v-2026-06-12` (reference-to-video): 1–5 reference
    images and videos combined plus an optional `first_frame`, an optional
    `reference_voice` audio URL on a `reference_image` or `reference_video`
    entry (refused on any other entry, and on every other model, since no
    other route documents it), `resolution` 720P/1080P,
    `ratio`, and `duration` 2–15 seconds (2–10 when a reference video is sent);
    $0.10 / $0.15 per second at 720P / 1080P. Through `unmodel/video`, reference
    images and `video` compile to `reference_image` / `reference_video` media.
    `WAN27_R2V_VIDEO_DURATIONS` and `WAN27_R2V_MAX_REFERENCES` are exported from
    `unmodel/alibaba`.

  Sources: https://www.alibabacloud.com/help/en/model-studio/model-pricing,
  https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions,
  https://www.alibabacloud.com/help/en/model-studio/kimi-api,
  https://www.alibabacloud.com/help/en/model-studio/qwen-omni,
  https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference,
  https://www.alibabacloud.com/help/en/model-studio/wan-video-to-video-api-reference,
  https://www.alibabacloud.com/en/notice/model_studio_notice_on_the_decommissioning_of_selected_historical_snapshot_models_730.

- 5570822: alibaba: retire the Qwen3-TTS snapshots and the Instruct-Flash models

  Model Studio retired these TTS ids on 2026-10-10 ("Upon retirement, these
  models will no longer support inference, and any applications or services
  continuing to call them will fail to receive responses"), and the
  international Qwen3-TTS model list is now `qwen3-tts-flash` alone. They are
  removed from `alibaba.tts`, the `unmodel/tts` adapter and the hand catalog:
  - `qwen3-tts-flash-2025-11-27` and `qwen3-tts-flash-2025-09-18` → use
    `qwen3-tts-flash` (the notice names `cosyvoice-v3.5-plus` as the
    replacement; the qwen-tts page lists that model for China (Beijing) only).
  - `qwen3-tts-instruct-flash` and `qwen3-tts-instruct-flash-2026-01-26` → use
    `qwen3-tts-flash` (notice replacement: `cosyvoice-v3.5-plus`).
  - `qwen3-tts-instruct-flash-realtime` (WebSocket-only catalog row) → use
    `qwen3-tts-flash-realtime` (notice replacement:
    `qwen3.5-omni-plus-realtime`).

  Requests naming a retired id now fail `alibaba.tts`'s model gate
  (`invalid_enum_value`, naming `qwen3-tts-flash`).

  The Instruct-only wire fields go with them: `input.instructions` and
  `input.optimize_instructions` are no longer part of `TtsGenerationParams`
  (the qwen-tts-api reference documents neither), and the `unmodel/tts` rows no
  longer offer them as extras.

  Removed exports (`unmodel/alibaba`, `unmodel/alibaba/values`):
  `INSTRUCTIONS_MAX_TOKENS`, `TTS_INSTRUCT_PER_MILLION_CHARACTERS`,
  `QWEN3_TTS_FLASH_2025_09_18_VOICES`, `QWEN3_TTS_INSTRUCT_FLASH_VOICES`.

  Sources: https://www.alibabacloud.com/en/notice/model_studio_notice_of_retirement_for_selected_legacy_models_7d9,
  https://www.alibabacloud.com/help/en/model-studio/qwen-tts,
  https://www.alibabacloud.com/help/en/model-studio/qwen-tts-api,
  https://www.alibabacloud.com/help/en/model-studio/realtime-tts-user-guide.

- 60a0728: amazon-bedrock: the 2026-11-12 models.dev refresh lands in `unmodel/amazon-bedrock`, adding Claude Fable 5.2, Opus 5.5, Sonnet 5.5 and Haiku 5.5, GPT-6 and Grok 4.7 among 85 new model and inference-profile ids, plus the two rules the new Claude ids need
  - 85 new catalog ids validate and price through `createAmazonBedrock({ region }).chat` and `checkChat`:
    - `anthropic.claude-fable-5-2`, `anthropic.claude-opus-5-5`, `anthropic.claude-sonnet-5-5` and `anthropic.claude-haiku-5-5`, each with the profiles models.dev lists (geo profiles cost 10% more than the global row):
      - Fable 5.2: `us.` / `global.`
      - Opus 5.5: `us.` / `eu.` / `au.` / `jp.` / `global.`
      - Sonnet 5.5: `us.` / `eu.` / `au.` / `global.`
      - Haiku 5.5: `us.` / `eu.` / `au.` / `jp.` / `global.`. AWS also serves `ca.anthropic.claude-haiku-5-5` (docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html, checked 2026-11-12), which models.dev does not list yet. It validates with an `unknown_model` warning and gets no `costUSD`.
    - `openai.gpt-6-astra` / `-sol` / `-luna` and `openai.gpt-6.1-sol` / `-terra`
    - `us.` / `global.xai.grok-4.7`, `global.moonshotai.kimi-k3.1`, `global.zai.glm-5.3` and `google.gemma-4-*`
    - the `us.` / `eu.` / `apac.` / `jp.` / `ca.` Nova profiles
  - 108 existing rows change with the snapshot. For example:
    - Nova Lite / Micro / Pro output rises from 8,192 to 10,000 tokens, and they gain cache-write rates.
    - Nova 2 Lite gets a 1M-token context.
    - `au.anthropic.claude-opus-4-6-v1` drops from $16.50 / $82.50 to $5.50 / $27.50.
    - `anthropic.claude-sonnet-4-6` output rises from 64K to 128K.
    - Some limits narrow. `google.gemma-3-27b-it`, `google.gemma-3-4b-it` and `deepseek.r1-v1:0` (and its `us.` profile) now carry `toolCall: false`, so `toolConfig` on them is `unsupported_capability`. Llama 4 Maverick / Scout output drops from 16,384 to 8,192.
  - 33 existing rows become `status: "deprecated"`: `anthropic.claude-sonnet-4-5-20250929-v1:0` and its five profiles, plus Llama 3.x / 4, Gemma 3, DeepSeek R1 / V3, MiniMax M2 / M2.1, GLM 4.7, Qwen3 Coder, Voxtral, Nemotron Nano v2, Palmyra X4 / X5, Devstral 2 and Kimi K2 Thinking. 10 of the new profile ids also arrive deprecated: the `apac.` / `eu.` / `global.` / `us.` profiles of `anthropic.claude-sonnet-4-20250514-v1:0`, `us.amazon.nova-premier-v1:0`, and the `us.` Llama 3.x and Palmyra X4 / X5 profiles. All of them are still served, so they still validate and warn `deprecated_model`.
  - Claude Fable 5.2, Fable 5.1, Opus 5.5 and Sonnet 5.5, and every inference profile of them, refuse forced tool choice: `toolConfig.toolChoice` `any` or `tool` is `unsupported_param`. Send `{ auto: {} }` or omit `toolChoice`. The Opus 5.5 and Sonnet 5.5 Bedrock model cards say: "Client-side tool calling ( tool_choice types auto and none only)" (docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5-5.html and …-sonnet-5-5.html). The Fable cards are silent, but Bedrock's Claude tool-use guide says: "Claude Fable 5.2, Claude Mythos 5.2, Claude Opus 5.5, Claude Fable 5.1, and Claude Mythos 5.1 do not support forced tool use. … In the Converse API, the equivalent `toolChoice` settings (`tool` and `any`) surface the same error." (docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages-tool-use.html#model-parameters-anthropic-claude-forced-tool-use)
  - Claude Haiku 5.5 is priced by prompt length, and its catalog rows carry only the rates for prompts up to 100,000 tokens. Above that, `chat(...).estimate.costUSD` and `checkChat(...).costUSD` are omitted rather than stated at the lower rate, which would be 5x too low. The prompt counts input, cache reads and cache writes. The models.dev Bedrock rows carry the tier (`"tier": { "size": 100000, "type": "context" }`), and Anthropic's pricing page states it: "Claude Haiku 5.5 is priced by prompt length: a request whose prompt is over 100,000 tokens pays higher prices." (platform.claude.com/docs/en/about-claude/pricing)

- 3548878: amazon-bedrock: Fable 5.2 / 5.1 fixed sampling, GPT-6 Converse content and long-context cost rules, and Grok 4.7's real context window

  `unmodel/amazon-bedrock`'s `chat` now enforces three more Bedrock model-card rules and corrects one catalog limit. Every rule covers the foundation id and each of its inference profiles.
  - **Claude Fable 5.2 and Fable 5.1 have fixed sampling.** These now return `unsupported_param`:
    - `inferenceConfig.temperature` other than `1`
    - `inferenceConfig.topP` below `0.99`

    Two more cases validate with an `unsupported_param` warning instead: `topP` above `0.99`, and `temperature` sent together with `topP`. The card rules out both, but the Anthropic SDK documents `top_p` >= 0.99 as accepted, so neither is refused until a live request settles which source is right. Both cards say: "Sampling parameters: temperature must be 1.0 or unset; top_p must be 0.99 or unset; temperature and top_p cannot be specified together; top_k is not supported" (docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-fable-5-2.html and …-fable-5-1.html). Fable 5 states a different rule and is unchanged.

  - **GPT-6 Astra / Sol / Luna and GPT-6.1 Sol / Terra refuse two Converse content shapes** with `unsupported_capability`:
    - a `document` content block, at any depth
    - an `image` block inside a `toolResult`

    Each card says: "This model doesn't accept `document` content blocks, and it doesn't accept an `image` content block inside a `toolResult`. A request that includes either is rejected with a `ValidationException`. To send a document to this model, use the Responses API with an `input_file` content part instead." (docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-sol.html and its siblings). Top-level images in user messages still validate.

  - **GPT-6, GPT-6.1 and GPT-5.6 withhold cost above 272,000 prompt tokens.** Above that size, `chat(...).estimate.costUSD` and `checkChat(...).costUSD` are omitted, as they already are for Claude Haiku 5.5 above 100,000. The catalog rows carry only the short-context rates, and the long-context rates are up to twice as high. The prompt counts input, cache reads and cache writes. The models.dev Bedrock rows carry the tier (`"tier": { "size": 272000, "type": "context" }`), and the GPT-6 Sol card says: "Long-context rates apply to the full request when input exceeds 272,000 tokens."
  - **Grok 4.7 (`us.` / `global.xai.grok-4.7`) gets its card's 524,288-token context and output limit.** The catalog row carries models.dev's 500,000, which refused prompts and `maxTokens` between 500,001 and 524,288 with `over_context` / `over_output_limit` although Bedrock accepts them. The card says: "Context window: 524,288 tokens, shared between input and output" and "Max output tokens: 524,288 minus input tokens" (docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-7.html). The exported `models` table still carries the generated 500,000 until models.dev does. Grok 4.6's card says 500K, so it is unchanged.

  Cards checked 2026-11-12 and 2026-11-13.

- 88e87fb: anthropic: Claude Fable 5.2, Opus 5.5, Sonnet 5.5 and Haiku 5.5 land in `unmodel/anthropic` with the per-model rules they need (models.dev refresh and vendor pages read 2026-11-12)
  - Catalog rows for `claude-fable-5-2` ($8 / $40 per MTok, cache read $0.20,
    5m cache write $10), `claude-opus-5-5` ($4 / $20, cache read $0.20, write
    $5), `claude-sonnet-5-5` ($2 / $10, cache read $0.10 — half Sonnet 5's —
    write $2.50) and `claude-haiku-5-5` ($0.10 / $0.50, cache read $0.01, write
    $0.125, for prompts up to 100,000 tokens). All four: 1M context, 128K output,
    text + image + PDF in, sampling removed. `claude-sonnet-4-5` and
    `claude-sonnet-4-5-20250929` now carry `status: "deprecated"` (retirement
    2026-11-30, replacement `claude-sonnet-5-5`) and their real 200K context, so
    the per-request image cap on them is 100.
  - Haiku 5.5 is priced by prompt length and the catalog row carries only the
    rates for prompts up to 100,000 tokens, so `chat(...).estimate.costUSD` and
    `checkChat(...).costUSD` are omitted — never stated at the sub-threshold
    rate, which is 5x too low — once the prompt (input + cache reads + cache
    writes) exceeds 100,000 tokens.
    (platform.claude.com/docs/en/about-claude/pricing)
  - The four new ids join the Claude 4.7+ generation: `top_k` is refused at any
    value, `temperature` other than 1 and `top_p` below 0.99 are refused, and
    images estimate at the high-resolution tier (4784 tokens per image).
  - Forced tool use (`tool_choice` `any` / `tool`) is refused on
    `claude-fable-5-2`, `claude-opus-5-5` and `claude-sonnet-5-5`; Haiku 5.5
    keeps it. (platform.claude.com/docs/en/api/errors)
  - Thinking rules, each with its compile-time arm on `anthropic.chat`:
    - `thinking: {type: "disabled"}` is refused at every effort on
      `claude-opus-5-5` and `claude-fable-5-2` (adaptive thinking is always on).
      `claude-opus-5-5` is no longer treated as a snapshot of `claude-opus-5`,
      so it gets this rule rather than Opus 5's effort cap: a snapshot is now
      `<id>-YYYYMMDD` only.
    - `claude-sonnet-5-5` refuses `disabled` and takes
      `thinking: {type: "between_tools"}` instead — a new wire value (it was
      `invalid_shape` before) accepted at `output_config.effort` high or below,
      refused at `xhigh` / `max`, refused with any extra field, and refused on
      every other catalog model.
    - `claude-haiku-5-5` accepts `disabled` at effort high or below and refuses
      it at `xhigh` / `max`, as Opus 5 does.
    - `thinking: {type: "enabled", budget_tokens}` (manual extended thinking) is
      refused on every Claude 4.7+ id: the four new ones and `claude-opus-4-7`,
      `claude-opus-4-8`, `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`,
      `claude-fable-5-1`. (errors page: "Claude 4.7 and later models don't
      support extended thinking")
  - A trailing assistant message (response prefill) is refused on Claude 4.6 and
    later whether or not thinking is on; earlier models keep the thinking-scoped
    rule.
  - `tools[].type` `computer_20251124` and `computer_20250124` are refused on
    the four new ids on the Claude API; the message names
    `computer_toolset_20260801` as what they accept.
  - `speed?: "standard" | "fast" | null` joins `MessagesBody` (fast mode).
    `"fast"` validates on `claude-fable-5-2` and `claude-opus-5-5` (GA), on
    `claude-opus-5` and `claude-opus-4-8` with the `fast-mode-2026-02-01` beta
    header you add yourself, is a warning on `claude-opus-4-6` (it runs at
    standard speed) and is refused on every other catalog model. `checkChat`
    reads `usage.speed` and omits `costUSD` for fast-mode responses, whose
    premium rates are not in the catalog.
    (platform.claude.com/docs/en/build-with-claude/fast-mode)

- f1ac865: anthropic: unified `reasoning` compiles per Claude model, and `adaptive` is refused on Claude 4.5 (vendor pages read 2026-11-12)
  - `unmodel/chat`: `reasoning: "off"` (or `false`) on `anthropic/claude-sonnet-5-5`
    was refused, because it compiled to `thinking: {type: "disabled"}`, which
    that model rejects. It now compiles to `thinking: {type: "between_tools"}`,
    the model's lowest setting, with an `approximated_param` warning: there is
    no up-front thinking, but the progress updates between tool calls still
    come back as thinking blocks. Other models are unchanged: `disabled` where
    they accept it, and still refused on models where thinking is always on
    (`claude-opus-5-5`, `claude-fable-5*`).
    (platform.claude.com/docs/en/build-with-claude/thinking)
  - `unmodel/chat`: a `reasoning` with `budgetTokens` on Claude 4.7 and later
    was refused, because it compiled to `thinking.type "enabled"`. That
    includes the portable `{ effort, budgetTokens }` form. These models have no
    token budget. A request now compiles to `thinking: {type: "adaptive"}` plus
    `output_config.effort`, the vendor's documented migration:
    - With `{ effort, budgetTokens }`, the effort you gave is sent. No warning:
      nothing was approximated.
    - With a bare `{ budgetTokens }`, the budget becomes an effort bucket, with
      an `approximated_param` warning: up to 2,048 tokens is `low`, up to 8,192
      is `medium`, anything above is `high`. These are the buckets the
      chat-completions codec already used.

    `adaptive` is always sent explicitly, because Claude Opus 4.7 and 4.8 run
    with thinking off when `thinking` is absent. Models that still take a
    budget (Claude 4.6 and earlier) compile to `enabled` as before.
    (platform.claude.com/docs/en/build-with-claude/extended-thinking,
    "Migrating to adaptive thinking")

  - `anthropic.chat`: `thinking: {type: "adaptive"}` is refused on
    `claude-opus-4-5`, `claude-sonnet-4-5` and `claude-haiku-4-5` (and their
    dated snapshots), both at run time and in the type of `thinking`. The API
    returns a 400 there: "Models that support only extended thinking (Claude
    4.5 and earlier models) reject `thinking: {"type": "adaptive"}`". The
    refusal names `thinking: {type: "enabled", budget_tokens: N}`. The
    `between_tools` refusal on these models no longer suggests `adaptive`.
    (platform.claude.com/docs/en/api/errors)

- 50bd44f: anthropic: corrections to `anthropic.chat` — mid-conversation `system` messages, the many-image bound, `inference_geo: null`, auth docs (vendor pages read 2026-11-12)
  - `messages[].role` accepts `"system"`. A mid-conversation system message is
    a stable, no-beta-header request on Claude Fable 5 / 5.1 / 5.2, Opus 4.8 /
    5 / 5.5, Sonnet 5.5 and Haiku 5.5 (not on Sonnet 5 or earlier, which take
    the top-level `system` only), and the validator refused it as
    `invalid_shape`. It still cannot be `messages[0]` or sit between a
    `tool_use` and its `tool_result`. `.toApi(...)` and `.toSdk("ai-sdk")` move
    its text to the end of the top-level system prompt with an
    `approximated_param` warning: translation carries system text in one
    leading slot, so the instruction applies from the start of the
    conversation there. Non-text blocks (`tool_addition`, `tool_removal`) are
    dropped with `dropped_content`.
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

- 78568c4: assemblyai: retire `universal-3-pro`, replaced by `universal-3-5-pro`
  - `universal-3-pro` has left the `assemblyai` catalog,
    `unmodel/assemblyai/values` (`STT_MODELS`, `STT_MODEL_PARAMS`) and the typed
    `unmodel/stt` refs. AssemblyAI retired it. Its changelog
    (https://www.assemblyai.com/changelog, checked 2026-11-12) says requests
    pinning it "return an error: The universal-3-pro speech model(s) have been
    deprecated. Use speech_models: ["universal-3-5-pro", "universal-2"]
    instead." The 2026-08-01 update moved the cut-over to September 2, 2026.
    The submit reference now lists "Supported values: `universal-3-5-pro`,
    `universal-2`."
  - **Replacement: `universal-3-5-pro`** ($0.21/hr pre-recorded). A request
    that still names `universal-3-pro` validates with an `unknown_model`
    warning and no cost estimate, and AssemblyAI will refuse it.
  - `slam-1` stays in the catalog as `deprecated`, but its row now cites
    AssemblyAI's current model reference
    (https://www.assemblyai.com/llms/models.md: "| `slam-1` | Deprecated |
    `universal-3-5-pro` (+ Medical Mode for medical use cases) |"). The old
    citation named the retired model as its migration target.

- 2dbd4cf: assemblyai: `assemblyai.stt` stops refusing requests the API accepts, and `checkTranscript` prices the model that actually ran

  Every fact below was checked against AssemblyAI's live docs on 2026-11-12.

  FALSE REFUSALS FIXED
  - `domain: "veterinary-v1"` (Veterinary Mode, beta) now validates.
    `ASSEMBLYAI_DOMAINS` and the `AssemblyaiDomain` type are now
    `"medical-v1" | "veterinary-v1"`. The submit reference
    (https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/submit)
    types the field "enum: - medical-v1 - veterinary-v1 - null".
  - `language_codes` without `"en"` is now refused only on a routing that can
    land only on `universal-2`. The code-switching guide
    (https://www.assemblyai.com/docs/pre-recorded-audio/code-switching) says
    "On Universal-3.5 Pro, `language_codes` accepts any number of languages, and
    English is **not** required" and "These two-code, English-required limits
    apply to Universal-2 only." The following now validate:
    `language_codes: ["es", "fr"]` on the default routing or on
    `universal-3-5-pro`, and the unified `languages: ["es", "fr"]` on
    `assemblyai/universal-3-5-pro`. The submit reference still carries the older
    "One of the values specified must be `en`." line; the guide and the
    2026-09-11 changelog entry are newer.
  - `speech_threshold: null` validates. The request schema types it
    `[number, null]`.
  - `speaker_options.include_speaker_confidence` (boolean) and
    `language_detection_options.on_no_speech_detected` (`"error" | "fallback"`)
    are now typed fields. Both are in the request schema, and a typed object
    literal that used either of them alone used to be a compile error.

  COST
  - `checkTranscript` now prices from `speech_model_used` ("The speech model
    that was actually used for the transcription."). It falls back to
    `speech_model`, which is a deprecated request echo that is `null` on
    `speech_models`-pinned requests. Before this change, `costUSD` was
    `undefined` for exactly those transcripts. `TranscriptResponseLike` gains
    `speech_model_used`.

  DOCS AND PROVENANCE
  - JSDoc on `speech_model` now says that a current model name there returns a
    400 ("Passing a current model name ( universal-2 , universal-3-5-pro ) to the
    async speech_model field now returns a 400."). Pin a model with
    `speech_models` instead.
  - JSDoc on `summarization` / `auto_chapters` now quotes the changelog
    ("Starting October 20, 2026, requests using them will return errors.") and
    names `speech_understanding.request` as the replacement. So does the
    Universal-2-only refusal message.
  - Issue `meta.source` links now point at the canonical
    `docs/pre-recorded-audio/api-reference/transcripts/{submit,get}` pages. The
    old paths 308-redirect there.
  - The AssemblyAI catalog header now records that streaming has ids of its own
    (`universal-3-6-pro` is the default, plus `universal-3-5-pro` and
    `universal-streaming-english/multilingual`). None of them is a
    `/v2/transcript` id. The two pre-recorded rates are unchanged ($0.21/hr
    Universal-3.5 Pro, $0.15/hr Universal-2).

- 6e5a898: assemblyai: `assemblyai.stt` refuses three requests AssemblyAI answers with an error

  These requests used to validate clean. Every fact below was checked against
  AssemblyAI's live docs on 2026-11-12.

  FALSE ACCEPTS FIXED
  - `summarization: true`, `auto_chapters: true` and a non-null `summary_model`
    are now refused (`unsupported_param`) on every routing, universal-2
    included. The changelog's 2026-10-06 entry
    (https://www.assemblyai.com/changelog) says: "The legacy Summarization
    model (the top-level `summarization` boolean and `summary_model` parameter)
    and the legacy Auto Chapters model are deprecated. Starting October 20,
    2026, requests using them will return errors." The model reference
    (https://www.assemblyai.com/llms/models.md, last updated 2026-11-10) says
    "the top-level `summarization` and `auto_chapters` options return errors
    since October 20, 2026".
    - **Replacement:** `speech_understanding.request.summarization`. The model
      reference adds that `summary_type: "paragraph"` "gives chapter-style
      sections".
    - These still validate: `false` / `null` values (the submit reference's own
      example sends them), and `summary_type` on its own, which neither source
      names.
    - In `unmodel/stt`, `summarization`, `summary_model`, `summary_type` and
      `auto_chapters` are no longer extras on `assemblyai/universal-2`, so they
      are now a compile error there. `providerOptions.assemblyai` still reaches
      the wire, where the provider validator refuses them.
    - The old pairing refusals for these params ("requires automatic
      punctuation", "cannot be combined with `summarization`") are gone. The
      retirement refusal is reported in their place, so their advice no longer
      points at a request that still errors.
  - `speech_model: "universal-3-5-pro"` or `"universal-2"` is now refused with
    `invalid_enum_value`. The message names the fix:
    `speech_models: ["<id>"]`. The errors page
    (https://www.assemblyai.com/docs/errors) lists "`400` when a current model
    name is sent in `speech_model` | The singular `speech_model` is deprecated. |
    Use `speech_models`." The changelog says: "Passing a current model name (
    universal-2 , universal-3-5-pro ) to the async speech_model field now returns
    a 400."
    - Legacy names (`best`, `universal`, `nano`) and `slam-1` still validate.
      The changelog says the legacy names return 200, and SDK 4.43.0 types
      `slam-1` as a legacy `speech_model` value.
    - `universal-3-6-pro-preview` also still validates, because neither source
      names it.
  - `language_detection_options.on_no_speech_detected: "fallback"` is now
    refused unless `fallback_language` is a specific language code.
    `fallback_language` omitted, `"auto"` or `null` is refused. The submit
    reference
    (https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/submit)
    says: "`fallback` requires `fallback_language` to be set to a specific
    language code; `auto` returns a `400`." The language-detection guide says:
    "When `fallback_language` is unspecified, it is set to `"auto"` by
    default."

- 5234ddb: assemblyai: `universal-3-6-pro-preview` joins `assemblyai.stt` and `unmodel/stt`
  - `universal-3-6-pro-preview`, AssemblyAI's next-generation pre-recorded model,
    is now a catalogued `speech_models` id with `status: "beta"`. It is listed
    self-serve on the model-selection page
    (https://www.assemblyai.com/docs/pre-recorded-audio/select-the-speech-model,
    checked 2026-11-12: "Our next-generation pre-recorded model, currently in
    preview. Supports 32 languages."). It validates without an `unknown_model`
    warning, and `assemblyai/universal-3-6-pro-preview` is a typed `unmodel/stt`
    ref that compiles to `speech_models: ["universal-3-6-pro-preview"]`.
  - No cost estimate. https://www.assemblyai.com/pricing publishes pre-recorded
    rates only for Universal-3.5 Pro and Universal-2, so `estimate.costUSD` is
    `undefined` for this id. The library does not guess a rate.
  - Same gating as its siblings. The submit reference says `prompt` and
    `remove_audio_tags` are "only supported for the Universal-3.5 Pro model",
    that `temperature` "only takes effect on the Universal-3.5 Pro model", and
    that `summarization` / `auto_chapters` are "only supported for the
    Universal-2 model". On a routing that names only the preview, those params
    are refused with `unsupported_param`, and the unified row leaves them out.
    They are still accepted when the routing can fall through to the model
    that takes them, e.g. `["universal-3-6-pro-preview", "universal-3-5-pro"]`.

- 42387c0: atlascloud: `AtlasAssetRef`'s JSDoc names the Asset Library as the source of `asset://` ids (vendor page read 2026-11-12)

  The hover text said an `asset://<ASSET_ID>` was "an id from `POST
/api/v1/model/uploadMedia`". That is wrong: `uploadMedia` "Returns a JSON object
  with a temporary URL for the uploaded file." (https://www.atlascloud.ai/docs/upload-files).
  Asset ids come from Atlas's Asset Library, `POST
https://console.atlascloud.ai/api/v1/sd/assets`, on the console host: "Asset
  Library endpoints live on the console host, NOT on the inference host where
  generation endpoints live." and "Do not call
  `https://api.atlascloud.ai/api/v1/sd/assets` — it will return 404."
  (https://www.atlascloud.ai/models/bytedance/seedance-2.5/reference-to-video).
  An asset is usable once it reaches `Active`. Docs only: the type and the
  validator are unchanged.

- 30a9cc2: atlascloud: Seedance 2.5 `draft`

  All three Seedance 2.5 documents on Atlas (`bytedance/seedance-2.5/text-to-video`,
  `/image-to-video` and `/reference-to-video`) now declare a `draft` boolean:
  "Generate a draft preview at 480p, overriding resolution. The response carries a
  draft_id for completing the draft at 1080p with bytedance/seedance-2.5/draft-complete
  within seven days. A draft is billed as a normal 480p render." (read 2026-09-30,
  the Seedance half of the drift the weekly Atlas audit reports in #7).
  - `atlascloud.video` types and validates `draft` on the 2.5 rows instead of
    passing it through with an `unknown_param` warning, and refuses it by name on
    every other Atlas video model.
  - It is listed in the 2.5 rows' `extras` in `VIDEO_MODEL_PARAMS`, beside
    `output_format`.
  - The three committed Seedance 2.5 snapshots under `data/atlascloud/openapi/`
    are refreshed. The completion route, `bytedance/seedance-2.5/draft-complete`,
    is its own curated id.

- 30a9cc2: atlascloud: Seedance 2.5 native `4k`, nine corrected listed figures, and a pricing caveat that cites what Atlas says today
  - **Native `4k` on Seedance 2.5.** All three Seedance 2.5 schemas on Atlas
    (`bytedance/seedance-2.5/text-to-video`, `/image-to-video`,
    `/reference-to-video`, read 2026-11-12) now list `"4k"` in `resolution`
    beside `"4k-esr"`. `atlascloud.video` was refusing it with
    `invalid_enum_value`; it is accepted, typed (`AtlasSeedance25Resolution`) and
    listed in `SEEDANCE_25_RESOLUTIONS`, now twelve values. `unmodel/video` still
    compiles canonical `4k` to `4k-esr` on these rows — native 4k and the enhanced
    rung are different products at different prices — and native 4k is
    `providerOptions.atlascloud.resolution: "4k"`. The three snapshots under
    `data/atlascloud/openapi/` are refreshed; every one of the 31 committed
    snapshots now matches its live document (canonical diff, 2026-11-12), and
    `VIDEO_VERIFIED` is `"2026-11-12"`.
  - **Listed figures.** `ATLASCLOUD_LISTED_BASE_PRICE_USD` (and
    `data/atlascloud/pricing.json`) now read what
    `https://api.atlascloud.ai/api/v1/models` returned on 2026-11-12, still
    unit-less and still not a `cost`:
    - Seedance 2.5 ×3: `{ actual: 0.134, origin: 0.167, discount: 80 }` (was
      `0.134 / 0.134 / 100`);
    - Seedance 2.0 ×3: `{ actual: 0.09, origin: 0.112, discount: 80 }` (was
      `0.112 / 0.112 / 100`);
    - Seedance 2.0-mini ×3: `{ actual: 0.045, origin: 0.056, discount: 80 }` (was
      `0.039 / 0.056 / 70`).
  - **`ATLASCLOUD_PRICING_CAVEAT` is rewritten.** The model page's meta
    description now reads "Starting from $0.134/second", so the "/1M tokens"
    sentence the caveat quoted is gone. Cost stays omitted on stronger evidence:
    Atlas's billing page (`https://www.atlascloud.ai/docs/models/price`) says
    video pricing "Varies by model, duration, and resolution; some models are
    billed by output video tokens", and Atlas's own cost test
    (`https://www.atlascloud.ai/blog/tips/seedance-2-5-draft-mode-cost-test`)
    prices one Seedance 2.5 render at "$0.134 per second" as a 480p draft and
    "$0.596 for direct 1080p". The catalog counts are restated: 608 rows, no
    curated row with a `unit`, 389 of 470 media rows unit-less, 223 rows
    discounted 30–95%. `ATLASCLOUD_PRICING_VERIFIED` is `"2026-11-12"`.

- 8e92108: atlascloud: eight in-family video ids — Veo 3.1 Fast and Lite, Seedance 2.5 `draft-complete`, and the Wan 3.0 reference routes

  `atlascloud.video` now types and validates eight more Atlas Cloud ids, each
  transcribed from its own OpenAPI document (`https://static.atlascloud.ai/model/schema/<id>.json`,
  read 2026-11-12, snapshots committed under `data/atlascloud/openapi/`):
  - `google/veo3.1-fast/text-to-video`, `google/veo3.1-fast/image-to-video` —
    Veo 3.1's schema with only `model`'s default changed: the same `[8, 4, 6]`
    durations, `720p` / `1080p` / `4k`, and "When resolution is 1080p or 4k,
    duration must be 8 (seconds)."
  - `google/veo3.1-lite/text-to-video`, `/image-to-video`,
    `/start-end-frame-to-video` — "Veo 3.1 Lite does not support 4K.", durations
    `[4, 6, 8]`, and "When resolution is 1080p, duration must be 8 (seconds)."
    `generate_audio` and `negative_prompt` are refused by name ("Audio is always
    generated", model page); the image route refuses `last_image` and names the
    start-end-frame route, which requires both frames.
  - `bytedance/seedance-2.5/draft-complete` — the second step of Seedance 2.5's
    draft mode: `draft_id` (required), `resolution` (`1080p` | `4k`),
    `output_format`, `watermark`, `return_last_frame`. Everything the draft fixes
    (prompt, media, duration, ratio, seed, audio) is refused by name — "do not
    send those fields again". `4k` is accepted because the schema lists it,
    although the model page says "Render the 1080p final" and Atlas's
    2026-11-05 cost test says "upgrades currently top out at 1080p". It is
    wire-only: no canonical word reaches `draft_id`, so it is not a
    `unmodel/video` ref.
  - `alibaba/wan-3.0/reference-to-video`, `alibaba/wan-3.0-prime/reference-to-video`
    — references are one typed list, `refers: [{ url, type }]` (≤ 20 items).
    Plain Wan 3.0 requires `type` on every item ("Each item requires a public URL
    and explicit media type."); prime infers it and caps images at 10, videos and
    audio at 5 each. `file` / `link` document and webpage parsing "requires
    enable_thinking" and the two are mutually exclusive; `enable_thinking`
    defaults to false on plain Wan 3.0 and true on prime (schema). `unmodel/video`
    compiles reference images and the clip into `refers`.

  `refers`, `enable_thinking`, `file`, `link` and `draft_id` are refused by name
  on every other Atlas model, naming the id that takes them. Seven of the eight
  are `unmodel/video` refs (`VIDEO_MODELS` / `VIDEO_MODEL_PARAMS` on
  `unmodel/atlascloud/values`); `VEO_LITE_RESOLUTIONS`,
  `DRAFT_COMPLETE_RESOLUTIONS` and `REFER_TYPES` join the published enums.

  No new id ships a `cost`, for the reason every Atlas row does not: the catalog
  (`https://api.atlascloud.ai/api/v1/models`, read 2026-11-12) gives a bare
  `base_price` with no unit (0.08 on Veo 3.1 Fast, 0.05 on Lite, 0.263 on
  draft-complete, 0.04 / 0.061 on the Wan reference routes), and Atlas's billing
  page says video pricing "Varies by model, duration, and resolution". The
  figures are in `ATLASCLOUD_LISTED_BASE_PRICE_USD`, unit-less.

- 30a9cc2: atlascloud: Wan 3.0 prime `resolution` follows Atlas's current schema

  Both Wan 3.0 prime documents (`alibaba/wan-3.0-prime/text-to-video` and
  `/image-to-video`) now publish the same lower-case list Wan 3.0 does: "Output
  resolution. Native tiers: 480p, 720p, 1080p. ESR tiers: 720p-esr, 1080p-esr,
  1440p-esr, 4k-esr." (read 2026-09-30, the drift the weekly Atlas audit has been
  reporting in #7).
  - `atlascloud.video` accepts `1080p` and the `-esr` ladder on the prime rows and
    refuses the old `1080P` / `720P` / `480P` spelling, which the schema no longer
    lists. `WAN_PRIME_RESOLUTIONS` and `AtlasWanPrimeResolution` change with it.
  - `unmodel/video` compiles canonical `1080p` to `1080p` on the prime rows, and
    now reaches `1440p` and `4k` there through `1440p-esr` / `4k-esr`, as it
    already did on Wan 3.0.
  - The two committed snapshots under `data/atlascloud/openapi/` are refreshed.
    The Seedance 2.5 drift in the same audit (a new `draft` field) is not part of
    this change.

- 03e4774: azure: `createAzure` now documents that Claude deployments are not served on `azure.chat`'s route

  Microsoft serves Claude in Foundry only on the Anthropic Messages API. The
  "API overview" table on
  https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/claude-models
  (checked 2026-11-13) lists just "Messages (`POST /v1/messages`)" and "Token
  counting (`POST /v1/messages/count_tokens`)", at
  `https://<resource-name>.services.ai.azure.com/anthropic/v1/messages`.
  `unmodel/azure` models only the OpenAI chat-completions route
  (`{endpoint}/openai/v1/chat/completions`).

  The generated `models` table still carries the 16 azure Claude rows, among them
  `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` and `claude-fable-5-2`.
  `azure.chat` still resolves a deployment named after one of them with no
  `unknown_model` warning. Treat that result as unchecked: the Messages request
  Azure actually takes for Claude is not one `azure.chat` validates.

- 7ff6ea7: azure: GPT-6, Grok 4.6 / 4.7 and DeepSeek V4.1 Flash on `azure.chat`, with Azure's own limits where they differ from models.dev (models.dev snapshot and Microsoft Learn pages read 2026-11-12)
  - `azure.chat` deployments named after these models now resolve to their own
    catalog rows and get the full catalog checks and pricing: `gpt-6-astra`,
    `gpt-6-sol`, `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6.1-terra` (1,050,000 context,
    922,000 input, 128,000 output), `grok-4.6`, `grok-4.7` and
    `deepseek-v4.1-flash`. models.dev records no Azure price for `grok-4.7`, so
    its `estimate.costUSD` and `checkChat(...).costUSD` are omitted.
  - New export `chatModels` from `unmodel/azure`: the catalog `azure.chat`
    validates against, which is the generated `models` table with Azure's
    documented corrections on top. `models` is unchanged.
    - The five GPT-6 rows accept `temperature` and `top_p`. Azure's GPT-6 feature
      table lists both as supported on all five
      (https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning).
      The same page's "Unsupported parameters" section says only GPT-6 Astra
      supports them, so for Sol, Luna, 6.1 Sol and 6.1 Terra the page contradicts
      itself. `azure.chat` does not refuse what one of Azure's own statements
      says is supported.
    - `deepseek-v4.1-flash` takes up to 384,000 output tokens, as Azure lists it
      ("**Output:** text (384,000 tokens)",
      https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure).
      models.dev's 128,000 refused larger `max_completion_tokens` values.
  - Generated row changes from the snapshot: `gpt-3.5-turbo-0125` and
    `gpt-3.5-turbo-1106` cap output at 4,096 tokens (was 16,384). `gpt-5-pro`
    caps output at 128,000 and input at 272,000. `gpt-5.1-codex-max` caps input
    at 272,000. `gpt-chat-latest` is 400,000 / 272,000 / 128,000 (was 128,000 /
    111,616 / 16,384). `gpt-5.1` and `gpt-5.1-codex` no longer list audio or image
    output. `deepseek-v4-flash` and `deepseek-v4-pro` accept `tools`. Several
    GPT-4.x, GPT-5.x and o-series rows add PDF input. Cache-read prices change
    for `gpt-5`, `gpt-5-codex`, `gpt-5-mini`, `gpt-5-nano` and `gpt-5.2`, and
    `gpt-5.6-sol` is now $4 / $20 (was $5 / $30).
  - models.dev no longer lists `claude-opus-4-1` or `deepseek-r1` for Azure.
    Deployments named after them now validate with an `unknown_model` warning and
    no price.

- 33def34: black-forest-labs: fix requests the validators wrongly refused, and add missing prices (checked against https://api.bfl.ai/openapi.json and https://bfl.ai/pricing on 2026-11-12)
  - **`safety_tolerance` goes up to 7 on FLUX.2 and the FLUX tools.** It was
    capped at 5. The schemas allow 0–7 (`maximum: 7`) on `flux-2-pro`,
    `flux-2-max`, `flux-2-pro-preview`, `flux-2-flex`, the klein routes,
    outpainting, erase, deblur and both VTO routes: "Harm moderation tolerance
    from 0 to 7, with 0 the strictest. The route and organization determine the
    approved maximum…". Kontext, FLUX.1, Fill and Expand stay at 0–6.
    `.toApi("fal")` refuses 6 and 7, because fal's FLUX.2 rows stop at `"5"`.
  - **`user` is accepted on every BFL endpoint.** Every request schema has
    this optional end-user identifier (`string | null`, 1–256 characters, no
    NUL): "Opaque identifier for the end user supplied by the calling
    platform." Before, it failed to compile and drew an `unknown_param`
    warning at run time. `.toApi("fal")` refuses it, because fal has no such
    field.
  - **`flux-dev` costs $0.025 per image**, from https://bfl.ai/pricing: "FLUX.1
    [dev] Per image $0.025 /img".
  - **Outpainting estimates its exact cost.** The rates are high (the default)
    $0.10 for the first MP plus $0.10 per additional MP, and fast $0.045 plus
    $0.006; the reference image is free. One megapixel is "1024 × 1024 pixels
    (1,048,576 pixels)", rounded up, and the output is the request's
    `width × height`. The new `outpaintingCostUSD` exposes the calculation.
  - **Erase and deblur rates are published, without an estimate.** The new
    `FLUX_ERASE_RATE` / `FLUX_DEBLUR_RATE` export the rates ($0.03 first MP,
    $0.004 per additional MP, $0.004 per reference MP), along with
    `BFL_MEGAPIXEL` and `FLUX_OUTPAINTING_RATES`. Neither endpoint estimates a
    cost: the output follows the input's size, and BFL does not say whether the
    input bills as a reference.
  - **`flux-pro-1.1-ultra-finetuned` is marked deprecated** and now returns a
    `deprecated_model` warning. BFL deprecated the FLUX.1 Finetuning API
    (https://docs.bfl.ml/release-notes: "No migration path available.
    Finetuning functionality will be discontinued."), but the route is still
    served.
  - Provenance comments on the BFL catalog now quote https://bfl.ai/pricing and
    the docs `rates` table, and they note that the response `cost` field is in
    credits.

- 5e245fb: black-forest-labs: `blackForestLabs.image` and `unmodel/image` now serve the FLUX.2 [klein] LoRA routes (public beta)
  - New catalog rows and typed arms: `flux-2-klein-4b-finetuned`,
    `flux-2-klein-9b-finetuned`, `flux-2-klein-9b-kv-finetuned` and
    `flux-2-klein-9b-kv-bf16-finetuned` (`Flux2Klein4bFinetunedBody`,
    `Flux2Klein9bFinetunedBody`, `Flux2Klein9bKvFinetunedBody`,
    `Flux2Klein9bKvBf16FinetunedBody`). Each takes the klein request schema
    plus a required `finetune_id` and an optional `finetune_strength`
    (https://docs.bfl.ml/flux_2/flux2_lora_inference: "The request schema
    matches the underlying base endpoint, with two added parameters:
    `finetune_id` and `finetune_strength`"). A missing `finetune_id` is an
    `invalid_shape`; the klein limits (4 input images, no
    guidance/steps/upsampling) still apply. The routes carry `status: "beta"`.
  - Pricing follows BFL's beta rule (billed as the base route): $0.014 for the
    4B route, $0.015 for the 9B and 9B KV routes (https://bfl.ai/pricing,
    https://docs.bfl.ml/quick_start/pricing). The BF16 route has no estimate —
    no BFL page says what it bills as.
  - `finetune_id` / `finetune_strength` on any other FLUX.2 route
    (pro, max, flex, klein, previews) is now an `unsupported_param` naming the
    `-finetuned` routes, instead of an `unknown_param` warning that let a LoRA
    request go out as a plain generation.
  - `unmodel/image` refs `black-forest-labs/flux-2-klein-*-finetuned` compile
    like klein, with `finetune_id` / `finetune_strength` as extras; `.toApi("fal")`
    refuses them by name (fal serves no klein row and cannot load a BFL LoRA).

- 51c7617: black-forest-labs: refuse requests the API rejects or silently drops, checked against https://api.bfl.ai/openapi.json and https://docs.bfl.ml on 2026-11-12
  - **Outpainting refuses `seed`, `webhook_url` and `webhook_secret`.**
    `FluxOutpaintingInputs` is closed (`additionalProperties: false`), and
    unlike erase, deblur and VTO it declares none of the three. The docs say
    "The endpoint rejects unknown fields", so each was a 422. They are now an
    `unsupported_param` and a compile error on `imageEditOutpainting`, and
    `constraintsFor("flux-tools/outpainting-v1")` lists them. The route has no
    seed, and it delivers results only through the `polling_url` the POST
    returns. Erase, deblur and VTO still take all three.
  - **Outpainting refuses canvases over 4 MP.** "The target canvas area
    (`width × height`) cannot exceed 4 megapixels (4,194,304 pixels). …
    Requests above this limit return `422`." (https://docs.bfl.ml/flux_tools/flux_outpainting).
    A larger canvas is now an `invalid_shape` on `width`, and the outpainting
    cost estimate no longer prices requests the API refuses. Exactly 4 MP is
    still accepted, in any aspect ratio. The new `FLUX_OUTPAINTING_MAX_PIXELS`
    exports the limit.
  - **`raw` on `flux-pro-1.1-ultra-finetuned` is now an `unsupported_param`
    and a compile error.** `FinetuneFluxUltraInput` declares no `raw`, so the
    server dropped it without saying so. Raw mode exists only on
    `flux-pro-1.1-ultra`. The `IMAGE_MODEL_PARAMS` row for the finetuned route
    in `unmodel/black-forest-labs/values` no longer lists `raw`.
  - The FLUX.2 [klein] LoRA docs also list `flux-2-klein-base-4b-finetuned` and
    `flux-2-klein-base-9b-finetuned`. They stay out of the catalog: the OpenAPI
    has no hosted klein Base route, so the request schema they are said to
    match cannot be checked. They validate on the loose path, with an
    `unknown_model` warning, and `finetune_id` is still required. The LoRA-only
    error on the other FLUX.2 routes now names them as well.

- 8657d37: black-forest-labs: retire `flux-pro-1.0-fill-finetuned`

  BFL discontinued the FLUX.1 Finetuning API on 2025-10-31 and the route is no
  longer in https://api.bfl.ai/openapi.json. The release notes
  (https://docs.bfl.ml/release-notes, read 2026-11-12) list
  `flux-pro-1.0-fill-finetuned` under the deprecation with "No migration path
  available. Finetuning functionality will be discontinued."
  - Removed: the `flux-pro-1.0-fill-finetuned` catalog row, its
    `blackForestLabs.imageEditFill` arm, and the `FluxFillFinetunedBody` type
    (from `unmodel/black-forest-labs` and `unmodel/black-forest-labs/types`).
    The id now validates as an unknown model, with an `unknown_model` warning
    and no cost estimate.
  - Replacement: BFL names none. For inpainting without a LoRA, use
    `flux-pro-1.0-fill`. LoRAs now run on the FLUX.2 [klein] `-finetuned`
    routes of `blackForestLabs.image` (`flux-2-klein-4b-finetuned`,
    `flux-2-klein-9b-finetuned`, `flux-2-klein-9b-kv-finetuned`,
    `flux-2-klein-9b-kv-bf16-finetuned`). Those are text-to-image/editing
    routes, not inpainting, and BFL calls them a self-serve product "separate
    from the FLUX.1-era Finetuning API".
  - `finetune_id` / `finetune_strength` on `flux-pro-1.0-fill` are still an
    `unsupported_param`, and the message now points to the klein LoRA routes.

- ddf7f91: breezeblue: `breeze-tts-2-multilingual` joins the catalog and `unmodel/tts`, and an omitted `model_id` is resolved the way the API routes it
  - `breezeblue.tts` catalogues `breeze-tts-2-multilingual` — "Breeze TTS 2
    Multilingual (`breeze-tts-2-multilingual`) supports all 51 codes accepted by
    the Voice contract" (https://docs.breezeblue.ai/concepts/multilingual) — so
    it validates and prices like `breeze-tts-2` instead of warning
    `unknown_model`. It is also a unified ref:
    `tts({ model: "breezeblue/breeze-tts-2-multilingual", … })`, whose
    `language` completes the 51 codes.
  - `breeze-tts-2-preview` is catalogued as what the docs call it, "a
    compatibility alias for `breeze-tts-2-multilingual`": it validates without
    `unknown_model`, and stays out of `BREEZEBLUE_MODEL_IDS` and the unified ref
    union, which name the formal id (`GET /v1/models` lists the formal model
    only).
  - An omitted or null `model_id` now resolves to the model that will serve the
    request, per https://docs.breezeblue.ai/guides/text-to-speech: "When
    `model_id` is omitted, explicit `language_code: en` or `zh` selects
    `breeze-tts-2`; other or omitted languages select
    `breeze-tts-2-multilingual`." Model-keyed checks now run on such requests
    instead of being skipped.
  - `VOICE_LANGUAGE_CODES` (`unmodel/breezeblue`, `unmodel/breezeblue/values`)
    grows from 23 to the 51 codes of the Voice contract table on
    https://docs.breezeblue.ai/concepts/multilingual, adding af, bg, bn, bs, ca,
    da, et, eu, fa, gl, he, hu, is, kn, lt, mr, ms, ne, no, sk, sl, sq, sv, sw,
    ta, te, tl, ur. `BreezeblueVoiceLanguageCode` widens with it.

- b635664: breezeblue: `breezeblue.tts` accepts the output profiles and voice settings the API serves, prices at $30 / 1M with CJK counted twice, and enforces the documented text limit

  Checked against https://docs.breezeblue.ai/openapi.json, the docs and
  `@breeze.blue/sdk` 0.23.0 on 2026-11-12.
  - **Output profiles no longer refused.** `output_format` takes the fourteen
    values of the OpenAPI enum — the six bare encodings plus `mp3_24000_64`,
    `mp3_24000_96`, `mp3_24000_128`, `mp3_24000_160`, `wav_24000`,
    `pcm_24000`, `flac_24000` and `aac_24000_128` — where it used to report
    `invalid_enum_value` for every profile. `BreezeblueOutputFormat` widens to
    match. In `unmodel/tts`, `outputFormat` now compiles a bitrate (and a rate
    where a rate-only profile exists) into the profile — `{ format: "mp3",
bitrate: 64000 }` → `mp3_24000_64` — and anything but 24 kHz, or a bitrate
    BreezeBlue does not publish, is refused at `outputFormat`
    (https://docs.breezeblue.ai/concepts/output-format: "A profile uses
    `codec_sample_rate_bitrate`, omitting the bitrate for WAV, PCM, and FLAC").
  - **`voice_settings` takes all four members.** `speed` (0.5–2.0), `volume`
    (0.01–2.0) and `use_speaker_boost` join `guidance_scale` on the strict
    `TtsVoiceSettingsPayload` schema (they were refused as unknown keys), and
    `.toSdk("breezeblue")` forwards them as `speed`, `volume` and
    `useSpeakerBoost`. In `unmodel/tts`, `speed` is now supported — it compiles
    to `voice_settings.speed`, and an out-of-range value is reported at `speed`
    — and `volume` and `use_speaker_boost` are new extras. New exports:
    `SPEED_MIN`, `SPEED_MAX`, `VOLUME_MIN`, `VOLUME_MAX`.
  - **Text limit.** Over 2,000 characters is now an `over_output_limit` error,
    and 1,001–2,000 a warning: "Up to 1000 characters by default; accounts with
    an approved higher limit may send up to their configured limit, at most
    2000 characters" (OpenAPI `TtsRequest.text`). Every catalog row carries
    `limit.characters: 2000`; new exports `TTS_MAX_CHARACTERS` and
    `TTS_DEFAULT_MAX_CHARACTERS`.
  - **Price.** `TTS_COST_PER_MILLION_CHARACTERS_USD` is 30, not 40: every plan
    card on https://breezeblue.ai/pricing now reads "$30 / 1M characters". The
    estimate counts billable units — Han ideographs, kana and Hangul are two
    each, per https://docs.breezeblue.ai/concepts/pricing — so pure-CJK text is
    no longer under-priced by half. The counter is exported as
    `billableUnits(text)`.
  - **`breeze-tts-2` is open-weight.** `openWeights` is now `true`: the weights
    were released on https://huggingface.co/BreezeBlue/Breeze-TTS-2 on
    2026-08-25 (for research and non-commercial use).
  - Doc comments now carry the current `instructions` rule ("Write
    `instructions` in the same language as the input text and
    `language_code`") and the current metering wording.

- 73c8dba: bria: Fibo 2 on `bria.image` and `bria.imageEdit`

  Bria moved POST /v2/image/generate and POST /v2/image/edit to Fibo 2 in place
  ("Image generation now runs on Fibo 2, with 12 more aspect ratios and no code
  changes." — https://docs.bria.ai/image-generation-overview.md; read 2026-11-12
  against https://docs.bria.ai/_bundle/image-generation.yaml and
  https://docs.bria.ai/_bundle/image-editing.yaml). The catalog ids stay
  (`bria/FIBO`, `FIBO-edit`); their display names are now "Fibo 2" and "Fibo 2 Edit".
  - `bria.image` accepts the 21 aspect ratios the route now declares. It used to
    refuse twelve of them, including Bria's own `21:9` panorama example.
    `BRIA_ASPECT_RATIOS` / `BriaAspectRatio` now hold all 21. The twelve new ones
    are also published on their own as `BRIA_FIBO2_ASPECT_RATIOS`. They return 422
    with `resolution: "4MP"`, with `prompt` + `structured_prompt` together, or with
    `images` and no `prompt`, and `bria.image` refuses those combinations before
    the request is sent.
  - `bria.imageLite` keeps the original nine ratios, published as
    `BRIA_LITE_ASPECT_RATIOS` / `BriaLiteAspectRatio`. If you send it one of the
    twelve new ratios, the error says which route accepts it.
  - New `style` on `bria.image`: `kodak_film` | `hard_flash` | `hazy_dreamy` |
    `rough_realism` (`BRIA_STYLES`, `BriaStyle`). It is refused with
    `structured_prompt`, `images` or 4MP ("Returns 422 with `style_id`,
    `structured_prompt`, `images` or 4MP resolution."). `bria.imageLite` reports
    it as `unsupported_param`, and the lite type has `style?: never`. In
    `unmodel/image` it is a `bria/FIBO` extra.
  - `bria.image` refuses `resolution: "4MP"` with `sync: true` ("A synchronous
    4MP request returns 422.").
  - `bria.imageEdit` accepts 1 to 4 `images` ("**Accepts 1 to 4 images.**",
    `minItems: 1`, `maxItems: 4`; `BRIA_EDIT_IMAGES_MIN` / `BRIA_EDIT_IMAGES_MAX`).
    It used to require exactly one image, so it refused the spec's own 3-image
    example. A `mask` is refused on a multi-image edit ("**Only supported when
    `images` contains exactly one item.**").
  - `bria.imageEdit` gains `aspect_ratio`, with the same 21 values as generate.
    When omitted, the output keeps the first image's ratio.

  Not changed, pending a request with a key: the 2026-11-12 bundles no longer list
  `model_version`, `negative_prompt` or `steps_num` on generate, or
  `guidance_scale` on edit. Bria's Fibo 2 page says "Same API, nothing to change in
  your code," so these fields stay typed with their earlier bounds.

- f9558b8: bria: published per-image prices for Fibo, Fibo Lite and Fibo Edit

  The cost estimates for the three Bria rows in `unmodel/bria` now use the
  current API price list (https://bria.ai/pricing, read 2026-11-12):
  - `FIBO` (`bria.image`, `bria/FIBO`): $0.03 → **$0.032** per image ("Fibo |
    $0.032 / Image").
  - `FIBO-lite` (`bria.imageLite`, `bria/FIBO-lite`): $0.02 → **$0.0288** per
    image ("Fibo Lite | $0.0288 / Image").
  - `FIBO-edit` (`bria.imageEdit`): $0.03 → **$0.032** per image ("Fibo Edit |
    $0.032 / Image").
  - `BRIA_STRUCTURED_PROMPT_COST_USD` stays at $0.02 per call ("Fibo Structured
    Prompt | $0.02 / Call").

  `maxCostUSD` budgets and `estimate.costUSD` on these routes change with the
  new rates. Comment-only fixes: the catalog header now lists the correct
  editing-route paths (`/v2/image/edit/erase` and the like, not `/v2/erase`). It
  also names `/v2/structured_instruction/generate` and `replace_background`'s
  `mode: "fibo2"` as not modeled, and links the Markdown references
  (`docs.bria.ai/image-generation.md`, `docs.bria.ai/image-editing.md`), because
  the rendered pages have no parameter text in their static HTML.

- 18d6bf0: bytedance: retire Seedance 1.5 pro (`seedance-1-5-pro-251215`) from `bytedance.video`

  BytePlus shut the model down after 17:00 UTC+8 on 2026-11-11 with no automatic migration ("The seedance-1-5-pro-251215 model will be shut down after 17:00 on November 11, 2026 (UTC+8) and will not be automatically migrated to a new model."), and it is gone from the ModelArk Model list and Pricing tables. The recommended replacement is `dreamina-seedance-2-0-mini-260615`.
  - Removed: the `seedance-1-5-pro-251215` catalog row, its shape rules and constraint table, its pricing rows, its `unmodel/video` row (`VIDEO_MODELS` / `VIDEO_MODEL_PARAMS` on `unmodel/bytedance/values`), and the `Seedance15ProBody` type. A request naming the id now validates with an `unknown_model` warning and no cost estimate.
  - `VideoPricingFields` drops `generateAudio`, and `videoUsdPerSecond` drops the silent-halving and the 0.6/0.7 draft-factor arithmetic: both priced Seedance 1.5 pro only. `draft` stays on `VideoPricingFields`, now with the Dreamina Seedance 2.5 meaning (a draft prices as an ordinary 480p video; see the Seedance 2.5 changeset).
  - The draft-mode refusals of `return_last_frame` and `service_tier: "flex"` are gone with it; they were documented for this model alone. `draft: true` still requires 480p.
  - Deny and range messages for `seed`, `camera_fixed`, `generate_audio` and `duration: -1` now name the models that still take them.

  Atlas Cloud's `bytedance/seedance-v1.5-pro/*` routes on `atlascloud.video` are a different host and are unaffected.

  Source: https://docs.byteplus.com/docs/en/modelark/model-deprecation-notice.md (retrieved 2026-11-12).

- 4be31d3: bytedance: Dreamina Seedance 2.5 takes 1080p and draft mode on `bytedance.video`, plus pricing and doc corrections, verified 2026-11-12
  - `resolution: "1080p"` is accepted on `dreamina-seedance-2-5-260628` (typed, validated, and offered by `unmodel/video`); it was refused although the API reference says "Dreamina Seedance 2.5: Default `720p`; supports `480p`, `720p`, and `1080p`." It prices at $0.569 per second ("$2.843 per video · $0.569 per second", 16:9, no input video).
  - Draft mode works on Dreamina Seedance 2.5: `draft: true` (480p only) and the final video from a `{ type: "draft_task" }` content item were both refused. A final video must set `resolution: "1080p"`, omit `draft`, and send nothing the draft fixed — the validator refuses re-sent prompt or media items, `duration`, `ratio`, `generate_audio` and `omni_reference_task_type` ("An error occurs even if their values match those used in the Draft task."). The type takes `content: ArkOmniContent[] | [ArkDraftTaskContent]`. `draft` is still denied on the 2.0 series and Seedance 1.0, now naming Dreamina Seedance 2.5.
  - `VideoPricingFields.draft` prices a Dreamina Seedance 2.5 draft as an ordinary 480p video when `resolution` is omitted ("The token consumption and token rate are the same as normal 480p videos.").
  - `VideoShapeRule` gains `supportsDraft`; `VIDEO_DRAFT_SOURCE` is exported.
  - Docs: `return_last_frame` returns a jpeg (not a PNG) at the video's pixel dimensions without watermark; draft task ids created from 10:00 UTC+8 on 2026-10-28 stay valid 14 days (others 7); the Seedream 5.0 pro tier boundary (2.61 million pixels) is now cited from the Pricing page instead of being flagged unverified; the long-ended Seedance 2.0 fast / mini limited-time discount notes are gone (list prices unchanged).

  Sources: https://docs.byteplus.com/docs/en/modelark/create-video-generation-task-api.md, https://docs.byteplus.com/docs/en/modelark/seedance-2-5.md, https://docs.byteplus.com/docs/en/modelark/model-pricing.md, https://docs.byteplus.com/docs/en/modelark/model-list.md, https://docs.byteplus.com/docs/en/modelark/seedance-2-0-mini-fast-limited-time-discount.md.

- fcc496f: bytedance: Seedream 5.5 (`dola-seedream-5-5-261028`) and Seedream 5.0 flash (`dola-seedream-5-0-flash-260915`) on `bytedance.image`, verified 2026-11-12 against the BytePlus ModelArk Model list, Pricing and image generation API reference
  - Both ids now validate, price and compile like their siblings: catalog rows, typed arms (`Seedream55Body`, `Seedream50FlashBody`), shape rules, constraint tables, the `unmodel/image` adapter rows and `IMAGE_MODELS` / `IMAGE_MODEL_PARAMS` on `unmodel/bytedance/values`.
  - Seedream 5.5 pricing is tiered by output pixels — $0.020 per image up to 1536² × 1.05² (2,601,123.84) pixels, $0.035 above it, every input image $0.008 — and its layer decomposition bills up to `layer_decomposition_options.max_images` images (default 30, base image included). Catalog `perImage` is 0.035 (the 2K default). New exports: `SEEDREAM_5_5_RATES`, `SEEDREAM_5_5_TIER_PIXELS`, `SEEDREAM_5_5_INPUT_IMAGE_USD`, `SEEDREAM_5_5_DEFAULT_LAYER_IMAGES`.
  - Seedream 5.0 flash is $0.018 per output image with free inputs; a layer-decomposition request now estimates its base image plus 16 layers (`generatedImageCount` counts them).
  - `background` gains `"auto"` (`IMAGE_BACKGROUNDS` is now `["auto", "transparent", "opaque"]`): Seedream 5.5 takes all three, Seedream 5.0 pro / flash keep `transparent | opaque`. The "transparent needs exactly one alpha-channel input image" rule now applies to Seedream 5.0 pro / flash only — Seedream 5.5 makes RGBA from text and from up to 10 ordinary references, which the validator refused before.
  - New `layer_decomposition_options` (`LayerDecompositionOptions`: `max_images` 2–100, `text_recognition`) for Seedream 5.5, refused on every other model, and warned as ignored when `layer_decomposition` is not `true`. `LAYER_MAX_IMAGES_RANGE` is exported.
  - New `safety_identifier` (≤ 64 characters) on Seedream 5.5 / 5.0 pro / 5.0 flash, typed and validated; it was a compile error and an `unknown_param` warning on Seedream 5.0 pro.
  - Seedream 5.5, 5.0 pro and 5.0 flash refuse `background` together with `layer_decomposition: true` ("This parameter is not supported for layer decomposition. Passing it causes an error."). Seedream 5.5 and 5.0 flash deny the sequential-batch family and `stream`, and take `optimize_prompt_options.mode: "standard"` only. Deny reasons for `layer_decomposition`, `background` and `output_format` on the other models now name every model that does take them.

  Sources: https://docs.byteplus.com/docs/en/modelark/model-list.md, https://docs.byteplus.com/docs/en/modelark/model-pricing.md, https://docs.byteplus.com/docs/en/modelark/image-generation-api.md, https://docs.byteplus.com/docs/en/modelark/image-generation-tutorial.md, https://docs.byteplus.com/docs/en/modelark/seedream-5-5.md.

- 9d8f789: cartesia: the docs and JSDoc now name `Authorization: Bearer` as the auth header, and the catalog's pricing and provenance notes are refreshed (sources read 2026-11-12)
  - Auth: every `cartesia.*` JSDoc example and the `docs/tts.md` auth table now
    send `Authorization: Bearer <api_key>` instead of `X-API-Key`. Cartesia's API
    conventions page says "Include `Authorization: Bearer <api_key>` in the
    headers of your requests.", every OpenAPI security scheme is `type: http,
scheme: bearer`, and `@cartesia/cartesia-js` 4.2.0 sends exactly that header.
    Docs only: unmodel still never touches the key.
  - The catalog's pricing note adds the realtime `ink-whisper` rate (1 credit
    per second on `/stt/websocket` and `/stt/turns/websocket`) and records the
    overage rates cartesia.ai/pricing now publishes per tier ($65 / $45 / $38
    per 1M credits on Pro / Startup / Scale). There is still no rate that holds
    across plans, so Cartesia rows still carry no `cost` and estimates still
    return no `costUSD`.
  - Provenance URLs point at the pages that serve the pinned schema: the
    `docs.cartesia.ai/2026-03-01/api-reference/...` references (the unversioned
    pages now render Cartesia-Version 2026-08-14), `tts-models/api-changes` for
    sunsets (the old deprecations URL redirects to a login), and
    `tts-models/{latest,older-models}` for the model tables.

- 22a30e0: cartesia: no more false refusals on `language` / `locale` for the Sonic aliases, unlisted Sonic 3.6 locales and the realtime STT socket; new `normalization` field; `locale` from the unified layer on Sonic 3.6 (sources read 2026-11-12)
  - Fixes a false refusal on `sonic-preview`, `sonic-latest` and `sonic-3-latest`.
    `cartesia.tts` and `cartesia.ttsWebsocket` held them to the 42-code list at
    error severity, so `locale: "en-GB"` or `language: "ur"` failed at compile
    time and at run time, even though no page names the model behind these ids.
    - `sonic-preview` now takes the Sonic 3.6 values quietly. The api-changes
      "Stable offerings" row points its supported languages at the Sonic 3.6 page.
    - On `sonic-latest` and `sonic-3-latest` (deprecated aliases of
      `sonic-preview`) a Sonic 3.6 value is now an `invalid_enum_value`
      _warning_.
    - Ids the catalog does not know (`sonic-3.7`) work the same way.
    - On all of these ids a value on no documented list is also a warning, never
      an error, and their `language` / `locale` types are open-tailed
      (`CARTESIA_TTS_ALIAS_LANGUAGES`).
    - The ids whose list is documented (`sonic-3.6`, `sonic-3.5`, `sonic-3` and
      their dated snapshots) still refuse at error severity.
  - Fixes a false refusal of the five locales that Sonic 3.6 serves but no page
    names. The locale table lists 56 codes while the changelog counts "44
    languages / 61 locales". A well-formed regional code on a Sonic 3.6 base that
    the table does not list (`ar-SA`, `zh-TW`, `es-419`) is now a warning on
    `sonic-3.6` and its snapshot, and it compiles. `en-gb` (wrong case) and
    `cy-GB` (Welsh is not a Sonic 3.6 language) are still errors.
  - New `normalization` field on `TtsBytesBody` (nullable, as on the wire) and
    `TtsWebsocketMessage`. Before, a TypeScript caller could not send this
    documented field without a cast.
    - It takes `"auto"`, `"off"`, any base code (on every model) or a locale
      code.
    - A locale code on a model before Sonic 3.6 is a warning ("Locale codes
      require Sonic 3.6 or later.").
    - Any other value is an `invalid_enum_value` error ("Values not on the list
      return a 400 error.").
  - Fixes a false refusal on `cartesia.sttWebsocket`. `language` was an error for
    anything but `"en"`, including `ink-whisper` with `"es"` and `ink-preview`
    with `"fr"`. Only the 2026-03-01 reference lists `en` alone, and it does not
    say other codes are refused. The 2026-08-14 reference points `ink-whisper` at
    its 100 codes, and the troubleshooting page says to pass `?language=xx`.
    - It now never errors. `ink-whisper` warns only outside its 100 codes, and
      `ink-2` / `ink-preview` warn on anything but `en` (the field is "Used by
      `ink-whisper` models only.").
    - `CartesiaSttWebsocketLanguage` widens to
      `CartesiaSttLanguage | (string & {})`.
  - Unified `tts`: on `cartesia/sonic-3.6`, a tag on Sonic 3.6's list is now sent
    exactly as `locale`, with its case folded (`pt-br` and `pt_BR` become
    `pt-BR`). Before, it was cut to `language: "pt"` with an `approximated_param`.
    Tags that are not on the list, and every other model, still go through
    `language` as a bare primary subtag. The `cartesia/sonic-preview` and
    `cartesia/sonic-latest` rows now complete Sonic 3.6's 44 languages.
  - Issue `meta.source` links for the TTS and STT routes now point at the
    `docs.cartesia.ai/2026-03-01/api-reference/...` pages, the version these
    routes pin. The unversioned pages render 2026-08-14, where for example
    `sonic-3.6` _is_ on the `model_id` enum.
  - The batch `/stt` model error now names `cartesia.sttWebsocket` for `ink-2`.
    Before, it said the WebSocket route was not validated.
  - Catalog notes: speech from a cloned voice is billed at 1 credit per character
    ("Speech from a clone costs 1 credit per character, unless your Enterprise
    plan says otherwise.", cartesia.ai/pricing). The old figure of ~1.5 appears
    on no Cartesia page. `sonic-english` / `sonic-multilingual` stay unlisted,
    now citing their June 1, 2026 sunset on the api-changes page.

- a7f3bf7: cartesia: retire the Sonic 2, Sonic Turbo and first Sonic 3 snapshot ids that Cartesia sunset after 2026-10-20

  Removed from the catalog, from `cartesia.tts` / `cartesia.ttsWebsocket`
  `model_id` completions and from `CartesiaTtsModelId`:
  - `sonic-2`, `sonic-2-2025-06-11`, `sonic-2-2025-05-08`, `sonic-2-2025-04-16`
    — "sonic-2 and all sonic-2-\* snapshots will stop working after October 20,
    2026." Use `sonic-3.6`.
  - `sonic-turbo`, `sonic-turbo-2025-06-04` — "sonic-turbo and all
    sonic-turbo-\* snapshots will stop working after October 20, 2026." Use
    `sonic-3.6`.
  - `sonic-3-2025-10-27` — "`sonic-3` | `sonic-3-2025-10-27` | October 20,
    2026" on the sunset table. Use `sonic-3-2026-01-12` (or `sonic-3.6`).

  Sources: https://docs.cartesia.ai/build-with-cartesia/tts-models/older-models
  and https://docs.cartesia.ai/build-with-cartesia/tts-models/api-changes
  ("Requests to sunsetted models will return an error.", `"error_code":
"model_sunsetted"`), both read 2026-11-12. A retired id now validates with an
  `unknown_model` warning rather than `deprecated_model`; nothing that validated
  before is refused.

  `ttsConstraints` is now empty: its only rules denied `pronunciation_dict_id`
  on `sonic-2` and `sonic-turbo`, and every remaining sonic id is Sonic 3 or
  later.

- 6f6de59: cartesia: Sonic 3.6, `ink-preview`, the `ink-whisper` snapshot and two deprecated aliases join the catalog, and the TTS language check goes per model (sources read 2026-11-12)
  - New TTS rows: `sonic-3.6` (GA since 2026-08-27: "generally available from
    August 27 on `sonic-3.6`", docs.cartesia.ai/changelog/2026) and its dated
    snapshot `sonic-3.6-2026-08-27` (tts-models/latest). Both sit off the
    Cartesia-Version 2026-03-01 `model_id` enum, so `cartesia.tts` and
    `cartesia.ttsWebsocket` validate them with the existing off-enum warning.
    `cartesia/sonic-3.6` is reachable from `unmodel/tts` with a 44-language row.
  - New deprecated aliases `sonic-3-latest` (use `sonic-preview`) and
    `sonic-3-preview` (use `sonic-3`), from the older-models page's
    "Deprecated Aliases" table. They validate with `deprecated_model`.
  - New STT rows: `ink-preview` (beta, realtime-only: batch `/stt` refuses it,
    `cartesia.sttWebsocket` takes `keyterm` on it and reports the
    `ink-whisper`-only silence knobs as ignored, as on `ink-2`) and
    `ink-whisper-2025-06-04` (batch `/stt` accepts it; on the socket `keyterm` is
    ignored, as on `ink-whisper`). The `keyterm` deny reason now reads "used by
    `ink-2` and `ink-preview` only".
  - Fixes a false refusal on the new model: `language` was checked against one
    42-code list for every model, so `sonic-3.6` with `language: "or"`, `"ur"`,
    `"en-GB"` or `"pt-BR"` failed with `invalid_enum_value`. The list is now per
    model (`CARTESIA_TTS_LANGUAGES_BY_MODEL`): the two Sonic 3.6 ids take
    their 44 base codes (`CARTESIA_TTS_3_6_LANGUAGES`) plus the 56 regional
    locales of the advanced-capabilities table (`CARTESIA_TTS_LOCALES`);
    sonic-3.5, sonic-3 and their dated snapshots keep the 42
    (`CARTESIA_TTS_LANGUAGES`). Refusing a Sonic 3.6 value
    on an earlier model now names `sonic-3.6`, and for a locale also the bare
    code to send instead.
  - New `locale` field on `TtsBytesBody` and `TtsWebsocketMessage`, taking the
    same per-model values ("Accepts exactly the same values as `language`").
    Setting both `language` and `locale` is an `invalid_shape` error ("Setting
    both returns a 400 error, even if the values match.").
  - Types: `TtsBytesBody<M>` and `TtsWebsocketMessage<M>` infer the `model_id`
    literal, so `language` / `locale` complete and check against that model's
    own list (`CartesiaTtsLanguageFor<M>`, new `CartesiaTtsLocale`). Unchanged
    for earlier models: `language: "pt-BR"` on `sonic-3.5` is still a compile
    error. A `string`-typed `model_id` accepts every model's values.
  - The `sonic-preview` row is renamed "Sonic Preview (beta alias)": the docs no
    longer say which model it serves.

- 125b667: catalog refresh (2026-11-12), hosts and gateways: models.dev snapshot for every provider except the first-party labs and cloud mirrors, which land in their own entries
  - 28 providers join `unmodel/catalog` (catalog-only — no validator): `ai21`,
    `aimlapi`, `ainetcafe`, `bee`, `boundless`, `commandcode`, `engy`, `hopper`,
    `inco`, `infer`, `kimi-code-plan-cn`, `kimi-code-plan-global`, `liquid`,
    `lowrouter`, `melious`, `modular`, `munito`, `munito-eu`, `nan`, `oci`,
    `pareto`, `prime`, `reflection`, `sambanova`, `tempr`, `vispark`, `wallaby`,
    `wally`.
  - 5 providers left models.dev and no longer resolve in `unmodel/catalog`:
    `crof`, `iflowcn`, `kimi-for-coding`, `llama`, `v0`.
  - Host and gateway catalogs (openrouter, vercel, togetherai, fireworks-ai,
    deepinfra, nvidia, friendli, siliconflow, novita-ai, …) pick up the new
    flagship rows. Ids that left a host's catalog now validate with an
    `unknown_model` warning and no cost estimate — among them
    `accounts/fireworks/models/gpt-oss-120b`, `deepseek-ai/DeepSeek-V3.2` on
    friendli and `meta/llama-3.3-70b-instruct` on nvidia.
  - `deepinfra.chat` gains `.toApi("anthropic")`: DeepInfra now serves
    `anthropic/claude-fable-5`, so the generated availability table names an
    anthropic target for it, and the entry now ships the anthropic-messages
    codec behind that edge (as openrouter and vercel already do) instead of a
    promised edge that would throw `TranslationUnavailableError`.

- 4899a2b: cohere: `north-mini-code-1.0` validates under Cohere's own id, and Command A+ / Reasoning / Translate / Vision no longer carry a contradicted $2.50 / $10 rate
  - **`north-mini-code-1.0`** is the id Cohere serves ("**Model Name**:
    `north-mini-code-1.0`" — https://docs.cohere.com/changelog; the model table
    at https://docs.cohere.com/docs/models and
    https://docs.cohere.com/docs/cohere-on-openrouter agree). models.dev's
    `north-mini-code-1-0` spelling left real requests at `unknown_model` with
    every capability and output-limit check skipped; they now run, and
    `north-mini-code-1-0` validates with an `unknown_model` warning instead.
    `response_format: json_object` stays accepted — the model page renders
    Structured Outputs as supported
    (https://docs.cohere.com/docs/north-mini-code-1.0).
  - **`command-a-plus-05-2026`, `command-a-reasoning-08-2025`,
    `command-a-translate-08-2025`, `command-a-vision-07-2025`**: estimates and
    `checkChat` report no `costUSD`. The $2.50 / $10.00 per 1M rate comes only
    from cohere.com/pricing's card rows, which the same page contradicts (they
    price Command R7B at $2.50 / $2.50 against its own $0.0375 / $0.15 entry,
    and Command A+'s own entry there reads "Free"). Each model page says "For
    both trial keys and production keys, <model> is free until rate limits are
    reached" and sends production use to sales or Model Vault, with no
    per-token rate published (https://docs.cohere.com/docs/command-a-plus,
    /command-a-reasoning, /command-a-translate, /command-a-vision).

- 877297c: cohere: `CohereTextModelId` and `CohereModelId` say on hover that they are models.dev's ids, not the ones `cohere.chat` validates

  Both unions are still the keys of the generated `models` table, and two of
  those keys are models.dev spellings no Cohere page uses:
  `north-mini-code-1-0` and `north-small-translate-09-2026`. `cohere.chat`
  validates them with an `unknown_model` warning. Type model ids as
  `CohereChatModelId` to get the ids `cohere.chat` knows, including Cohere's own
  `north-mini-code-1.0` and `north-small-translate-1.0`. Both are exported from
  `unmodel/cohere` and `unmodel/cohere/types`.

- 771ce7c: cohere: `north-small-translate-1.0` and the four Tiny Aya models validate on `cohere.chat`; the two retired Aya 8B ids leave the catalog (models.dev refresh, 2026-11-12)
  - **`north-small-translate-1.0`** validates under Cohere's own id, with a 16K
    context and 16K output limit, priced at $0 ("For both trial keys and
    production keys, North Small Translate is free until rate limits are
    reached"). Tools, `thinking`, `response_format: json_object` and image input
    are refused — the model page's capability card greys out Tool Use,
    Reasoning, Structured Outputs and Image Inputs
    (https://docs.cohere.com/docs/north-small-translate-1.0). models.dev spells
    this model `north-small-translate-09-2026` with a 32768-token context; no
    Cohere page uses that id, so it validates with an `unknown_model` warning.
  - **`tiny-aya-global`, `tiny-aya-earth`, `tiny-aya-fire`, `tiny-aya-water`**
    validate (8k context / 8k output). Cohere publishes no price for them, so
    estimates carry no `costUSD` (https://docs.cohere.com/docs/tiny-aya).
  - **Retired:** `c4ai-aya-expanse-8b` and `c4ai-aya-vision-8b` — "Effective
    April 4, 2026, the following models are no longer available. Requests using
    these model IDs will fail." (https://docs.cohere.com/changelog). They leave
    `CohereTextModelId` and now validate with an `unknown_model` warning. Use
    `c4ai-aya-expanse-32b` / `c4ai-aya-vision-32b`, or Cohere's recommended chat
    alternatives `command-r7b-12-2024`, `command-a-03-2025` and
    `command-a-reasoning-08-2025` (https://docs.cohere.com/docs/deprecations).
  - `c4ai-aya-expanse-32b`, `c4ai-aya-vision-32b` and the Tiny Aya models now
    refuse `response_format: json_object` (models.dev marks them without
    structured outputs; Cohere's structured-outputs guide lists only Command
    models as compatible). `c4ai-aya-expanse-32b` gains its $0.50 / $1.50 per 1M
    token rate ("Aya Expanse models (8B and 32B) on the API are charged at
    $0.50/1M tokens for input and $1.50/1M tokens for output" —
    https://cohere.com/pricing).
  - New exports on `unmodel/cohere`: `chatModels`, the catalog `cohere.chat`
    validates against (the generated models.dev table plus the doc-sourced
    corrections above), and its id union `CohereChatModelId`, which
    `ChatBody["model"]` now completes from.

- 8f16f5e: deepgram: correct the STT rates, accept `eot_threshold` up to 1.0, type `language_hint` / `redact_usage`

  Rates (pay-as-you-go, read off the JSON-LD offers on https://deepgram.com/pricing,
  2026-11-12). The pre-recorded Nova-3 figures were the streaming list prices,
  and the streaming figures a promotion that has ended, so cost estimates move:

  |                                                                                    | was         | now         |
  | ---------------------------------------------------------------------------------- | ----------- | ----------- |
  | Nova-3 pre-recorded (`NOVA_3_USD_PER_MINUTE`, `deepgram.stt`, `checkListen`)       | $0.0077/min | $0.0043/min |
  | Nova-3 `language=multi` pre-recorded (`NOVA_3_MULTILINGUAL_USD_PER_MINUTE`)        | $0.0092/min | $0.0052/min |
  | Nova-3 streaming (`NOVA_3_STREAMING_USD_PER_MINUTE`, `deepgram.listenLive`)        | $0.0048/min | $0.0077/min |
  | Nova-3 `language=multi` streaming (`NOVA_3_MULTILINGUAL_STREAMING_USD_PER_MINUTE`) | $0.0058/min | $0.0092/min |
  | `flux-general-en` (`deepgram.listenFlux`)                                          | $0.0065/min | $0.0077/min |
  | `whisper-large` pre-recorded                                                       | unpriced    | $0.0048/min |

  `flux-general-multi` ($0.0078/min) and Aura-2 / Aura-1 ($0.030 / $0.015 per
  1,000 characters) are unchanged.

  False refusals fixed:
  - `deepgram.listenFlux` and `deepgram.fluxConfigure` accept `eot_threshold`
    up to `1.0` (`EOT_THRESHOLD_MAX` is now 1.0): "Valid Values: `0.5` to
    `1.0`" — `1.0` fully suppresses natural end-of-turn detection and hands turn
    endings to `ForceEndTurn` (https://developers.deepgram.com/docs/flux/configuration).
  - `language_hint` (string or list, repeated on the wire) is now typed on
    `deepgram.stt` and `deepgram.listenLive`, and as a Nova-3 extra in
    `unmodel/stt`. It is refused when `language` is not `"multi"` (Deepgram
    ignores it) or on a non-Nova-3 model ("Nova-2 does not support
    `language_hint`", https://developers.deepgram.com/docs/nova-3-language-prompting),
    and warns on Nova-3 variants other than `nova-3` / `nova-3-general`, where
    support is undocumented.
  - `redact_usage` (boolean) is now typed on `deepgram.stt`,
    `deepgram.listenLive`, `deepgram.listenFlux` and `deepgram.fluxConfigure`,
    and as an extra on every Deepgram model in `unmodel/stt`; `fluxConfigure`
    also takes `numerals` (https://developers.deepgram.com/docs/flux/configure).
    Each was a compile error under `ExactKeys` and an `unknown_param` warning at
    run time.

- 7b33fe2: deepgram: `nova-3-pharma`, and Flux TTS voices refused by name on `/v1/speak`
  - `nova-3-pharma` joins the Deepgram catalog — Deepgram's Nova-3 model for
    pharmaceutical vocabulary, English only (`en`, `en-US`, `en-AU`, `en-CA`,
    `en-GB`, `en-IE`, `en-IN`, `en-NZ`), batch and streaming
    (https://developers.deepgram.com/changelog/2026/9/17). It validates on
    `deepgram.stt` and `deepgram.listenLive` without an `unknown_model` warning,
    takes `keyterm` like the other Nova-3 ids, and `deepgram/nova-3-pharma`
    resolves in `unmodel/stt` with the Nova-3 extras row. It carries no cost:
    deepgram.com/pricing publishes no rate for it, so estimates return
    `undefined`.
  - `deepgram.tts` and `deepgram.speakLive` now refuse a Flux TTS voice
    (`flux-{voice}-{language}`, e.g. `flux-alexis-en`) with
    `unsupported_capability`, naming `/v2/speak` (batch REST and WebSocket) as
    the endpoint that serves it. Before, the id was unknown to the catalog and
    passed with only an `unknown_model` warning, although `/v1/speak` accepts
    the Aura and Aura-2 voices alone ("Flux TTS is served on the new `/v2/speak`
    endpoint … Aura and Aura-2 continue to be served on `/v1/speak`",
    https://developers.deepgram.com/changelog/2026/8/12). Other unknown ids keep
    the warning, so a new Aura voice is never refused.

- 73aeeb0: deepgram: retire `aura-2-perseo-it`
  - Removed: `aura-2-perseo-it` (from `ttsModels`, `DeepgramTtsModelId`, the
    `unmodel/tts` ref union and `unmodel/deepgram/values`' `TTS_MODELS` /
    `TTS_MODEL_PARAMS`). Deepgram never served it — "The unsupported
    `aura-2-perseo-it` model is removed from Speak V1 model literals; the API
    never served that model" (https://developers.deepgram.com/changelog/2026/9/14),
    and the API answers it with 400 `No such model/version combination found`
    (deepgram-python-sdk changelog). The `/v1/speak` `model` enum now lists 102
    Aura voices.
  - Replacement: none — pick one of the nine Italian Aura-2 voices that remain:
    `aura-2-cesare-it`, `aura-2-cinzia-it`, `aura-2-demetra-it`,
    `aura-2-dionisio-it`, `aura-2-elio-it`, `aura-2-flavio-it`,
    `aura-2-livia-it`, `aura-2-maia-it`, `aura-2-melia-it`. The id now
    validates with an `unknown_model` warning and no cost estimate.

- ec2c2f2: deepseek: `deepseek-flash` joins the catalog, and `deepseek.chat` enforces DeepSeek's documented thinking-mode and endpoint rules
  - `deepseek-flash` (DeepSeek-V4.1-Flash-1017, text and image input) validates
    and prices like its siblings: a 1,048,576-token context, `max_tokens` up to
    393,216, and $0.15 input / $0.003 cache hit / $0.60 output per 1M tokens.
  - The legacy names `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` stay
    reachable and now warn `deprecated_model`: DeepSeek retired both models and
    serves both names with DeepSeek-V4.1-Flash-1017 at the Flash price, so their
    rows now carry that model's limits, image input and rates.
  - `deepseek-v4-pro` is repriced to $0.66 input / $0.022 cache hit / $1.98
    output per 1M tokens.
  - Every deepseek id accepts `max_tokens` up to the documented 393,216; values
    from 384,001 up were refused before.
  - Cost estimates use DeepSeek's off-peak rates (what models.dev carries). Peak
    hours — 01:00–04:00 and 06:00–10:00 UTC, Monday to Friday, excluding Chinese
    public holidays — bill at twice these rates, which the estimate does not model.

  New refusals, each a documented 400:
  - `tool_choice: "required"` or a named function choice while thinking mode is on,
    which is DeepSeek's default. Turn thinking off with `reasoning_effort: "none"`
    or `thinking: { type: "disabled" }`, or use `"auto"` / `"none"`.
  - `stream_options` without `stream: true`.
  - `reasoning_effort` outside DeepSeek's values: `none`, `low`, `high`, `max`,
    the compatibility aliases `minimal`, `medium`, `xhigh`, and `ultra`.
  - Inline or declared images on the image-capable ids beyond JPEG/PNG/GIF/WebP,
    32 MiB, or 8192 px per side.

  New warnings (the API accepts the value and does not use it):
  `frequency_penalty` and `presence_penalty` ("no longer supported"),
  `temperature` in thinking mode, and `top_p` where the model fixes or clamps it
  (`deepseek-flash` raises values below 0.95 in thinking mode and ignores the
  value in non-thinking mode; `deepseek-v4-pro` ignores it in thinking mode).

  Sources, all checked 2026-11-12:
  https://api-docs.deepseek.com/api/create-chat-completion,
  https://api-docs.deepseek.com/api/list-models,
  https://api-docs.deepseek.com/quick_start/pricing,
  https://api-docs.deepseek.com/guides/vision,
  https://api-docs.deepseek.com/guides/thinking_mode,
  https://api-docs.deepseek.com/updates.

- 91c961d: deepseek: `deepseek.chat` types DeepSeek's own params and content parts, stops refusing its documented image shapes, and `checkChat` flags interrupted completions
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

- 007c6bf: elevenlabs (2026-11-12): corrected rates, limits and deprecations, and five requests the API accepts that were being refused
  - **Rates** (elevenlabs.io/pricing/api):
    - Multilingual-class TTS (`eleven_v4`, `eleven_v3`, `eleven_multilingual_v2`) is now $0.08 per 1,000 characters (was $0.10). Flash/Turbo is now $0.04 (was $0.05).
    - `eleven_v3_conversational` gains its published $0.04 rate.
    - Batch Scribe (`scribe_v3`, `scribe_v2`, `scribe_v2_medical`, `scribe_v1`) is now $0.20 per hour (was $0.22). The page has no Scribe v1 card, so `scribe_v1` takes the generic "(Scribe)" rate.
    - Realtime Scribe (`scribe_v2_realtime`, `scribe_v3_live`) is now $0.22 per hour (was $0.39).
    - `checkTranscription` and every estimate move with them.
  - **Limits**: `eleven_multilingual_v1` and `eleven_english_sts_v1` carry the 10,000-character figure from elevenlabs.io/docs/overview/models.
  - **Deprecations**: `music_v1` (removal 2027-01-31; use `music_v2_5`) and `eleven_text_to_sound_v2` (removal 2027-03-01; use `eleven_text_to_sound_v3`) are marked `deprecated`. Both are still served and are still the server defaults, so `elevenlabs.music` and `elevenlabs.sfx` without a `model_id` now warn `deprecated_model`.
  - **Requests that were wrongly refused**:
    - `elevenlabs.sfx` accepts the seven `wav_*` output formats (`wav_8000` … `wav_48000`, added 2026-10-19). In `unmodel/sfx`, 16-bit PCM now compiles to `wav_<rate>` by default and to `pcm_<rate>` with `container: "raw"`, the arrangement `unmodel/tts` already uses.
    - Batch STT and Dubbing accept keyterms of exactly 50 characters. The cap is "at most 50", not "less than 50".
    - `elevenlabs.tts` accepts `use_pvc_as_ivc: null`. The field is no longer tagged `@deprecated`: the API deprecated it on Text to Dialogue only.
    - `elevenlabs.stt` accepts `null` for `webhook_id`, `temperature` and `seed`. Source: api.elevenlabs.io/openapi.json.
  - **Links**: error `source` links point at the pages ElevenLabs serves today. The dubbing reference moved to `/docs/api-reference/dubbing/create-project`; the old URL redirects to a sign-in page. `/docs/models`, `/docs/capabilities/voice-changer` and `/docs/best-practices/prompting/controls` now redirect to their `/docs/overview/…` pages. `provider.doc` is updated to match.

- a5c7848: elevenlabs (2026-11-12): six new models on routes unmodel already validates, and the per-model rules they bring
  - `elevenlabs.tts` accepts **`eleven_v4`** (10,000 characters per request, $0.08 per 1,000 characters) and `voice_settings.clone_strength` (0–1; "Applies only to professional voice clones fine-tuned for the selected v4 model"). In `unmodel/tts`, `clone_strength` is an extra on `elevenlabs/eleven_v4` only. Sources: elevenlabs.io/docs/eleven-api/quickstart, elevenlabs.io/docs/overview/models, elevenlabs.io/pricing/api, api.elevenlabs.io/openapi.json.
  - `elevenlabs.textToSpeechStreamInput` now refuses `eleven_v3` and `eleven_v4` by name ("That endpoint does not support the `eleven_v3` or `eleven_v4` models"), pointing at the Text to Dialogue WebSocket; its allow-list is the new `STREAM_INPUT_MODEL_IDS` / `ElevenlabsStreamInputModelId`. Source: elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tts.
  - `elevenlabs.stt` accepts **`scribe_v3`** and **`scribe_v2_medical`** ($0.20 per hour each). `scribe_v3` adds `numbers_format` (`"digits"` | `"words"`) and `secondary_language_codes` (sent as one form field per code); both are refused on every other batch model, which "returns an `invalid_parameters` error". `no_verbatim` is accepted on `scribe_v2_medical` and `scribe_v3`. Source: elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/batch/number-and-language-options.
  - `elevenlabs.speechToTextRealtime` accepts **`scribe_v3_live`** ($0.22 per hour), `commit_strategy: "turn_prediction"` and `multilang_mode`. Both are refused on `scribe_v2_realtime` ("Other models reject … with an `invalid_request` error and close the connection"). `speechToTextRealtimeUrl` serializes `multilang_mode`. The batch route now points `scribe_v3_live` and `scribe_v2_realtime` at `elevenlabs.speechToTextRealtime`.
  - `elevenlabs.music` accepts **`music_v2_5`** ($0.15 per generated minute). It takes the chunks `composition_plan` ("Composition plan for the `music_v2` and `music_v2_5` models"), refuses the sections plan, and warns that `respect_sections_durations` is ignored. Source: api.elevenlabs.io/openapi.json, elevenlabs.io/docs/changelog/2026/9/14.
  - `elevenlabs.sfx` accepts **`eleven_text_to_sound_v3`** ($0.12 per generated minute). The served spec places no per-model restriction on `loop`, so the warning about `loop` on a model this build does not know has been removed. Source: elevenlabs.io/docs/changelog/2026/11/2, api.elevenlabs.io/openapi.json.
  - The unified packs (`unmodel/tts`, `unmodel/stt`, `unmodel/music`, `unmodel/sfx`) and `unmodel/elevenlabs/values` list the new refs.

- 2cf2d3d: elevenlabs: `elevenlabs.tts` bounds `stability` and `similarity_boost` to 0–1, and two more error links follow ElevenLabs' moved pages
  - **New refusals**: `elevenlabs.tts` now refuses `voice_settings.stability` and `voice_settings.similarity_boost` outside 0–1 (`invalid_shape` at `["voice_settings", "<key>"]`). The text-to-speech request body on api.elevenlabs.io/openapi.json bounds both to `"maximum":1.0,"minimum":0.0` (read 2026-11-13), so such a request fails at the API anyway. `TTS_STABILITY_MIN` / `TTS_STABILITY_MAX` and `TTS_SIMILARITY_BOOST_MIN` / `TTS_SIMILARITY_BOOST_MAX` are exported from `unmodel/elevenlabs`. `style` stays unbounded, because no ElevenLabs source bounds it. `elevenlabs.sts` is unchanged: its body sends `voice_settings` as an untyped JSON string.
  - **`.toApi("fal")`**: the out-of-range refusal for `stability` / `similarity_boost` now happens at the source validator instead of the fal mapping. The fal-side 0–1 refusal remains for `style` alone, the one setting fal bounds and ElevenLabs does not.
  - **Catalog**: `eleven_multilingual_sts_v2` no longer carries `limit.characters: 10000`. The character-limit table on elevenlabs.io/docs/overview/models lists only `eleven_english_sts_v2` and `eleven_english_sts_v1`, so the figure had no source. No check reads it.
  - **Links**: `elevenlabs.speechToTextRealtime`'s keyterm-cap issues cite `/docs/overview/capabilities/speech-to-text`, since `/docs/capabilities/speech-to-text` now redirects there. `elevenlabs.dubLanguage` issues cite `/docs/api-reference/dubbing/language-targets/create-language-target`, since the old `/dubbing/project/language/create` URL redirects to a sign-in page.

- 711df3c: fish-audio: `s1` is deprecated, `s2-pro` has open weights, the TTS `language` and `pronunciation_dictionary` fields and the voice-clone `voice_design_signatures` field are accepted, `repetition_penalty` on `s2.1-pro` warns as a no-op, and the voice-clone visibility checks follow the private default
  - `s1` now carries `status: "deprecated"`, so requests that use it get a
    `deprecated_model` warning. "S1 is deprecated and will be retired on December 31, 2026. After that date, requests that specify `s1` are served by `s2.1-pro`"
    ([deprecations](https://docs.fish.audio/developer-guide/models-pricing/deprecations)).
    It is still served until that date, so it keeps validating and its
    single-speaker rule stays.
  - `s2-pro` now has `openWeights: true`. models-overview lists it as
    "Open-source", and https://huggingface.co/fishaudio/s2-pro publishes the
    weights.
  - `fish-audio.tts` accepts `language`, a BCP-47 tag of at most 35 letters,
    digits, `-` or `_`. Anything else is an error, since the docs say such
    values "are rejected with HTTP 400". Before this change the request type
    refused the field at compile time. Fish Audio uses it "only by text
    normalization … and by word-timestamp alignment", so the canonical
    `language` on `unmodel/tts` is still refused, and the refusal reason now
    says why.
  - `fish-audio.tts` accepts `pronunciation_dictionary`: up to 3 references
    (`{ id, version }`) or up to 3 inline dictionaries (`{ items }`, each with at most
    5000 entries), never both in one request. The fields follow the
    `PronunciationDictionaryRef`, `PronunciationDictionaryInline` and
    `PronunciationItem` schemas. Fish Audio bills "the text actually synthesized, with alias replacements
    counted". A request that carries a reference or an inline `alias` entry
    therefore gets no cost estimate. Phoneme-only dictionaries keep the
    estimate.
  - `fish-audio.voiceClone` accepts `voice_design_signatures` (a string or an
    array, sent as one form part per item). Fish Audio documents no way to get
    a signature: the voice-design candidates in the response have no signature field.
  - `fish-audio.voiceClone` no longer warns when `visibility` is omitted. That
    warning said the default was "public". The POST /model schema now has
    `"default": "private"`, and "Public requests are downgraded to private; use
    the web publish flow to publish publicly"
    ([openapi.json](https://docs.fish.audio/api-reference/openapi.json)).
  - `fish-audio.voiceClone` (and `unmodel/voice-clone` on `fish-audio/fast`)
    now warns that an explicit `visibility: "public"` is downgraded to private.
    The warning is `unsupported_param` at `visibility`, with `meta.applied:
"private"`.
  - `fish-audio.voiceClone` (and `unmodel/voice-clone` on `fish-audio/fast`)
    now warns, and no longer refuses, when `visibility: "public"` has no
    `cover_image`. Public requests are downgraded to private, and the docs do
    not say whether the server still requires one.
  - `fish-audio.tts` warns that `repetition_penalty` is accepted but has no
    effect on `s2.1-pro`, including when the `model` header is omitted and the
    server falls back to `s2.1-pro`. The source is "`repetition_penalty` applies
    to S1 but has no effect on S2.1-Pro"
    ([migrate-from-s1](https://docs.fish.audio/developer-guide/models-pricing/migrate-from-s1)).
    On `unmodel/tts`, `fish-audio/s2.1-pro` no longer takes `repetition_penalty`
    as an extra, so the request is refused at compile time.
    `s2.1-pro-free`, `s2-pro`, `drama-3` and `s1` still take it, because the
    page names only S2.1-Pro.
  - `pronunciation_dictionary` is now a typed extra on `unmodel/tts` for every
    `fish-audio/…` model, and `TTS_MODEL_PARAMS` in `unmodel/fish-audio/values`
    lists it. Before this change it was reachable only through `providerOptions`.
  - The doc comments now give the JavaScript SDK's real package name, `fish-audio`
    (`fish-audio-sdk` is the Python package), and list the fields its
    0.1.0 types lack.

- 9613137: fish-audio: `drama-3` joins `fish-audio.tts` and `unmodel/tts` (`fish-audio/drama-3`)
  - `drama-3` (Fish Audio Drama 3, launched 2026-10-13) is a value of the
    `model` header enum on `POST /v1/tts`. It validates, compiles from
    `unmodel/tts` with the same codecs and extras as the S2 rows, and prices at
    the list rate of $50.00 / M UTF-8 bytes
    ([pricing](https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits)).
    Fish Audio bills a launch price of $10.00 / M UTF-8 bytes through
    2026-11-30; the catalog carries the list price, so `maxCostUSD` budgets
    against the price you pay from 2026-12-01.
  - Multi-speaker dialogue (a `reference_id` array or a nested `references`
    array) is accepted on `drama-3`. The TTSRequest schema reads "Multi-speaker
    dialogue synthesis is available with the S2 family (`s2-pro`, `s2.1-pro`,
    `s2.1-pro-free`) and `drama-3`, not `s1`". The new
    `MULTI_SPEAKER_MODEL_IDS` export lists those models, and the `s1` refusal
    names them in its message and in `meta.allowed`.
  - The `prosody.normalize_loudness` no-op warning now fires only on `s1`, the
    one model the docs say it has no effect on. A `drama-3` request that sets it
    validates clean.
  - `docs/providers.md` lists Fish Audio's speech-to-text (`POST /v1/asr`) and
    realtime transcription socket as still to do.

- 7e99509: gladia: no USD cost for Gladia models (they are priced in EUR only now), and `solaria-3` stops refusing language setups Gladia documents
  - **Cost removed from `solaria-1` and `solaria-3`.** www.gladia.io/pricing
    (and its plain-text copy www.gladia.io/pricing.md, "Last updated:
    2026-11-03", "Currency: EUR") now lists EUR rates only: Solaria-1 0.27€/hr,
    Solaria-3 0.16€/hr and real-time 0.68€/hr, with automatic volume discounts,
    on a prepaid wallet. It no longer shows a USD rate. The catalog used the old
    "Async at $0.61 /hr" for both models, so it was wrong on two counts: the
    currency, and that the two models no longer cost the same. Converting to
    USD would mean guessing an exchange rate, so the rows carry no `cost`.
    `gladia.stt` estimates and `checkPreRecorded` reports therefore have no
    `costUSD`, and `maxCostUSD` has nothing to enforce for Gladia.
  - **Removed: the `REALTIME_USD_PER_MINUTE` export of `unmodel/gladia`** (the
    old "Real-time at $0.75 /hr"). There is no replacement. Gladia's only
    real-time rate is in EUR (0.68€/hr), and unmodel does not validate the live
    WebSocket API.
  - **`solaria-3` with no language, or with several, is now a warning, not an
    error.** Gladia's endpoint page says "pass exactly one language", but the
    Models page (docs.gladia.io/chapters/introduction/models) says you can pass
    "several from EN/FR/DE/ES/IT so the model can pick among those covered
    languages". The OpenAPI (api.gladia.io/openapi.json) puts no per-model
    limit on the array, and www.gladia.io/solaria-3 lists auto language
    detection as Supported. The warning names the one-language form that every
    page accepts.
  - **`solaria-3` now checks every entry in `language_config.languages`
    against its five languages (en, fr, de, es, it), not only the first.** So
    `["en", "ja"]` is refused at `language_config.languages.1`, and the error
    names `"ja"`. Through `unmodel/stt`, that error is reported at `languages`.
  - **`solaria-3` with `code_switching: true` and exactly one language is now
    a warning.** The OpenAPI says "If one language is set, this option will be
    ignored." With no language or several, it is still refused.

- 8392c82: gladia: through `unmodel/stt`, the `solaria-3` no-language warning now names `language`

  A `gladia/solaria-3` call that sets neither `language` nor `languages` gets a
  warning asking it to pin one language. That warning was reported at the raw
  wire path `language_config.languages`, a field the caller never wrote. It is
  now reported at `language`, and its message ends "(compiled from
  `language_config.languages`)", like the other solaria-3 language findings.
  A `language_config` sent through `providerOptions.gladia` is still reported
  at its wire path.

- 57d6b1b: google: the three preview TTS ids are deprecated (shutdown 2026-11-17), and `gemini-2.5-flash-image` takes its documented 65,536-token window
  - **`gemini-2.5-flash-preview-tts`, `gemini-2.5-pro-preview-tts`, `gemini-3.1-flash-tts-preview`** now carry `status: "deprecated"` on `google.tts` and `google.chat`, so a request to any of them gets a `deprecated_model` warning five days before they stop answering. Source: https://ai.google.dev/gemini-api/docs/deprecations (2026-11-12) — "`gemini-3.1-flash-tts-preview` — February 26, 2026 — November 17, 2026 — `gemini-3.8-flash-tts` or `gemini-3.8-flash-lite-tts`", with the same November 17, 2026 row for the two 2.5 ids. models.dev carries no status for them; the hand rows in `ttsModels` do, and `google.chat`'s overlay now takes those hand rows wholesale for every TTS id models.dev carries (`ttsModelOverrides` is that table), so both surfaces say the same thing about the same id. The `unmodel/tts` golden fixtures for google move to `gemini-3.8-flash-tts`, the named replacement.
  - **`gemini-2.5-flash-image`** — a false `over_context` refusal fixed: its model page says "**Input token limit** 65,536" (https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image, 2026-11-12) where models.dev carries 32,768, so a 32k–65k-token prompt the API accepts was refused. `google.chat` now validates against 65,536 (`GEMINI_25_FLASH_IMAGE_CONTEXT_TOKENS` on `unmodel/google`); the test pins both halves so the override retires when the upstream row is fixed.

- c9e5da0: google (2026-11-12): Gemini 4 lands with its documented per-model rules; the Gemini 3.8 TTS pair, Gemini 3.5 Transcribe, Lyria 3.5 and Nano Banana 2.1 join as hand rows; the shut-down Veo 3.1 previews leave
  - **`google.chat` / `unmodel/chat` — Gemini 4.** `gemini-4-argon`, `gemini-4-carbon`, `gemini-4-hydrogen` and `gemini-pro-latest` arrive from the models.dev snapshot, and the rules the Gemini 4 docs state per model are enforced:
    - `thinkingLevel: "MINIMAL"` is refused on all three — "Gemini 4 models (`gemini-4-carbon`, `gemini-4-argon`, and `gemini-4-hydrogen`) do not support `minimal`" (long-decode guide); the refusal names the levels each model does take (`LOW, MEDIUM, HIGH`, plus `XHIGH` on Hydrogen).
    - `thinkingBudget` and `thinkingLevel` together are refused — "sending `thinkingBudget` and `thinkingLevel` together returns a `400` error" (thinking guide). A budget alone still passes: "If passed alone, it maps to the nearest `thinkingLevel` … and returns a warning."
    - `cachedContent` is refused on Carbon and Argon — "Explicit caching (`cachedContents` / `caches.create`) is not supported on Gemini 4 Carbon and returns an error" (and the same sentence for Argon). Hydrogen is left alone: its page says "not supported" and never that the request errors.
    - `maxOutputTokens` is bounded by the 1,048,576-token long-decode ceiling, not the catalog's 32,768 / 65,536 per-hop defaults — "Output can use up to 1,048,576 minus your input tokens"; the long-decode guide's own REST sample sends `maxOutputTokens: 262144` to `gemini-4-carbon:generateContent`, which the previous bound refused.
    - `XHIGH` joins `GEMINI_THINKING_LEVELS` and `GoogleThinkingLevel` ("XHigh thinking level." — REST reference; "Hydrogen … adds `xhigh`"), so the thinking guide's own `thinkingLevel: "xhigh"` sample for Hydrogen no longer fails `invalid_enum_value`. On `unmodel/chat`, `reasoning: "xhigh"` against the gemini dialect compiles to `XHIGH` instead of narrowing to `high` with `approximated_param`.
    - The wire gains top-level `continuationToken` ("An opaque continuation token used to resume generation … that stopped with `finish_reason` set to `CONTINUATION`") and `labels` ("Labels with user-defined metadata for the request."). `checkChat` reports `finishReason: "CONTINUATION"` as an incomplete-by-design response (`meta.kind: "continuation"`, naming the token to resend) and `GoogleFinishReason` gains the member. Like `store`, `continuationToken` stays off `.toSdk("google")`: the pinned `@google/genai` declares no such config field.
    - The thinking tables (`GEMINI_THINKING_LEVELS`, `GEMINI_NO_MINIMAL_THINKING_MODEL_IDS`, `GEMINI_THINKING_DOCS_URL`) now live on an import-free leaf so the battery `google.chat`, `google.stt` and `google.tts` share can enforce them; every name is still exported from `unmodel/google`. New there: `GEMINI_4_MODEL_IDS`, `GEMINI_XHIGH_THINKING_MODEL_IDS`, `GEMINI_LONG_DECODE_MAX_OUTPUT_TOKENS`, `GEMINI_LONG_DECODE_DOCS_URL`.
  - **`google.chat` hand rows** (`chatSupplementModels`, for generateContent ids models.dev's google section does not carry): `gemini-nano-banana-2.1` — "Input token limit 131,072 / Output token limit 32,768", $1.50 per 1M in and "$7.50 (text and thinking) / $30.00 (images)" per 1M out, all 14 aspect ratios at 1K / 2K / 4K and no 512 ("not supported on Gemini Nano Banana 2.1"); `gemini-robotics-er-2-preview` — 131,072 / 65,536, "$1.00 … through December 31, 2026" in and "$5.00 through December 31, 2026" out (both double on 2027-01-01); and the Gemini 3.8 TTS pair below.
  - **`google.tts` / `unmodel/tts` — Gemini 3.8 TTS.** `gemini-3.8-flash-tts` ($0.50 per 1M text in; "$9.00 (audio) through December 31, 2026. $18.00 (audio) starting January 1, 2027.") and `gemini-3.8-flash-lite-tts` ($0.50; "$6.00 (audio) through December 31, 2026. $12.00 (audio) starting January 1, 2027.") — the deprecations page's named replacements for `gemini-3.1-flash-tts-preview`, `gemini-2.5-flash-preview-tts` and `gemini-2.5-pro-preview-tts`, all of which shut down on 2026-11-17. Both rows carry their model pages' "Input token limit 8,192 / Output token limit 16,384 (Gemini API serving limit)" and `reasoning: false` (Thinking: not supported). New types: `GoogleTts38FlashBody`, `GoogleTts38FlashLiteBody`.
  - **`google.stt` / `unmodel/stt`.** `gemini-3.5-transcribe` joins as a hand row (`sttSupplementModels`, merged into `sttModels`): the transcribe guide posts to `models/gemini-3.5-transcribe:generateContent`; "$2.00 or $0.003/min (audio)" in and "$12.00 or $0.002/min (text)" out; "Up to 1 hour per request (up to 30 minutes when speaker diarization or word-level timestamps are enabled)"; Thinking not supported, so `thinkingConfig` is refused on it. `audioTranscriptionConfig.mode` ("Supported values: `VERBATIM`, `SMART`.") is typed on the wire config and offered as a unified extra. `gemini-4-argon`, `gemini-4-carbon`, `gemini-4-hydrogen` and `gemini-pro-latest` join the curated list (the catalog lists all four as audio-in / text-out), and the Gemini 4 thinking rules above apply on this surface too.
  - **`google.music` / `unmodel/music`.** `lyria-3.5` — "Lyria 3.5 (Full Song) … $0.08 per song"; "Input token limit 131,072"; the deprecations page's replacement for `lyria-3-pro-preview`. Its unified row offers MP3 only (no page extends Pro's WAV option to it). New type: `Lyria35Body`.
  - **Retired from `google.video` / `unmodel/video`:** `veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview`, `veo-3.1-lite-generate-preview` — "were shut down on October 22, 2026" (their model pages); the deprecations page names `gemini-omni-1.2-flash` (an Interactions API model unmodel does not serve yet) as the replacement, so the three ids now validate with `unknown_model`. With them go their `VEO_RESOLUTION_RATE_OVERRIDES`, `VEO_PARAMETER_SPACE` and `VIDEO_MODEL_PARAMS` rows. Reference images and video extension were Veo 3.1 features and are now refused on every served id. Every remaining Gemini API video id (Veo 2, Veo 3, Veo 3 Fast) is `status: "deprecated"`; the surface's future is an owner decision recorded in the audit, not made here.

  Sources, all retrieved 2026-11-12: aistudio.google.com/docs/models/{gemini-4-hydrogen, gemini-4-carbon, gemini-4-argon, gemini-nano-banana-2.1, gemini-robotics-er-2-preview, gemini-3.8-flash-tts, gemini-3.8-flash-lite-tts, gemini-3.5-transcribe, lyria-3.5, veo-3.1-generate-preview, veo-3.1-lite-generate-preview}, docs/{long-decode, thinking, caching, whats-new-gemini-4-hydrogen, whats-new-gemini-4-carbon, whats-new-gemini-4-argon, image-generation, transcribe, music-generation, pricing, deprecations, changelog}, api-reference/generate-content.

- b92d5cd: google: retire the shut-down `gemini-omni-flash-preview`, the two image `-preview` rule rows and `gemini-3.1-flash-lite-preview` from the curated surfaces

  Every date below is from https://ai.google.dev/gemini-api/docs/deprecations (retrieved 2026-11-12).
  - **`google.video` / `unmodel/video` — `gemini-omni-flash-preview`.** "June 30, 2026 — October 22, 2026 — `gemini-omni-1.2-flash`"; its model page: "Shut down: `gemini-omni-flash-preview`". models.dev still carries the row, so the id is now refused by name — `unsupported_capability` at `model`, naming the shutdown and the replacement (`gemini-omni-1.2-flash`, an Interactions API model unmodel does not serve yet) — through the new `VIDEO_RETIRED_IDS` map on `unmodel/google`, instead of validating against a model that no longer answers. It leaves `VIDEO_MODELS` / `VIDEO_MODEL_PARAMS`, `VEO_PARAMETER_SPACE` and `videoConstraints`. Retired with it: `GEMINI_OMNI_FLASH_DOCS_URL` and `videoDocsUrl()` (every remaining video constraint cites the Veo page).
  - **`GEMINI_IMAGE_MODEL_RULES` — `gemini-3.1-flash-image-preview` and `gemini-3-pro-image-preview`.** Both rows are gone: "`gemini-3.1-flash-image-preview` — February 26, 2026 — June 25, 2026 — `gemini-nano-banana-2.1`" and "`gemini-3-pro-image-preview` — November 20, 2025 — June 25, 2026 — `gemini-3-pro-image`". The ids also left the models.dev snapshot, so `google.chat` now reports them `unknown_model`.
  - **`google.stt` / `unmodel/stt` — `gemini-3.1-flash-lite-preview`.** "March 3, 2026 — May 25, 2026 — `gemini-3.1-flash-lite`". Moved from `GEMINI_STT_MODEL_IDS` to `GEMINI_STT_EXCLUDED_IDS`, so a transcription request to it is refused with the shutdown date and pointed at `gemini-3.1-flash-lite`, which the surface serves. The curated list is now 19 ids, the exclusion map 6.

- 6b64436: google: Search grounding passes on the image models, `voiceConfig.voice` is typed, Lyria 3.5 takes WAV, and gemini-3.5-transcribe warns past its 1-hour / 30-minute bound
  - **`google.chat`: built-in tools are no longer refused on `toolCall: false` models.** That flag is models.dev's `tool_call`, which covers function calling and nothing else. The check now refuses only a `tools[i]` entry that carries `functionDeclarations`, and reports it at `["tools", i, "functionDeclarations"]` instead of `["tools"]`. `googleSearch`, `urlContext`, `codeExecution` and the other built-in tools pass, because the catalog has no flag for them. This fixes a false refusal: the Nano Banana model pages (`gemini-nano-banana-2.1`, `gemini-3.1-flash-image`, `gemini-3-pro-image`) badge Function calling not-supported and "Grounding with Google Search" supported, and the image-generation guide's REST sample posts `"tools": [{"google_search": {}}]` to `gemini-nano-banana-2.1:generateContent`. Both requests used to fail with `unsupported_capability`. The per-model type arm matches: on a `toolCall: false` model `tools` is now an array of tools whose `functionDeclarations` is `never`, so `tools: [{ googleSearch: {} }]` on `gemini-3.1-flash-image` compiles. Not in this change: `google-vertex`'s `chat` runs the same blanket check, and its generated `gemini-nano-banana-2.1` row is also `toolCall: false`.
  - **`GoogleVoiceConfig.voice`** (`voice?: string`): "The speaker identifier for synthesis. Supported formats: Speaker name for prebuilt voices (for example, `Orus` or `Kore`). Voice ID for stored voices (for example, `voice_xxx`). Voice replication key (for example, `voicekey_xxx`)." This is the REST reference's second `voiceConfig` union member. The Gemini 3.8 TTS guide's own single-speaker sample sends `"voiceConfig": {"voice": "Kore"}`. Before this change `google.tts` and `google.chat` failed to compile on it with TS2353, while the runtime already accepted it. Text parts on both surfaces also gain `speechMetadata?: { speaker?: string; style?: string }`, the guide's per-part speaker and style annotation. `prebuiltVoiceConfig.voiceName` keeps its closed 30-name list. `google-vertex`'s body types extend this body, so they inherit both fields. Neither field has been checked against Vertex's own `VoiceConfig`.
  - **`unmodel/music` — `google/lyria-3.5` offers `outputFormat: "pcm_s16le"` (WAV).** The music guide (2026-11-13) says: "By default, the Lyria 3.5 models generate audio in MP3 format. For Lyria 3.5, you can also request the output in WAV format by setting the `response_format`." Its row in `GOOGLE_MUSIC_MODEL_PARAMS` was MP3-only, so the type refused a request that the runtime, the wire arm and the API all accept. The Clip messages (the `google.music` refusal and the unified `dropped_param` warning) quoted "This WAV format option is available for Lyria 3 Pro only", a sentence the guide no longer contains. They now cite the guide's model table ("MP3") and the Lyria 3.5 sentence. Clip's behaviour is unchanged.
  - **`google.stt` — `gemini-3.5-transcribe`.**
    - A declared audio duration over 3,600 s, or over 1,800 s with `diarization` or `wordTimestamp` on, now draws a `media_duration_exceeded` **warning** at the part where the summed declared duration crosses the bound. The request still passes. The model page says "Up to 1 hour per request (up to 30 minutes when speaker diarization or word-level timestamps are enabled)". The guide says longer audio "is truncated at the limit while still returning a completed response", which is why this is a warning and not an error.
    - The hand row drops `structuredOutput: true`. The model page has no Structured outputs badge, so the catalog now gives no answer. Validation is unchanged.
  - **`google.video` — the model union no longer offers `gemini-omni-flash-preview`.** `GenerateVideosBody["model"]` subtracts the ids in `VIDEO_RETIRED_IDS`, which the runtime refuses by name. Any string is still assignable. docs/providers.md now states that every id `google.video` serves is shut down upstream: Veo 2 / Veo 3 / Veo 3 Fast on 2026-06-30, and the Veo 3.1 previews and `gemini-omni-flash-preview` on 2026-10-22. What to do with the surface is an open owner decision, recorded in `veo-models.ts`.

  Sources, retrieved 2026-11-12/13: aistudio.google.com/docs/models/{gemini-nano-banana-2.1, gemini-robotics-er-2-preview, gemini-3.5-transcribe, gemini-3.8-flash-tts}, docs/{image-generation, music-generation, speech-generation, transcribe, deprecations}, api-reference/generate-content.

- 30c7fc1: google-vertex, google: Google Search grounding on the image models, Gemini 4 long decode on Vertex, and a warning for partner models on `vertex.chat` (pages retrieved 2026-11-13)
  - **Google Search grounding is no longer refused on models without function calling.** `vertex.chat` and `google.chat` refused every `tools` entry on a `toolCall: false` row, including `{ googleSearch: {} }`, which these models' pages list as supported:
    - Vertex `gemini-nano-banana-2.1`: "Grounding Google Search, Image search Supported".
    - Vertex `gemini-3-pro-image` and `gemini-3.1-flash-image`: "Grounding Google Search Supported".
    - The Gemini API pages for all three models list "Grounding with Google Search" as supported.

    `googleSearch` now passes on these three ids, image search included (`googleSearch.searchTypes.imageSearch`). Every other tool key is still refused, one issue per key at `["tools", i, key]`: `functionDeclarations` ("Function calling Not supported"), and `codeExecution` and `urlContext`. Every other `toolCall: false` row still refuses `tools` outright at `["tools"]`. That includes `gemini-2.5-flash-image`, whose pages say grounding is not supported. On `google.chat`, the per-model `tools` type arm follows the runtime check. The three ids accept only the `googleSearch` shape, where `gemini-3-pro-image` and `gemini-3.1-flash-image` took `never` before and `gemini-nano-banana-2.1` took the full tool array.

  - **Gemini 4 `maxOutputTokens` on Vertex goes up to 1,048,576.** `vertex.chat` refused any `generationConfig.maxOutputTokens` above 65,536 on `gemini-4-argon`, `gemini-4-carbon` and `gemini-4-hydrogen`. Each model page lists "Maximum output tokens 1,048,576", and each developer guide says "setting `max_output_tokens` greater than `1,048,576` returns an HTTP `400` error". Carbon's guide also sends 131072 and 256000 in its samples. The `over_output_limit` error now fires only above 1,048,576 and cites the guide (`…/models/guides/<id>#long-decodes`). A value above 65,536 and at most 1,048,576 passes with an `over_output_limit` warning. The warning explains that long decode needs `continuation_token`, which "is supported only in the `v1beta1` API", but `.request.url` targets `/v1/`. For output past one segment, use `.toSdk("google-vertex")`, since the Gen AI SDK uses v1beta1 by default, or call a `/v1beta1/` REST path. `estimate()` and the catalog's `limit.output` are unchanged.
  - **Partner and open models on `vertex.chat` now get a warning.** The google-vertex catalog includes Claude, Mistral, Grok and the `-maas` open models, and `vertex.chat` validated them with no warning into a `publishers/google/models/{model}:generateContent` URL, which Vertex does not document for them. They now pass with an `unsupported_capability` warning at `["model"]`. The warning names the route Vertex does serve them on, in `meta.route`, with the page in `meta.source`:
    - `-maas` and `xai/` ids: `endpoints/openapi/chat/completions`, the OpenAI-compatible route (…/models/maas/call-open-model-apis, …/partner-models/use-partner-models: "Grok models use the OpenAI-compatible chat completions and Responses APIs, so the request path uses `endpoints/openapi`").
    - Claude: `publishers/anthropic/models/{model}:rawPredict`.
    - `mistral-*` and `codestral-*`: `publishers/mistralai/models/{model}:rawPredict` (…/partner-models/mistral).

    The warning also says unmodel has no validator for those routes. The request is still built exactly as written. The families are the ones the availability data already records, and a test pins the two against each other.

- 59bd5b8: google-vertex (2026-11-12): Gemini 4, Nano Banana 2.1 and the new partner rows arrive from models.dev, with the rules the Vertex model pages state for them
  - **Catalog.** The google-vertex section of the 2026-11-12 models.dev snapshot adds `gemini-4-argon`, `gemini-4-carbon`, `gemini-4-hydrogen`, `gemini-nano-banana-2.1` and `gemini-3.1-flash-lite-image` (all served by `chat`, the `:generateContent` route), the `-maas` rows `google/gemma-4-26b-a4b-it-maas`, `meta/llama-4-scout-17b-16e-instruct-maas` and `zai-org/glm-5.2-maas`, the partner rows `xai/grok-4.1-fast-{reasoning,non-reasoning}`, `xai/grok-4.20-{reasoning,non-reasoning}`, `xai/grok-4.3`, `xai/grok-4.6`, `xai/grok-4.7`, `mistral-medium-3`, `mistral-small-2503` and `codestral-2`, and the Claude rows `claude-fable-5-2@default`, `claude-opus-5-5@default`, `claude-sonnet-5-5@default`, `claude-haiku-5-5@default` (also in `google-vertex-anthropic`). It drops `gemini-3.1-flash-lite-preview`, `gemini-flash-latest` and `gemini-flash-lite-latest`, and marks `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite` and `gemini-3.6-flash` deprecated, so those ids now carry a `deprecated_model` warning. The Claude and partner rows are catalog-only: `chat` speaks Gemini `generateContent` on `publishers/google`, which serves none of them.

    `gemini-4-argon` and `gemini-4-carbon` carry the promotional rate ($2.00 in / $10.00 out / $0.10 cached per 1M, global), which Vertex lists "through November 30, 2026" and delivers as "50% credits back on net spend". From 2026-12-01 the page lists $4.00 / $20.00 / $0.20. Until a models.dev refresh lands, `estimate.costUSD` and `maxCostUSD` on these two ids under-price December traffic by half (cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing, retrieved 2026-11-12).

  - **Gemini 4 thinking on `chat`.** Every Gemini 4 page says "Setting thinking_budget or thinking_level="MINIMAL" returns an HTTP 400 validation error." So on Vertex any `thinkingConfig.thinkingBudget` is refused (`unsupported_param`), alone or with a level. That is stricter than the Gemini API, where a budget alone only draws a warning. `thinkingLevel: "MINIMAL"` is refused too (`invalid_enum_value`). Each refusal names the levels the page lists: "LOW, MEDIUM (default), and HIGH" on Argon, "LOW, MEDIUM (default on gemini-4-carbon), and HIGH" on Carbon, and "LOW, MEDIUM, HIGH (default), and XHIGH" on Hydrogen.
  - **Nano Banana 2.1 sampling on `chat`.** Its Vertex page: "The seed, topK, logprobs, temperature, and topP parameters aren't supported for Nano Banana 2.1. Setting any of these parameters returns an API error." Each of these is now refused, and the error cites the page.
  - **Availability data.** Vertex's `xai/` Grok rows are labelled `google-vertex.chatMaas`. The partner-models guide says "Grok models use the OpenAI-compatible chat completions and Responses APIs, so the request path uses endpoints/openapi", which is the same route as the `-maas` models. Vertex's Mistral rows are denied in both directions. The Mistral page documents `publishers/mistralai/models/MODEL:rawPredict`, a route unmodel has no module for. Without these two overrides, both kinds of row were labelled `google-vertex.chat` (Gemini dialect).

  Sources, all retrieved 2026-11-12: docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/{4-argon, 4-carbon, 4-hydrogen, nano-banana-2-1}, …/models/partner-models/{use-partner-models, mistral, grok/responses}, …/models/maas/call-open-model-apis.

- 691fa89: google-vertex: `temperature` on Gemini 4 is a warning, not an error

  The generated Vertex rows for `gemini-4-argon`, `gemini-4-carbon` and `gemini-4-hydrogen` carry `temperature: false`, so `chat` refused `generationConfig.temperature` with `unsupported_param`. The API accepts that request. Each Gemini 4 page says "Custom values for sampling parameters (temperature, top_p, and top_k) are ignored.", and Carbon and Hydrogen list "Temperature: 1.0 (fixed; custom values ignored) topP: 0.95 (fixed; custom values ignored) topK: 64 (fixed; custom values ignored)". So `temperature`, `topP` and `topK` on these three ids now pass, each with an `unsupported_param` warning (`meta.ignored: true`) that cites the page.

  `gemini-nano-banana-2.1` is not part of this change. Its page says those parameters return an API error, so they stay refused.

  Sources, retrieved 2026-11-12: docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/{4-argon, 4-carbon, 4-hydrogen, nano-banana-2-1}.

- 0984f88: groq: catalog refresh (models.dev, 2026-11-12)
  - `groq/compound` and `groq/compound-mini` are gone from the groq catalog and
    from `unmodel/chat`'s refs (`"groq/groq/compound"`, `"groq/groq/compound-mini"`).
    Groq decommissioned both on 2026-09-21 with no replacement: "Beginning on that
    date, requests to these model IDs will return errors."
    (https://console.groq.com/docs/deprecations). `groq.chat` now answers them with
    an `unknown_model` warning instead of validating them silently.
  - `llama-3.1-8b-instant`, `llama-3.3-70b-versatile` and `qwen/qwen3.6-27b` are
    marked deprecated, so `groq.chat` validates them with a `deprecated_model`
    warning. They stay in the catalog because Groq still serves them to enterprise
    accounts: the shutdowns (08/16/26 for both Llamas, 09/14/26 for Qwen 3.6) apply
    "to free and developer-tier usage; enterprise customers with a committed-spend
    contract are not affected". Groq's named replacements: `openai/gpt-oss-20b` for
    Llama 3.1 8B, `openai/gpt-oss-120b` for Llama 3.3 70B, `qwen/qwen3.8-27b` for
    Qwen 3.6 27B.
  - `qwen/qwen3.8-27b`: context window 131,072 (was 131,042), matching
    "CONTEXT WINDOW 131,072" on https://console.groq.com/docs/model/qwen/qwen3.8-27b;
    the row is now marked beta (Groq tags it Preview). Every host's availability
    edge to it on groq narrows to the corrected window.
  - `openai/gpt-oss-safeguard-20b` prices cached input at $0.0375 / 1M tokens:
    Groq's prompt-caching page lists the model and gives "a 50% discount for cached
    input tokens" (https://console.groq.com/docs/prompt-caching).
  - `whisper-large-v3` and `whisper-large-v3-turbo` carry models.dev's 448-token
    limits instead of 0.

- 09ecaab: groq: `qwen/qwen3.8-27b` image estimates, and an honest roster row
  - `groq.chat` now estimates each image sent to `qwen/qwen3.8-27b` at 2048 input
    tokens, the figure Groq documents ("Each image counts as 2048 input tokens.",
    https://console.groq.com/docs/vision, read 2026-11-12), instead of the
    1000-token default. `estimate.inputTokens` and `estimate.costUSD` change for
    image-bearing qwen3.8 requests, and so do the checks that read them: each
    image now counts 2048 tokens toward the 131,072-token `over_context` /
    `near_context` check and toward a `maxCostUSD` `over_budget` check, so a
    request close to either limit can now be refused where it passed before.
  - `docs/providers.md` no longer claims Whisper STT coverage for groq. unmodel
    validates Groq's chat endpoint only; Groq's `/audio/transcriptions`,
    `/audio/translations` (Whisper) and `/audio/speech` (Orpheus) endpoints have
    no validator yet, and their model ids are catalog rows only.

- 7686937: groq: the Whisper ids are named as speech-to-text models, not chat models
  - `groq.chat` now warns `unsupported_capability` (path `["model"]`) on
    `whisper-large-v3` and `whisper-large-v3-turbo`, naming the route Groq does
    serve them on: POST https://api.groq.com/openai/v1/audio/transcriptions and
    /audio/translations for `whisper-large-v3`, transcriptions only for
    `whisper-large-v3-turbo` ("Translation Support | No",
    https://console.groq.com/docs/speech-to-text, read 2026-11-12). unmodel has no
    validator for those routes. It is a warning, and the request is still built
    as written. The 448-token Whisper limits still produce `over_context` /
    `over_output_limit` errors on long requests; the warning now sits beside
    them and gives the real cause.
  - `unmodel/chat` drops the `"groq/whisper-large-v3"` and
    `"groq/whisper-large-v3-turbo"` refs (`ChatModelRef`, `CHAT_MODEL_REFS` and
    the chat profiles). Both compiled to a Chat Completions request that Groq
    serves on no chat route.

- c681ce5: heygen: current USD rates, `null` on every nullable optional, the full voice-engine union, `more_blinking`, `output_upload`, and no `engine` on the raw-image arm

  False refusals fixed (requests HeyGen's OpenAPI document,
  https://developers.heygen.com/openapi/external-api.json, accepts on 2026-11-12
  and `heygen.avatar` / `heygen.lipsync` refused):
  - `null` on every optional the spec types `anyOf: [T, {"type": "null"}]`. On
    `heygen.avatar`: `engine` (on the `avatar` arm, the one that declares it),
    `script`, `voice_id`, `audio_url`, `audio_asset_id`, `voice_settings`,
    `title`, `folder_id`, `resolution`, `aspect_ratio`, `fit`, `background`,
    `remove_background`, `callback_url`, `callback_id`, `watermark`, `caption`,
    `brand_glossary_id`, `motion_prompt`, `expressiveness`. On `heygen.lipsync`:
    `title`, `callback_url`, `callback_id`, `keep_the_same_format`, `start_time`,
    `end_time`, `fps_mode`, `folder_id`. Every cross-field check reads `null` as
    absent. `output_format`, `type`, `mode` and the defaulted lipsync booleans
    stay non-nullable, as in the spec.
  - `voice_settings.engine_settings` takes all seven discriminator values the
    spec maps: `cartesia` (`model`: `"sonic-3.6" | "sonic-3.5"`), `heygen_voice`
    and its legacy alias `orca` (`model: "heygen-voice-1"`, `similarity`,
    `expressiveness` 0–1, `pitch` −4…4 in steps of 0.5, `inflection` 0.5–2) and
    `mockingbird`, beside `elevenlabs`, `fish` and `starfish`. ElevenLabs gains
    `eleven_v4` and Fish Audio `s2.1-pro` (its default). New exports:
    `HEYGEN_CARTESIA_MODELS`, `HEYGEN_VOICE_SIMILARITIES`, and the types
    `HeygenCartesiaEngineSettings`, `HeygenHeyGenVoiceEngineSettings`,
    `HeygenMockingbirdEngineSettings`, `HeygenVoiceSimilarity`.
  - `engine: { type: "avatar_v", more_blinking: true }` type-checks ("Ask Avatar
    V for more natural blinking.").
  - `output_upload` (`{ video, captions?, thumbnail? }` presigned PUT targets,
    "Available to enabled workspaces") is typed and validated instead of drawing
    an `unknown_param` warning. New types `HeygenOutputUpload`,
    `HeygenUploadTarget`.

  Corrections:
  - `unmodel/avatar` → HeyGen no longer writes `engine` into the body.
    `CreateVideoFromImage` declares no `engine` property and is
    `additionalProperties: false`, and the Talking Photo page
    (https://developers.heygen.com/image-to-video) lists its engine as Avatar IV.
    The compiled body is now `{ type: "image", image, audio_url, … }`; a ref
    other than `heygen/avatar_iv` is refused at `model` with
    `unsupported_capability`, naming `heygen.avatar({ type: "avatar", … })` for
    Avatar V and Avatar III.
  - Catalog rates. The old source, https://developers.heygen.com/docs/pricing, is
    a 404; https://developers.heygen.com/llms.txt now points at
    https://platform.heygen.com/pricing ("Sign in to the API dashboard at
    platform.heygen.com to see current prices."). The rates are quoted from the
    platform's own catalog data
    (https://platform.heygen.com/assets/catalogText-1niwFpkW.js, identical in the
    two earlier builds): `avatar_iii` $0.0433 → $0.0165/sec (top of $0.01–$0.0165),
    `avatar_iv` $0.0667 → $0.0805 (top of $0.0385–$0.0805), `avatar_v` $0.0667 →
    $0.12 (the one published tier, Custom Video Avatar; HeyGen publishes no rate
    for its Studio and Photo looks), `lipsync-speed` $0.0333 → $0.014,
    `lipsync-precision` $0.0667 → $0.029. "Rates apply to 720p and 1080p
    output."
  - Documentation: the OpenAPI document is now 1.96 MB with 136 paths and 517
    schemas; the ElevenLabs settings note now reads "When using eleven_v3 or
    eleven_v4, stability may be any value in [0.0, 1.0]."

- 58ffe2e: heygen: `engine` is refused on the raw-image arm, whatever it names

  `heygen.avatar({ type: "image", engine: … })` is now refused for every value,
  including `{ type: "avatar_iv" }` and `null`, with `unsupported_param` at
  `engine`. `CreateVideoFromImage` in HeyGen's OpenAPI document
  (https://developers.heygen.com/openapi/external-api.json, read 2026-11-13) is
  `additionalProperties: false` with 23 properties, and `engine` is not one of
  them, so HeyGen answers 400 rather than ignoring it. The Talking Photo page
  (https://developers.heygen.com/image-to-video) fixes the engine instead: "|
  Engine | Avatar IV |".

  Replacement: omit `engine` — the arm renders on Avatar IV. To choose an engine,
  use the catalogued-look arm, which is unchanged: `heygen.avatar({ type:
"avatar", avatar_id, engine: { type } })`. `HEYGEN_IMAGE_ENGINES` stays
  `["avatar_iv"]`, as the engine the arm renders on rather than a value to send.
  `unmodel/avatar` already compiled this arm without `engine`.

- a76eca4: heygen: retire Avatar V on the raw-image arm and two voice-engine models HeyGen's spec no longer lists
  - `heygen/avatar_v` leaves `unmodel/avatar`, and `HEYGEN_IMAGE_ENGINES` is now
    `["avatar_iv"]`. HeyGen's engine comparison
    (https://developers.heygen.com/models, 2026-11-12) marks "Arbitrary image
    input" ✗ for Avatar V and Avatar III, and the Talking Photo page
    (https://developers.heygen.com/image-to-video) lists its engine as Avatar IV.
    `heygen.avatar({ type: "image", engine: { type: "avatar_v" }, … })` is now
    refused with `unsupported_param` at `engine`, because the raw-image arm
    declares no `engine` at all. Replacement: `heygen/avatar_iv` (or
    `heygen.avatar({ type: "image", … })` with no `engine`) for a picture you
    supply, or Avatar V on the catalogued-look arm — `heygen.avatar({ type:
"avatar", avatar_id, engine: { type: "avatar_v" } })`, which is unchanged.
    `AVATAR_MODELS` / `AVATAR_MODEL_PARAMS` on `unmodel/heygen/values` drop the
    `avatar_v` row and its `reference_look_id` extra.
  - `voice_settings.engine_settings.model` no longer accepts
    `"eleven_flash_v2_5"` (ElevenLabs) or `"s1"` (Fish Audio). The OpenAPI
    document (https://developers.heygen.com/openapi/external-api.json,
    2026-11-12) lists `["eleven_multilingual_v2", "eleven_turbo_v2_5",
"eleven_v3", "eleven_v4"]` and `["s2.1-pro", "s2-pro"]`. Replacements:
    `eleven_turbo_v2_5` or `eleven_v3` for ElevenLabs, `s2-pro` for Fish Audio.
    `HEYGEN_ELEVENLABS_MODELS` and `HEYGEN_FISH_MODELS` shrink to match.
  - `HEYGEN_V1_V2_SUNSET` documents that the date has passed: "Those endpoints
    passed their October 31, 2026 sunset and are being removed"
    (https://developers.heygen.com/docs/quick-start).

- df33c33: hume: `hume/octave-2` is priced at its own rate, and every Hume row is flagged deprecated: Hume retired its TTS API on 2026-11-13
  - `hume/octave-2` now prices at $75 per 1M characters, down from $150.
    Hume's pricing page has an Octave 1 view and an Octave 2 view, and the
    Octave 2 Creator cell reads "$0.075/1,000" beside the note "In Octave 2,
    characters are metered at half rate". `hume/octave`, and a `hume.tts`
    request that omits `version`, still price at Octave 1's $0.15/1,000, so the
    estimate for an omitted `version` remains an upper bound. Source: the
    archived https://www.hume.ai/pricing
    (https://web.archive.org/web/20260930030232/https://www.hume.ai/pricing; the
    2026-07-12 and 2026-09-01 captures show the same cells).
  - `hume/octave`, `hume/octave-2` and `hume/voice-conversion` are now
    `status: "deprecated"`, so every `hume.tts` and `hume.sts` request (and
    `tts()` / `sts()` from `unmodel/tts` and `unmodel/sts` aimed at `hume/…`)
    returns a `deprecated_model` warning. Hume's changelog says: "Hume is
    sunsetting the TTS and EVI APIs. Access ends November 13, 2026 at 12:01
    a.m. EST, and both APIs remain fully supported until then. Any data in your
    account is permanently deleted after November 13, 2026."
    (https://web.archive.org/web/20261003165626/https://dev.hume.ai/changelog).
    The cutoff has passed. Probed on 2026-11-13, `POST /v0/tts`,
    `/v0/tts/file` and `/v0/tts/voice_conversion/file` and
    `GET /v0/tts/voices` all answer 404 with
    `sunset: Fri, 13 Nov 2026 05:01:00 GMT` and the body "This API was retired
    on 2026-11-13 and is no longer available." Voice conversion is retired with
    the rest. Nothing is removed in this release and every id still validates,
    so a `hume.tts` or `hume.sts` request that passes unmodel is one Hume now
    refuses.

- a710745: ideogram: `ideogram.image` (and `unmodel/image` refs to `ideogram/ideogram-3.0-…`) prices `custom_model_uri` requests at Ideogram's custom-model rate instead of the base 3.0 rate
  - A request that sets `custom_model_uri` was estimated at the base per-image
    rate ($0.03 / $0.06 / $0.09), half of what Ideogram bills. It is now priced
    at the published custom-model rate: TURBO $0.06, DEFAULT $0.12, QUALITY
    $0.18 per image, × `num_images`. `maxCostUSD` enforces against the real
    figure.
  - `rendering_speed: "FLASH"` with a custom model, and a custom model combined
    with `character_reference_images`, have no published API rate, so those
    requests now return no cost estimate rather than a guessed one.
  - The rate table is exported as `CUSTOM_MODEL_PER_IMAGE` from
    `unmodel/ideogram`, next to `CHARACTER_REFERENCE_PER_IMAGE`.

  Source: https://ideogram.ai/api/usage-pricing/catalog (retrieved 2026-11-12) —
  the "Generation with a custom model" offerings "Ideogram 3.0 Custom Turbo"
  60000, "Ideogram 3.0 Custom Default" 120000, "Ideogram 3.0 Custom Quality"
  180000 (usd_micros), and the billing entries
  `api_ideogram_v3_custom_model_generation` TURBO 0.06 / DEFAULT 0.12 / QUALITY
  0.18, which carry no route or API-version dimension.

- 3dfc38e: inception: `mercury-edit-2` warns on `inception.chat` and leaves the `unmodel/chat` refs, and `inception.checkChat` reports the response's `warning`
  - `inception.chat` now warns `unsupported_capability` at `["model"]` for
    `mercury-edit-2`, naming POST /v1/fim/completions and POST
    /v1/edit/completions: Inception serves it only there, and POST
    /v1/chat/completions answers it 400 ("Model must be one of the following:
    mercury, mercury-2, mercury-2.5, mercury-3, …", checked 2026-11-13). The
    request still validates and is sent as written; unmodel validates neither
    route. Sources: https://docs.inceptionlabs.ai/get-started/models and
    https://api.inceptionlabs.ai/v1/edit/completions/models.
  - The `unmodel/chat` ref `inception/mercury-edit-2` is withdrawn from
    `ChatModelRef` and `CHAT_MODEL_REFS`: it compiled to a body the chat
    endpoint refuses. Sending it anyway gets the substrate warning above.
  - `inception.checkChat` reports a non-empty top-level `warning` string as an
    `invalid_shape` warning at `["warning"]` with `meta.kind:
"provider_warning"`. The API fills it when it resets an out-of-range
    `temperature` (`ChatCompletionResponse.warning`,
    https://api.inceptionlabs.ai/openapi.json). `ChatCompletionLike` from
    `unmodel/inception` and `unmodel/inception/types` now declares
    `warning?: string | null`.

- f3df205: inception: `mercury-3` and `mercury-2.5` join the `inception.chat` catalog from the 2026-11-12 models.dev refresh, and an out-of-range `temperature` now warns
  - `inception.chat` validates `mercury-3` and `mercury-2.5` without an
    `unknown_model` warning, caps `max_tokens` / `max_completion_tokens` at
    their 131,072 and 65,536-token output ceilings, and prices responses at the
    rates the API bills: $0.10 input / $0.01 cached input / $0.35 output per 1M
    for `mercury-3` (a launch promotion with no published end date; regularly
    $0.20 / $0.02 / $0.70), $0.20 / $0.02 / $0.75 for `mercury-2.5`. Sources:
    https://docs.inceptionlabs.ai/get-started/models and
    https://api.inceptionlabs.ai/v1/models.
  - `temperature` outside 0.5–1 on `mercury-3`, `mercury-2.5` or `mercury-2`
    now validates with an `invalid_shape` warning naming the value the request
    will actually run at: the API does not refuse it, it resets it to the
    model's default (1 for `mercury-3` and `mercury-2.5`, 0.75 for `mercury-2`)
    and says so in the response's `warning` field. Sources:
    https://docs.inceptionlabs.ai/resources/faq and
    https://api.inceptionlabs.ai/openapi.json.
  - `inception/mercury-3` and `inception/mercury-2.5` join the `unmodel/chat`
    model refs, and Vercel's `inception/mercury-3` and `inception/mercury-2.5`
    gain `.toApi("inception")`.
  - `mercury-edit-2`'s generated row drops reasoning and structured outputs, so
    `reasoning_effort` and a `json_schema` `response_format` are now refused on
    it: its endpoints take neither (https://api.inceptionlabs.ai/openapi.json),
    and Inception serves it only on `/v1/fim/completions` and
    `/v1/edit/completions`, which unmodel does not validate yet. Its context
    moves from 128,000 to models.dev's 32,000, the docs' "FIM: 32K".
  - `mercury-2` and `mercury-2.5` are closed to new users; existing customers
    keep access until 2026-11-15 and enterprise customers under their
    agreements (https://www.inceptionlabs.ai/models), so both stay validated.
    Any other key gets a 404 for them.

- 38c1def: inworld: corrections from the 2026-11-12 doc re-verification. Several requests the API serves were being refused.

  False refusals fixed
  - `inworld.tts` accepts a `script` (1–100 utterances, each with its own
    `text` and `voiceConfig.voiceId`) in place of `text` + `voiceId`, an inline
    `voiceDesign: { designPrompt }` (7–1,024 characters) in place of `voiceId`,
    and `outputMode` (`PER_UTTERANCE` requires `script`). `TtsVoiceBody` is now
    the union `TtsVoiceTextBody | TtsVoiceDesignBody | TtsVoiceScriptBody`, so
    the type rejects mixed shapes too. The character cap and the cost estimate
    count a script's utterance texts, and the estimate adds a design prompt,
    which "counts once per request" (docs.inworld.ai/portal/billing).
  - `audioConfig.sampleRateHertz` takes any integer in [8000, 48000] on REST
    and on the TTS WebSocket. The reference now prints a range plus "Common
    sample rates include: …", not a closed list. `INWORLD_SAMPLE_RATES_HERTZ`
    is that common list.
  - `deliveryMode` on the 1.x TTS generations is a warning
    (`unsupported_param`, `meta.ignored`), not an error: "The field is ignored
    on other models."
  - `realtimeVoiceContext`: `bufferCharThreshold` takes 0–2000 ("Omission or 0
    selects 1000"), and `audioConfig.audioEncoding` takes
    `"AUDIO_ENCODING_UNSPECIFIED"`, which the socket's enum lists.
    `TTS_STREAM_MAX_BUFFER_CHAR_THRESHOLD` is 2000 and
    `TTS_STREAM_MAX_TEXT_CHARACTERS` is 2000 ("Maximum 2000 UTF-16 code units
    per message").
  - STT: Voice Profile is no longer refused on third-party routes ("works with
    every STT model on the API — including third-party models"). The `groq`
    row of `STT_MODEL_PARAMS` gains `voiceProfileConfig`.
  - STT: `includeWordTimestamps` / `enableSpeakerDiarization` on
    `inworld/inworld-stt-1` pass on the WebSocket and warn (ignored) on sync,
    instead of being refused on both.
  - STT sync takes the `MP4`, `MXF` and `WEBM` container encodings. The
    WebSocket refuses them, with the reason ("Not supported for streaming
    transcription").
  - `inworldSttV1Config.maxTurnSilence` (20–5000 ms, default 768) is typed and
    bounded.
  - Voice cloning: the per-sample cap is 12MB, not 4MB
    (`VOICE_CLONE_MAX_SAMPLE_BYTES`, per docs.inworld.ai/tts/instant-voice-cloning).
    `langCode` is an open enum ("every supported locale has an enum name"), so
    any locale-shaped name such as `SV_SE` or `EN_GB` passes. Only values that
    cannot be enum names (e.g. a BCP-47 `en-US`) are refused.
  - Voice design: `designPrompt` is capped at 1000 characters, not 250. Under 30
    is a warning, not an error ("descriptions under 30 rarely produce a useful
    voice"). `designPromptMode` (`DESIGN_PROMPT_MODE_ASSISTED` |
    `DESIGN_PROMPT_MODE_VERBATIM`) is typed.

  Catalog and constants
  - `inworld-tts-1.5-max` and `inworld-tts-1.5-mini` no longer carry `cost`, so
    estimates return `undefined`. inworld.ai/pricing lists only TTS-2 and TTS-2
    Flash.
  - `inworld-tts-1` / `inworld-tts-1-max` are named "TTS 1" / "TTS 1 Max". The
    vendor says only that they are "automatically routed to newer models", so
    the names no longer claim a routing target. Both stay deprecated and
    resolvable.
  - Removed: `TTS_STREAM_MAX_CONNECTIONS` (20) and
    `TTS_STREAM_MAX_CONTEXTS_PER_CONNECTION` (5). Neither is a documented
    constant any more. Connections and active contexts are plan-dependent
    (docs.inworld.ai/resources/concurrency-limits).
  - The `realtimeTranscribeConfig` example sends the key as an `Authorization:
Basic` header on the upgrade request. The docs say "Do not put tokens in URL
    query parameters".

- 45d98a0: inworld: review fixes for the 2026-11 wave. Two false refusals and two false accepts.

  False refusals fixed
  - `temperature: 0` passes on `inworld.tts` and `inworld.realtimeVoiceContext`.
    The range is now [0, 2]. Both references say "Accepts values between 0
    (exclusive) and 2 (inclusive)", and the same paragraph adds "If 0 is
    provided, the default value will be used." So the API serves a request with
    0, and treats it as asking for the default.
  - `assemblyaiConfig.prompt` on `assemblyai/universal-3-5-pro` is a warning
    (`unsupported_param`, severity warning), not an error. Inworld's
    `assemblyaiConfig` table says "Universal-3 Pro Streaming only". The same
    page's Realtime AssemblyAI example sends a `prompt` to this model, and
    AssemblyAI documents Universal-3.5 Pro Realtime as promptable. `prompt` is
    still an error on the other AssemblyAI routes, and `meta.allowed` now names
    both Pro ids.
  - The unified `stt` pack no longer refuses `timestamps: "word"` on an
    `inworld/…` id outside its table. Such an id already warns
    `unknown_model`. It now compiles to `includeWordTimestamps: true`, matching
    what `inworld.stt` accepts.

  False accepts fixed
  - `inworld.realtimeVoiceContext` refuses `audioConfig.audioEncoding: "FLAC"`.
    The WebSocket reference's enum is `AUDIO_ENCODING_UNSPECIFIED`, `LINEAR16`,
    `MP3`, `OGG_OPUS`, `ALAW`, `MULAW`, `PCM` and `WAV`, with no FLAC. The type
    `InworldVoiceContextAudioConfig.audioEncoding` drops FLAC to match.
  - `inworld.stt` and `inworld.realtimeTranscribeConfig` refuse
    `audioEncoding: "AUDIO_ENCODING_UNSPECIFIED"` (`invalid_enum_value`).
    `meta.allowed` lists the encodings that work on that surface. Both
    references document the zero value as an error: "Will return
    [google.rpc.Code.INVALID_ARGUMENT]" (sync) and "Will return an error."
    (WebSocket).

- 5c97dfb: inworld: `assemblyai/universal-3-5-pro` joins the STT router catalog
  - `inworld.realtimeTranscribeConfig` now knows `assemblyai/universal-3-5-pro`
    (WebSocket only, 18 languages, per docs.inworld.ai/stt/third-party): it no
    longer warns `unknown_model`, and `inworld.stt` reports it as
    `unsupported_capability` naming the sync roster, like every other
    WebSocket-only route. It carries no `cost`. Inworld prints "$0.21/hr" for
    it, but in a column whose `inworld/inworld-stt-1` cell is the committed-plan
    $0.10/hr, not the On-Demand $0.15/hr, so the column's tier is unstated.
  - The AssemblyAI and Soniox routes now warn (`invalid_enum_value`, severity
    warning) on any `audioEncoding` other than `LINEAR16`. Each vendor block on
    docs.inworld.ai/stt/third-party says "WebSocket streaming only; audio must be
    `LINEAR16`", while the WebSocket reference lists `AUTO_DETECT` for every
    model. The pages disagree, so this is a warning, not an error.

- 5da9013: kling: Kling 4.0 and Kling 4.0 Flash

  Both models are live on Kling's path-addressed routes — "Kling 4.0 API Is Now Fully
  Available, with Native Video Generation up to 30s ... Request paths:
  /text-to-video/kling-4.0, /image-to-video/kling-4.0, and /omni-video/kling-4.0", and
  Kling 4.0 Flash "up to 20s" at `/…/kling-4.0-flash` (https://kling.ai/document-api/updates/api,
  read 2026-11-12). They have no `model_name` spelling on `POST /v1/videos/*`.
  - `kling.videoV3`, `kling.videoV3FromImage` and `kling.videoOmni` validate
    `kling-4.0` and `kling-4.0-flash`: 3–30s (Flash 3–20s), 720p/1080p (Flash 720p
    only), `21:9` on every route and `adaptive` on omni, omni `audio` of
    `"native"` / `"original"` (no `"off"`, and no audio switch on text- or
    image-to-video), up to 7 Elements on omni, 4.0's `middle_frame` keyframes and
    `voice` entries (`{ type: "voice", voice_id, id }`). 4.0's image-to-video
    needs no `first_frame` ("first frame, last frame, first-and-last frames, or
    intermediate frames"); Flash's still does ("Only first-frame-to-video
    generation is supported.").
  - The prompt cap is per model: 4.0 / Flash take "up to 26,000 characters"
    English-only and "up to 11,000" non-English-only, with mixed input satisfying
    "E / 26000 + N / 11000 <= 1"; the earlier text-to-video rows keep 3072. Only
    letters outside the Latin script count as non-English.
  - `unmodel/video` serves both ids: a text or keyframe request goes to
    `/text-to-video` or `/image-to-video`, and a reference image or clip to
    `/omni-video`. `aspectRatio: "21:9"` compiles on them.
  - Costs from https://kling.ai/document-api/pricing/base/video: 4.0 is $0.157/s at
    720p and $0.235/s at its default 1080p; Flash is $0.094/s. With a video input
    they bill $0.094 / $0.141 (Flash $0.063) per second of a total duration of
    output × 2 or more, so those estimates are a floor; an omitted
    `settings.duration` (read off the prompt) has no estimate.
  - New exports: `KLING_4_ASPECT_RATIOS`, `KLING_4_OMNI_ASPECT_RATIOS`,
    `DURATIONS_3_20`, `DURATIONS_3_30` (also on `unmodel/kling/values`),
    `KLING_4_MAX_ELEMENTS`, `KLING_4_PROMPT_BUDGET`, `PROMPT_BUDGET_3072`, and the
    types `KlingSettingsAspectRatio` and `PromptBudget`. `KlingDuration` widens to
    3–30, `KLING_CONTENT_TYPES` gains `middle_frame`, `KlingContent` gains
    `voice_id`, and `RouteModelRules` gains `requireFirstFrame`, `maxElements` and
    `prompt`.

- 580364c: kling: `unmodel/video` sends Kling 4.0 `audio` and frame-plus-shape requests to omni; omni `audio: "original"` needs a video
  - `unmodel/video` refused two Kling 4.0 / 4.0 Flash requests that the API fulfils.
    It sent every text-only or keyframe request to `/text-to-video` or `/image-to-video`.
    Neither route has an audio switch for these ids, and image-to-video has no
    `settings.aspect_ratio`. So `{ model: "kling/kling-4.0", prompt, audio: "native" }`
    was refused with `unsupported_param`, and so was a first frame with `aspectRatio`.
    Both ids now compile these requests to `/omni-video/{model}`. The omni route takes
    `audio` (`enum:["native","original"]`) and `aspectRatio`
    (`enum:["21:9","16:9","9:16","1:1","adaptive"]`), and that `aspect_ratio` "takes
    precedence" over the first frame
    (https://kling.ai/document-api/api/video/4-0/video-omni, read 2026-11-12).
    Text and frames without these settings still go to their own routes.
  - `kling.videoOmni` now checks Kling 4.0 / 4.0 Flash `settings.audio: "original"`
    against the documented rules: "Voice references cannot be included in the same
    request" and "At least one `base_video` or `feature_video` must be provided"
    (kling-4-params, 2026-11-12). A request without either video entry is refused with
    `invalid_shape` at `settings.audio`, and a `voice` entry is refused at its
    `contents` index. `RouteModelRules` gains `originalAudioNeedsVideo`. The 3.0 Omni
    and O1 rows are unchanged.

- f29e2dd: kling: Omni Element cap, `kling-v2-6` durations, and the path-addressed family's provenance
  - **`kling.videoOmni` no longer refuses 4–7 Elements on `kling-3.0-omni` and
    `kling-o1`.** Both pages allow up to 7 — "When there is no reference
    video+only multi-image element, the sum of the number of reference pictures
    and multi-image element shall not exceed 7."
    (https://kling.ai/document-api/api/video/3-0-omni/video-omni) and "No reference
    video: reference images + Elements ≤ 7." (/api/video/o1/video-omni), read
    2026-11-12 — where the validator capped every omni model at 3. The tighter
    cases depend on whether an Element is a video-character one, which an
    `element_id` does not reveal, so 7 is the checked ceiling (`OMNI_MAX_ELEMENTS`).
  - **`kling-v2-6` on `kling.video` / `kling.videoFromImage` runs 5s or 10s**, as
    its capability-map row now reads (`generationRange:{en:"5s, 10s"}`,
    https://kling.ai/document-api/guides/capability-map/video) and as the 2.6
    path-addressed routes enumerate. Any other `duration` is refused, and the
    unified `kling/kling-v2-6` row's `durations` is `[5, 10]`.
  - The module notes on `kling.videoV3` / `kling.videoV3FromImage` /
    `kling.videoOmni` no longer claim the route family is uncorroborated: without
    credentials the API host answers `POST /text-to-video/kling-4.0`,
    `/omni-video/kling-4.0` and `GET /tasks` with the new API's auth error (HTTP 401,
    code 1002) where an unknown path answers 404. Each model's path is still
    doc-only, and the exports keep their EXPERIMENTAL label. The notes also record
    that `POST /v1/videos/omni-video` (`kling-video-o1`, `kling-v3-omni`) is
    documented (https://kling.ai/document-api/api/video/3-0-omni/video-omni/legacy)
    but not validated here, and that `PROMPT_MAX_CHARS` (3072) is the 3.0 / 3.0
    Turbo text-to-video cap.

- e566fba: kling: retire the models Kling retired on 2026-09-15

  Kling's 2026-08-13 announcement on https://kling.ai/document-api: "selected legacy
  models, video effect templates, and the Virtual Try-On API will be retired on
  September 15, 2026" — Kling 1.0, 1.5, 1.6, 2.0 Master, 2.1 and 2.1 Master (video)
  and Kling Image 1.0, 1.5, 2.0 and 2.0 New. The current references agree (read
  2026-11-12): `POST /v1/videos/text2video` and `/image2video` take
  `enum:["kling-v2-5-turbo","kling-v2-6","kling-v3"]`
  (`/api/video/3-0-omni/text-to-video/legacy`, `/image-to-video/legacy`) and
  `POST /v1/images/generations` takes `enum:["kling-v2-1","kling-v3"]` with
  `default:"kling-v3"` (`/api/image/3-0-omni/image-generation`).

  Retired ids, with their replacements:
  - Video (`kling.video`, `kling.videoFromImage`, `unmodel/video`): `kling-v1`,
    `kling-v1-5`, `kling-v1-6`, `kling-v2-master`, `kling-v2-1`, `kling-v2-1-master`
    → `kling-v3` (or `kling-v2-6` / `kling-v2-5-turbo`; Kling 4.0 on the
    path-addressed routes). `kling-v2-1` stays as the Kling Image 2.1 model on
    `kling.image`.
  - Image (`kling.image`, `unmodel/image`): `kling-v1`, `kling-v1-5`, `kling-v2`,
    `kling-v2-new` → `kling-v3` (or `kling-v2-1`).

  They leave the catalogs, the price tables, `TEXT2VIDEO_MODELS` /
  `IMAGE2VIDEO_MODELS`, `V1_MODEL_RULES`, the `VIDEO_MODELS` / `IMAGE_MODELS` value
  lists and `KLING_VIDEO_FAL_REFUSALS` (now empty: every `/v1/videos/*` id has a fal
  row). `models["kling-v2-1"]` is now the image row alone, and `kling-v3` is the one
  id that names both a video and an image model.

  The request fields only those models had leave with them — the current
  `/v1/videos/*` bodies document none of them: `cfg_scale` and `camera_control`
  (both routes) and `static_mask` / `dynamic_masks` (image2video). Removed with
  them: `KLING_CAMERA_TYPES`, `KLING_CAMERA_AXES`, `CAMERA_AXIS_MIN`,
  `CAMERA_AXIS_MAX`, `KlingCameraType`, `KlingCameraConfig`, `KlingCameraControl`,
  `KlingDynamicMask`, `KlingTrajectoryPoint`, and the `cfgScale` / `cameraControl`
  fields of `V1ModelRules`. Sent anyway, those keys now draw an `unknown_param`
  warning like any undocumented key.

  `DEFAULT_V1_MODEL` (`"kling-v1"`) is removed. The reference marks `model_name`
  `required:!0` while its prose still says an empty one calls "the V1 model", so an
  omitted `model_name` on `kling.video` / `kling.videoFromImage` now runs no
  model-dependent check and has no estimate, instead of being priced as Kling 1.0.
  `DEFAULT_IMAGE_MODEL` is now `"kling-v3"`, the field's documented default, so an
  omitted `model_name` on `kling.image` estimates at $0.028 rather than $0.0035.

- bb5121b: krea: `krea.image` accepts `aspect_ratio: "3:4"`, and the catalog and error copy match what Krea serves (verified 2026-11-12)
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

- 708fc08: krea: `krea.image` warns on a long data URI instead of refusing it, and checks `moodboards[].id` against the served UUID pattern (verified 2026-11-13)
  - **False refusal fixed: data URIs over 1024 characters.** `image_url` and
    `image_style_references[].url` carry `"maxLength":1024` in the spec Krea
    serves at https://api.krea.ai/openapi.json. Krea's own guides contradict
    that. They send whole-file data URIs in these fields, and Zero Data
    Retention (the `X-Api-Zero-Data-Retention` header) requires them.
    https://www.krea.ai/docs/developers/zdr says: "Any URL provided, for
    example a style reference image, must be a base64 data URI. Using an
    external URL would result in a `422`". `krea.image` used to refuse any
    value over 1024 characters, and its advice to upload via `POST /assets`
    is a documented 422 under Zero Data Retention. A `data:` URI over the cap
    now gets an `invalid_shape` warning that names both sources. An external
    or asset URL over 1024 characters is still an error. Its message now
    points to `POST /assets` or a data URI, and notes that Zero Data
    Retention accepts only data URIs.
  - **New refusal: `moodboards[].id` must be a UUID.** All three Krea 2 routes
    declare `"id":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"}`.
    Until now any string got through without a warning, and the API was
    certain to answer it with a 422. A non-matching id is now an
    `invalid_shape` error at `["moodboards", i, "id"]`. The pattern is exported
    verbatim as `KREA_MOODBOARD_ID_PATTERN` from `unmodel/krea`.

- 1725b5c: leonardo: nine more image models (kino-xl … lightning-xl)

  `leonardo.image` and `unmodel/image` now validate, type and compile `kino-xl`,
  `anime-xl`, `portrait-perfect`, `stock-photography`, `illustrative-albedo`,
  `concept-art`, `lifelike-vision`, `graphic-design` and `lightning-xl` — each a
  discriminator key on `POST /v2/generations` with its own `…GenerationRequest`
  schema (https://docs.leonardo.ai/reference/creategeneration, OpenAPI updatedAt
  2026-09-01, read 2026-11-12). They used to fall through to the loose arm with an
  `unknown_model` warning and no per-param checks.
  - One shared `parameters` shape, `LeonardoElementsParameters` (unmodel's name for
    it, after the two Elements arrays — no vendor page names a family for these
    models): Phoenix's keys plus
    `transparency` ("Whether the image can be generated with a transparent
    background"), `user_elements` and `platform_elements` (at most 4 entries each,
    `weight` ≥ 0 — the items declare no id key, so none is typed), `mode`
    `FAST | QUALITY` (no ULTRA), height 32–1536, width 32–1536 (kino-xl,
    portrait-perfect, stock-photography) or 32–1584 (the other six), a
    9999-character prompt, and four guidance kinds beyond Phoenix's: `edge`,
    `pose`, `depth`, `text_image` (one reference each).
  - Every model keeps its own published `style_ids` allowlist (2 to 22 UUIDs).
  - Catalog rows carry the schema titles as names ("Cinematic Kino", "Anime", …,
    "Leonardo Lightning") and no `cost`: Leonardo publishes no per-model rate.
    No vendor page names who trained these models, so no `family` is recorded.
  - `unmodel/leonardo/values` lists them in `IMAGE_MODELS` / `IMAGE_MODEL_PARAMS`
    with a shared 1536-px preset list and the `1k` tier.
  - `negativePrompt`, `contrast`, `tiling` and the new keys are no longer called
    "Phoenix-only": a request that sends one to a model without it is flagged
    `unsupported_param` with the list of models that take it.

- 8b6ee4a: leonardo: accept content ULTRA, URL / base64 image references, and prompt-less third-party models

  Four false refusals on `leonardo.image`, each a request the live reference
  (https://docs.leonardo.ai/reference/creategeneration, OpenAPI updatedAt
  2026-09-01, read 2026-11-12) accepts:
  - **Content guidance takes `ULTRA`.** All 15 content schemas now read
    `"enum": ["LOW", "MID", "HIGH", "ULTRA"]` (the prose tables still say LOW / MID
    / HIGH; the schema is the wire). New `LEONARDO_CONTENT_STRENGTHS` /
    `LeonardoContentStrength`; `LeonardoContentGuidance` takes it. Character,
    image-to-image, edge, pose, depth and text-image guidance stay on LOW / MID /
    HIGH — character now types as `LeonardoGuidance` rather than
    `LeonardoContentGuidance`.
  - **Image references can be a URL or inline bytes.** `image.type` is
    `UPLOADED | GENERATED | VARIATION | URL | BASE64` on all 189 image-reference
    schemas, and `LeonardoImageReference` gains `data` ("Base64-encoded image bytes.
    Required when type is BASE64."). `LEONARDO_IMAGE_TYPES` is now exactly the
    published enum. `INIT` and `GENERATION` are no longer listed anywhere in the
    reference; they still type-check and validate, with an `invalid_enum_value`
    **warning** (`LEONARDO_UNLISTED_IMAGE_TYPES`), because no page says whether the
    API still takes them.
  - **Untabled models are not required to send `prompt`.** remove-bg, both aurora
    upscalers, rodin-v2 and bytedance/video-upscaler have no `prompt` property, and
    meshy/meshy-7's is optional, so the documented remove-bg and
    aurora-upscaler-precise bodies no longer fail with "`parameters.prompt` is
    required." The loose arm now checks only that `parameters` is an object.
  - **Docs URL.** `LEONARDO_DOCS_URL`, `provider.doc` and every issue's
    `meta.source` move to `https://docs.leonardo.ai/reference/creategeneration`;
    the `creategeneration-1` page now 301-redirects there and its `.md` form 404s.

  The module notes no longer claim an official SDK sends the v2 body: both
  Leonardo SDKs target `/api/rest/v1` (the TypeScript SDK's config.ts:
  `openapiDocVersion: "v1.0.0"`), so `.toSdk("leonardo")` is documented as the raw
  body, unchanged. Comment counts are corrected (87 discriminator ids; 36
  `style_ids` arrays, none with `maxItems`); the 1-style cap stays an advisory
  warning.

- db26754: leonardo: a sibling model's key is a warning, and the refusal copy cites real routes
  - **Sibling-model keys and guidance kinds now warn instead of erroring.** On
    `leonardo.image`, a `parameters` key that belongs to another tabled model
    (`contrast` on `lucid-origin`, `transparency` on `phoenix-v1.0`, …) and a
    guidance kind outside the model's table (`guidances.edge` on Phoenix) are
    still reported as `unsupported_param` with the models that take them, but as
    a **warning**, so the request passes. The published reference
    (https://docs.leonardo.ai/reference/creategeneration, OpenAPI updatedAt
    2026-09-01, read 2026-11-12) leaves `parameters` and `guidances` open on all
    13 tabled image arms (no `additionalProperties: false`, which it sets 62 times
    elsewhere), and no page or recorded response says the API rejects such a key.
    Pass `severity: { unsupported_param: "error" }` to keep refusing them. The
    unified `negativePrompt` on a Lucid model is still refused: a canonical field
    that cannot be delivered is a typed gap.
  - **`outputFormat` / `outputDelivery` refusal copy.** Both messages cited a
    `GET /v2/generations/{id}` route that the v2 reference does not publish. The
    images come back from the v1
    `GET https://cloud.leonardo.ai/api/rest/v1/generations/{id}`
    (https://docs.leonardo.ai/v1.0/reference/getgenerationbyid) or a webhook,
    and the messages now say so. The `outputFormat` message also no longer claims
    that no model on the endpoint has a format field: none of the tabled Leonardo
    models does, but seedream-5.0-pro and bytedance/seedream-5.0-flash take
    `output_format` and remove-bg takes `format`, set through
    `providerOptions.leonardo.parameters`.

- 96394be: lightricks: audio-to-video names the default resolution truthfully, and `guidance_scale` no longer documents defaults

  CORRECTED DATA
  - The JSDoc on `AudioToVideoParams.guidance_scale` no longer says "Defaults to
    5 (text-only) or 9 (with an image)". The current OpenAPI
    `AudioToVideoRequest` and the reference page
    (https://docs.ltx.io/api-documentation/api-reference/async-video-generation/submit-audio-to-video.md)
    do not list the field, so it is unknown whether LTX honours it and what its
    default is. It is still typed and passed through unchanged, and is checked
    only as a number.
  - `lightricks.videoFromAudio` with `image_uri` and no `resolution`: an `fps`
    issue says "at the default 1080p resolution (1920x1080, or 1080x1920 for a
    portrait image)", and its `meta` carries `tier: "1080p"` in place of
    `resolution`. unmodel cannot see the image's orientation, so it no longer
    names 1920x1080, which is wrong for a portrait image. The allowed frame
    rates are the same, because both orientations are in the 1080p tier.
    Without an image the issue still names 1920x1080, the documented default.
    Source: `AudioToVideoRequest.resolution` in https://docs.ltx.io/openapi.json:
    "portrait images produce 1080x1920 video, landscape images produce
    1920x1080 video. If no image is provided, defaults to 1920x1080."

  All sources read 2026-11-12 and re-checked 2026-11-13.

- de0584b: lightricks: `ltx-2-5-pro` reaches 1440p/4K and 48fps, LTX-2.5 takes 1:1 / 3:2 / 2:3, and audio-to-video takes the full resolution matrix

  FALSE REFUSALS FIXED
  - `ltx-2-5-pro` validates at 1440p and 4K and at 48fps, on `lightricks.video`,
    `lightricks.videoFromImage`, `lightricks.videoFromAudio` and through
    `unmodel/video` (its `resolution` now offers `1440p` / `4k` and `fps` offers
    `48`). Its matrix is now the same as `ltx-2-3-pro`'s: every tier at 24, 25,
    48 and 50fps, 6, 8 or 10 seconds. Source: "`ltx-2-5-pro` now generates 1440p
    and 4K in 16:9 and 9:16, and accepts 48 fps, on text-to-video,
    image-to-video, and audio-to-video."
    (https://docs.ltx.io/api-changelog/2026/9/2.md), and the
    https://docs.ltx.io/models/ltx-2-5.md matrix row "| **ltx-2-5-pro** | 720p |
    24, 25, 48, 50 | 6, 8, 10 |", repeated for 1080p, 1440p and 4K.
  - `ltx-2-5-fast` and `ltx-2-5-pro` accept twelve more `resolution` values:
    1:1 (`720x720`, `1080x1080`, `1440x1440`, `2160x2160`), 3:2 (`1080x720`,
    `1620x1080`, `2160x1440`, `3240x2160`) and 2:3 (`720x1080`, `1080x1620`,
    `1440x2160`, `2160x3240`), on all three routes and as `aspectRatio` `1:1` /
    `3:2` / `2:3` in `unmodel/video`. LTX-2.3 still refuses them: its resolution
    table has only 16:9 and 9:16 columns. Source: "`ltx-2-5-fast` and
    `ltx-2-5-pro` now generate 1:1, 3:2, and 2:3 video at every resolution from
    720p to 4K, on text-to-video, image-to-video, and audio-to-video."
    (https://docs.ltx.io/api-changelog/2026/10/12.md).
  - `lightricks.videoFromAudio` takes the same per-model `resolution` set as
    text-to-video (720p through 4K) instead of 1080p only, plus the `fps`,
    `last_frame_uri` and `camera_motion` fields. `resolution` and `fps` are
    checked against the model's matrix, and an omitted `resolution` is checked
    at the documented default tier (1920x1080). `last_frame_uri` without
    `image_uri` is refused with `invalid_shape`, because the reference page says
    it "Requires `image_uri`". Sources: "**Audio-to-video** now supports the same
    resolution tiers as text-to-video and image-to-video"
    (https://docs.ltx.io/api-changelog/2026/8/18.md); "**Audio-to-video** now
    supports `fps` (default 24), `last_frame_uri` (requires `image_uri`), and
    `camera_motion`" (https://docs.ltx.io/api-changelog/2026/8/19.md); and the
    `AudioToVideoRequest` schema in https://docs.ltx.io/openapi.json.
  - `AUDIO_TO_VIDEO_RESOLUTIONS` is removed. It listed the two 1080p strings,
    and the route's resolutions are now per model. Read `SUPPORT_MATRIX` with
    `RESOLUTION_SHAPES`, or `LTX_RESOLUTION_GRID`, instead.

  CORRECTED DATA
  - `VIDEO_USD_PER_SECOND["ltx-2-5-pro"]` gains 1440p at $0.25/s and 4K at
    $0.39/s, so those requests now get a cost estimate. Source: "1440p is billed
    at $0.25 per second and 4K at $0.39 per second."
    (https://docs.ltx.io/api-changelog/2026/9/2.md), and https://docs.ltx.io/pricing.md.
    Every 1:1 / 3:2 / 2:3 size is billed at the rate of its short side's tier:
    "Each is priced the same as the 16:9 size with the same short side."
    (https://docs.ltx.io/api-changelog/2026/10/12.md).
  - `AUDIO_TO_VIDEO_USD_PER_SECOND` is now keyed by model, then tier, like
    `VIDEO_USD_PER_SECOND` (per second of input audio, from
    https://docs.ltx.io/pricing.md): `ltx-2-5-fast` 0.09 / 0.13 / 0.19 / 0.30,
    `ltx-2-5-pro` 0.12 / 0.17 / 0.25 / 0.39, `ltx-2-3-pro` 0.06 / 0.10 / 0.18 /
    0.34 (720p / 1080p / 1440p / 4K). The 1080p figures are unchanged. The route
    still produces no estimate, because the request carries only the audio's URI.
  - `ltx-2-5-fast` and `ltx-2-5-pro` are `openWeights: true`. Source: "LTX-2.5
    is an open world model with open weights, built for local execution and
    fine-tuning."
    (https://docs.ltx.io/open-source-model/getting-started/overview.md).
  - New exports on `unmodel/lightricks`: `LTX_RESOLUTION_GRID` (tier → shape →
    `WIDTHxHEIGHT`), `RESOLUTION_SHAPES` (the shapes each model renders) and the
    `LtxResolutionShape` type (also on `unmodel/lightricks/types`).
    `LTX_RESOLUTION_TIERS` and `LTX_RESOLUTIONS` now carry all twenty strings.
  - `lightricks.video`'s `.toApi("fal")` behaves as before: fal's
    `lightricks/ltx-2.5/text-to-video/pro` row is a strict subset of what LTX
    serves on `ltx-2-5-pro` (720p/1080p, 16:9/9:16, 24/25/50fps), so the new
    native values are refused there rather than mapped. The prompt-cap refusal
    now says that LTX's own schema has the same 5,000-character cap
    (`"maxLength":5000` in https://docs.ltx.io/openapi.json).

  All sources read 2026-11-12.

- 8281574: lightricks: retire LTX-2 (`ltx-2-fast`, `ltx-2-pro`) and the synchronous `/v1` generation routes

  RETIRED UPSTREAM
  - `ltx-2-fast` and `ltx-2-pro` leave the lightricks catalog, the unified video
    table (`VIDEO_MODELS` / `VIDEO_MODEL_PARAMS`), `GENERATION_MODELS`,
    `AUDIO_TO_VIDEO_MODELS`, `SUPPORT_MATRIX` and the fal refusal table. LTX
    removed both on 2026-08-15: "As announced in the July 2 LTX-2 deprecation
    notice, `ltx-2-fast` and `ltx-2-pro` are no longer available. Requests that
    specify these models return an error."
    (https://docs.ltx.io/api-changelog/2026/8/16.md, read 2026-11-12). Use
    `ltx-2-3-fast` / `ltx-2-5-fast` in place of `ltx-2-fast`, and `ltx-2-3-pro` /
    `ltx-2-5-pro` in place of `ltx-2-pro`. Requests naming the retired ids still
    validate, with an `unknown_model` warning, no support-matrix check and no
    cost estimate.
  - `NO_LAST_FRAME_MODELS` is removed: it listed only the LTX-2 pair, so every
    model LTX still serves takes `last_frame_uri` on image-to-video.
  - The synchronous `/v1` generation routes are gone, and with them the
    non-wire `api_version` param on `lightricks.video`, `lightricks.videoFromImage`
    and `lightricks.videoFromAudio`, the `TEXT_TO_VIDEO_V1_URL`,
    `IMAGE_TO_VIDEO_V1_URL` and `AUDIO_TO_VIDEO_V1_URL` constants,
    `LTX_API_VERSIONS` (also dropped from `unmodel/lightricks/values`),
    `DEFAULT_API_VERSION`, the `LtxApiVersion` type, and `ltxUrl`'s second
    argument. "The V1 video generation endpoints listed below were retired on
    October 26, 2026 and return an error. Use the V2 endpoints instead."
    (https://docs.ltx.io/migrate-v1-to-v2.md, read 2026-11-12). Every validator
    now builds its `/v2/<endpoint>` URL, which is the only generation API LTX
    serves; the request body is unchanged. `api_version` is no longer stripped,
    so a caller still sending it gets an `unknown_param` warning. The media upload
    route stays at `POST /v1/upload`.
  - `lightricks.video`'s `.toApi("fal")` no longer refuses `api_version: "v1"`:
    the param it answered for no longer exists.

- a50f336: Linear-time parsing of two caller-supplied strings (CodeQL `js/redos` and `js/polynomial-redos`).
  - `data:` URIs: the media-type parameters are now matched one `;`-free segment at a time, so a hostile `data:;;;;…` string with no `,` is rejected in one pass instead of backtracking exponentially. Every data URI that parsed before parses the same way (RFC 2397 parameters never contain `;`). Applies to the unified layer's `requireInlineBytes` / `base64Payload` and heygen's avatar adapter.
  - Azure endpoints: `createAzure({ endpoint })` and the MAI image URL builders trim trailing `/` with a scan, not `replace(/\/+$/, "")`, which went quadratic on a long run of slashes that is not at the end. URLs built from ordinary endpoints are unchanged.

- 63e6aa5: longcat: `LongCat-2.5-Preview` joins `unmodel/longcat`, and a fixed LongCat temperature is overridden, never refused
  - `longcat.chat` catalogs `LongCat-2.5-Preview` (models.dev snapshot,
    2026-11-12): text and image input, 1,048,576-token context, 262,144-token
    output ceiling, $0.30 / 1M input, $0.006 / 1M cached input, $1.20 / 1M
    output. Rates are the "Discounted Price $/1M Tokens (limited-time)" column
    of
    https://web.archive.org/web/20261018115714/https://longcat.chat/platform/docs/pricing/longcat-2.5
    ("Pay-As-You-Go currently supports LongCat-2.5-Preview."; the live page now
    names only LongCat-2.5, at the same rates). No end date is published, so
    cost estimates move when the promotion ends. Reachable from `unmodel/chat`
    as `"longcat/LongCat-2.5-Preview"`.
  - `LongCat-2.0` reprices to $0.30 / $0.006 / $1.20 from $0.75 / $0.015 /
    $2.95: https://longcat.chat/platform/docs/pricing/longcat-2.0 now shows only
    the limited-time discount column. Its context is 1,048,576 tokens and it is
    marked open weights (MIT, https://huggingface.co/meituan-longcat/LongCat-2.0).
  - Both rows now carry models.dev's `temperature: false`, which on LongCat means
    "fixed", not "refused":
    https://longcat.chat/platform/docs/api/model-params — "Other values are not
    rejected — they are overridden with the default for the current thinking
    state.", with `top_p` adjustable over (0, 1]. `temperature` therefore
    validates on every LongCat model with an `unsupported_param` warning
    (`meta.ignored: true`) saying the value is replaced, and `top_p` is not gated
    at all — where the shared dialect's reading of the flag would have refused
    both.
  - `createOpenAICompatible` gains `fixedSampling: "rejected" | "overridden"`
    (the `FixedSampling` type, exported from `unmodel/openai-compatible` and its
    `/types` entry). Omitted means `"rejected"` — OpenAI's behaviour, unchanged
    for every other overlay; an overlay whose provider documents that a fixed
    temperature is accepted and overridden declares `"overridden"`.

- 9f32118: luma: `ray-2` and `ray-flash-2` are marked deprecated, and the reframe routes publish their input limits
  - `ray-2` and `ray-flash-2` now carry `status: "deprecated"`, so every
    `luma.video`, `luma.videoModify` and `luma.videoReframe` request on them (and
    `video({ model: "luma/ray-2" })`) validates with a `deprecated_model`
    warning. Luma's migration guide
    (https://docs.agents.lumalabs.ai/guides/videos/migration/) lists Ray 2 and
    Ray 2 Flash among its "retiring models", with no global date: each account
    gets its own deprecation notice, and "Legacy requests will continue to work
    during the notice period". Both ids stay in the catalog and keep validating.
    The replacement Luma names, `ray-3.2`, is on the separate Luma Agents API
    (`POST https://agents.lumalabs.ai/v1/generations`, another key and request
    shape), which unmodel does not cover yet. Photon is not affected.
  - `luma.videoReframe.constraintsFor()` now returns the input limits from
    https://docs.lumalabs.ai/docs/reframe-video-image: `ray-2` accepts up to 10s
    and 100 MB, `ray-flash-2` up to 30s and 100 MB. The 30s is twice Modify
    Video's 15s for the same model.
    `luma.imageEditReframe.constraintsFor()` returns the 10 MB source limit for
    `photon-1` and `photon-flash-1`. The tables are exported as
    `videoReframeConstraints` and `imageEditReframeConstraints`, matching
    `videoModifyConstraints`. They are metadata only. A request carries a media
    URL that unmodel never fetches, so nothing is enforced and no request that
    validated before now fails.

- 37d38cc: meta: Muse Spark 1.3, Muse Ember and Muse Wonder validate and price; `meta.chat` refuses the request fields Meta's Chat Completions endpoint documents as HTTP 400
  - New catalog rows (models.dev refresh, 2026-11-12): `muse-spark-1.3`,
    `muse-spark-1.3-contributor`, `muse-ember-1.0` and `muse-wonder-1.0` validate
    on `meta.chat` and in `unmodel/chat` (`"meta/<id>"`), with cost estimates at
    Meta's published per-1M-token rates (https://dev.meta.ai/docs/pricing-rate-limits).
    `muse-spark-1.1` now carries the documented 1,048,576-token context window.
  - `muse-ember-1.0` caveat: Meta bills a request over 200K input tokens at the
    long-context rates in full ($0.30 / $1.50 / $0.012 per 1M). Estimates use the
    up-to-200K rates, so they run 3x low above that threshold.
  - `meta.chat` now refuses, for every Muse model, what Meta's docs say returns
    HTTP 400 (so does `unmodel/chat`, whose meta bodies finish in `meta.chat`;
    `stopSequences` is refused there as the `stop` it compiles to):
    - `stop`, `logit_bias`, `prediction`, `verbosity`, `web_search_options`,
      `modalities`, `audio`, `max_output_tokens` and `text.format`
      (https://dev.meta.ai/docs/protocols/chat-completions);
    - `reasoning_effort: "none"` (every Muse model always reasons; the accepted
      levels are `minimal` through `max`), `logprobs: true`, and `n` above 1;
    - `tool_choice` other than `"auto"`, `custom` tools, and function tool names
      that do not match `^[a-zA-Z0-9_.-]+$` or contain more than one dot
      (https://dev.meta.ai/docs/tool-calling);
    - `temperature` outside 0–2 and `top_p` outside `0 < top_p ≤ 1`
      (https://dev.meta.ai/docs/error-handling);
    - more than 50 images in one request (https://dev.meta.ai/docs/media-understanding).
  - Not refused, because Meta never states a 400 for them: `top_logprobs`;
    `frequency_penalty`, `presence_penalty`, and `reasoning_effort: "max"` on
    `muse-spark-1.2`, `muse-spark-1.1` and the contributor ids are warned, not
    refused.

- 07ee6e8: meta: `meta.chat` warns on the penalties and on `reasoning_effort: "max"` where Meta's docs say they are unsupported

  Both are `unsupported_param` **warnings**: the request still validates, because
  no Meta page says the API returns HTTP 400 for them. `unmodel/chat` raises the
  same warnings for `"meta/<id>"`, on `frequencyPenalty` / `presencePenalty`.
  - `frequency_penalty` / `presence_penalty`, on every Muse model. Meta: "are not
    supported." "Leave them unset: they do not change the output, and a request
    that sets them can return an error."
    (https://dev.meta.ai/docs/protocols/chat-completions)
  - `reasoning_effort: "max"` on `muse-spark-1.1`, `muse-spark-1.2`,
    `muse-spark-1.2-contributor` and `muse-spark-1.3-contributor`. Meta: "`"max"`
    isn't available on `muse-spark-1.2`, `muse-spark-1.1`, or
    `muse-spark-1.3-contributor`." (https://dev.meta.ai/docs/choose-a-model). It
    is offered on `muse-wonder-1.0`, `muse-spark-1.3` and `muse-ember-1.0`
    (https://dev.meta.ai/docs/reasoning). `unmodel/chat` already compiles
    `reasoning: "max"` to `"high"` for Meta, so the warning reaches only
    `meta.chat` bodies.

- f5a925d: meta: `muse-spark-1.1` accepts audio input

  `meta.chat` (and `unmodel/chat` with `"meta/muse-spark-1.1"`) refused an
  `input_audio` part on `muse-spark-1.1` as `unsupported_capability`, because the
  models.dev row lists its input as text, image, PDF and video only. Meta's model
  page says of every Muse Spark version, 1.1 included: "All take text, image,
  video, audio, and PDF input, return text, and have a 1,048,576-token context
  window." (https://dev.meta.ai/docs/muse-spark, checked 2026-11-12). The
  validator now uses a corrected catalog, exported as `chatModels` from
  `unmodel/meta`; `models` stays the generated table.

- 56db6fb: minimax: `minimax.chat` accepts video and `detail: "default"` content parts, and encodes the remaining M3-generation rules

  Read off MiniMax's OpenAI-compatible chat page and its OpenAPI document
  (`MessageContentPart`, `ChatCompletionReq`), 2026-11-12.
  - **Fixed a false refusal.** A `{ type: "video_url", video_url: { url, detail?,
fps?, max_long_side_pixel? } }` user part, and `image_url.detail: "default"`
    (plus `image_url.max_long_side_pixel`), were refused with `invalid_shape` on
    `MiniMax-M3` and `MiniMax-M3.1-Flash`, although both models take text, image
    and video input. They now validate. `url` takes an http(s) URL, a base64
    `data:` URL or a Files API `mm_file://{file_id}` reference; `fps` must be in
    [0.2, 5] and `max_long_side_pixel` an integer ≥ 1. A model the catalog gives
    no video input (the deprecated M2.x rows) refuses the part with
    `unsupported_capability`. The widening is minimax's alone: every other
    OpenAI-compatible overlay still refuses both shapes.
  - `unmodel/minimax/types`: `ChatBody` is now `MinimaxChatCompletionsBody`, the
    shared dialect with MiniMax's user content parts, and the new
    `MinimaxChatImagePart`, `MinimaxChatVideoPart`, `MinimaxChatUserContentPart`,
    `MinimaxChatUserMessage` and `MinimaxChatMessage` are exported. Every
    shared-dialect body still satisfies it.
  - `MiniMax-M3.1-Flash` refuses `thinking: { type: "disabled" }` with
    `unsupported_param` at `thinking.type` — the documented HTTP 400 ("thinking
    cannot be disabled"). `{ type: "adaptive" }` validates. `MiniMax-M3` keeps
    `disabled`, which is its documented off switch.
  - `MiniMax-M3` reports `reasoning_effort` as ignored, for every value (a warning,
    never a refusal): thinking depth is tunable on `MiniMax-M3.1-Flash` only.
  - `MiniMax-M3` narrows `service_tier` to `standard` | `priority`; anything else
    is refused with `invalid_enum_value`. On `MiniMax-M3.1-Flash`, which MiniMax
    says does not support the field, `service_tier` is a warning, not a refusal —
    whether the API ignores it or 400s is not stated.
  - `unmodel/openai-compatible`: `createOpenAICompatible` takes an optional
    `schema` (the top-level body schema, built with
    `createChatCompletionsSchema(extraShape)`) and a fifth `Body` type argument,
    for an overlay whose wire is wider than the shared dialect. Both default to
    the shared dialect, so existing overlays are unchanged.

  Known gap: from `unmodel/chat`, `reasoning: "xhigh"` or `"max"` on
  `minimax/MiniMax-M3.1-Flash` still compiles to `reasoning_effort: "high"` with an
  `approximated_param` warning, because the encoder narrows to the
  chat-completions levels rather than the target model's own ladder. Flash
  defaults to `max`, so to get `xhigh` or `max`, set
  `providerOptions.minimax.reasoning_effort` or leave `reasoning` unset.

  Sources: https://platform.minimax.io/docs/api-reference/text-openai-api,
  https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json
  (both 2026-11-12).

- f2b96ed: minimax: MiniMax-M3.1-Flash on `minimax.chat`, and MiniMax-H3-Highspeed / -Lite / -Max on `minimax.videoV2`

  Read off MiniMax's live docs on 2026-11-12 — the OpenAI-compatible chat page and
  its OpenAPI document, the v2 video-generation OpenAPI document, and the pricing
  overview.

  CHAT (`minimax.chat`, `unmodel/chat` as `minimax/…`)
  - `MiniMax-M3.1-Flash` joins the generated catalog: 1,000,000-token context,
    524,288-token completion maximum, text + image + video in, $0.15 / $0.60 /
    $0.015 (cache read) per 1M tokens. It validates and prices like its siblings,
    `minimax/MiniMax-M3.1-Flash` is a `unmodel/chat` ref, and the hosts that serve
    it (openrouter, vercel, huggingface, nebius, novita-ai, nvidia) gain a
    `.toApi("minimax")` edge to it.
  - `MiniMax-M3` is corrected by the same refresh: context 1,000,000 (was
    1,048,576) and completion maximum 524,288 (was 512,000 — a
    `max_completion_tokens` between the two used to be refused with
    `over_output_limit`). Both M3 models now carry `structuredOutput: false`, so a
    `response_format: { type: "json_schema" }` is refused: the OpenAI-compatible
    request body has no `response_format` field.
  - The M2 / M2.1 / M2.5 / M2.7 rows are marked `deprecated` (a
    `deprecated_model` warning); MiniMax's model list files them as retired or
    retiring on 2026-11-18, with MiniMax-M3.1-Flash as the replacement.
    `MiniMax-M2.5-highspeed`'s cache-read rate follows models.dev to $0.03 per 1M
    (MiniMax's pricing page no longer lists any M2.x rate).
  - New rules on `MiniMax-M3.1-Flash`: `reasoning_effort` must be `low`, `medium`,
    `high`, `xhigh` or `max` (`none` returns HTTP 400 — "MiniMax-M3.1-Flash always
    thinks"), so `unmodel/chat`'s `reasoning: false` is now a typed refusal on this
    model instead of a 400.
  - On both `MiniMax-M3` and `MiniMax-M3.1-Flash`: `n` must be 1; the deprecated
    `function_call` is refused in favour of `tools`; `presence_penalty`,
    `frequency_penalty` and `logit_bias` are reported as ignored (a warning, never
    a refusal); `temperature` and `top_p` are reported as ignored ("any value
    passed has no effect"; the models always use 1 and 0.95), and `top_p` outside
    (0, 1] is refused.

  VIDEO (`minimax.videoV2`, `unmodel/video` as `minimax/…`)
  - `MiniMax-H3-Highspeed`, `MiniMax-H3-Lite` and `MiniMax-H3-Max` join
    `MiniMax-H3` on POST /v2/video_generation, with per-model rules:
    - resolution: `MiniMax-H3` renders `768P`/`2K`; the other three `480P`/`768P`
      (`480P` is new to the route, and canonical `480p` maps to it exactly);
    - duration: 4–15 seconds, except `MiniMax-H3-Max` at 5–15;
    - `MiniMax-H3-Lite` refuses an `"adaptive"` (or omitted) `ratio` for
      reference-to-video;
    - `MiniMax-H3-Max` takes the new `extra: { prompt_expansion_mode:
"disabled" | "balanced" | "quality" }`; undeclared fields inside `extra` are
      refused, and `extra` on the other three is flagged as undocumented (a
      warning).
  - Pricing is per model and resolution, per second of output: H3 $0.08 (768P) /
    $0.13 (2K); Highspeed $0.06 / $0.04 (480P); Lite $0.04 / $0.025 (480P); Max
    $0.08 / $0.05 (480P). Input images beyond the free quota add $0.04 / $0.03 /
    $0.02 each (first 5 free) and $0.074 on Max (first 2 free).
  - New exports on `unmodel/minimax`: `VIDEO_V2_MODEL_RULES` (the per-model table
    above), `VIDEO_V2_PROMPT_EXPANSION_MODES`, and the types `VideoV2ModelRule`,
    `MinimaxVideoV2Extra`, `MinimaxVideoV2PromptExpansionMode`.
    `VIDEO_V2_RESOLUTIONS` gains `"480P"`.
  - Removed: `VIDEO_V2_USD_PER_SECOND`, `VIDEO_V2_FREE_IMAGES` and
    `VIDEO_V2_USD_PER_EXTRA_IMAGE` — route-wide constants that were MiniMax-H3's
    rates. Read `VIDEO_V2_MODEL_RULES[model].usdPerSecond`, `.freeImages` and
    `.usdPerExtraImage` instead.

  Sources: https://platform.minimax.io/docs/api-reference/text-openai-api,
  https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json,
  https://platform.minimax.io/docs/api-reference/video/generation/api/v2-video-generation.json,
  https://platform.minimax.io/docs/pricing/overview,
  https://platform.minimax.io/docs/faq/models (all 2026-11-12).

- c29ccbb: minimax: `voiceDesign` no longer estimates a preview cost

  MiniMax now publishes two different preview rates for POST /v1/voice_design:
  the voice-design API reference says "Generating preview audio incurs a fee of
  $30 per 1M characters.", while the pricing overview says "In-API preview
  synthesis is billed at $60 / M characters." (both read 2026-11-12). With the
  vendor's own pages in contradiction there is no defensible number, so the
  `voice-design` catalog row carries no `cost` and `minimax.voiceDesign` (and
  `unmodel/voice-design` on `minimax/voice-design`) returns an `undefined`
  `estimate.costUSD` instead of the $30 figure.

  The pricing page's "$3 per voice" for design and "$1.5 per voice" for cloning
  are "Charged when the designed voice is first used for synthesis" / "when the
  cloned voice is first used for synthesis" — a later synthesis's cost, not the
  design or clone request's, so neither is estimated on these routes either.
  - Removed: `VOICE_DESIGN_PREVIEW_PER_MILLION_CHARACTERS` from `unmodel/minimax`
    (it held the $30 rate). There is no replacement; read the two sources above.

  Sources: https://platform.minimax.io/docs/api-reference/voice-design-design,
  https://platform.minimax.io/docs/pricing/overview (2026-11-12).

- e3a74e8: mistral: `mistral-large-latest` is Large 4, `context_bias` takes phrases, `speaker_references` is typed, and the deprecations warn

  Corrections to rows and rules that already existed, each read off
  docs.mistral.ai on 2026-11-12.

  `mistral.chat`
  - `mistral-large-latest` now validates and prices as Mistral Large 4 — the
    card lists `"names":["mistral-large-4","mistral-large-4-0","mistral-large-latest"]`
    (https://docs.mistral.ai/models/mistral-large-4-0), while models.dev still
    carried Mistral Large 3 under it. Before, `reasoning_effort: "high"` (the
    value the reasoning guide recommends) was refused as `unsupported_capability`,
    prompts between 262k and 1M tokens were refused as `over_context`, and cost
    estimates used Large 3's $0.5 / $1.5 instead of $0.7 / $2.1 per 1M. It also
    joins the Large 4 `reasoning_effort` ladder (`low` / `medium` / `high`).
  - `ministral-3b-latest` carries Ministral 3 3B's 262,144-token window ("Context
    i 256k", https://docs.mistral.ai/models/ministral-3-3b-25-12); models.dev's
    128,000 refused valid long prompts.
  - `mistral-large-2512`, `mistral-medium-latest` and `mistral-medium-2604` now
    warn `deprecated_model`: deprecated 2026-10-31, served until 2027-04-30,
    replaced by Mistral Large 4 (https://docs.mistral.ai/getting-started/models).

  `mistral.stt`
  - `context_bias` entries may contain spaces and commas on every model. The
    no-comma/no-whitespace rule had no documented source: openapi.yaml types the
    entries as plain strings, and "Spaces, commas, and other punctuation are
    accepted"
    (https://docs.mistral.ai/studio/audio/speech-to-text/bias-context-and-vocabulary).
    The 100-entry cap stays on the pre-Voxtral 3 ids, whose page states it.
  - New wire field `speaker_references` (speaker name → base64 reference clip),
    from openapi.yaml's `AudioTranscriptionRequest`; `ExactKeys` made it a compile
    error. It requires `diarize: true` ("When enabled, diarize must be true"; a
    422 otherwise) and takes at most 8 entries ("At most 8 speaker references are
    supported, got {n}", https://docs.mistral.ai/studio/audio/specs-and-limits/limits)
    — new export `MAX_SPEAKER_REFERENCES`. `toFormData` sends it as one JSON form
    field, as the Mistral SDK does. Not every model takes reference clips ("The
    model doesn't accept reference clips", https://docs.mistral.ai/studio/audio/speech-to-text/diarize-speakers),
    but Mistral names none, so unmodel refuses the field on no id.
  - `voxtral-mini-2602`, `voxtral-mini-latest`, `voxtral-mini-transcribe-realtime-2602`
    and `voxtral-mini-realtime-latest` now carry `status: "deprecated"`, so the
    two transcription ids warn `deprecated_model`: deprecated 2026-10-31, served
    until 2027-04-30, replaced by the Voxtral 3 models.
  - Provenance URLs follow Mistral's moved pages: the pre-Voxtral 3 transcription
    page is now `/studio/audio/deprecated/speech_to_text/offline_transcription`,
    model cards live at `/models/<card>`, and the `unmodel/stt` adapter cites the
    current `/studio/audio/speech-to-text/transcribe-files`.

- 0a25117: mistral: Mistral Large 4, GLM 5.3, Ministral 3, Voxtral 3 transcription — and the rules they need

  The mistral slice of the 2026-11-12 models.dev refresh, plus what the new models
  needed beyond it. Every hand fact was read off docs.mistral.ai on 2026-11-12.

  CATALOG
  - New generated rows: `codestral-2508`, `deepseek-v4-1-flash-1017`,
    `ministral-3b-2512`, `ministral-8b-2512`, `ministral-14b-2512`,
    `mistral-large-4`, `zai-glm-5-3`, `zai-glm-5-3-flash` and the chat-capable
    `voxtral-small-2507`. `ministral-3b-latest` / `ministral-8b-latest` now carry
    Ministral 3's rates ($0.1 / $0.15 per 1M), 256k-class windows and image
    input; `voxtral-small-latest` output is $0.4 per 1M.
  - Ids models.dev dropped, all retired by Mistral (requests 404, per
    https://docs.mistral.ai/getting-started/models): `devstral-medium-2507`,
    `devstral-small-2505`, `devstral-small-2507`, `magistral-small`,
    `mistral-large-2411`, `mistral-nemo`, `open-mistral-7b`,
    `open-mixtral-8x22b`, `open-mixtral-8x7b`, `pixtral-large-latest`. They now
    validate with an `unknown_model` warning and no cost estimate. Mistral's
    named replacements: Mistral Medium 3.5 for `devstral-medium-2507`,
    `devstral-small-2505`, `mistral-large-2411` and `pixtral-large-latest` (and
    Medium 3.5 is itself deprecated in favour of `mistral-large-4`); Mistral
    Small 4 (`mistral-small-latest`) for `devstral-small-2507`, `magistral-small`
    and both Mixtrals; Ministral 3 8B (`ministral-8b-2512`) for `mistral-nemo` and
    `open-mistral-7b`.
  - Two new generated rows name models Mistral has already retired, and are
    reported upstream rather than hidden: `glm-5-2` (alias of `zai-glm-5-2`,
    retired 2026-10-31) and `labs-leanstral-1-5-1` (no vendor page carries this
    spelling; Leanstral 1.5 retired 2026-09-30). Both carry models.dev's
    `deprecated` status, so they warn.

  `mistral.chat` — `chatModels`, the generated catalog plus what models.dev lacks
  - Vendor aliases, each priced as the model it serves (the card's `"names"`
    array): `mistral-large-4-0` (Large 4), `mistral-medium-3-5` and
    `mistral-medium-3` (Medium 3.5, deprecated 10/31/2026 and served until
    4/30/2027 — they warn), `ministral-14b-latest`, `zai-glm-5` and
    `zai-glm-latest` (GLM 5.3). New type `MistralChatModelId`; `ChatBody`'s
    default model union is now that one.
  - `mistral-large-4` is GA (card: "November 5, 2026 GA") and open-weight (the
    card's Weights tab links huggingface.co/mistralai/Mistral-Large-4-1T-A52B).
  - `ministral-3b-2512`'s context is 262,144 (card: "Context 256k"; models.dev's
    131,072 refused valid long prompts as `over_context`).
  - `deepseek-v4-1-flash-1017` takes images ("with text and image inputs",
    https://docs.mistral.ai/getting-started/models), so `image_url` parts no
    longer fail.

  RULES
  - `reasoning_effort` on Mistral Large 4 (`mistral-large-4`, `mistral-large-4-0`)
    must be `low`, `medium` or `high` — "Mistral Large 4 does not accept none ,
    minimal , xhigh , or max" — and on Z.ai GLM 5.3 (`zai-glm-5-3`, `zai-glm-5`,
    `zai-glm-latest`, `zai-glm-5-3-flash`) `low`, `high` or `max` — "none is not
    supported" (https://docs.mistral.ai/inference/conversations/reasoning). A
    `"none"` previously validated on both and came back a 400; it is now an
    `invalid_enum_value` naming the levels each model takes.

  `mistral.stt` — Voxtral 3
  - New transcription ids, priced from the cards and the pricing page: Voxtral
    Mini Transcribe 3 (`voxtral-mini-transcribe-3-0` / `-3` / `-latest`,
    $0.0035/min) and Voxtral Small Transcribe 3 (`voxtral-small-transcribe-3-0` /
    `-3` / `-latest`, $0.004/min), in Public Preview. New export
    `VOXTRAL_3_TRANSCRIPTION_MODEL_IDS`; `TRANSCRIPTION_MODEL_IDS` gains them.
  - On those ids, `timestamp_granularities` takes `"segment"` only ("word returns
    a 400 error") and `diarize: true` needs segment timestamps (a 422 otherwise),
    per https://docs.mistral.ai/studio/audio/migrate-from-voxtral-2 and
    https://docs.mistral.ai/studio/audio/speech-to-text/transcribe-files. They
    document no audio-length cap, so none is enforced, and their `context_bias`
    takes phrases and free-form passages with "no fixed number of entries" — the
    100-term cap and the no-whitespace rule now apply to the earlier Voxtral ids
    only.
  - The realtime ids — Voxtral Mini Transcribe Realtime 3
    (`voxtral-mini-transcribe-realtime-3-0` / `-3` / `-latest`, $0.008/min) and
    `voxtral-mini-realtime-latest` (the 2602 realtime model's alias) — are
    catalogued and rejected by name as WebSocket-only, instead of passing as
    unknown models.
  - `voxtral-small-2507` is now a generated row with its per-minute rate layered
    on in `transcriptionModels`, so `MistralTranscriptionSupplementModelId` no
    longer includes it.
  - `unmodel/stt` reaches the six Voxtral 3 ids; their `timestamps` row is
    `"none" | "segment"`, so `timestamps: "word"` is a compile error there.

- 48193ca: mistral: retire `voxtral-mini-2507`

  Mistral retired Voxtral Mini Transcribe (`voxtral-mini-2507`) on 2026-05-31 —
  "Voxtral Mini Transcribe ↗ 25.07 voxtral-mini-2507 2/27/2026 5/31/2026 Voxtral
  Mini Transcribe 2" (https://docs.mistral.ai/getting-started/models, checked
  2026-11-12) — and "Once retired, requests to its identifiers fail with a 404
  error" (https://docs.mistral.ai/inference/model-lifecycle).
  - `mistral.stt` no longer catalogs it: it leaves `transcriptionSupplementModels`
    (and `MistralTranscriptionSupplementModelId`), `TRANSCRIPTION_MAX_AUDIO_SECONDS`
    and `TRANSCRIPTION_MODEL_IDS`. A request naming it now validates with an
    `unknown_model` warning and no 15-minute cap.
  - `unmodel/stt` drops the `mistral/voxtral-mini-2507` ref and its
    `STT_MODELS` / `STT_MODEL_PARAMS` entry in `unmodel/mistral/values`.

  Replacement: Voxtral Mini Transcribe 2 (`voxtral-mini-2602`, or
  `voxtral-mini-latest`) — itself deprecated since 2026-10-31 and served until
  2027-04-30 — or its successor Voxtral Mini Transcribe 3
  (`voxtral-mini-transcribe-3`).

- cf57303: mistral: Voxtral 3 takes `language` with timestamps, `codestral-latest` is Codestral 25.08, and two non-chat refs leave `unmodel/chat`

  `mistral.stt`
  - The "`timestamp_granularities` is not compatible with `language`" refusal
    now applies only to `voxtral-mini-latest`, `voxtral-mini-2602`,
    `voxtral-small-latest` and `voxtral-small-2507`, the ids on the deprecated
    page that states it. The Voxtral 3 pages document the two fields
    independently ("Pinning the language can improve accuracy.",
    https://docs.mistral.ai/studio/audio/speech-to-text/transcribe-files,
    2026-11-12). Before, a diarized request with a pinned language was refused on
    every Voxtral 3 id, because diarization there needs segment timestamps. The
    `unmodel/stt` call `{ model: "mistral/voxtral-mini-transcribe-3", diarization:
true, timestamps: "segment", language: "fr" }` now validates.
  - The `speaker_references` refusals cite
    https://docs.mistral.ai/studio/audio/speech-to-text/diarize-speakers, the page
    whose error table states them.

  `mistral.chat`
  - `codestral-latest` validates and prices as Codestral 25.08: the card lists
    `"names":["codestral-2508","codestral-latest"]`
    (https://docs.mistral.ai/models/codestral-25-08). models.dev carried the 2024
    Codestral row under the alias, so `max_tokens` 4097–8192 was refused as
    `over_output_limit` although `codestral-2508` accepts it.
  - `mistral-medium-3-5`, `mistral-medium-3` and `mistral-medium-latest` are named
    "Mistral Medium 3.5", the row of the 26.04 snapshot they resolve to, not
    "Mistral Medium (latest)".

  `unmodel/chat`
  - `"mistral/mistral-embed"` and `"mistral/voxtral-mini-latest"` are no longer
    `ChatModelRef`s or `CHAT_MODEL_REFS` entries. Neither model is served by
    POST /v1/chat/completions: `mistral-embed` answers /v1/embeddings
    (https://docs.mistral.ai/models/mistral-embed-23-12), and
    `voxtral-mini-latest` answers only /v1/audio/transcriptions
    (https://docs.mistral.ai/models/voxtral-mini-transcribe-26-02), which is
    `stt` from `unmodel/mistral`.

- 5e86b05: moonshotai: `kimi-k2.6` temperature is checked against Kimi's two fixed values

  Kimi fixes `kimi-k2.6`'s temperature at 1.0 with thinking on and at 0.6 with
  thinking off. `moonshotai.chat` now accepts
  exactly those two values and refuses any other with `invalid_enum_value`; the
  refreshed catalog's `temperature: false` alone would have refused 0.6. Source:
  https://platform.kimi.ai/docs/api/models-overview ("Fixed at `1.0` with
  thinking on and `0.6` with thinking off").

  Moonshot AI's documentation now lives at https://platform.kimi.ai/docs; the
  platform.moonshot.ai links redirect there.

- b655b54: moonshotai: Kimi K3.1 Pro joins `moonshotai.chat`, six retired Kimi ids leave, and the chat validator learns Kimi's fixed parameters
  - `kimi-k3.1-pro` ($2 input / $10 output / $0.20 cached input / $2 5-minute
    cache write per 1M tokens) and `kimi-k3.1-pro-highspeed` ($4 / $20 / $0.20 /
    $4) validate, price and appear as `"moonshotai/kimi-k3.1-pro"` /
    `"moonshotai/kimi-k3.1-pro-highspeed"` refs in `unmodel/chat`. Both have a
    1,048,576-token context window and accept up to 1,048,576
    `max_completion_tokens`. Sources: https://platform.kimi.ai/docs/pricing/chat,
    https://platform.kimi.ai/docs/openapi.json.
  - `kimi-k3` now accepts `max_completion_tokens` up to 1,048,576 (131,072 is
    only its default) and prices 5-minute cache writes at $3 per 1M tokens.
  - Retired upstream and removed from the moonshotai catalog:
    `kimi-k2-0711-preview`, `kimi-k2-0905-preview`, `kimi-k2-turbo-preview`,
    `kimi-k2-thinking`, `kimi-k2-thinking-turbo` (the K2 series, retired May 2026) and `kimi-k2.5` (retired August 2026; calls return 404). Kimi's
    migration target is `kimi-k3`; `kimi-k3.1-pro` / `kimi-k3.1-pro-highspeed`
    are the current flagships. These ids now validate with an `unknown_model`
    warning and no cost estimate. Source:
    https://platform.kimi.ai/docs/platform-changelog.
  - `moonshotai.chat` enforces Kimi's fixed sampling parameters on every model
    it serves: `top_p` must be 0.95 (it previously refused 0.95 and accepted 1,
    the reverse of what the API does), `n` must be 1, and `presence_penalty` /
    `frequency_penalty` must be 0. Passing the fixed value itself still
    validates. Source: https://platform.kimi.ai/docs/api/models-overview.
  - `moonshotai.chat` refuses a function-object `tool_choice` on `kimi-k3`,
    `kimi-k3.1-pro`, `kimi-k3.1-pro-highspeed`, `kimi-k2.7-code` and
    `kimi-k2.7-code-highspeed`: thinking is always on for these models, and Kimi
    returns 400 "tool_choice 'specified' is incompatible with thinking enabled".
    On the K3 series, use `"required"` to force a tool call; on
    `kimi-k2.7-code` / `kimi-k2.7-code-highspeed` only `"auto"` / `"none"`
    remain. Sources: https://platform.kimi.ai/docs/guide/use-tool-choice,
    https://platform.kimi.ai/docs/api/models-overview.
  - `moonshotai.chat` refuses `tool_choice: "required"` on `kimi-k2.6`,
    `kimi-k2.7-code` and `kimi-k2.7-code-highspeed`, where Kimi documents
    "Passing `"required"` returns an error"; the K3 series keeps it. Source:
    https://platform.kimi.ai/docs/api/models-overview.
  - `moonshotai.chat` refuses `prompt_cache_breakpoint` on content parts (Kimi
    rejects the request with HTTP 400 and caches request prefixes on its own) and
    SVG `data:` URLs in `image_url` parts (Kimi accepts JPEG, PNG, GIF, WebP,
    BMP, HEIC and HEIF). Sources: https://platform.kimi.ai/docs/api/chat,
    https://platform.kimi.ai/docs/guide/use-kimi-vision-model.

- 95869cc: mureka: the song route takes a target `duration` (mureka-9.5), and the pricing notes cite the published per-song rates
  - `mureka.music` (POST /v1/song/generate) accepts `duration`, an integer
    number of seconds from 120 to 300. Mureka's spec reads "Target song
    duration, in seconds. Value range: [120,300]. If not provided, the model
    determines the duration automatically. Supported only by mureka-9.5." and
    the changelog for 2026.10.29 says "Lyrics to song API supports duration
    control"
    (https://platform.mureka.ai/docs/api/operations/post-v1-song-generate.html,
    https://platform.mureka.ai/docs/en/changelog.html, checked 2026-11-12).
    Before this change, a typed call with `duration` did not compile and an
    untyped one passed with an `unknown_param` warning. Now a length outside
    120–300, or a fractional one, is refused at `duration`.
    `mureka-7.6`, `mureka-o2`, `mureka-8` and `mureka-9` refuse it with
    `unsupported_param` ("Supported only by mureka-9.5"), and
    `constraintsFor(id)` exposes each row. `auto` accepts it, because the spec
    does not say whether the alias honours it. `DURATION_MIN_SECONDS` and
    `DURATION_MAX_SECONDS` are exported from `unmodel/mureka`.
  - `unmodel/music`: `durationSeconds` on a `mureka/…` ref is no longer refused
    as unsupported. With the `lyrics` extra it compiles to the song route's
    `duration`, unchanged because both are seconds. The range and the
    mureka-9.5-only rule are reported at `durationSeconds`. The prompt-to-song
    and instrumental routes have no length field, so they still refuse
    `durationSeconds`, and the message now names the song route and mureka-9.5.
  - Mureka publishes its USD prices per generated song. They differ by route as
    well as by model. Lyrics-to-song costs $0.03 (7.6), $0.045 (o2/8/9) and
    $0.15 (9.5). Prompt-to-song costs $0.30 (7.6/o2/8/9) and $0.50 (9.5).
    Instrumental (BGM) costs $0.03, $0.045 and $0.15. Sources are the static
    chunk behind https://platform.mureka.ai/pricing, corroborated by fal.ai's
    Mureka page. `cost` is still omitted, but the module notes now give the
    right reason: `ModelCost` has no per-song unit, and one id has a different
    price on each route. The old reason, that no rate list was published, was
    wrong.
  - Doc-comment corrections in `unmodel/mureka`: mureka-9.5 is generally
    available, not early access. The route inventory now lists the video, TTS,
    podcast, describe/recognize/transcribe, finetuning, billing and uploads
    routes that are not validated, and it no longer files
    `/v1/song/easy-generate` (validated as `mureka.musicFromPrompt`) as
    doc-note-only. The mureka-o1 `stream` carve-out is attributed to the song
    route alone.

- 6911988: murf: companded codecs warn instead of failing, `pronunciationDictionary` on `murf.tts`, and a re-verified catalog

  Every source below was read on 2026-11-12.
  - **ULAW / ALAW no longer refuse requests Murf fulfils.** A companded `format` with a
    `sampleRate` other than 8000 or a `channelType` other than `MONO` was an error on both
    routes; it is now an `invalid_enum_value` warning naming the value the API applies:
    "ULAW and ALAW formats only support mono channel type and a sample rate of 8000 Hz. If
    you specify a different channel type or sample rate, the API will default to the
    supported values." (https://murf.ai/api/docs/text-to-speech/overview)
  - **`pronunciationDictionary` on `murf.tts`.** The Synthesize Speech body takes it too
    ("`pronunciationDictionary` (map from string to PronunciationDetail, optional) — Custom
    pronunciations for words in `text`." —
    https://murf.ai/api/docs/api-reference/text-to-speech/generate), so `SpeechGenerateBody`
    accepts it instead of a compile error and an `unknown_param` warning, and `murf/gen2`
    takes it as an extra in `unmodel/tts`.
  - **The `falcon-2` row is Falcon 2.1 under its earlier id.** Its `name` is now
    `"Falcon 2.1 (earlier id falcon-2)"` and its rate cites "Falcon 2.1 costs 1 cent per 1000
    characters." (https://murf.ai/api/docs/text-to-speech-models/falcon-2-1) — still $10 per
    1M characters. It is not marked deprecated: Murf says "still accepted".
  - The character-cap issue's `meta.source` is the FAQ (https://murf.ai/api/docs/resources/faq)
    that states the cap, not the TTS overview, which no longer does.
  - JSDoc: `locale` is documented on both routes, not "Gen2 only"; pause tags in `text` are
    Gen2-only ("custom pause tags … are Synthesize (Gen 2) only" —
    https://murf.ai/api/docs/text-to-speech/synthesize).
  - `docs/providers.md` records why Murf's Instant Voice Cloning is not covered: it "is
    available on the Enterprise plan only" and returns `403` until enabled per workspace.

- c23190f: murf: Falcon 2.1 on `murf.ttsStream`, and the stream fields it ships with

  Murf released Falcon 2.1 on 2026-10-19 ("Send `model: "falcon-2.1"` to use it." —
  https://murf.ai/api/docs/changelog/2026/10/19). It is now the only value of the Stream
  Speech `model` enum and its default, and "The earlier identifiers falcon-2, falcon2 and
  FALCON are still accepted and use Falcon 2.1"
  (https://murf.ai/api/docs/api-reference/text-to-speech/stream, read 2026-11-12).
  - `falcon-2.1` joins the Murf catalog at $10 per 1M characters ("Falcon 2.1 costs 1 cent
    per 1000 characters." — https://murf.ai/api/docs/text-to-speech-models/falcon-2-1) with
    the 3,000-character cap, and validates without `unknown_model`.
  - `murf.ttsStream` accepts `falcon2` and `FALCON` and prices them as `falcon-2.1`.
    `STREAM_MODEL_IDS` lists all of them and is now a literal tuple; its union is exported
    as `MurfStreamModelId`, which `SpeechStreamBody.model` autocompletes from.
  - `DEFAULT_STREAM_MODEL` is `"falcon-2.1"` ("`model` (enum, optional, default:
    falcon-2.1)"), with no regional exception.
  - `SpeechStreamBody` gains `volumeOffset` (integer, -50 to 50, default 0; values outside
    the range "are clamped to the nearest limit", so they warn rather than fail),
    `pronunciationDictionary` (`Record<string, PronunciationDetail>`, `type` `"IPA"` or
    `"SAY_AS"`) and the deprecated `multiNativeLocale` (warns, as it does on `murf.tts`).
    New exports: `VOLUME_OFFSET_MIN`, `VOLUME_OFFSET_MAX`, `PRONUNCIATION_TYPES`,
    `FALCON_STYLE` and the `PronunciationDetail` / `PronunciationDetailType` types.
  - On every Falcon spelling, a `style` other than `"Conversational"` warns ("Falcon 2.1
    voices speak in a single style, `Conversational`." —
    https://murf.ai/api/docs/text-to-speech/speech-customization).
  - `unmodel/tts` serves `murf/falcon-2.1` on the stream route (bytes). Both Falcon refs
    take `volumeOffset` and `pronunciationDictionary` as extras.

- 57487c3: murf: `gen2` is retired from `murf.ttsStream`

  "The Gen2 model has been decommissioned for the Streaming API. If you haven't migrated yet,
  use our latest Falcon 2 model on the Streaming API."
  (https://murf.ai/api/docs/changelog/2026/10/5, read 2026-11-12). Gen2 itself is not
  retired: "Gen2 remains available via Synthesize or non-streaming (Gen2)"
  (https://murf.ai/api/docs/introduction/overview).

  Retired:
  - `model: "gen2"` on `murf.ttsStream` — now an `invalid_enum_value` error naming the
    route that serves it, instead of passing and pricing at the Gen2 rate. Replacement:
    `murf.tts` with `modelVersion: "GEN2"` for Gen2, or `model: "falcon-2.1"` to keep
    streaming. `"gen2"` leaves `STREAM_MODEL_IDS` and `MurfStreamModelId`; the `gen2`
    catalog row and `murf/gen2` in `unmodel/tts` (which compiles to the generate route)
    are unchanged.
  - `variation` on `SpeechStreamBody` — the Stream Speech schema does not declare it
    ("variations are Synthesize (Gen 2) only" —
    https://murf.ai/api/docs/text-to-speech/synthesize), so it moves to
    `SpeechGenerateBody`; on the stream route it is now a compile error and a runtime
    `unknown_param` warning. Replacement: `murf.tts`.

- 8e7442a: openai: three corrections read off the live docs on 2026-11-12 — two were refusals of requests the API accepts
  - `openai.imageEdit` no longer refuses `input_fidelity` on `gpt-image-1-mini`.
    The createEdit reference reads "Supports `high` and `low` on
    `gpt-image-1.5`; `gpt-image-1-mini` supports only `low`.", so the param is
    narrowed to `low` (an `invalid_enum_value` for `high`) instead of denied
    outright; the wire arm and the `unmodel/image-edit` extras follow.
  - `openai.image` no longer refuses `chatgpt-image-latest`. The create
    reference's model list now ends "…`gpt-image-2.6-flare`, and
    `chatgpt-image-latest`.", so the edits-only gate (an `unsupported_capability`
    error) is gone; the id gets a generations arm with the GPT Image 1 surface
    (`ChatgptImageLatestBody`) and joins `unmodel/image`'s roster. The reference
    also dropped its `dall-e-2` default — "Specify a model explicitly." — which
    is what `openai.image` has always required.
  - Every `openai.tts` row (`tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`,
    `gpt-4o-mini-tts-2025-12-15`) and every `openai.stt` row except
    `gpt-transcribe` (`whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`,
    `gpt-4o-mini-transcribe-2025-12-15`, `gpt-4o-transcribe-diarize`) is now
    `status: "deprecated"` and validates with a `deprecated_model` warning:
    "The following text-to-speech models are deprecated and will be removed from
    the API on January 6, 2027" and "On August 26, 2026, we notified developers
    using `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`" (removal
    2027-02-26). No replacement row is added: the named TTS successor
    `gpt-realtime-2.1-mini` is "Speech generation | `v1/audio/speech` | Not
    supported", and the STT successors `gpt-live-transcribe` /
    `gpt-realtime-whisper` are realtime-transcription-session models.

  Sources: https://developers.openai.com/api/reference/resources/images/methods/edit.md,
  https://developers.openai.com/api/reference/resources/images/methods/generate.md,
  https://developers.openai.com/api/docs/deprecations,
  https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini.md,
  https://developers.openai.com/api/docs/models/gpt-live-transcribe.md.

- 2f662f6: openai: GPT-6 generation on `openai.chat`, GPT-Image-2.5 / 2.6 on `openai.image` and `openai.imageEdit`, `gpt-image-1` retired (models.dev snapshot 2026-11-12, every rule read off the vendor's pages the same day)
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

- 85d96a6: openai: the six `-pro` models leave `unmodel/chat`, `safety_identifier` reaches every GPT image model, and `gpt-image-2` and DALL·E carry their deprecation (vendor pages read 2026-11-12/13)
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

- 64835e3: perplexity: `checkChat` reports the billed cost and deep-research reasoning tokens

  `perplexity.checkChat` priced a response from catalog token rates only, which
  misses what every Sonar request also bills. On Perplexity's own sample
  responses it reported $0.000411 for a `sonar` request billed $0.005420 ("1
  request × $5 ÷ 1,000 = $0.005" is the search fee —
  [sonar](https://docs.perplexity.ai/docs/legacy/sonar/models/sonar)), and
  $0.091226 for a `sonar-deep-research` request billed $0.816123 (reasoning
  tokens, citation tokens and "21 queries × $5 ÷ 1,000 = $0.105" —
  [sonar-deep-research](https://docs.perplexity.ai/docs/legacy/sonar/models/sonar-deep-research)),
  all read 2026-11-12.
  - `costUSD` is now the response's own `usage.cost.total_cost` ("Total cost for
    the request in USD", a required field of the response's `usage` in the
    [API reference](https://docs.perplexity.ai/api-reference/legacy/sonar-post)).
    A response without `usage.cost` gets no `costUSD` instead of a token-only
    undercount.
  - `usage.reasoningTokens` is read from the top-level `usage.reasoning_tokens`,
    where Perplexity reports it: "They're reported separately from completion
    tokens in `usage.reasoning_tokens` and billed at their own rate."
    ([FAQ](https://docs.perplexity.ai/docs/resources/faq)).
  - `ChatCompletionLike` from `unmodel/perplexity/types` declares those two
    `usage` fields.

  The pre-send `estimate.costUSD` (and so `maxCostUSD`) still prices tokens
  only; the `unmodel/perplexity` module header and `docs/providers.md` now say
  so, and correct the endpoint note: `/chat/completions` is the documented
  alias of the canonical `POST /v1/sonar` ("For OpenAI SDK compatibility,
  `POST /chat/completions` is also accepted as an alias" —
  [OpenAI compatibility](https://docs.perplexity.ai/docs/legacy/sonar/openai-compatibility)),
  and the Orchestrator API (`/orchestrator/v1`) speaks Chat Completions,
  Responses and Anthropic Messages but stays out of the library because
  "Orchestrator API is in private preview."
  ([orchestrator models](https://docs.perplexity.ai/docs/orchestrator/models)).

- 8545143: perplexity: `perplexity.chat` accepts the Sonar reference's `file_url` and `pdf_url` chunks and string `image_url`, and refuses `video_url` by modality rather than shape

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

- a41e7eb: perplexity: the four Sonar models are marked deprecated

  The models.dev snapshot (2026-11-12) now carries `status: "deprecated"` on
  `sonar`, `sonar-pro`, `sonar-reasoning-pro` and `sonar-deep-research`, so
  `perplexity.chat` adds a `deprecated_model` warning for each of them. They
  still validate: Perplexity superseded Sonar Chat
  Completions with the Agent API (`POST /v1/agent`) but keeps serving it —
  "Sonar Chat Completions support ended on September 27, 2026. Synchronous and
  streaming requests keep working: they are being reformulated as Agent API
  requests"
  ([migration overview](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview),
  read 2026-11-12). Perplexity's suggested Agent API starting points are
  "`sonar` → `fast`, `sonar-pro` → `fast`, `sonar-reasoning-pro` → `low`,
  `sonar-deep-research` → `high`"
  ([migration how-to](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/how-to)).

  The same snapshot adds `family: "sonar"` to the `sonar-deep-research` row.

- 1041420: pixverse: corrected credit rate and v5.6 prices, no estimate for the legacy models, template requests without `img_id`, `webhook_id` on both routes, and a 2048-character image-to-video prompt

  All checked against PixVerse's current docs on 2026-11-12.
  - **Every estimate was 2.25× too high.** `CREDIT_USD` is now `1 / 225`.
    The pricing page gives "225 Credits = USD 1; 1 Credit ≈ USD 0.004444" and
    works out every USD figure as "total Credits ÷ 225"
    ([pricing](https://docs.platform.pixverse.ai/pixverse-api-pricing-2394995m0)).
    The $0.01-per-credit pack table the old rate came from is no longer on the
    page. Your plan, volume deals or promotions can change what you actually
    pay, so treat an estimate as PixVerse's list price.
  - **v5.6, 5 seconds with audio** now costs 80 credits at 540p, 90 at 720p and
    120 at 1080p, which is a flat 45 credits on top of the silent price. The
    catalog had 90, 80 and 150, the figures from the earlier pricing page.
  - **v4.5 / v4 / v3.5 return no estimate.** The pricing page now lists only
    C1, V6, V6 Max, V5.6, V5.5 and V5, and it says "Legacy-model availability
    depends on the active endpoint and your account". The three ids still
    validate, because both routes still accept them.
  - **Retired: `VideoCostInputs.motionMode`.** It only chose a column of the
    v4.5 / v4 / v3.5 price table, and PixVerse no longer publishes that table.
    `videoCredits` / `videoCostUSD` callers should stop passing it.
  - **`pixverse.videoFromImage` accepts template requests without `img_id`.**
    The schema's `anyOf` asks for `img_id` without `template_id`, or for
    `template_id` plus whatever image field the template takes. A multi-image
    template takes `img_ids` and rejects `img_id`
    (`SINGLE_IMAGE_INPUT_UNSUPPORTED`,
    [error details](https://docs.platform.pixverse.ai/error-details-2490131m0)).
    The validator used to require `img_id` in every request, so the only
    multi-image template request it let through was one the API refuses.
    `ImageToVideoParams` is now a union of the two shapes, so a request
    without `template_id` still needs `img_id`, at compile time and at run time.
  - **`webhook_id` is typed on both routes.** It is the id of a webhook you
    set up in your PixVerse account, not a callback URL. It used to be a
    compile error and an `unknown_param` warning. `.toApi("fal")` refuses it,
    because fal's v6 endpoint has no webhook field and dropping it would mean
    no callback ever arrives.
  - **`lip_sync_switch` is typed on `pixverse.videoFromImage`**, the spelling
    that route's schema uses, with the same v5-and-below gate as the other
    legacy lip-sync fields. `lip_sync_tts_switch` is still accepted.
  - **The image-to-video `prompt` limit is 2048 characters** (`IMAGE_PROMPT_MAX_CHARS`).
    The validator used to apply text-to-video's 5000.
  - The `.toApi("fal")` refusal message for `motion_mode` no longer says the
    motion mode changes the price, since PixVerse no longer prices it on this
    route.
  - Source links point at the current docs pages. The old pricing, model
    overview, capability matrix, V6 matrix and API key pages now return 404.

- 9399a1f: pixverse: a switch sent as `false` passes on every model, a template task lifts the image-to-video sound-effect / lip-sync gate, and a template task refuses multi-clip

  All checked against PixVerse's current docs on 2026-11-12.
  - **A gated switch sent as `false` is no longer refused.** `false` is each
    switch's documented default. The image-to-video schema's `allOf` admits
    `generate_multi_clip_switch: false` on any model, and text-to-video
    declares both switches `default: false`
    ([image-to-video](https://docs.platform.pixverse.ai/image-to-video-and-video-templates-13016633e0),
    [text-to-video](https://docs.platform.pixverse.ai/text-to-video-13016634e0)).
    Before this fix, `generate_multi_clip_switch: false` on c1, v5.6 or v6-max,
    `generate_audio_switch: false` on v5 and `lip_sync_switch: false` on v6 all
    came back as `unsupported_param`. `true` is still gated by model.
  - **`pixverse.videoFromImage` accepts the sound-effect / lip-sync fields on
    any model when the request has a `template_id`.** That route's schema reads
    "use only with a supporting model/template", and it says "Template metadata
    determines supported model, duration, and quality". The field docs already
    said "or with a `template_id`", but the validator refused these fields on
    every model above v5. `template_id` is still refused on v6-max. `pixverse.video` (text-to-video) keeps the plain
    v5-and-below gate, because its docs give only "Supported in v5 models and
    below".
  - **`pixverse.videoFromImage` refuses `generate_multi_clip_switch: true`
    next to `template_id`.** The schema description reads "Not supported with
    other models or template_id", and the `allOf` arm that allows `true` also
    requires that `template_id` is absent. A `false` switch on a template task
    still passes.
  - The `unmodel/video` refusal for an image input on `pixverse/…` now names
    the real route, `POST /openapi/v2/video/img/generate`. It used to say
    `/video/image/generate`, which does not exist.

- c95e726: pixverse: V6 Max (`v6-max`) joins the catalog, `pixverse.video`, `pixverse.videoFromImage` and `unmodel/video`

  PixVerse added V6 Max to text-to-video and image-to-video on 2026-10-22
  ([changelog](https://docs.platform.pixverse.ai/changelog-2394996m0)). It
  used to pass both validators with an `unknown_model` warning, no per-model
  checks and no estimate, and `unmodel/video` could not name it. Now it
  validates, prices and compiles the way its siblings do:
  - `duration` is any integer from 1 to 15 (`PER_SECOND_MODELS`), and
    `aspect_ratio` takes all eight ratios, 2:3, 3:2 and 21:9 included
    ([capability map](https://docs.platform.pixverse.ai/model-capability-map-2394982m0)).
  - `generate_audio_switch` is accepted (`AUDIO_SWITCH_MODELS`).
  - `template_id` is refused on V6 Max, by the wire validators and by the
    `pixverse/v6-max` row in `unmodel/video`. The capability map marks
    "Video Templates" as "Not supported" for it, and the pricing page says
    "V6 MAX (v6-max) Only support text-to-video/image-to-video now". The new
    `NO_TEMPLATE_MODELS` list (on `unmodel/pixverse` and
    `unmodel/pixverse/values`) names it.
  - `generate_multi_clip_switch` stays v5.5 / v6 only. The image-to-video
    schema's `allOf` and the text-to-video error example ("supported in model
    v5.5, v6 only") both leave V6 Max out.
  - Estimates are per second, 6 / 9 / 11 / 22 credits silent and 9 / 11 / 15 / 28
    with audio at 360p / 540p / 720p / 1080p
    ([pricing](https://docs.platform.pixverse.ai/pixverse-api-pricing-2394995m0)).
  - `.toApi("fal")` refuses `v6-max` with a reason, because fal serves no V6 Max
    endpoint and sending the request to the v6 URL would change the model.

  `v5-fast` still has no row. PixVerse gates it by account and publishes no
  price and no capability column for it, so it validates with an
  `unknown_model` warning.

- 9caf1a9: recraft: stop refusing four request shapes the API accepts, and re-source the generation rules to the current docs
  - `style_id` validates on every V4 / V4.1 model (V4.1 Flash excepted). It was refused with `unsupported_param` on the strength of a styles-doc sentence that is gone; the V4 Styles page now reads "Every V4 and V4.1 model (except V4.1 Flash) also accepts `style_id` or style references, at that model's own price." The `unmodel/image` rows for the V4 / V4.1 line carry `style_id` too. Curated `style`, `negative_prompt` and `text_layout` stay denied there, now sourced to the per-family matrix of https://www.recraft.ai/docs/api-reference/agents.
  - With no `model`, a curated `style` now resolves the request to the model whose list holds it — V3 first, then V2 — as the server does ("If a style name is supported by multiple models, the API defaults to Recraft V3 (if supported, to Recraft V2 otherwise)", https://www.recraft.ai/docs/api-reference/styles). Recraft's own example `{ prompt, style: "Illustration", text_layout }` used to be refused; it now validates and prices as `recraftv3`.
  - `response_format: "multipart"` is accepted on `recraft.image` and all five editing routes ("Must be one of `url`, `b64_json` or `multipart`", https://www.recraft.ai/docs/api-reference/endpoints). The multipart answer is `multipart/form-data`, which the OpenAI SDK behind `.toSdk("recraft")` cannot read.
  - The editing routes' input cap is 20 MB, not 10 ("| File size | Under 20 MB |", https://www.recraft.ai/docs/api-reference/appendix); `MAX_INPUT_IMAGE_BYTES` is now `20 * 1024 * 1024`, so a 15 MB image or mask no longer fails with `media_too_large`.
  - Provenance: `image_format` is cited to the endpoints doc, `upscale` to the `UpscaleMode` enum of https://www.recraft.ai/docs/api-reference/openapi.json, and the `issue.meta.source` of `substyle` / `creativity` records that the internal spec those lists came from now returns 404 and that no current Recraft source declares them.

- f18691b: recraft: the editing routes type `image_format` and `style_match`, and `recraft.imageEdit` refuses the V3-only params on V4 / V4.1
  - `image_format` (`"webp"` | `"png"`) now compiles and validates on all five editing routes: `imageEdit`, `imageEditInpaint`, `imageEditOutpaint`, `imageEditReplaceBackground` and `imageEditGenerateBackground`. It used to type as `never` and pass at run time with an `unknown_param` warning. Every route page lists "| `image_format` | string, `webp` | `webp` (lossless) or `png`." (https://www.recraft.ai/docs/api-reference/tools/image-to-image, …/inpainting, …/outpainting, …/background, 2026-11-12). Any other value is now `invalid_enum_value`. It is not refused on vector models, where the API ignores it.
  - `style_match` is typed `"regular"` on the same five routes ("**V3 only**, with `style_id`. Must be `regular`." on image-to-image; "Only `regular` for V3." on the others). `"precise"` / `"flexible"` are `invalid_enum_value` there.
  - `recraft.imageEdit` (imageToImage) now refuses `style`, `style_id`, `style_match`, `negative_prompt` and `text_layout` on the V4 / V4.1 models and their `_raster` aliases with `unsupported_param`. The image-to-image page marks each one "**V3 only.**" and says "Image to image doesn't take V4 / V4.1 styles". `controls.artistic_level` and `controls.no_text` are refused there too ("V3 models only", https://www.recraft.ai/docs/api-reference/endpoints). These params all used to pass silently.
  - With no `model`, a curated V3 `style` on `recraft.imageEdit` now resolves the request to `recraftv3` / `recraftv3_vector` for checks and pricing, as on the generations route. So `{ image_url, prompt, strength, style: "Illustration" }` validates and prices at $0.04.
  - `unmodel/image-edit`: `outputFormat` on a `recraft/…` ref now compiles to `image_format` (`"webp"` / `"png"`; `"jpeg"` is an error that names both) instead of being declared unsupported. The V4 / V4.1 rows of `IMAGE_EDIT_MODEL_PARAMS` no longer offer `style_id` (now a compile error there). The three V3 rows offer `style_id` and `style_match: "regular"`.

- f92e85f: recraft: Recraft V4.1 Flash, the V4 Styles line and every `_raster` alias now validate, cap and price like their siblings
  - `recraft.image` (and `unmodel/image`) catalog `recraftv4_1_flash` ($0.007 per image, 1K raster) and the V4 Styles line: `recraftv4_styles` ($0.035), `recraftv4_styles_vector` ($0.05), `recraftv4_styles_pro` ($0.10) and `recraftv4_styles_pro_vector` ($0.12). These ids used to pass with an `unknown_model` warning and no prompt cap, size table or estimate. Sources: https://www.recraft.ai/docs/api-reference/models/recraft-v4-1-flash, https://www.recraft.ai/docs/api-reference/models/recraft-v4-styles and https://www.recraft.ai/docs/api-reference/pricing (2026-11-12).
  - The eleven documented `_raster` aliases (`recraftv4_1_raster`, `recraftv4_1_pro_raster`, `recraftv4_1_utility_raster`, `recraftv4_1_utility_pro_raster`, `recraftv4_1_flash_raster`, `recraftv4_raster`, `recraftv4_pro_raster`, `recraftv4_styles_raster`, `recraftv4_styles_pro_raster`, `recraftv3_raster`, `recraftv2_raster`) are cataloged with their base model's rate, prompt cap, size table, styles and rules ("The aliases behave exactly like the base names" — https://www.recraft.ai/docs/api-reference/models/overview). `recraft.imageEdit` now accepts the seven V3/V4/V4.1 raster aliases, and the four V3-only editing routes accept `recraftv3_raster`; both used to refuse them with `invalid_enum_value`.
  - V4 Styles requires a style: a request with neither `style_id` nor `style_reference_urls` is refused, and the error names both. `style_reference_urls` is now typed (1–10 URLs or data URLs), cannot be combined with `style_id`, adds the documented $0.005 style-creation charge to the estimate once per request, and, with no `model`, resolves the request to `recraftv4_styles` as the server does.
  - V4.1 Flash refuses `style`, `style_id`, `style_match`, style references, `negative_prompt` and `text_layout`, per its model page.
  - `style_match` is now typed (`"regular" | "precise" | "flexible"`) and narrowed per family, from the "Parameter support by model family" matrix of https://www.recraft.ai/docs/api-reference/agents: `regular` on V2/V3, `flexible` / `precise` on the V4 / V4.1 / V4 Styles line. The unified image rows carry `style_reference_urls` and `style_match` on every model that takes them, and `style_id` on the V4 Styles line. New exports: `STYLE_MATCHES`, `RecraftStyleMatch`, `STYLE_CREATION_USD`, `DEFAULT_STYLE_REFERENCES_MODEL_ID`.

- f8f5b7e: recraft: retire `recraft20b` from the catalog and from `unmodel/image`'s `recraft/…` refs
  - `recraft20b` was cataloged (with no price and no prompt cap) on the strength of one source, the internal `TransformModel` enum of https://external.api.recraft.ai/doc/spec/api/api.yaml. That document now returns "404 page not found" (2026-11-12), and both current specs leave the id out of the `TransformModel` enum that types `model` on every generation request: the docs-generated https://www.recraft.ai/docs/api-reference/openapi.json (32 ids, `recraftv2` through `recraftv4_1_flash_raster`) and the backend https://external.api.recraft.ai/doc/spec/external-api.yaml. No Recraft docs page, pricing row or appendix entry names it.
  - Replacement: none named by Recraft. A raw `recraft.image({ model: "recraft20b", … })` still validates, now with an `unknown_model` warning; the cataloged models are listed at https://www.recraft.ai/docs/api-reference/models/overview.

- cf01887: resemble: `resemble.tts` no longer refuses 2,001–3,000-character requests, and the catalog says why it carries no price
  - `resemble.tts` (`POST /synthesize`) errors only above 3,000 characters of
    `data` — the cap in its API reference ("max 3,000 characters",
    https://docs.resemble.ai/api-reference/text-to-speech/synthesize). Its guide
    says "≤ 2,000 characters"
    (https://docs.resemble.ai/voice-generation/text-to-speech/synchronous), so
    2,001–3,000 characters now validates with an `over_output_limit` warning that
    names both pages (`meta.source`, `meta.referenceSource`), where it used to be
    an error. New export: `RESEMBLE_SYNTHESIZE_MAX_CHARACTERS` (3000).
  - `resemble.ttsStream` (`POST /stream`) keeps its 2,000-character error: both of
    its pages agree ("max 2000 characters",
    https://docs.resemble.ai/api-reference/text-to-speech/stream-synthesize).
    `RESEMBLE_MAX_CHARACTERS` and the `resemble-ultra` row's `limit.characters`
    stay 2000, the figure every page of both routes accepts.
  - Docs corrected: Resemble does publish per-second voice rates
    (https://app.resemble.ai/billing/api/v1/plans — Text-To-Speech 0.00067 USD/s
    on Flex, 0.0005 on Team and Business), but they depend on the caller's plan
    and are no longer sold to new customers, so `cost` stays omitted and
    `estimate.costUSD` stays `undefined`.
  - Resemble stopped selling voice generation to new customers on 2026-08-13 and
    keeps serving existing ones
    (https://www.resemble.ai/resources/why-a-former-voice-ai-company-went-all-in-on-deepfake-detection);
    `resemble.tts` and `resemble.ttsStream` stay, and `docs/providers.md` now says
    so.

- a089b0c: revai: the `low_cost` and `fusion` transcribers are deprecated and unpriced, `speaker_channels_count` is accepted for Spanish and French, and `revai.stt` accepts `null` wherever Rev AI's OpenAPI does
  - `low_cost` (Reverb Turbo) and `fusion` (Whisper Fusion) now carry
    `status: "deprecated"`, so `revai.stt` warns `deprecated_model` on them.
    Rev AI deprecated them on 2026-07-28 and 2026-08-20 ("This option is being
    sunset and will be removed in a future release"), recommending the default
    `machine` transcriber instead
    (https://docs.rev.ai/api/asynchronous/changelog). Both are still served,
    so both still validate.
  - `low_cost` and `fusion` lose their cost. https://www.rev.ai/pricing no
    longer lists "Reverb turbo transcription" or "Whisper Fusion Transcription"
    (checked 2026-11-12; the last published rates, $0.10/hr and $0.005/min, are
    on the 2026-08-23 Wayback snapshot). English-language estimates for them
    now return no `costUSD`. Non-English jobs still estimate at the $0.30/hr
    foreign-language rate, because Rev AI ignores `transcriber` for
    non-English audio.
  - `speaker_channels_count` is no longer refused for `language: "es"` or
    `"fr"`. Its own field description reads "Only available for English,
    Spanish and French languages", and the 2023-05-15 changelog entry
    documents "valid languages (en, es, fr)". Every other non-English language
    is still refused, and the error now names the five codes that are accepted.
  - `null` is accepted, and treated as unset, on every job option
    `SubmitJobMediaUrlOptions` marks `nullable: true` (`transcriber`,
    `language`, `metadata`, `source_config`, `notification_config`, the
    boolean flags, `summarization_config`, `translation_config` and their
    nested `model`/`type`, `auth_headers`, …). Before, these failed with
    `invalid_shape`. `JobsBody` gains `| null` on the same fields. `verbatim`,
    `custom_vocabularies`, `strict_custom_vocabulary` and `media_url` are not
    nullable in the OpenAPI, so they still refuse `null`
    (https://docs.rev.ai/_bundle/api/asynchronous/reference.yaml).
  - The `revai.stt` docs now say which add-ons the estimate leaves out: forced
    alignment, summarization and translation, which Rev AI bills per minute,
    in addition to the human rush and verbatim add-ons.

- ea172a9: revai: the `low_cost` restrictions no longer refuse non-English jobs, and they cite the archived reference
  - `revai.stt` refused `diarization_type` and `forced_alignment` with
    `transcriber: "low_cost"` even on non-English jobs (for example
    `language: "es"`). Rev AI's transcribers page says "The `transcriber`
    option is ignored for non-English transcription requests", so those jobs
    never run in the low-cost environment. The validator already warned that
    the transcriber is ignored and priced the job at the foreign-language rate.
    These requests now validate, with the existing `deprecated_model` and
    ignored-`transcriber` warnings. English jobs (an absent `language`, `en`,
    `en-us`, `en-gb`) are still refused.
  - The two low-cost refusals now set `meta.source` to the archived reference
    that carries the clauses word for word
    (https://web.archive.org/web/20250601173112/https://docs.rev.ai/api/asynchronous/reference),
    not to the changelog, which does not mention them. The live reference no
    longer documents `low_cost`.

  Sources: https://docs.rev.ai/api/asynchronous/transcribers,
  https://docs.rev.ai/api/asynchronous/changelog,
  https://web.archive.org/web/20250601173112/https://docs.rev.ai/api/asynchronous/reference.

- 98bff0b: rime: Coda takes Italian and Dutch, inline phonemes work on English Mist v3, and dropped params warn instead of failing

  Every fact below comes from Rime's docs, checked 2026-11-12.
  - **`lang` accepts `it` / `ita` and `nl` / `nld`.** Before this change,
    `rime.tts` refused every Italian and Dutch Coda request at the schema,
    although Rime serves them. The Coda reference
    (https://docs.rime.ai/api-reference/coda/http) lists "| `it` | Italian |"
    and "| `nl` | Dutch |", and says "The 3-letter ISO 639-2 codes that older
    integrations send (`eng`, `spa`, `fra`, `por`, `ger`, `jpn`, `ara`, `hin`,
    `ita`, `nld`) remain accepted". `LANGUAGES` (and so
    `TTS_MODEL_PARAMS.coda.languages` in `unmodel/rime/values`) now lists the
    ten languages in 20 spellings. Both are Coda only, so Mist models still
    refuse them, and the refusal now names Dutch and Italian among the
    languages to send to Coda. In `unmodel/tts`, `language: "it-IT"` on
    `rime/coda` compiles to `lang: "it"`.
  - **`phonemizeBetweenBrackets` validates on Mist v3.** It was refused on
    `mistv3` with an error. https://docs.rime.ai/docs/models says
    "`phonemizeBetweenBrackets` works on English Mist v3 only. Coda and
    non-English Mist v3 ignore it." The custom-pronunciation page's own
    example sends it with `"modelId": "mistv3"`. It now passes on Mist v3 when
    `lang` is English or omitted (the Mist v3 reference documents `lang`
    "(default: en)"). With `lang` French, German or Spanish it passes with an
    `unsupported_param` warning flagged `ignored`, citing
    https://docs.rime.ai/docs/migrate-legacy-mist: "French, German, and
    Spanish requests ignore it." It is also a typed Mist v3 extra in
    `unmodel/tts` (`rime/mistv3`).
  - **On Coda, `phonemizeBetweenBrackets` warns instead of failing.** Coda
    ignores it, so it is now an `unsupported_param` warning flagged `ignored`,
    and the message names English Mist v3 and Coda's custom lexicon as what
    Rime offers instead.
  - **On Mist v3, `noTextNormalization` warns instead of failing.**
    https://docs.rime.ai/docs/migrate-legacy-mist says "`noTextNormalization`
    has no effect on Mist v3, which always normalizes text." The rule now
    cites that page. On Coda it is still refused.
  - **`mistv2` is `deprecated`**, as `mist` already was, so a request naming
    it gets a `deprecated_model` warning. https://docs.rime.ai/docs/models
    says "Mist v1 (`mist`) and Mist v2 (`mistv2`) are legacy models. Both
    retire on December 3, 2026."
  - The `rime.tts` header and `docs/tts.md` drop the old "api.rime.ai returns
    404" host note. The validator still addresses
    `https://users.rime.ai/v1/rime-tts`, which Rime's error reference still
    documents. Rime now also documents per-model hosts
    (`https://coda.api.rime.ai/`, `https://mist.api.rime.ai/`), where "The host
    selects the model, so the body needs no `modelId`". Those hosts are not
    validated.

- 42b0838: rime: Mist v2 server-sent events pass, Mist v2 and Mist v1 lose their unsourced cost, and the legacy checks cite a live page

  Every fact below comes from Rime's docs and pricing page, checked 2026-11-12
  and 2026-11-13.
  - **`accept: "text/event-stream"` passes on `mistv2` with a warning.** Before
    this change, `rime.tts` refused it with an `invalid_enum_value` error.
    Rime still serves it:
    https://docs.rime.ai/docs/migrate-legacy-mist says "Server-sent events
    (`Accept: text/event-stream`) are Mist v2 only. Before December 3, move them
    to HTTP streaming or the Mist v3 WebSocket." The warning is
    `invalid_enum_value` with `meta.retires: "2026-12-03"` and cites that page.
    `RimeTtsParams.accept` now types the value, and `unmodel/rime` exports it
    as `MIST_V2_SSE_ACCEPT`. Every other id, including `mist`, still refuses it,
    and the error now says that server-sent events are `mistv2` only. The
    constant goes away with the `mistv2` row once it retires on 2026-12-03.
  - **`rime.tts` no longer estimates cost for `mistv2` or `mist`, and
    `maxCostUSD` no longer applies to them.** Both rows carried
    `perMillionCharacters: 30`, quoting a "$0.03 / 1K characters" Starter rate
    that https://www.rime.ai/pricing no longer shows. The page lists only Mist
    v3 and Coda v2 for TTS, so no Mist v2 or Mist v1 rate exists to quote. `coda`
    and `mistv3` keep $50/1M and $30/1M characters. Those figures are now
    re-sourced to the per-minute Flex rates ("$0.050 / min" and
    "$0.030 / min") through Rime's own "about 1,000 characters per minute"
    conversion, which is approximate.
  - **The legacy checks cite a page that still exists.** Rime's Mist v2 HTTP
    reference (https://docs.rime.ai/api-reference/mistv2/http) now redirects
    to the Mist v3 page. The `meta.source` of the `mistv2`/`mist` samplingRate
    check (4000–44100 Hz) and of the three-format Accept check is now
    https://docs.rime.ai/docs/migrate-legacy-mist, and both messages say the
    values were last verified 2026-08-13. The Coda `noTextNormalization`
    refusal now cites https://docs.rime.ai/docs/models. Severities are
    unchanged.

- 937d5b0: rime: retire `arcana`, `arcanav2` and `arcanav3`, replaced by `coda`
  - The three Arcana ids have left the `rime` catalog, `RIME_MODEL_IDS`,
    `unmodel/rime/values` (`TTS_MODELS`, `TTS_MODEL_PARAMS`), the typed
    `unmodel/tts` refs (`rime/arcana`, `rime/arcanav2`, `rime/arcanav3`) and
    `rime.tts`'s per-model constraint table. The `ARCANA_MODEL_IDS` export is
    removed from `unmodel/rime` and `unmodel/rime/values`.
  - Rime retired the model. Its migration guide
    (https://docs.rime.ai/docs/migrate-arcana-to-coda, checked 2026-11-12):
    "Arcana retired from the Rime cloud API on August 15, 2026. Cloud requests
    that set `modelId` to `arcana`, `arcanav2`, or `arcanav3` are now served by
    Coda." The changelog (https://docs.rime.ai/docs/changelog) says the same:
    "Arcana retired from the Rime cloud API. Requests using `arcana`,
    `arcanav2`, or `arcanav3` are now served by Coda."
  - **Replacement: `coda`** (`rime/coda` in `unmodel/tts`). The guide says:
    "Change `modelId` to `coda`. The endpoint, authentication, transports, and
    remaining request fields do not change." A `rime.tts` request that still
    names an Arcana id validates with an `unknown_model` warning and no cost
    estimate. Rime serves it with Coda.

- 2b16773: runway: corrected rates, bounds and false refusals on the existing models

  Re-read against Runway's OpenAPI document, `guides/pricing.md` and
  `assets/inputs.md` on 2026-11-12.
  - **No longer refused** (requests the API accepts):
    - `seed` on `veo3.1` / `veo3.1_fast` and on every seedance arm, all routes
      (integer 0–4294967295).
    - `duration: "auto"` on `seedance2` / `_fast` / `_mini` / `seedance2_5`.
    - `seedance2_5`: the 1080p and 4K ratios (24 sizes on every route),
      `outputFormat: "mov"`, and `mode: "edit"` on video-to-video.
    - `promptText` up to 10000 characters on `seedance2` / `_fast` / `_mini`.
    - `resolution: "768p"` / `"2k"` on `hailuo3`, `"720p"` / `"1080p"` on
      `happyhorse_1_0` image-to-video.
    - gen4.5's nine 10-bit and HDR `outputFormat` profiles (`hdr10`, `hlg`,
      `sdr_rec709_10bit`, `hdr_prores`, …) and aleph2's `sdr_rec709_10bit`.
    - `background: "transparent"` on `gpt_image_2` (also on the unified
      `background` extra).
    - Prompts up to 45000 characters on `gemini_image3_pro`,
      `gemini_image3.1_flash` and `gemini_2.5_flash` (`gemini_image3_pro` now
      also enforces its minimum of 3).
    - Freeform `seedream5_lite` sizes: any `W:H` whose area is 3686400–16777216
      pixels, not only the 16 presets; `unmodel/image` sends such `dimensions`
      verbatim.
  - **Tightened**: `seedance2` / `_fast` / `_mini` take at most 2
    `referenceVideos` on video-to-video (3 elsewhere).
  - **Prices** (`guides/pricing.md`):
    - `seedance2` 14 / 30 / 40 / 150 credits/s at 480p / 720p / 1080p / 4K with
      a 56-credit minimum; `seedance2_fast` 11 / 24 (44 minimum);
      `seedance2_mini` 7 / 15 (28 minimum). The fast / mini catalog rates are
      removed (no documented default ratio).
    - `seedance2_5` gains its 1080p tier (68 credits/s); its 4K sizes get no
      estimate (no published 2.5 rate); the catalog now carries the default
      `1280:720` rate, $0.30/s.
    - `duration: "auto"` on the seedance arms is estimated at the variant
      maximum it reserves up front (15 s, 30 s on `seedance2_5`).
    - Documented defaults replace worst cases: `hailuo3` 2K ($0.15/s, now in the
      catalog), `grok_imagine_1_5` 480p ($0.10/s, now in the catalog),
      `happyhorse_1_0` image-to-video 720P; `happyhorse_1_0` text-to-video bills
      by its ratio's tier, and lower-case `768p` / `720p` price at their tier.
    - `gemini_image3.1_flash` is priced: 5 / 7 / 11 / 16 credits per 512px /
      1K / 2K / 4K image.
    - The professional-output surcharge is per format: 5 credits/s for
      `prores` / `png_sequence`, 20 for the 10-bit and HDR profiles, 40 above
      4 megapixels (`HDR_SURCHARGE_CREDITS_PER_SECOND`,
      `HDR_OVER_4MP_SURCHARGE_CREDITS_PER_SECOND`).
  - The generation routes' 200 is documented as `{ id, estimatedCost: {
credits } }` in the module headers.

- cd4dbcf: runway: 29 new models validate, price and compile — Kling 2.5 / 3.0 / O3 / 4.0, WAN 3.0, MiniMax H3 Max, Grok Imagine 1.5 Lite, Gemini Omni Flash 1.1 / 1.2, Muse, Nano Banana 2.1 / 2 Lite, GPT Image 2.5 / 2.6, FIBO, Ideogram and Seedream 5.0 Flash / Pro Layers

  Every row was read off Runway's OpenAPI document (spec version 2024-11-06),
  `guides/models.md`, `guides/pricing.md` and `assets/inputs.md` on 2026-11-12.
  - **Video** (`runway.video`, `runway.videoFromImage`, and for the O3 / 4.0 /
    Gemini 1.x arms `runway.videoFromVideo`): `kling2.5_turbo_pro`,
    `kling3.0_standard` / `_pro` / `_4k`, `klingO3_standard` / `_pro` / `_4k`,
    `kling_4`, `kling_4_flash`, `wan3`, `wan3_prime`, `h3_max`,
    `grok_imagine_1_5_lite`, `gemini_omni_flash_1.1`, `gemini_omni_flash_1.2`.
    New wire params: `cfgScale`, `providerSettings` (Kling multishot;
    `keepOriginalSound` on Kling O3 video-to-video), `promptExpansionMode`
    (H3 Max), `references` / `referenceVideos` on image-to-video, `duration:
"auto"` (Gemini Omni 1.x), `mode: "edit"`, `auto_480p` / `auto_720p` /
    `auto_1080p` ratios, a `"middle"` prompt-image position (Kling 4.0), and the
    `360p` / `4k` / `768p` resolutions.
  - **Image** (`runway.image`): `muse_image`, `gemini_image3.1_flash_lite`,
    `nano_banana_2.1`, `gpt_image_2_5_flare` / `_sunburst`,
    `gpt_image_2_6_flare` / `_sunburst`, `bria_fibo_1_5`, `bria_fibo_edit_1_5`,
    `ideogram_4_0`, `ideogram_4_5`, `ideogram_vector`, `seedream5_flash`,
    `seedream5_pro_layers`. New wire params: `thinkingLevel`,
    `reasoningEffort`, `frameCount`, `frameDurationMs`, `preciseEdit`,
    `contextWindow`, `maskUri`, `resolution` and `optimizePromptMode`;
    `outputFormat` gains `webp` / `gif` / `svg`, `quality` gains `xhigh` /
    `max` / `very_low`, and `background` `transparent` (on the arms that offer
    it). `promptText` and `ratio` are now required per model rather than by the
    route — `seedream5_pro_layers` needs only its source image, and the Ideogram
    and FIBO Edit arms make `ratio` optional.
  - **Documented rules, now enforced**: Kling 4.0's first / ≤8 middle / last
    frame layout and its 10-image budget (frames plus references); Kling O3's
    7-image budget, and no `last` keyframe with `multiPrompt`; multishot
    segments totalling 3–15 s and `shotType: "intelligence"` needing
    `promptText`; `promptText` with references on Kling 4.0 / 4.0 Flash; WAN 3.0
    keyframes needing an `auto_*` ratio and never mixing with references; H3
    Max's last frame needing a first; Gemini Omni 1.2's extend / edit modes;
    GPT Image 2.6's GIF / SVG / JPEG rules; Ideogram 4.5's editing rules; FIBO
    Edit's two-image minimum for a chosen size; and the 31-bit `seed` on the FIBO
    and Ideogram Vector arms.
  - **Pricing** (`guides/pricing.md`): flat and documented-default rates in the
    catalog; request-aware estimates for the tiered ones — the GPT Image 2.5 /
    2.6 quality × size × aspect tables (GIF and SVG included), Nano Banana 2.1
    and FIBO by size, Ideogram by quality (with 4.5's reference-dependent
    default), Seedream Pro Layers at its 17-image reservation, WAN / Grok Lite /
    Gemini Omni 1.x by ratio tier, and Kling 4.0 at list price (an upper bound
    until its promotion ends on 2026-11-30 UTC), rounded up where the page says
    so. Kling O3 video-to-video and Gemini Omni 1.x edits bill the input video's
    length and get no estimate.
  - **Unified surfaces**: the new video models join `unmodel/video` (with the
    documented ratio tiers — Kling 4.0's `1440:1440` is its 1080p square — and a
    tier alone compiling to the model's `auto_<tier>` token), and the new
    generating image models join `unmodel/image`, which now sends `outputFormat:
"webp"` to the arms that take it and sends no `ratio` to an arm that makes it
    optional when no size was asked for. `bria_fibo_edit_1_5` and
    `seedream5_pro_layers` edit an image rather than generate one, so they stay
    on `runway.image`.
  - `referenceVideos` items type `type` as optional: the seedance / hailuo3 /
    wan3 arms still require `type: "video"`, the Kling 4.0 Flash and Gemini
    Omni 1.x arms refuse it.

  Not catalogued: `hailuo3_highspeed`, `hailuo3_lite`, `recraft_v4_1_flash` and
  `recraft_v4_1_vector` have arms in the spec but are on neither
  `guides/models.md` nor `guides/pricing.md`; `ruby`, `enhance_frame_rate`,
  `mirelo_sfx_2_0`, `eleven_music_v2_5` and `POST /v1/image_to_vector` live on
  routes unmodel does not validate yet.

- e0954f5: runway: seedance `bitrate`, `draft` and `draftTaskId` are typed, and the seedance2_5 / hailuo3 input rules are enforced

  Read against Runway's OpenAPI document, `guides/models.md`,
  `guides/pricing.md` and `assets/inputs.md` on 2026-11-12.
  - **Typed and validated** (they used to pass as unknown params, and a typed
    call refused them at compile time):
    - `bitrate: "standard" | "high"` on `seedance2` / `_fast` / `_mini`, on
      all three video routes. It does not change the price.
    - `draft: boolean` on `seedance2_5`, on all three routes. A draft bills at
      the 480p rate (20 credits/s, 80-credit minimum) whatever its `ratio`, and
      `outputFormat: "mov"` is refused beside `draft: true`.
    - `draftTaskId` (a UUID v4) on `seedance2_5` text-to-video. An enhance
      request sends `model` and `draftTaskId` only. Every other generation
      field is refused beside it (`promptText`, `ratio`, `duration`, `seed`,
      `audio`, the three reference arrays, `draft`, `outputFormat`), and it
      gets no estimate because the preview's duration is not in the request.
    - Every other arm refuses all three fields as `unsupported_param`.
  - **Now refused** (the API rejects these requests):
    - `seedance2_5` video-to-video `mode: "extend"` / `"edit"` without
      `promptText`, or with a `ratio`.
    - `mode: "edit"` with any `duration` other than `"auto"`. An omitted
      duration counts as the documented default of 5, so it is refused too.
    - On image-to-video, a `promptImage` array that mixes keyframes (with
      `position`) and references (without) on `seedance2` / `_fast` / `_mini`
      / `seedance2_5` and `hailuo3`, as on wan3.
  - **Sizes and prices**:
    - `seedance2_fast` / `seedance2_mini` serve 480p and 720p only. Their
      `VIDEO_MODEL_PARAMS` row no longer lists `1080p`, so `unmodel/video`
      refuses it instead of sending the 720p `960:960` square.
    - `480p` at `1:1` now compiles to `640:640` instead of being refused.
    - The twelve small sizes split six and six into 480p and 720p
      (`SEEDANCE2_SMALL_RATIOS_BY_TIER`). `seedance2` bills its 480p sizes at
      14 credits/s, `seedance2_fast` at 11 and `seedance2_mini` at 7, rather
      than at the 720p rate.

- 8a62b8f: smallest-ai: catalog the `lightning_v3.1_pro_10_26` preview checkpoint

  `smallest-ai.tts` and `tts({ model: "smallest-ai/lightning_v3.1_pro_10_26" })`
  now know the third value of the Waves `model` enum ("Allowed values:
  `lightning_v3.1`, `lightning_v3.1_pro`, `lightning_v3.1_pro_10_26`",
  https://docs.smallest.ai/api-reference/models/text-to-speech/synthesize-speech,
  read 2026-11-12). Until now the id drew an `unknown_model` warning and no cost
  estimate.
  - It is the Pro pool's preview checkpoint for English, Spanish and Hindi,
    released 2026-10-29 (https://docs.smallest.ai/changelog/lightning-v-3-1/2026/10/29).
    It "becomes the stable `lightning_v3.1_pro` for these three languages" on
    2026-11-28 and "remains available until 2026-12-28". Its catalog row is
    marked `status: "beta"`.
  - It prices like `lightning_v3.1_pro`, $19.50 per 1M characters: "pricing ...
    the same as `lightning_v3.1_pro`" (changelog), and the Pro pool is "approximately
    USD 0.195 per 10,000 characters" (https://smallest.ai/pricing/models).
  - `word_timestamps` gets the same accepted-but-ignored warning as on the two
    stable pools, and the unified row is the Pro row (same codecs, languages and
    extras), because "Other request parameters behave identically".
  - `SmallestModelId` / `SmallestTtsModelId`, `SMALLEST_MODEL_IDS` and the
    `unmodel/smallest-ai/values` `TTS_MODELS` / `TTS_MODEL_PARAMS` tables gain
    the id.

- 40571b8: smallest-ai: correct the Waves TTS character cap, the default model, pricing and two missing body params

  Every fact below was read on 2026-11-12 from the endpoint reference
  (https://docs.smallest.ai/api-reference/models/text-to-speech/synthesize-speech),
  the deprecations page (https://docs.smallest.ai/api-reference/deprecations/models)
  and https://smallest.ai/pricing/models.
  - **The `text` cap is 8000 characters, not 250.** "Max 8000 characters after
    trim; whitespace-only strings are rejected." `smallest-ai.tts` refused every
    request between 251 and 8000 characters; it now refuses only past 8000,
    measured on the trimmed text. `MAX_CHARACTERS` and every catalog row's
    `limit.characters` are 8000. The model cards' "Max chunk size 250
    characters" (optimal throughput at ~140 characters) is a throughput figure,
    so a longer `text` now draws an `over_output_limit` **warning** instead.
  - **An omitted `model` has no default pool.** "If you omit `model`, it's picked
    from the voice: Pro catalog voices use `lightning_v3.1_pro`, all others
    `lightning_v3.1`." The validator can't see which pool a voice belongs to, so a
    request without `model` no longer resolves to `lightning_v3.1`. The per-pool
    checks are skipped (a Pro voice sent with `language: "ja"` and no `model` is
    no longer refused), and there is still no cost estimate. Pin `model` to get
    one. `word_timestamps` still warns without a model.
  - **A Pro-only `language` on `lightning_v3.1` is a warning, not an error.** The
    reference lists 20 codes for the base pool but documents no 400 for the other
    11, and from 2026-11-30 the id is served by Pro, which "accepts every
    `language` code that `lightning_v3.1` accepts". `number_pronunciation_language`
    follows the same rule.
  - **`lightning_v3.1` is deprecated.** "Retiring on Nov 30, 2026; use
    `lightning_v3.1_pro`." It now draws `deprecated_model`. It still validates,
    because afterwards "requests with `"model": "lightning_v3.1"` or no `model`
    will be served by `lightning_v3.1_pro`".
  - **`lightning_v3.1` is priced at $17.50 per 1M characters**: "Usage-based
    Lightning v3.1 text-to-speech pricing at approximately USD 0.175 per 10,000
    characters." Until now it had no `cost`, so `maxCostUSD` could not fire on it.
    The Pro rate ($19.50, "approximately USD 0.195 per 10,000 characters") now
    cites the same page, because the model card's pricing row only links to
    https://smallest.ai/pricing, which now shows voice-agent rates.
  - **`date_format` (`"EU" | "US"`) and `content_filter` (`{ enabled?: boolean;
action?: "reject" | "flag" | "redact" }`) are typed and validated.** Both are
    documented body fields (date_format since
    https://docs.smallest.ai/changelog/lightning-v-3-1/2026/10/14, content_filter's
    `redact` since https://docs.smallest.ai/changelog/lightning-v-3-1/2026/10/17).
    Before this, `TtsBody` rejected them at compile time and the runtime warned
    `unknown_param`. They are also extras on `tts({ model: "smallest-ai/…" })`.
    New exports: `DATE_FORMATS`, `CONTENT_FILTER_ACTIONS`, `SmallestDateFormat`,
    `SmallestContentFilter`, `SmallestContentFilterAction`.
  - **No `Accept` header is sent.** "`Accept` ... Optional. The server ignores it;
    `output_format` sets the audio format." `.request.headers` is now just
    `content-type: application/json` (plus `x-expire-content` when you opt in).
  - Issue `source` links point at the current docs URLs (the old
    `docs.smallest.ai/models/...` paths redirect).

  Removed exports from `unmodel/smallest-ai`:
  - `DEFAULT_MODEL_ID` — the API has no default model (see above). Pass `model`
    explicitly; `lightning_v3.1_pro` is the pool that serves every request after
    2026-11-30.
  - `REQUIRED_ACCEPT` — the header is not required and is no longer sent.

- 2068b1f: smallest-ai: refuse whitespace-only `text`, flag off-checkpoint languages on `lightning_v3.1_pro_10_26`, warn on `word_timestamps` for every model

  Facts read from the endpoint reference
  (https://docs.smallest.ai/api-reference/models/text-to-speech/synthesize-speech)
  and the Pro model card
  (https://docs.smallest.ai/model-cards/text-to-speech/lightning-v-3-1-pro),
  2026-11-12 and 2026-11-13.
  - **`smallest-ai.tts` now refuses whitespace-only `text`.** The reference
    (sync and SSE) says "Max 8000 characters after trim; whitespace-only strings
    are rejected." Until now `"   "` validated and drew the API's 400. A `text`
    that is empty after `trim()` is now `invalid_shape` at `["text"]`. The body
    is still sent untrimmed.
  - **A `language` other than `en`, `es` or `hi` on `lightning_v3.1_pro_10_26`
    draws an `invalid_enum_value` warning.** The reference says "On
    `lightning_v3.1_pro_10_26`, use `en` (English), `es` (...) or `hi` (...)",
    and the model card says "The other 28 languages and `auto` stay on their
    current checkpoints". `auto` warns too. No page documents a 400, so the
    request still validates. With `language` omitted, `number_pronunciation_language`
    is checked instead, because then it "also becomes the synthesis language".
    New export: `PREVIEW_CHECKPOINT_LANGUAGES` (`unmodel/smallest-ai` and
    `unmodel/smallest-ai/values`). The unified row for
    `tts({ model: "smallest-ai/lightning_v3.1_pro_10_26" })` now completes only
    these three languages. Others still compile, with the wire warning.
  - **`word_timestamps` warns on uncatalogued models too**, such as the next
    dated checkpoint: "Accepted on this endpoint but ignored". Until now only an
    omitted `model` or one of the three catalogued ids got the warning.

- 76a11f8: soniox: stop refusing four requests the API accepts, mark realtime `api_key` deprecated, and update doc links
  - **Context length is now a warning.** Going over 10,000 characters of
    context content on `soniox.realtimeTranscription` now reports a
    `near_context` warning; it used to be an `invalid_shape` error. Soniox caps
    context at "**8,000 tokens** (about 10,000 characters)", and the server error
    reads "Context is too long: N tokens, the maximum is 8000 tokens." A
    character count cannot settle a token limit, so the old error could refuse
    a dense context the API accepts. The warning's `meta.limitTokens` is the
    real cap. `MAX_CONTEXT_CHARACTERS` is unchanged. Sources:
    https://docs.soniox.com/stt/concepts/context and
    https://docs.soniox.com/api-reference/stt/websocket-api.
  - **8-bit raw audio formats.** `audio_format` now accepts `pcm_s8le`,
    `pcm_s8be`, `pcm_u8le` and `pcm_u8be` next to the bare `pcm_s8` and
    `pcm_u8`. The official SDK's `AudioFormat` union (`@soniox/node` 2.5.0)
    includes all four, which settles the docs' "`pcm_s8` … (`le`/`be`)"
    wording. Before this change they were refused with `invalid_enum_value`.
    `SONIOX_RAW_AUDIO_FORMATS` and `SonioxRawAudioFormat` both include them.
  - **`null` on the async body.** `soniox.stt` now accepts an explicit `null` on
    `audio_url`, `file_id`, `language_hints`, `language_hints_strict`,
    `enable_speaker_diarization`, `enable_language_identification`,
    `webhook_url`, `webhook_auth_header_name`, `webhook_auth_header_value` and
    `client_reference_id`, and `TranscriptionsBody` types each one `| null`.
    The OpenAPI `CreateTranscriptionPayload` types every optional field
    `anyOf: [<type>, null]` (https://docs.soniox.com/openapi.yaml). A `null`
    audio source counts as absent in the exactly-one-source rule.
  - **Realtime `api_key` is deprecated.** "The `api_key` field of the start
    request is **deprecated**. From **15 January 2027** a connection that sends
    its key only there is refused." (https://docs.soniox.com/api-reference/stt/websocket-api).
    The field is still accepted and passed through untouched, but it now
    carries an `unsupported_param` warning (`meta.refusedFrom: "2027-01-15"`).
    The module docs and the JSDoc example now send the key with the connection,
    either as an `Authorization: Bearer <key>` header or as
    `["soniox-api-key", key]` in the WebSocket protocols list
    (https://docs.soniox.com/authentication/migrate-websocket-authentication).
  - **Doc links.** Soniox moved its docs from `soniox.com/docs` to
    `docs.soniox.com`, and every old URL now redirects. Issue `meta.source`
    values, `provider.doc` and the provenance comments now point at the new
    pages. The 5-hour audio cap is now cited from the limits pages ("300
    minutes", fixed) rather than the models page; the value is unchanged.

- 3d7981e: soniox: `RealtimeTranscriptionConfig.api_key` now has a `@deprecated` tag

  The JSDoc on `api_key` now starts with `@deprecated`, so editors strike the
  field through and TypeScript reports it as deprecated, like the repo's other
  deprecated wire fields. Soniox's WebSocket reference says "Send the API key
  with the connection instead". From 15 January 2027 it refuses a connection
  whose key is sent only in that field
  (https://docs.soniox.com/api-reference/stt/websocket-api). The field still
  validates and is passed through untouched, with the same `unsupported_param`
  warning (`meta.refusedFrom: "2027-01-15"`).

- 8d76188: soniox: Soniox STT v6 — `stt-async-v6` and `stt-rt-v6` — plus `enable_agent_text_input`
  - `stt-async-v6` (`soniox.stt`, and `soniox/stt-async-v6` on `unmodel/stt`)
    and `stt-rt-v6` (`soniox.realtimeTranscription`) join the catalog. They were
    released November 3, 2026 and are "fully compatible with the existing v5
    models and Soniox API" (https://docs.soniox.com/stt/models). Pricing is the
    same per-mode rate as v5: $0.10/hour async, $0.12/hour real-time
    (https://soniox.com/pricing).
  - `soniox.realtimeTranscription` accepts `enable_agent_text_input`, typed on
    `RealtimeTranscriptionConfig`. The WebSocket reference says it is
    "Supported only by `stt-rt-v6`", and the agent-text-input page lists
    "`enable_agent_text_input` on a model that doesn't support it." under
    "These errors end the stream". So `true` on `stt-rt-v5` or `stt-rt-v4` is
    now an `unsupported_param` error that names `stt-rt-v6`. `false`, and ids
    missing from the catalog, still pass.
  - `endpoint_sensitivity` and `endpoint_latency_adjustment_level` no longer
    warn on `stt-rt-v6`: they are "Supported by `stt-rt-v5` and `stt-rt-v6`"
    (https://docs.soniox.com/api-reference/stt/websocket-api). The warning on
    other catalogued ids now gives that model list as `meta.supportedModels`.
  - The cost-estimation docs on both validators now say that context,
    translation and agent text are billed per input text token on top of the
    hourly rate, which makes a per-minute estimate a lower bound.

- da3d24f: soniox: `stt-async-v5` and `stt-rt-v5` are now catalogued as deprecated

  Soniox's models page lists both as "**Deprecated** — Will be removed Dec 15,
  2026" (https://docs.soniox.com/stt/models). They are still served, so both
  ids still validate and price, but they now carry `status: "deprecated"` and
  emit a `deprecated_model` warning.

  | Deprecated id  | Replacement    | After 2026-12-15                                                       |
  | -------------- | -------------- | ---------------------------------------------------------------------- |
  | `stt-async-v5` | `stt-async-v6` | "requests using stt-async-v5 will automatically route to stt-async-v6" |
  | `stt-rt-v5`    | `stt-rt-v6`    | "requests using stt-rt-v5 will automatically route to stt-rt-v6"       |

  The v6 models are "fully compatible with the existing v5 models and Soniox
  API", so migrating means changing the `model` string and nothing else.
  `soniox/stt-async-v5` is still a valid ref on `unmodel/stt`.

- 78d9393: speechify: spoken-character caps, the 160 kbps mp3 formats, `safety_identifier`, the legacy pair's rate and the stream SDK shape

  Every fact below was read on 2026-11-12.
  - **Character caps count spoken characters, in code points.** "Every limit counts the characters
    that are spoken, which are the characters the request is billed for. SSML tags do not count, an
    entity such as `&amp;` is one character, and a `<sub>` counts its `alias`." and "A character is
    one Unicode code point, so an emoji is one character even where JavaScript's `length` counts
    two." (https://docs.speechify.ai/build/guides/concepts/api-limits). `speechify.tts` and
    `speechify.ttsStream` used to count `input.length` with markup included, refusing SSML-heavy
    and emoji-heavy input the API accepts. The 2,000 / 20,000 spoken caps now apply to plain text,
    without its leading and trailing whitespace; input carrying SSML or an entity gets the ceiling
    on "The input as sent, markup included": 20,000 on `/v1/audio/speech`, 32,000 on
    `/v1/audio/stream`, exported as `SPEECH_MAX_SENT_CHARACTERS` / `STREAM_MAX_SENT_CHARACTERS`. The
    issue's `meta.counted` says which count fired (`"spoken"` or `"sent"`).
  - **`mp3_22050_160` and `mp3_24000_160`** are accepted on both routes (OpenAPI `AudioOutputFormat`,
    "All 23 values, as the API accepts them." —
    https://docs.speechify.ai/build/guides/concepts/audio-formats), and `unmodel/tts` compiles a
    160 kbps mp3 request to them.
  - **`safety_identifier`** joins `AudioSpeechBody` and `AudioStreamParams`. It was a compile error
    before. It is checked against the OpenAPI pattern `^[A-Za-z0-9._:|+/=-]{1,64}$` ("The value must
    be 1 to 64 characters of letters, digits and `. _ - : | + / =`." —
    https://docs.speechify.ai/build/guides/concepts/safety-identifiers), so an email address is an
    `invalid_shape` error.
  - **`simba-english` and `simba-multilingual` price at $15 per 1M characters.** "A request naming
    either id is billed at the `simba-3.5` rate on your plan"
    (https://docs.speechify.ai/build/changelog/2026/11/10), and `simba-3.5` bills its $15 Starter
    list rate "From 22 November" (https://docs.speechify.ai/build/changelog/2026/11/9). They stay
    catalogued and deprecated: "Nothing breaks; the audio changes."
    (https://docs.speechify.ai/build/guides/concepts/models).
  - **`ttsStream(...).toSdk("speechify")` returns `{ Accept?, body }`**, the `StreamAudioRequest`
    that `client.audio.stream()` takes in @speechify/api 4.0.0 (2026-08-19) through 5.0.0
    (`Accept?: Speechify.StreamAudioRequestAccept; body: Speechify.GetStreamRequest;`). It used to
    return the flat 3.x shape, and those SDKs send no body for that shape. `AudioStreamSdkParams`
    changes to match.

- 88292f0: speechify: Simba 3.5, and the `pronunciations` field it ships with

  Speechify's recommended model since 2026-10-18 is `simba-3.5` ("Streaming-native model covering
  48 languages under one model id, on every plan." — https://docs.speechify.ai/build/guides/concepts/models,
  read 2026-11-12). The OpenAPI `model` enum on both synthesis routes is now
  `"simba-3.0" | "simba-3.2" | "simba-3.5"` (https://docs.speechify.ai/openapi/api-reference.json).
  - `simba-3.5` joins the Speechify catalog, `SPEECHIFY_MODEL_IDS` and the `unmodel/tts` ref union
    (`speechify/simba-3.5`), and validates on `speechify.tts` and `speechify.ttsStream` without
    `unknown_model`. It prices at its $15 per 1M characters Starter list rate ("Simba 3.5 lists at
    $15/$12/$10 per 1M characters on Starter/Pro/Scale , billed at $10/$8/$6 until 21 Nov 2026 ." —
    https://speechify.ai/pricing): the launch price ends on a published date, and the estimate is the
    worst case a budget check should assume. `simba-3.0` and `simba-3.2` stay at $10.
  - `AudioSpeechBody` and `AudioStreamParams` gain `pronunciations` (OpenAPI `Pronunciations`), typed
    as `SpeechifyPronunciation` — an `ipa` entry or an `alias` entry, never both. It was a compile
    error before. Shape rules every model shares are checked: at most 200 entries
    (`MAX_PRONUNCIATIONS`), `text` 1-64 characters (one word on an `ipa` entry), `alias` 1-160
    characters, `ipa` 1-64 phones, no control characters, no repeated `text` (case-insensitive unless
    both entries are `case_sensitive`).
  - Which model applies them is now exported as `PRONUNCIATION_LANGUAGES`, each model's
    `pronunciation_languages` from GET /v1/audio/models. A non-empty list on `simba-3.0`, `simba-3.2`
    or an omitted `model` is an `unsupported_capability` error (both publish
    `"pronunciation_languages": []`, and "A request whose model or language is not listed refuses the
    field with `400 pronunciations_unsupported`" — https://docs.speechify.ai/build/guides/text-to-speech/pronunciation).
    On `simba-3.5` a `language` outside its 47 pronunciation languages is a warning: English is "not
    supported yet", and the set "can grow over time". An empty list passes on every model.
  - The `simba-3.2` English-only error now points non-English requests to `simba-3.5` and `simba-3.0`.

- a381c41: speechmatics: Oak 1 (`oak-1`), Speechmatics' multilingual medical model, validates, prices and compiles on `speechmatics.stt` and `unmodel/stt`
  - `oak-1` joins the hand catalog, the `model` / `operating_point` literal
    unions, `STT_MODELS` and `STT_MODEL_PARAMS` (`unmodel/speechmatics/values`),
    so `stt({ model: "speechmatics/oak-1", … })` autocompletes and compiles.
    Batch list rate $0.30/hr (https://www.speechmatics.com/pricing.md:
    "| Pre-recorded | Oak 1 | 0.3 | — |"), so a declared duration now yields a
    `costUSD` estimate and `checkJob` prices finished jobs.
  - Oak 1 carries Melia 1's Batch gates (https://docs.speechmatics.com/speech-to-text/models.md:
    "On Batch, Melia 1 and Oak 1 match the Enhanced and Standard models for core
    transcription features […] They do not yet support the following features"):
    `language` must be `"multi"` ("Oak 1 does not support the `auto` language
    value, which returns an error"); custom dictionary, find-and-replace, entity
    detection, audio filtering, speaker identification and the six
    speech-intelligence add-ons are refused with `unsupported_capability`, and
    every refusal names the model that drew it.
  - `domain: "medical"` on `oak-1` is refused with a message that says Oak 1 is
    itself the multilingual medical model ("Oak 1 is a standalone model for
    healthcare audio. It is separate from the Enhanced Medical model").

- 1962012: speechmatics: list rates corrected, and three requests the API accepts are no longer refused

  Rates (https://www.speechmatics.com/pricing.md, "Speech-to-text list rates
  (USD per hour)", read 2026-11-12 — the HTML /pricing page renders
  discounted rates and is no longer the source):
  - Batch, used by `costUSD` estimates and `checkJob`: Enhanced $0.40 → $0.75/hr
    ("| Pre-recorded | Enhanced | 0.75 | — |"), Standard $0.24 → $0.45/hr
    ("| Pre-recorded | Standard | 0.45 | — |"), Melia 1 $0.129 → $0.24/hr
    ("| Pre-recorded | Melia 1 | 0.24 | — |").
  - Realtime constants: `REALTIME_STANDARD_USD_PER_MINUTE` now $0.45/hr
    ("| Real-time | Standard | 0.45 | — |"), `REALTIME_ENHANCED_USD_PER_MINUTE`
    $0.80/hr ("| Real-time | Enhanced | 0.8 | — |"). New
    `REALTIME_MELIA_USD_PER_MINUTE` ($0.40/hr, "| Real-time | Melia 1 | 0.4 | — |")
    and `REALTIME_OAK_USD_PER_MINUTE` ($0.46/hr, "| Real-time | Oak 1 | 0.46 | — |"):
    Melia 1 and Oak 1 now run on Realtime too.
  - `MELIA_REGIONS` is `["eu1", "us1", "au1"]` and covers Oak 1: "The Melia 1 and
    Oak 1 models are available on the EU1, US1, and AU1 endpoints only"
    (https://docs.speechmatics.com/get-started/authentication.md).

  Requests that were refused and now validate:
  - `transcription_config.output_locale` takes an array on both layers —
    "`output_locale` also accepts an array of locales, one per language present
    in the audio" (https://docs.speechmatics.com/speech-to-text/formatting.md;
    the API reference and the SDKs still type it `string`). Two locales of one
    language (`["en-GB", "en-US"]`) are refused, as upstream does: "Passing two
    locales for the same language, for example `en-GB` and `en-US` together, is
    rejected."
  - `unmodel/stt` accepts `domain` on `speechmatics/standard`, typed `string` as
    on Enhanced and the wire (e.g. `"bilingual-en"`): the Spanish and English
    pack is `{"language": "es", "domain": "bilingual-en"}` and the packs are for
    "The Enhanced and Standard models"
    (https://docs.speechmatics.com/speech-to-text/languages.md), and the API
    reference types `domain` as a free string, "e.g. 'finance' or 'medical'"
    (https://docs.speechmatics.com/api-ref/batch/create-a-new-job.md).
    `domain: "medical"` is still refused off Enhanced, at run time.
  - `SpeechmaticsTranscriptionConfig` types `language_hints_strict`,
    `entities_config.detect_advanced_entities`, `enable_redaction` and
    `redaction_config.entity_classes` (new `SpeechmaticsEntitiesConfig` /
    `SpeechmaticsRedactionConfig`), all documented at
    https://docs.speechmatics.com/api-ref/batch/create-a-new-job.md; `ExactKeys`
    rejected them at compile time. From `unmodel/stt` they ride
    `providerOptions.speechmatics`.

- f3bdfce: speechmatics: five documented rejections are now refused, and two refusals no page backs are now warnings

  New refusals in `speechmatics.stt` (and so in `unmodel/stt`):
  - `transcription_config.output_locale` beside `language: "auto"`: "Output
    Locale is currently not supported in combination with using Automatic
    Language Identification. Jobs with this combination of features will be
    rejected." (https://docs.speechmatics.com/speech-to-text/batch/language-identification.md,
    2026-11-12). On `unmodel/stt` an omitted `language` compiles to `"auto"`, so
    `output_locale` now needs a `language`.
  - `transcription_config.additional_vocab` above 20,000 entries (new
    `MAX_ADDITIONAL_VOCAB_ITEMS`): "If a job's custom dictionary
    (`additional_vocab`) contains more than 20,000 items, the job is rejected
    with an `HTTP 400 Bad Request`" (https://docs.speechmatics.com/speech-to-text/batch/limits.md).
  - Redaction pairing, from https://docs.speechmatics.com/api-ref/batch/create-a-new-job.md:
    `enable_redaction: true` without `redaction_config.entity_classes` ("Must be
    set together with `redaction_config.entity_classes`"); `enable_redaction`
    with `enable_entities: true` but no `entities_config.detect_advanced_entities: true`
    ("If `enable_entities` is true, `entities_config.detect_advanced_entities`
    must also be true"); and a repeated `entity_classes` item ("unique items").
    `detect_advanced_entities` without `enable_entities: true` ("Must be set
    together with `enable_entities: true`") is a warning: no rejection is
    documented, and redaction "can be used on its own" without `enable_entities`.

  Refusals relaxed to warnings on `melia-1` and `oak-1`:
  - `enable_entities` is sent with a warning carrying `meta.contradictedBy`. The
    models page says Melia 1 and Oak 1 "do not yet support" entity detection, while
    https://www.speechmatics.com/pricing.md lists "| Entity detection |
    Pre-recorded | On request | Melia 1, Oak 1 |". `unmodel/stt` now offers
    `enable_entities` on both models.
  - A single language code such as `language: "en"` is a warning. The docs say
    "Set `language` to `multi`" and name `auto` as the value that "returns an
    error" (https://docs.speechmatics.com/speech-to-text/models.md). The
    languages page lists what these models do not support as "the `auto` option,
    the bilingual and multi-language pack codes, or translation", so `auto` and
    the pack codes (`ar_en`, `en_ms`, `cmn_en`, `cmn_en_ms_ta`) are still
    refused.

- 310d3f1: stability: Stable Audio 2.5 and 3.0 now cost 8 credits ($0.08) per generation
  - `stableAudioCredits("stable-audio-2.5")` returns 8 (was 20), and
    `stability.music` / `stability.musicFromAudio` with
    `model: "stable-audio-2.5"` and `stability.musicInpaint` estimate
    `costUSD` 0.08 instead of 0.20. Stability's v2beta spec
    (https://api.stability.ai/v2alpha/openapi) now says "Requests made using the
    Stable Audio 2.5 model have a flat rate of 8 credits per successful result.",
    and https://docs.stability.ai/pricing lists Stable Audio 2.5 at 8.
  - `stableAudioCredits("stable-audio-3")` returns 8 (was 26): "`stable-audio-3`
    requires 8 credits per generation" (same spec), and the pricing page lists
    Stable Audio 3.0 at 8.
  - `stable-audio-2` is unchanged: `credits = 17 + 0.06 * steps`, 20 credits
    ($0.20) at its default 50 steps.
  - The `stable-audio-3` catalog row gains `limit.characters: 10000`, the
    `"AudioPrompt"` cap its routes share with the 2.x ones.
  - `stability`'s `provider.doc` is now https://docs.stability.ai/api-reference,
    where Stability's API reference moved; the pricing source is
    https://docs.stability.ai/pricing.

  Verified 2026-11-12. The archive dates the price change to between 2026-09-11
  (the spec still said 20 and 26) and 2026-10-19 (the pricing page already said 8).

- 79164e3: stability: `toRequestInit` refuses the Stable Audio and Stable Image edit routes, which are multipart-only

  `toRequestInit` now refuses `stability.music`, `stability.musicFromAudio`,
  `stability.musicInpaint` and the six `stability.imageEdit*` routes (`Erase`,
  `Inpaint`, `Outpaint`, `SearchAndReplace`, `SearchAndRecolor`,
  `RemoveBackground`) at compile time and at run time, the way it already
  refused `stability.image` / `imageCore` / `imageSd3`. Their results now carry
  `.request.body: "form"` and are typed `ValidatedForm`.

  Before this, the helper JSON-encoded these bodies without any error. Every
  `Blob` (`audio`, `image`, `mask`) came out as `{}`, so the request could
  never succeed. Stability's v2beta spec (https://api.stability.ai/v2alpha/openapi,
  checked 2026-11-12) declares only `multipart/form-data` for all nine routes. Send
  `.request.url` with `stability.toFormData(validated)` as the body instead.

- c7a1937: stepfun: cache hits are priced, step-3.5-flash-2603's effort ladder is checked, and the ASR row leaves `unmodel/chat`
  - `checkChat` now reads StepFun's top-level `usage.cached_tokens` ("A positive
    `response.usage.cached_tokens` value indicates a cache hit and reports the
    number of cached input tokens.",
    https://platform.stepfun.ai/docs/en/guides/developer/prompt-cache.md,
    2026-11-12). Before, it read only `prompt_tokens_details.cached_tokens`, so
    `cachedInputTokens` was missing and every cached token was priced at the
    full input rate. On `step-5-preview`, 900 cached of 1,000 prompt tokens was
    reported as $0.00108 instead of $0.00023. The nested field is still read
    first, and wins when both are present. The fix is in the shared
    openai-compatible checker, so any host that sends the top-level field
    benefits; hosts that never send it are unaffected.
  - `reasoning_effort: "medium"` on `step-3.5-flash-2603` is now
    `invalid_enum_value`. It passed clean before. "`step-3.5-flash-2603` accepts
    `low` and `high` only."
    (https://platform.stepfun.ai/docs/en/api-reference/chat/chat-completion-create.md,
    2026-11-12). Every other StepFun model keeps `low` / `medium` / `high`.
  - `stepaudio-2.5-asr` is no longer a `ChatModelRef`: the retired ref is
    `stepfun/stepaudio-2.5-asr`. The model is speech recognition, served on
    "POST https://api.stepfun.ai/v1/audio/asr/sse"
    (https://platform.stepfun.ai/docs/en/api-reference/audio/asr-sse.md,
    2026-11-12), not on chat completions. `stepfun.chat` still accepts the id,
    but now warns `unsupported_capability` at `model`, names that route, and
    says unmodel has no validator for it. It used to validate with no warning
    at all.
  - `step-tts-2` no longer carries `status: "deprecated"` and no longer warns
    `deprecated_model`. No StepFun page deprecates it: the China reference lists
    it and the Global pricing page prices it. It still warns
    `invalid_enum_value` because it is off the Global reference's enum.

- 534a47e: stepfun: `step-5-preview` on `stepfun.chat`, `stepaudio-3-tts` on `stepfun.tts` with its 500-character instruction cap
  - `stepfun.chat` (models.dev refresh, 2026-11-12) adds `step-5-preview`
    (1,000,000-token context, 65,536-token output; tools, structured output,
    reasoning). `max_tokens` above 65,536 is `over_output_limit`, matching the
    model page's "64k tokens"
    (https://platform.stepfun.ai/docs/en/guides/models/step-5-preview.md).
    Its catalog row lists text, image and video input, but video does not
    validate yet: a `video_url` content part is refused with `invalid_shape`,
    as it already was on `step-3.7-flash`. The shared openai-compatible
    dialect has no `video_url` arm, and how to add one is an open owner
    decision (docs/providers.md, the stepfun row).
    The other StepFun chat rows pick up models.dev's new prices and the
    `structuredOutput` flag.
  - `step-1-32k` and `step-2-16k` are removed from the StepFun catalog and from
    `ChatModelRef` (`stepfun/step-1-32k`, `stepfun/step-2-16k`): StepFun retired
    both on July 8, 2026, and names `step-1o-turbo-vision` as the replacement
    (https://platform.stepfun.ai/docs/en/guides/model-migration.md,
    https://platform.stepfun.com/docs/zh/guides/models/deprecations.md). Sending
    either id to `stepfun.chat` now draws `unknown_model`.
  - `stepfun.tts` accepts `stepaudio-3-tts`, which the create-speech reference
    now lists ("Currently supports `stepaudio-3-tts` and `stepaudio-2.5-tts`",
    https://platform.stepfun.ai/docs/en/api-reference/audio/create-audio.md).
    It gets a hand catalog row (models.dev does not carry it yet), joins
    `TTS_MODELS` / `TTS_MODEL_PARAMS` on `unmodel/stepfun/values`, and is
    reachable from `unmodel/tts` as `stepfun/stepaudio-3-tts` with the same
    codecs and the `instruction` / `volume` extras. It carries no cost: the
    model card ("$0.36 / 10,000 characters") and the pricing page ("$14.00 / 1M
    billable input text characters" from November 17, 2026, weighted per
    script) disagree, so no `costUSD` is estimated.
  - The `instruction` cap is now per model — "200 characters for
    `stepaudio-2.5-tts`, 500 characters for `stepaudio-3-tts`". A 201–500
    character instruction on `stepaudio-3-tts` was refused before; it now
    passes. Over the cap is still `invalid_shape` at `instruction`, and the
    message names both caps. Ids with no documented cap (`step-tts-2`) are not
    capped.
  - **Breaking:** `MAX_INSTRUCTION_CHARACTERS` (from `unmodel/stepfun`) is now
    the per-model table `{ "stepaudio-3-tts": 500, "stepaudio-2.5-tts": 200 }`
    instead of the number `200`. Read `MAX_INSTRUCTION_CHARACTERS[model]`.

- 2f68b89: stepfun: `stepfun.tts` takes the documented `language` field, and `unmodel/tts` compiles `language` to it
  - `TtsBody` gains `language?: "zh" | "en" | "ja" | "ko" | "fr" | "es"` —
    "Target language; defaults to English when omitted. Supported values:
    `zh`, `en`, `ja`, `ko`, `fr`, `es`. Japanese, Korean, French, and Spanish
    are in preview."
    (https://platform.stepfun.ai/docs/en/api-reference/audio/create-audio.md,
    2026-11-12). It was a compile error under `ExactKeys` and an
    `unknown_param` warning at run time; it now type-checks and validates, and
    a code off the six is `invalid_shape` at `language`. The six codes are
    exported as `LANGUAGES` (and `StepfunLanguage`) from `unmodel/stepfun`.
  - `unmodel/tts` no longer refuses `language` on `stepfun/…` with
    `unsupported_param`: a BCP-47 tag compiles to its primary subtag
    (`"zh-CN"` → `"zh"`, with an `approximated_param` warning naming the
    dropped region), and both models' `TTS_MODEL_PARAMS` rows list the six
    codes for completion. A cloned voice takes only `zh` or `en` ("Cloned
    voices can be used only with `language` omitted, `zh`, or `en`",
    https://platform.stepfun.ai/docs/en/api-reference/audio/create-voice.md);
    unmodel cannot tell a cloned voice id from a system one, so that pairing is
    the API's to refuse.
  - Corrected comments: StepFun speech has no `cost` because the pricing page
    counts characters by weight ("two English letters count as one
    character", https://platform.stepfun.ai/docs/en/guides/pricing/details.md),
    not because no rate is published; models.dev's `stepfun-ai` is StepFun's
    international platform (api.stepfun.ai), not a Hugging Face org; the China
    create-speech reference documents a different body (`text_normalization`,
    `voice_label`, `timestamp`, no `language`).
  - docs/providers.md drops `image-edit` from StepFun's capabilities:
    "`step-2x-large` and `step-image-edit-2` were retired on October 10, 2026."

- aa5d962: sync.: the documented count ceilings, `react-1`'s missing features and the `Idempotency-Key` header, verified against https://sync.so/docs (2026-11-12)
  - **Count ceilings.** A generation over 101 `input` items or 100 `segments`
    is refused (`invalid_shape` at `input` / `segments`, naming the limit), as
    sync. answers 400 — "A generation can have up to 100 segments and up to 101
    inputs" (/developer-guides/segments). `SYNC_MAX_INPUTS` and
    `SYNC_MAX_SEGMENTS` publish the two numbers.
  - **`react-1` takes no speaker selection and no segments**
    (https://sync.so/docs/models/react). `sync.lipsync` now warns
    (`unknown_param`) on `options.active_speaker_detection` and on `segments`
    at `react-1`. The page does not say whether sync. ignores them or rejects
    the request, so this is a warning rather than a refusal. At
    `unmodel/lipsync`, the `sync/react-1` row no longer offers
    `active_speaker_detection` or `segments`, so both are refused there as
    `unsupported_param`. `SYNC_ACTIVE_SPEAKER_MODELS` and
    `SYNC_SEGMENT_MODELS` publish the gate as data, from `unmodel/sync` and
    `unmodel/sync/values`.
  - **`Idempotency-Key`.** `SYNC_IDEMPOTENCY_HEADER` and
    `SYNC_IDEMPOTENCY_KEY_PATTERN` (`/^[A-Za-z0-9._~-]{1,128}$/`) document the
    optional retry header on `POST /v2/generate`. Without it, sync. answers 409
    `DUPLICATE_SUBMISSION` to an identical request sent within 60 seconds.
    It is a header, not a body field, so you add it to `fetch` yourself;
    unmodel never writes it.

- 1db9dbc: sync.: `sync.lipsync` and `sync.avatar` re-verified against sync.'s curated OpenAPI document, reference pages and `@sync.so/sdk@0.4.0` (2026-11-12) — requests the API accepts are no longer refused
  - **Dubbing languages.** `dubParams.targetLang` takes 110 codes and
    `sourceLang` 111: the 17 regional variants (`ar-EG`, `yue`, `zh-TW`, `dgo`,
    `en-AU`, `en-CA`, `en-GB`, `en-US`, `fr-CA`, `fr-FR`, `cmn`, `pt-BR`,
    `pt-PT`, `es-AR`, `es-CL`, `es-ES`, `es-MX`) were refused as
    `invalid_shape`. `dubParams` also types `cloningStrength` (integer 1–10),
    `startTime` and `endTime`; a range whose `endTime` is not after `startTime`
    is refused, as sync. answers 422 `generation_input_trim_invalid`.
  - **Segments.** `startTime`, `endTime` and `audioInput` are optional;
    `startFrame` / `endFrame` and `lipsync` are typed. A `lipsync: false`
    segment needs no `audioInput`, frame-bounded segments validate, and the
    rules from https://sync.so/docs/developer-guides/segments are checked: a
    lipsynced segment needs an `audioInput`, at least one segment must be
    lipsynced, and `startFrame` must be strictly less than `endFrame`.
  - **`outputAudio`** (one audio input played over the whole output) is typed
    and checked: it needs `segments`, its `refId` must name an `audio` input,
    and a `lipsync: false` segment with several audio inputs needs it.
  - **`dialogueEdit`** (`{ id }` of a completed `POST /v2/dialogue-edits` job) is
    typed. A request with it and one video input is no longer refused for
    having no voice input; adding a voice input, `segments` or `dubParams` is
    refused, per https://sync.so/docs/developer-guides/dialogue-editing.
  - **Options.** All fifteen `GenerationOptions` fields the curated spec and the
    SDK declare are typed: `reasoning_enabled` (gated to `lipsync-2-pro` —
    a warning elsewhere, and a `lipsync-2-pro` extra at `unmodel/lipsync`),
    `refinement_enabled`, `blending_mode` (`SYNC_BLENDING_MODES`),
    `face_boxes_url`, `prompt_image_uris`, `i2v_prompt` and the deprecated
    `output_format` (`SYNC_OUTPUT_FORMATS`), `fps` and `output_resolution`; plus
    `active_speaker_detection.face_image`. `options.prompt` is a `string` on the
    wire, so a `react-1` emotion outside the six documented ones is a warning
    instead of a refusal.
  - **Error catalog.** `SYNC_ERROR_CODES` has the 135 codes `GET
https://api.sync.so/v2/errors` serves (73 added, none removed).
  - **Estimate endpoint.** `ESTIMATE_COST_URL` is `POST
https://api.sync.so/v2/generations/estimate`, the documented quote, which
    takes `{ model, duration, fps?, workflow?, reasoningEnabled? }` rather than
    the generation body.
  - **Docs.** The webhook payload carries `errorCode` (not `error_code`);
    `include=progress` adds a `progress` object; generation creation is bounded
    by plan concurrency (Free 1, Hobbyist 3, Creator 10, Growth 20, Scale 50)
    rather than a request rate; lip-sync is billed per output frame, so the
    25-fps per-second rates under-state a 30 fps output by 20%.

  Removed, with their replacements:
  - `ANALYZE_COST_URL` (`POST /v2/analyze/cost`, no longer documented) →
    `ESTIMATE_COST_URL`.
  - `SYNC_RATE_LIMITS` (`{ create: 100, poll: 600 }`, no longer published on
    https://sync.so/docs/api-reference/guides/rate-limits) → none; the plan
    concurrency figures are documented on `unmodel/sync`.

- aa56b85: topaz: false refusals fixed, Wonder 3 / 3.5 repriced, four models marked deprecated

  Every fact below was read from the model's own page under
  https://developer.topazlabs.com/image-models/upscaling-and-enhancement/ on
  2026-11-12.
  - **`Recover 3` takes `enhancementStrength` as a decimal from 0.0 to 10.0**
    (default 5.0; its own sample sends `enhancementStrength=5`). A number used
    to be refused at runtime and at compile time. `enhancementStrength` is now
    `TopazEnhancementStrength | number`. `Wonder 3` and `Wonder 3.5` still take
    only `"low"` / `"medium"` / `"high"`.
  - **`faceEnhancement: true` no longer requires `faceEnhancementStrength` and
    `faceEnhancementCreativity`, and `detail: true` no longer requires
    `detailStrength`.** Wonder 2's page lists the strength as optional (default
    0.8) and its sample sends `faceEnhancement=true` on its own, and no page now
    ties `detailStrength` to a switch. The check that refused these requests is
    gone.
  - **`Wonder` accepts up to 256 MP of output, not 128** ("This model accepts up
    to 256 MP input and output." on wonder-1.md). Requests between 128 and 256
    MP were refused.
  - **Settings the pages list that were untyped, or that warned as ignored:**
    `Wonder 2` now takes `colorCorrection` and `preDownscale` (1–4); `Redefine`
    now takes `creativityBoost`, `detailLevel` (1–5) and `seed`; `High Fidelity
V2` and `Low Resolution V2` now take `deblurStrength`,
    `decompressionStrength`, `denoiseStrength` and `opacity`; `CGI` now takes
    `denoiseStrength` and `opacity`; `Standard V2` takes `opacity` and its three
    strength dials in both spellings. Standard 2's page and sample write them as
    `deblur_strength` / `decompression_strength` / `denoise_strength`, while the
    request parameters page says every setting is camelCase, so both spellings
    are typed. The unified `topaz/…` refs offer the same dials.
  - **`Wonder 3` and `Wonder 3.5` are 8 MP per credit, not 4** ("costs 1 credit
    per every 8 MP of generated output."), so their estimates halve.
    `MP_PER_CREDIT["Wonder 3"]` and `["Wonder 3.5"]` are now 8.
  - **`High Fidelity V2`, `Wonder`, `Wonder 2` and `Wonder 3` carry `status:
"deprecated"`** and validate with a `deprecated_model` warning. Each page
    says it "is deprecated and will be retired no sooner than January 1, 2027",
    and https://developer.topazlabs.com/resources/model-deprecations.md lists
    each one as Deprecated. They are still served.
  - JSDoc: `recoveryStrength` defaults to 0.333 on `Upscale High Fidelity V3`;
    `Bloom Realism`'s `creativity` defaults to 2 and its page gives `seed` no
    bound. `Recovery V2` is recorded as Recover 2 (deprecated) and stays
    unrostered. So do the deprecated first-generation ids `Standard`, `Low
Resolution`, `High Fidelity` and `Recover`. `/denoise-gen/async` (Denoise
    Max) is added to the routes the provider deliberately does not serve.

- bd14763: topaz: $0.10 a credit, 256 MP classic ceilings, `prompt` only where a page lists it

  Every fact below was read from Topaz's own pages on 2026-11-12 / 2026-11-13.
  - **`CREDIT_USD` is 0.10, not 0.12.** The $0.12 "Starter" rate is gone:
    https://www.topazlabs.com/enhance-api now redirects to
    https://www.topazlabs.com/api, which publishes only Developer ("$0.10 /
    credit") and Scale ("$0.08 / credit"). `topazCostUSD` and every
    `estimate.costUSD` on `topaz.upscale` / `topaz.upscaleGenerative` now use
    $0.10, the highest published plan rate. A one-time credit pack exists at an
    unpublished price, so that figure is not a ceiling for every account.
  - **The classic upscalers cap their output at 256 MP, not 1024.** "This model
    accepts up to 256 MP input and output." is on the pages of `Standard V2`,
    `High Fidelity V2`, `Upscale High Fidelity V3`, `Low Resolution V2`, `CGI`
    and `Text Refine`. Requests between 256 and 1024 MP used to pass here, but
    Topaz's spec documents a 413 for them: "Output image dimensions exceed
    maximum allowed of 256 MP." `TOPAZ_MEGAPIXEL_LIMITS` is now 256 / 256 for
    all six; `Upscale High Fidelity V3` is a new row.
  - **`prompt` is refused at `topaz/Wonder`, `topaz/Wonder 2`, `topaz/Wonder 3`,
    `topaz/Wonder 3.5`, `topaz/Standard MAX`, `topaz/Recover 3` and
    `topaz/Bloom Realism`** in `unmodel/upscale`, as it already was at
    `topaz/Wonder 4` and `topaz/Detail`. None of their pages lists `prompt`
    ("Wonder 1 has no model-specific parameters.", "Standard Max has no
    model-specific parameters."), so Topaz dropped the prompt without a word.
    Only `Redefine`, `Bloom 2` and `Bloom` take one. In `TOPAZ_SETTINGS_BY_MODEL`,
    `prompt` and `autoprompt` are removed from those seven rows, so at the wire
    they warn as ignored settings. Those seven catalog rows no longer declare a
    `text` input. The unified `autoprompt` extra is now offered only at
    `topaz/Redefine` and `topaz/Bloom 2`.
  - **`Redefine` takes `creativity` 1–6.** Its page says "`1` to `6`", and 7–9
    are now refused (`invalid_enum_value`). `Bloom 2` and `Bloom` still take 1–9.
  - **`Recover 3` refuses a word for `enhancementStrength`.** Its page types the
    dial as a decimal from 0.0 to 10.0. `"low"`, `"medium"` and `"high"` are now
    `invalid_shape` there. They are still the only values `Wonder 3` and
    `Wonder 3.5` take.
  - Dead documentation links are re-cited:
    - `topaz.provider.doc` and the unified refusals' `meta.source` now point at
      https://developer.topazlabs.com/reference/image/enhance.
    - The classic route's issues now cite
      https://developer.topazlabs.com/image-models/upscaling-and-enhancement/precision,
      and the generative route's issues cite
      https://developer.topazlabs.com/image-models/upscaling-and-enhancement.
    - The spec is cited at
      https://openapi.gitbook.com/o/HctdcUHRfIWXBVA1egPp/spec/image-yaml.yaml.
      The dated `image-yaml-feb-2026.yaml` URL now serves the Video API.

- 68adfee: topaz: `Wonder 4`, `Detail` and `Bloom` join `topaz.upscaleGenerative` and `unmodel/upscale`
  - **`Wonder 4`** — Topaz's recommended generative upscaler. No settings at all
    (its page's parameter table is the `model` row alone; What's New: "No
    settings."), so any dial warns as one it ignores, and the canonical `prompt`
    is refused at `topaz/Wonder 4`. 8 MP per credit, 256 MP input and output.
    https://developer.topazlabs.com/image-models/upscaling-and-enhancement/generative/wonder-4.md
  - **`Detail`** (Detail Faces) — filed under Precision Upscaling but served on
    `/image/v1/enhance-gen/async`. One setting, `detailStrength` (0.0–10.0), and
    no `prompt`. 24 MP per credit; no MP ceiling on its page.
    https://developer.topazlabs.com/image-models/upscaling-and-enhancement/precision/detail-faces.md
  - **`Bloom`** (Bloom 1 Creative) — its page now states the `"Bloom"` model
    string. Settings `colorPreservation`, `creativity`, `creativityBoost`,
    `facePreservation`, `prompt` and `seed`; `creativityBoost` and
    `facePreservation` are newly typed on `TopazUpscaleGenerativeParams`. 2 MP per
    credit, 256 MP input and output. Legacy per Topaz's creative family page,
    Active in its Model Deprecations table, so no `deprecated` status.
    https://developer.topazlabs.com/image-models/upscaling-and-enhancement/creative/bloom-1-creative.md
  - `unmodel/upscale` now decides canonical `prompt` per model from
    `TOPAZ_SETTINGS_BY_MODEL` rather than per route, so a generative-route model
    whose page documents no `prompt` refuses it by name, listing the models that
    take one. The catalog rows of `Wonder 4` and `Detail` declare no `text` input.
  - **Breaking (values):** Topaz now prices per model rather than per family,
    because the rate no longer follows the route (`Detail` is 24 MP per credit on
    the generative route, `Wonder 4` is 8). `MP_PER_CREDIT` is keyed by model id
    and quotes each model page's "costs 1 credit per every N MP of generated
    output" sentence. Retired: `TOPAZ_PRICING_FAMILY`, the `TopazPricingFamily`
    type, and `MP_PER_CREDIT`'s `gigapixel` / `wonder` / `bloom` keys — read
    `MP_PER_CREDIT[model]` instead. `topazCredits` / `topazCostUSD` results are
    unchanged for every model already rostered.

- 4696116: tripo3d: three false refusals fixed, the texture-version parameters typed, and P1 priced
  - **`texture_quality: "fast"`** is accepted on every model that takes `texture_quality`.
    It needs `texture_version: "v3.5-20260815"`, so a `fast` request that omits
    `texture_version` (every model derives v3.0 or v2.5 by default) or names another
    documented version is refused, naming the version it would run. Docs: "`fast` is only
    available on texture `v3.5-20260815`. … Any other texture version returns `1004` rather
    than silently falling back to `standard`."
    (https://developers.tripo3d.ai/en/docs/generation-text-to-model/standard, read 2026-11-12).
    It costs the same as `standard`.
  - **New parameters on both routes and every model**: `texture_version` (open string;
    `TEXTURE_VERSIONS` lists `v3.5-20260815`, `v3.0-20250812`, `v2.5-20250123`), `delight`
    (boolean; a warning when the texture version ignores it) and `export_orientation`
    (`+x` / `-x` / `+y` / `-y`, `EXPORT_ORIENTATIONS`). All three sit outside the version
    gate and reach `unmodel/3d` as extras. Changelog: "new `texture_version` pins the texture
    model independently of the geometry `model`."
    (https://developers.tripo3d.ai/en/docs/changelog, read 2026-11-12).
  - **`generate_parts` with `quad: true` is no longer refused.** Only `texture` / `pbr` being
    true (including their true defaults) is an error; `quad: true` now warns that the parts come
    back as triangles, and `smart_low_poly: true` warns that parts are not produced. Docs:
    "`quad=true` — quad is ignored; the returned parts are triangle meshes." /
    "`smart_low_poly=true` — smart_low_poly takes precedence and parts are NOT produced."
    The cost estimate for either combination is now `undefined`, because Tripo publishes no
    rate for a switch it ignores or lets override `generate_parts`.
  - **`tripo3d.threeDFromImage` accepts a prior task's id as `input`.** Task ids are bare UUIDs
    ("Example: `550e8400-e29b-41d4-a716-446655440000`",
    https://developers.tripo3d.ai/en/docs/generation-image-to-model/standard); the input check
    only recognised a `task_` prefix that no Tripo page uses, and refused the real shape.
  - **P1 is priced**: 30 credits bare / 40 textured on text-to-model, 40 / 50 on image-to-model,
    texture tiers +10 / +20, from the pricing page's P-Series tab
    (`noTexP1:30 … stdTexP1:40`, `noTexP1:40 … stdTexP1:50` in
    https://developers.tripo3d.ai/assets/PricingPage-BWsTiO9s.js, read 2026-11-12). Estimates
    for P1 were `undefined`.
  - Docs: Tripo's `models-and-versions` page now lists the same dated ids as the endpoint pages;
    the note about a short-alias conflict is gone.

- 38891d0: tripo3d: `P2-20260801` joins `tripo3d.threeD`, `tripo3d.threeDFromImage` and `unmodel/3d` (`tripo3d/P2-20260801`)
  - **New model `P2-20260801`** ("Tripo P2", family `tripo-p`) — the P series with native quad
    output. Tripo's changelog: "`POST /v3/generation/text-to-model`, `image-to-model`, and
    `multiview-to-model` now accept `model=P2-20260801` (an upgrade of P1)."
    (https://developers.tripo3d.ai/en/docs/changelog, read 2026-11-12). It validates, prices and
    compiles like its siblings, and appears in `TRIPO3D_MODELS`, `THREE_D_MODELS`,
    `THREE_D_MODEL_PARAMS`, `FACE_LIMITS` and `GATED_PARAMS_BY_MODEL`.
  - **Version gate**: P2 takes `texture_quality`, `auto_size`, `quad` and `compress`, and refuses
    `geometry_quality`, `smart_low_poly` and `generate_parts`, naming the models that take them.
    The P pages mark `quad` "**P2-20260801 only.**"
    (https://developers.tripo3d.ai/en/docs/generation-text-to-model/p).
  - **Polycount**: `face_limit` runs 48–50,000 triangles on P2, and 48–25,000 with `quad: true` —
    "`P2-20260801` triangle: **48 – 50,000**; with `quad=true`: **48 – 25,000**". `FACE_LIMITS`
    rows gain an optional `quad` ceiling (150,000 on the H series, 25,000 on P2), and the quad cap
    is now read per model rather than from one global figure.
  - **Pricing**: 100 credits bare and 110 textured on both routes, 120 / 130 for the `detailed` /
    `extreme` texture tiers — "**Credits**: 100 without texture; `standard` / `detailed` /
    `extreme` = 110 / 120 / 130" (changelog), per route `noTexP2:100,stdTexP2:110` on the pricing
    page's P-Series tab. `quad: true` on P2 estimates `undefined`: the P-Series tab publishes no
    add-on list, so its quad surcharge is unknown.
  - **`BASE_CREDITS` is replaced by `CREDIT_TABLES`**, keyed by model id: each row carries its
    per-task `base` and the `addOns` it publishes a rate for (new types `Tripo3dCreditTable`,
    `Tripo3dAddOn`). Base credits now differ by model series, so a table keyed by task type alone
    could no longer state them. `ADD_ON_CREDITS` is unchanged.

- 92e4ffe: upstage: record the 2026-10-30 retirement of `solar-pro3`, `solar-pro2` and `solar-mini`, and re-source the `solar-mini` `reasoning_effort` deny
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

- e2a4799: upstage: `solar-mini4` (Solar Mini 4) joins the `upstage.chat` catalog from the 2026-11-12 models.dev refresh
  - `upstage.chat` now validates `solar-mini4` without an `unknown_model`
    warning, caps `max_tokens` at its 131,072-token (128K) output ceiling, and
    prices responses at the vendor list rate of $0.10 input / $0.40 output /
    $0.01 cached input per 1M tokens (dated snapshots such as
    `solar-mini4-260922` price the same way). Source:
    https://console.upstage.ai/docs/models/solar-mini-4.
  - `reasoning_effort` stays accepted on `solar-mini4` and `solar-mini4-260922`
    for every documented value (`none`, `minimal`, `low`, `medium`, `high`,
    `xhigh`, `max`): the `solar-mini` family deny does not reach it, although
    models.dev files the model under family `solar-mini`. Source:
    https://console.upstage.ai/docs/capabilities/generate/reasoning.
  - `upstage/solar-mini4` joins the `unmodel/chat` model refs, and OpenRouter's
    `upstage/solar-mini4` gains `.toApi("upstage")`.

- 30d5d05: veed: the published enums, response types and provenance now match VEED's 2026-11-12 OpenAPI document (https://api.veed.io/openapi.json)
  - `VEED_ERROR_CODES` gains `insufficient_tokens` (third, in the spec's
    `ErrorBody.code` order), so `VeedErrorCode` is nine members.
  - `VEED_ERROR_REASONS` gains `api_key_workspace_unavailable`,
    `insufficient_credits`, `model_access_required` and `oauth_token_invalid`
    (`ErrorDetail.reason`, nine members), and `VeedErrorResponse`'s detail
    entries gain the spec's untyped `value`.
  - `VeedErrorResponse` and `VeedJobResponse` gain the optional top-level
    `$schema` the spec declares on `ErrorResponse` and every `Resource*Job`
    envelope, and that VEED sends on the wire (e.g.
    `"$schema":"https://api.veed.io/schemas/ErrorResponse.json"` on a 401).
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

- 5bc81d9: vidu: `viduq4-preview`, `viduq3-drama` and `viduq3-ad` (models refresh 2026-11-12)
  - `viduq4-preview` validates on `vidu.videoFromImage` and `vidu.videoFromReference`
    (and `vidu/viduq4-preview` on `unmodel/video`): 3–16 seconds, `540p` / `720p` /
    `1080p` / `2K` / `4K`, up to 15 reference images, no subjects form. Sources:
    https://platform.vidu.com/docs/api-reference/video-models/vidu-q4-preview/image-to-video
    and …/vidu-q4-preview/reference-to-video.
  - `viduq3-drama` (both reference forms, 2–16 seconds, `720p` / `1080p`) and
    `viduq3-ad` (images form, 3–15 seconds, `720p` / `1080p`) validate on
    `vidu.videoFromReference`. Source:
    https://platform.vidu.com/docs/api-reference/video-models/vidu-q3/reference-to-video.
  - None of the three carries a cost or produces an estimate: q4 is priced in
    credits on a page that prices credits in RMB only, and the pricing pages have
    no drama or ad row (https://platform.vidu.com/docs/overview/pricing).
  - `Reference2VideoParams` gains `sounds` (up to 3 mp3 audio references, documented
    on `viduq3-mix`, `viduq3-ad`, `viduq3-drama` and `viduq4-preview`), and its
    `aspect_ratio` accepts `"auto"` — both were refused at compile time although
    the API documents them.
  - `ViduResolution` / `VIDU_RESOLUTIONS` gain `"2K"` and `"4K"` for the q4 img2video
    and reference2video arms; `Text2VideoParams.resolution` keeps excluding them.
  - The video `prompt` ceiling is 20000 characters (the q3 and q4 pages); the
    q2 / q1 / vidu2.0 models stay capped at 5000. `PROMPT_MAX_CHARS` is now 20000,
    and the new `PROMPT_CAPS` export lists the per-model caps below it.

- b85f071: vidu: saved subjects on viduq2-pro, video subjects elsewhere, and `4k` on `unmodel/video` (review fixes, 2026-11-13)
  - `vidu.videoFromReference` no longer refuses viduq2-pro's documented maximum
    of 4 image subjects plus 2 saved video subjects. A subject passed as
    `{ name, server_id }` keeps its kind (image or video) on Vidu's side, so on
    viduq2-pro it counts toward neither the 4 image-or-text cap nor the 2 video
    cap, only toward their total of 6. On every other model it can only be an
    image subject and still counts toward the 7. Source:
    https://platform.vidu.com/docs/api-reference/video-models/vidu-q3/reference-to-video
    ("The number of image or text subjects should not exceed 4. The number of
    video subjects should not exceed 2 (or 1 for temporary video subjects).")
  - `subjects[].videos` is now refused with `unsupported_param` at
    `["subjects", i, "videos"]` on every model except `viduq2-pro` ("Note 1: Only
    the viduq2-pro Reference to Video model supports video subjects.", same
    page). It used to pass silently.
  - `unmodel/video` compiles `resolution: "4k"` to the wire `"4K"` for
    `vidu/viduq4-preview` on both of its routes (img2video and reference2video),
    and `VIDEO_MODEL_PARAMS["viduq4-preview"].resolutions` on
    `unmodel/vidu/values` lists `"4k"`. It used to be refused, although both q4
    pages list `4K`. Every other Vidu model still refuses `4k`, at compile time
    and from its endpoint check. Sources:
    https://platform.vidu.com/docs/api-reference/video-models/vidu-q4-preview/image-to-video
    and …/vidu-q4-preview/reference-to-video.

- ec60673: vidu: watermark fields, the full subject shape, viduq2-pro subjects, and live doc links (corrections, 2026-11-12)
  - `Text2VideoParams`, `Img2VideoParams` and `Reference2VideoParams` gain the
    documented watermark fields — `watermark`, `wm_position` (the integers 1–4;
    the pages disagree on which corner each one names), `wm_url` and `meta_data`
    — as the shared `ViduWatermarkParams` type, with `VIDU_WM_POSITIONS` on
    `unmodel/vidu` and `unmodel/vidu/values`. They were refused at compile time.
    Source: https://platform.vidu.com/docs/api-reference/updates and the route
    pages under https://platform.vidu.com/docs/api-reference/video-models/.
  - `ViduSubject` takes `server_id` (a saved subject from the Create Subject API)
    and `videos` (a temporary video subject, `viduq2-pro` only), and `images` is
    optional — a subject with only a `name` is a text subject.
  - `vidu.videoFromReference` accepts the `subjects` form on `viduq2-pro`, capped
    at 4 image or text subjects and 2 video subjects (at most 1 temporary, one
    clip each). It was refused with `unsupported_param`. Source:
    https://platform.vidu.com/docs/api-reference/video-models/vidu-q3/reference-to-video
  - `vidu.video` no longer warns that `audio` is q3-only on `viduq2`: the q2 and
    q1 text-to-video pages document it with "Default: true".
  - Issue `meta.source` links point at the live API reference
    (`https://platform.vidu.com/docs/api-reference/video-models/vidu-q3/<route>`
    and `…/api-reference/image-generation`); the old `/docs/<route>` pages now
    render "Document not found".

- 6644602: `unmodel/chat` narrows reasoning effort to the target model's documented ladder; `alibaba.chat` accepts Kimi K3's `top_p: 0.95`; Gemini `XHIGH` off Hydrogen warns

  `unmodel/chat`
  - `reasoning.effort` now narrows to the levels the target model documents,
    read from its provider validator's `reasoning_effort` row
    (`constraintsFor(modelId)`). A level on the ladder compiles verbatim. Any
    other level compiles to the nearest level above it, or to the ladder's top
    when nothing is above it, with an `approximated_param` whose `meta.levels`
    names the ladder. Changes:
    - `openai/gpt-6-sol`, `gpt-6-luna`, `gpt-6.1-terra`, `gpt-6-astra` and
      `gpt-6.1-sol` with `xhigh` or `max`: sent as written, where they used to
      compile to `high`.
    - The same models with `minimal`: compiles to `low` with a warning, where it
      used to be refused. The migration guide says "If your existing request uses
      `minimal`, start with `low`".
    - `zhipuai/glm-5.3` with `max`: sent as written, where it used to compile to
      `high`. `xhigh` compiles to `max`.
    - `alibaba/kimi-k3` with `medium`: compiles to `high`, where it used to be
      refused. `xhigh` compiles to `max`.
    - `alibaba/qwen3.8-*`, `deepseek/*` and `meta/*` with `xhigh` or `max`: sent
      as written.
    - `mistral/mistral-large-4` with `xhigh` or `max`: still `high`.

    Models whose validator has no ladder (`openai/o3`, `openai/gpt-5.5`,
    `groq/…`, `xai/…`) keep the dialect fallback: `xhigh` and `max` compile to
    `high`, because the open `reasoning_effort` field does not say which of them
    a model takes. The fallback warning now says that.

  - `ChatProviderValidator` gains an optional
    `constraintsFor(modelId): readonly EndpointConstraints[]`. Every validator
    unmodel ships already has it, and a hand-written validator without it
    narrows by dialect alone.

  `alibaba.chat`
  - `kimi-k3` accepts `top_p: 0.95`, the value Alibaba documents as the model's
    default ("| kimi-k3 | … | 1.0 | 0.95 | 0.0 |"); it used to be refused. `1`
    stays accepted: Alibaba calls sampling "fixed" only for `kimi-k3.1-pro`, and
    Moonshot's "`top_p` | Fixed at `0.95`" is a rule for its own host. Any other
    value is `invalid_enum_value`. `temperature` (1 only) and `presence_penalty`
    (unpinned) are unchanged.

  `google.chat`, `google.stt`, `google-vertex.chat`
  - `thinkingLevel: "XHIGH"` on a model other than `gemini-4-hydrogen` now draws
    an `invalid_enum_value` warning: XHIGH is documented on Hydrogen only. It is
    still never refused, because no page says it errors elsewhere. Through
    `unmodel/chat`, `google/gemini-4-carbon` with `reasoning: "xhigh"` used to
    compile to `XHIGH` with no warning, and the warning now reaches
    `result.warnings` at `["reasoning"]`.

  `unmodel/openai-compatible`
  - `createSamplingParamsCheck(spec)` and the `ChatCompletionsCheck` type are
    exported. The first is the default for `chatCompletionsChecks(spec,
slots)`'s `sampling` slot and is what a dialect should wrap: it honours
    the spec's `enums` pins (Kimi's `top_p: 0.95`) and its `fixedSampling:
"overridden"` reading. `checkSamplingParams` is the unpinned,
    `"rejected"`-only reading, and wrapping it for an overlay with pinned or
    `"overridden"` sampling refuses requests the API fulfils.

- 7123d9c: xai: `grok-4.7` and `grok-imagine-video-1.5-lite` (models.dev refresh 2026-11-12, every fact re-read off docs.x.ai)
  - `xai.chat` validates and prices `grok-4.7` ($2.00 input / $0.50 cached /
    $6.00 output per 1M below 200k prompt tokens — https://docs.x.ai/developers/models).
    It is a reasoning model, so `frequency_penalty`, `presence_penalty` and `stop`
    are refused as on the rest of the reasoning line ("Requests that include them
    return an error" — https://docs.x.ai/developers/model-capabilities/text/reasoning).
    `reasoning_effort: "xhigh"` passes. The ≥200k long-context tier ($4 / $1 / $12)
    is not modelled: `ModelCost` has no tier field yet.
  - `xai.video` and `unmodel/video` accept `grok-imagine-video-1.5-lite`, priced at
    "$0.020 / sec" (https://docs.x.ai/developers/models). It serves text-to-video
    and image-to-video only, per the capability matrix on
    https://docs.x.ai/developers/model-capabilities/video/overview: `reference_images`
    and `reference_audios` are refused with `unsupported_capability` naming
    grok-imagine-video-1.5, `xai.videoEdit` / `xai.videoExtend` refuse the id naming
    grok-imagine-video, and the unified adapter gives it no reference route and no
    `reference_audios` extra. `VIDEO_TEXT_IMAGE_ONLY_MODELS` and
    `VIDEO_1_5_LITE_PER_SECOND_USD` are exported from `unmodel/xai`.
  - `grok-imagine-image-2.0` and `grok-imagine-image-quality` left models.dev but
    xAI still serves both, so they stay valid on `xai.image` as hand rows
    (text, image → image; `limit.context: 0`, since xAI publishes no prompt limit).
  - The mirrored Imagine rows follow the snapshot: `grok-imagine-image` is
    text, image → image with a 16,000 context, and both video rows drop `pdf` input.

- 4623413: xai: Grok Imagine pricing follows resolution and quality, and five requests xAI fulfils are no longer refused (every fact re-read off docs.x.ai on 2026-11-12)

  Pricing — the per-resolution rates live only in the rendered "Imagine" table on
  https://docs.x.ai/developers/pricing, and the estimates now use them:
  - Video, per second: grok-imagine-video $0.05 at 480p and $0.07 at 720p (it
    serves up to 720p, so it has no 1080p rate); grok-imagine-video-1.5
    $0.08 / $0.14 / $0.25 at 480p / 720p / 1080p; grok-imagine-video-1.5-lite
    $0.02 / $0.03 / $0.14. Each input image (`image` and each `reference_images`
    entry) adds $0.01, or $0.002 on grok-imagine-video. `videoPriceUSD` takes an
    optional third argument, `{ resolution, inputImages }`.
  - `xai.videoExtend` no longer returns an estimate: grok-imagine-video bills the
    input clip at $0.01 per second, and the clip's length is not in the request.
  - Image, per image: grok-imagine-image-2.0 is $0.04 / $0.05 / $0.06 at
    1k / 1.5k / 2k at low quality and $0.06 / $0.07 / $0.08 at medium quality.
    An omitted or `"auto"` quality is priced as low, because "Auto currently uses
    `low` for image generation"
    (https://docs.x.ai/developers/model-capabilities/images/generation).
    grok-imagine-image has 1k and 2k rates only, so a 1.5k request has no estimate.
  - grok-imagine-image-quality was retired on 2026-11-02, but the id still works
    and is served by 2.0 at low quality. It now prices at that rate ($0.04 at 1k,
    down from $0.05) and comes with a `deprecated_model` warning
    (https://docs.x.ai/developers/migration/imagine-image-quality-nov-2).
  - New exports from `unmodel/xai`: `IMAGE_RATES`, `IMAGE_MEDIUM_RATES`,
    `VIDEO_RATES` and `VIDEO_INPUT_IMAGE_USD`. `IMAGE_QUALITY_PER_IMAGE_USD` is
    now 0.04.

  Requests xAI fulfils that were refused:
  - `aspect_ratio` `"21:9"` and `"5:2"` on every video id, as listed in the REST
    reference and the OpenAPI `VideoAspectRatio` enum.
  - `prompt` may be omitted on `xai.video` and `unmodel/video` when the request
    includes `image`, `reference_images`, `reference_audios`, `last_frame` or
    `keyframes`. It is still required for text-to-video ("it is required only for
    text-to-video").
  - `image` together with `reference_images` is allowed on grok-imagine-video-1.5,
    where it "is reference-to-video with a pinned first frame". Only
    grok-imagine-video still refuses the combination.
  - `xai.image` accepts `resolution: "1.5k"` and grok-imagine-image-2.0's
    `quality` (`"low" | "medium" | "auto"`). `IMAGE_QUALITIES` and
    `XaiImageQuality` are exported. Neither field has a canonical spelling in
    `unmodel/image`, so both are set through `providerOptions.xai`.
  - The model aliases xAI documents now validate and price as the model they
    point to: `grok-imagine-image-2026-03-02` (grok-imagine-image), and
    `grok-imagine-video-1.5-preview` and `grok-imagine-video-1.5-2026-05-30`
    (grok-imagine-video-1.5). They are exported as `IMAGE_MODEL_ALIASES` and
    `VIDEO_MODEL_ALIASES`.

- 87a900a: xai: the Grok Imagine video validators follow the per-model capability matrix, and four requests xAI fulfils are no longer refused (every fact re-read off docs.x.ai on 2026-11-12)

  Requests xAI rejects that passed:
  - `xai.videoEdit` and `xai.videoExtend` refuse `grok-imagine-video-1.5` and its
    aliases `grok-imagine-video-1.5-preview` / `grok-imagine-video-1.5-2026-05-30`,
    as they already refused grok-imagine-video-1.5-lite. Only `grok-imagine-video`
    passes: "| Model | `grok-imagine-video` |" on
    https://docs.x.ai/developers/model-capabilities/video/editing and
    https://docs.x.ai/developers/model-capabilities/video/extension.
  - `xai.video` refuses `resolution: "1080p"` on grok-imagine-video
    ("`grok-imagine-video` supports up to 720p." —
    https://docs.x.ai/developers/model-capabilities/video/generation), on every
    mode, naming grok-imagine-video-1.5 and -lite as the models that render it.
    In `unmodel/video` and `unmodel/xai/values`, the `xai/grok-imagine-video` row
    lists `480p` and `720p` only.
  - `reference_audios` is refused on grok-imagine-video, as it is on lite ("|
    Voice references | Yes: Up to 3 voices | Not supported | Not supported |" on
    https://docs.x.ai/developers/model-capabilities/video/overview). In
    `unmodel/video`, `xai/grok-imagine-video` no longer offers it as an extra.
  - Reference-to-video limits are enforced per model: up to 14 `reference_images`
    on grok-imagine-video-1.5 and 7 on grok-imagine-video, and up to 10 seconds on
    grok-imagine-video
    (https://docs.x.ai/developers/model-capabilities/video/reference-to-video).
    The pinned `image` does not count toward the image cap.
  - `xai.image` warns (`unsupported_param`, a warning, not an error) when `quality`
    is sent to an id other than grok-imagine-image-2.0: "The parameter is only
    supported for `grok-imagine-image-2.0`."
    (https://docs.x.ai/developers/model-capabilities/images/generation). xAI does
    not document a 400 for it.

  Requests xAI fulfils that were refused:
  - `last_frame`, `keyframes` and `generate_audio` are typed `xai.video` wire
    fields (they were compile-time errors and runtime `unknown_param` warnings).
    `keyframes` takes at most 4 `{ image, timestamp_s }` entries, each with
    `0 < timestamp_s < duration`. `last_frame` and `keyframes` are
    grok-imagine-video-1.5 only, and refused with `unsupported_capability` on
    grok-imagine-video ("Classic `grok-imagine-video` still rejects `last_frame`
    and `keyframes`") and on lite. `generate_audio: false` requests a silent video
    on any model. In `unmodel/video`, the `role: "last"` image compiles to
    `last_frame` on `xai/grok-imagine-video-1.5`.
  - In `unmodel/video`, an inline image (`{ data, mimeType }`) on an `xai/…`
    model compiles to a `data:` URL instead of being refused. The OpenAPI
    `ImageUrl` "Accepts a public URL, a base64-encoded data URL, or a file_id from
    the xAI Files API" (https://docs.x.ai/openapi.json). Bytes with no `mimeType`
    are an `invalid_shape` error, never a guessed type.
  - `storage_options.public_url` accepts the object form `{ expires_after }`
    beside `true`/`false` on `xai.image`, `xai.video`, `xai.videoEdit` and
    `xai.videoExtend` ("\* `public_url` (boolean | object)" —
    https://docs.x.ai/developers/rest-api-reference/inference/videos).
  - `xai.video` accepts `duration` as a digit string (`"8"`), which xAI documents
    for `/v1/videos/generations`: "Accepts both number (8) and string ("8")
    values." The type still names the number. `/v1/videos/extensions` documents
    no string form and still refuses it.

  Also:
  - The grok reasoning-model deny rules (`frequency_penalty`, `presence_penalty`,
    `stop`) cite
    https://docs.x.ai/developers/rest-api-reference/inference/chat-completions,
    which carries "(Not supported by reasoning models)". The previous link now
    redirects to the Responses page, which does not.
  - New exports from `unmodel/xai`: `VIDEO_VOICE_AND_FRAME_MODELS`,
    `VIDEO_REFERENCE_LIMITS`, `VIDEO_MAX_KEYFRAMES`, and the types
    `XaiVideoKeyframe` and `XaiPublicUrlOptions` (also on `unmodel/xai/types`).

- ebe7127: zhipuai (2026-11-12): `glm-4.6v-flash` and `glm-5.3-flashx` join the catalog, and `zhipuai.chat` enforces GLM-5.3's always-on thinking
  - New models: `glm-4.6v-flash` (free vision model, 128K context / 32,768 max
    output, image, video and file input) and `glm-5.3-flashx` (1M context /
    131,072 max output, image, video and file input). Both validate, price and
    retarget from their catalog rows, and `unmodel/chat` accepts
    `zhipuai/glm-4.6v-flash` and `zhipuai/glm-5.3-flashx`. `glm-4.6v-flash`'s
    file input is a correction to models.dev's row (see the file-input entry).
  - `zhipuai.chat` refuses a `reasoning_effort` other than `"low"`, `"high"` or
    `"max"` on `glm-5.3`, `glm-5.3-flash` and `glm-5.3-flashx`. Zhipu's
    thinking guide (https://docs.bigmodel.cn/cn/guide/capabilities/thinking):
    "针对 `GLM-5.3` `GLM-5.3-FLASH` `GLM-5.3-FLASHX`，仅支持 `max`、`high`、`low`，其余输入将报错".
    The same table runs on `.toApi("zhipuai")` retargets, and an `unmodel/chat`
    request that compiles to another level (`reasoning: "medium"`, `"minimal"`,
    or `"off"`, which compiles to `"none"`) now fails validation on these three
    models with `invalid_enum_value` instead of getting a 400 from the API.
  - `zhipuai.chat` refuses `thinking: { type: "disabled" }` on the same three
    models: "GLM-5.3 GLM-5.3-FLASH 不再支持关闭思考（API 请求中 thinking.type 传
    disabled 将会报错）" (same page), and the parameter page
    (https://docs.bigmodel.cn/cn/guide/start/concept-param) lists GLM-5.3-FLASHX
    as "强制需开启" too. `glm-5.2` and older keep their full effort range and can
    still turn thinking off.
  - Zhipu prices follow models.dev, which now reads them off open.bigmodel.cn's
    CNY price list (https://docs.bigmodel.cn/cn/guide/start/pricing) and converts
    at a dated exchange rate. Most cost estimates drop accordingly, for example
    `glm-5.3` input 1.4 → 1.19516 USD per 1M tokens. `glm-5v-turbo` drops from
    5 / 22 to 0.74698 / 3.28669 USD per 1M input / output tokens: the old row
    carried the CNY figures labelled as USD.

- 0dc5a52: zhipuai: `zhipuai.chat` accepts `{type: "file"}` content parts on `glm-4.6v-flash`, `glm-4.6v` and `glm-4.5v`
  - These three vision models refused every file part with
    `unsupported_capability` ("does not accept pdf input"), because models.dev
    lists their input as text, image and video only. Each model's page lists its
    input as "视频、图像、文本、文件" (video, image, text, file)
    (https://docs.bigmodel.cn/cn/guide/models/free/glm-4.6v-flash,
    https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v,
    https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.5v). The chat API
    reference says "视觉模型支持纯文本和多模态内容（文本、图片、视频、文件）"
    (https://docs.bigmodel.cn/api-reference/模型-api/对话补全, checked
    2026-11-13). A file part now validates on all three, whether it uses
    `file.file_id` or Zhipu's `file.file_url`, both directly and through
    `unmodel/chat`. Text-only models such as `glm-4.6` still refuse it.
  - `unmodel/zhipuai` exports `chatModels`, the catalog `zhipuai.chat`
    validates against. It is the generated `models` table, which is unchanged,
    with these three rows corrected.

## 0.5.1

### Patch Changes

- a075116: catalog refresh: gemini 3.7/3.8 flash, qwen3.8, fable-5.1 wave + doc-verified rules

  A models.dev + fal snapshot refresh (28 new providers, 171 catalog files, 178 fal
  snapshots), and the per-model rules the new flagships turned out to need. Every
  fact below was read off the vendor's live docs on 2026-09-02, not off the
  snapshot.

  CATALOG
  - New generations land in the generated catalogs: `gemini-3.7-flash` /
    `gemini-3.8-flash`, the `qwen3.8` family, `claude-fable-5-1`, `deepseek-v4-pro`
    / `deepseek-v4-flash-vision-exp`, `glm-5.3` / `glm-5.3-flash`, `kimi-k2.5`,
    `wan` v3.0 and `grok-imagine-image-2.0`.
  - `gpt-5.6` repriced: input $5 → $4 and cacheWrite $6.25 → $5 per 1M, matching
    OpenAI's 2026-08-21 changelog entry ("GPT-5.6 Sol now costs $4 per million
    input tokens and $20 per million output tokens"). Cost estimates for gpt-5.6
    change accordingly.

  RETIRED UPSTREAM
  - `deepseek-chat` and `deepseek-reasoner` no longer resolve in the deepseek
    catalog: DeepSeek discontinued both ids on 2026-07-24 ("The two legacy API
    model names, `deepseek-chat` and `deepseek-reasoner`, will be discontinued in
    three months"). Use `deepseek-v4-flash` (thinking is a per-request toggle now,
    not a separate id) or `deepseek-v4-pro`. Requests naming the retired ids still
    validate, with an `unknown_model` warning and no cost estimate.
  - `gemini-robotics-er-1.6-preview` left the google catalog upstream, so
    `google.stt`'s excluded-id list no longer carries a reason for it.

  RULES
  - `claude-fable-5-1` joins the sampling-removed generation: `top_k` is denied
    (any value returns a 400) and only the default `temperature` is accepted,
    matching Claude Fable 5, Opus 4.7/4.8/5 and Sonnet 5.
  - `anthropic.chat` refuses forced tool use on `claude-fable-5-1`. `tool_choice`
    `{"type": "any"}` and `{"type": "tool", …}` return a 400
    `invalid_request_error` on this model, thinking on or off; `auto` and `none`
    are unaffected. The error names the documented replacements (`strict: true` on
    the tool, or structured outputs). `MessagesArm` narrows `tool_choice` to match,
    so the editor refuses it first — the fourth per-model fact moved to compile
    time.
  - `claude-fable-5-1` is in the always-thinking arm alongside `claude-fable-5`:
    `thinking: {"type": "disabled"}` was already refused at run time, but the type
    arm did not say so.
  - `google.stt` curates `gemini-3.7-flash` and `gemini-3.8-flash` for
    transcription. Both are audio-in / text-out `generateContent` models per
    ai.google.dev — not Live API, not TTS, not embedding.
  - `google.chat` refuses `generationConfig.thinkingConfig.thinkingLevel:
"MINIMAL"` on `gemini-3.7-flash` and `gemini-3.8-flash`. Both model pages
    state "Note: `minimal` is not supported and returns an error", and the issue
    names the three levels they do accept. Scoped to those two ids on purpose:
    `gemini-3.6-flash` and `gemini-3.5-flash` still take MINIMAL, and every other
    row in the thinking guide's table is silent on what an unlisted level does.
  - `xai.image` mirrors the generated `grok-imagine-image-2.0` row rather than
    carrying a longhand hand row: models.dev now tracks it, so the id gains the
    snapshot's modalities and `limit.context` (8000) while keeping its docs-quoted
    "$0.04 / image" rate, which the snapshot still does not carry.

  VERIFIED, NO RULE NEEDED
  - `qwen3.8-max` / `qwen3.8-flash`: catalog limits, modalities and all four rates
    match Alibaba Model Studio's Singapore price table exactly.
  - `gemini-3.7-flash` / `gemini-3.8-flash`: 1,048,576 context and 65,536 output
    agree with Google's model pages, so the chat TTS overlay gains nothing; no
    3.7/3.8 TTS, Live or embedding variants exist to classify.

## 0.5.0

### Minor Changes

- 19faf5f: Accept `background: "transparent"` on `gpt-image-2` and `gpt-image-2-2026-04-21`,
  on both `openai.image` and `openai.imageEdit` and through the `unmodel/image` /
  `unmodel/image-edit` packs. OpenAI shipped transparent-background support for
  these models in preview (images/create and createEdit references, checked
  2026-08-31), so the per-model arms regain the `transparent` value, the
  constraint enum widens, and the recorded 400 fixtures that pinned the old
  refusal are retired. Retired compile errors: `background: "transparent"` on a
  gpt-image-2 generation or edit no longer errors.

  Both image routes also gain the documented `transparent`↔`output_format`
  coupling check: `background: "transparent"` with `output_format: "jpeg"` is
  rejected before send on every GPT image model — jpeg has no alpha channel; use
  `png` (the default) or `webp`.

  The README hero and docs champion example move from the retired gpt-image-2
  transparent 400 to Sora's size matrix: `openai@7.4.0` types `size` with one
  closed `VideoSize` union for every model, refusing the 1920x1080 (and 16/20s
  durations) that sora-2-pro documents and prices while compiling 1024p sizes
  sora-2 cannot render. unmodel's per-model arms carry the documented matrix,
  and the SDK-side claims are pinned in type tests so an SDK fix fails loudly.

- cb314cb: **Mureka can take a prompt-only vocal request.** `mureka.musicFromPrompt` is a
  new wire address for `POST /v1/song/easy-generate` ("Prompt to song"), the route
  that writes the lyrics itself. It is typed from the OpenAPI document embedded in
  the docs bundle (`SongEasyGenerateReq`, verified 2026-08-31): every field is
  optional — `model` included, which both generate routes require — `prompt` is
  capped at **2000** characters, and `styles` takes one or more of a closed
  thirteen-value enum (`pop`, `rock`, `jazz`, `r&b`, `edm`, `ambient`, `folk`,
  `latin`, `k-pop`, `j-pop`, `house`, `gospel`, `lo-fi`), published as `STYLES` on
  `unmodel/mureka` and `unmodel/mureka/values`. It is async like its siblings and
  polls with the `songQueryUrl()` that already shipped.

  **The music adapter now dispatches three ways**, and this is a behavior change:
  - `instrumental: true` → `POST /v1/instrumental/generate`
  - a `lyrics` extra → `POST /v1/song/generate`
  - neither → `POST /v1/song/easy-generate`

  So `music({ model: "mureka/mureka-9.5", prompt })` **used to be an
  `invalid_shape` error on `lyrics` and is now a successful compile to a different
  URL**, with zero warnings. `gender`, `melody_id` and `instrumental_id` are
  absent from the new route's body and are refused there with the route that does
  take each one named. Nothing is fabricated on the way: the canonical `prompt`
  reaches `prompt` unchanged and Mureka writes the words.

  **One wart, written down rather than smoothed over.** The effective cap on the
  canonical `prompt` is now route-dependent — 2000 characters on easy-generate,
  1024 on the other two — so the same prompt can pass or fail depending on whether
  a `lyrics` extra rode along with it. Each wire schema carries its own accurate
  cap; the adapter and module headers say so.

  `styles` stays a per-model extra rather than canonical vocabulary: no other
  music provider in the roster has any style or genre field, so it has one witness
  (decisions.md §8).

  ### Corrections for the report this came from
  - **"Every other music provider writes lyrics from the prompt" was 2 of 4**, not
    4 of 4. ElevenLabs Music and Google Lyria take prompt-only vocals; Stability
    has no vocals at all; and at fal, `minimax/music-3` and
    `fal-ai/minimax-music/v2` refuse a prompt-only request exactly as Mureka did,
    which is a standing recorded decision (unmodel does not invent lyrics), not an
    oversight.
  - **`styles` is an array, not a single style**, and `prompt` is optional too — a
    `styles`-only request is legal. The route also carries `reference_id`,
    `vocal_id`, `n` and `stream`.
  - The related silent-prompt-to-lyrics defect at `fal/fal-ai/diffrhythm` was
    fixed separately: that compile has carried an `approximated_param` since the
    previous release.

- a0388cc: **A container you asked for is never silently dropped.** `resolveAudioFormat`
  had one branch that accepted an explicit `outputFormat.container` without
  checking it: when an endpoint declares no container list for a codec, it has no
  wire field for a container either, so the ask could not be sent — and nothing
  said so. `{ format: "opus", container: "webm" }` was an error at
  `elevenlabs/music_v1` and a silent success at `fal/fal-ai/elevenlabs/music`.
  It is now an `approximated_param` warning naming the container the endpoint
  actually serves, and the resolved format reports that container rather than the
  one that was asked for. This reaches 2 fal music rows and 3 fal speech rows
  generically; every hand-written adapter declares its containers and is
  unchanged.

  **DiffRhythm sings your prompt, and now says so.** `fal/fal-ai/diffrhythm`'s only
  text field is `lyrics` — the words the model sings — so a canonical `prompt`
  written there comes back sung verbatim. That compile now carries an
  `approximated_param` on `prompt`.

  **Two shipped pricing rows were wrong about their own provenance.** The
  ElevenLabs catalog claimed elevenlabs.io/pricing/api "publishes no separate USD
  rate" for speech-to-speech and for sound effects. The page publishes both, in
  the same card set and tier this catalog already reads for Music and Dubbing:
  "Voice Changer and Voice Isolator $0.12 per minute. Sound Effects $0.12 per
  minute" (verified 2026-08-31). `eleven_multilingual_sts_v2`,
  `eleven_english_sts_v2`, `eleven_english_sts_v1` and `eleven_text_to_sound_v2`
  now carry `cost.perAudioMinute`, and `unmodel/elevenlabs` exports the two rates
  beside the ones it already published:
  - `VOICE_CHANGER_PER_AUDIO_MINUTE` (new)
  - `SOUND_EFFECTS_PER_AUDIO_MINUTE` (new)

  **A codec fal publishes can no longer vanish from a row.** `codegen:fal` now
  runs `assertCodecsComplete` over every closed `output_format` enum, the twin of
  the `aspect_ratio` guard: each member either canonicalises into the row's
  `codecs` or is named in a recorded-refusal set with its argument. The `ogg` and
  `m4a` declines at `fal-ai/stable-audio-3/medium/text-to-audio`, and MiniMax's
  `url`/`hex` delivery switch, moved out of generator comments into that set.

  **The instrumental refusal names its siblings** instead of counting them:
  `"fal-ai/elevenlabs/music" and "fal-ai/minimax-music/v2.6" do take one`.

  ### Corrections for the report this came from
  - **Nothing types canonical `instrumental` as `never`.**
    `music.safe({ model: "fal/fal-ai/minimax-music/v2.6", prompt, instrumental: true })`
    compiles and sends `is_instrumental: true`; the same word reaches
    `force_instrumental` at ElevenLabs Music and Mureka's
    `POST /v1/instrumental/generate` route. Only `outputFormat` narrows to `never`
    at a music ref, and only where the row declares no codecs.
  - **The wire spelling `is_instrumental` is refused by design**, at both layers,
    and is on no row's `extras`. A gap in the canonical vocabulary is a typed
    refusal, never a wire word smuggled through — so it is not the workaround it
    was taken for.
  - `docs/surfaces.md` now states which music words narrow at compile time and
    which refuse at run time, with the executed output of both.

- de52e8a: **New category: `unmodel/sfx` — text to sound effects, two providers, seven refs.**

  The fifth category added in 2026 and the one that arrived with the most evidence
  behind it: **five independent vendor witnesses on day one** — ElevenLabs, Sonilo,
  CassetteAI, Stability and Mirelo — where `3d` shipped with two and `lipsync`,
  `avatar` and `upscale` each shipped with one.

  ```ts
  import { sfx } from "unmodel/sfx";

  sfx({
    model: "elevenlabs/eleven_text_to_sound_v2",
    prompt: "a heavy oak door creaking open in a stone hall",
    durationSeconds: 4,
    outputFormat: "mp3",
  });
  // → { text: "…", model_id: "eleven_text_to_sound_v2", duration_seconds: 4 }
  //   …with ?output_format=mp3_44100_128 on the URL, because at this endpoint the
  //   format is a QUERY param.
  ```

  **Four canonical words** — `model`, `prompt`, `durationSeconds?`, `outputFormat?`
  plus `providerOptions` — the smallest vocabulary in the library, and every one of
  them is also a `music` word.

  **Why it is not `unmodel/music`.** At ElevenLabs, the one vendor serving both, the
  two wires are disjoint and so are their model-id enums: `/v1/music` counts
  MILLISECONDS with a floor of 3 000 and takes a `composition_plan` and a
  `force_instrumental`; `/v1/sound-generation` counts seconds with a floor of **0.5**
  and takes a `loop` and a `prompt_influence`. Merging them would have pushed the
  category floor from three seconds to half of one and put `instrumental?: boolean`
  on a door creak.

  **Omitting `durationSeconds` means the PROVIDER's default, never `"auto"`** — the
  decision the category is built on, because the five vendors give three different
  answers:

  | ref                                                                            | absent means                            | what you get                                     |
  | ------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------ |
  | `elevenlabs/eleven_text_to_sound_v2`, `fal/fal-ai/elevenlabs/sound-effects/v2` | the model reads a length off the prompt | nothing — nothing was invented, so nothing warns |
  | `fal/sonilo/v1.1/text-to-sound-effects`                                        | 8 seconds                               | `approximated_param` naming 8                    |
  | `fal/mirelo-ai/sfx1.6/text-to-audio`                                           | 10 seconds                              | `approximated_param` naming 10                   |
  | `fal/fal-ai/stable-audio-3/small/sfx/*`                                        | 30 seconds                              | `approximated_param` naming 30                   |
  | `fal/cassetteai/sound-effects-generator`                                       | HTTP 422 — the field is required        | a **compile error**, and a typed refusal         |

  The default is warned about and never sent: writing 8 into `duration` would pin a
  number the provider is free to change.

  **New addresses.**
  - `elevenlabs.sfx` — `POST /v1/sound-generation`, typed from the live
    `api.elevenlabs.io/openapi.json`. `text` required; `duration_seconds` 0.5–30
    nullable; `loop`; `prompt_influence` 0–1; `model_id`; `output_format` as a
    **query param** whose 21-member enum is NOT `/v1/music`'s (there is no 48 kHz
    MP3 arm here, so `SOUND_EFFECTS_OUTPUT_FORMATS` is its own constant rather than
    a shared one that would have accepted four values this endpoint rejects). The
    catalog row already existed and now carries its $0.12-per-generated-minute rate.
  - `fal.sfx` — six curated endpoints from five vendors, taking `unmodel/fal` to
    **178 endpoints across eleven verbs**: `fal-ai/elevenlabs/sound-effects/v2`,
    `sonilo/v1.1/text-to-sound-effects`, `cassetteai/sound-effects-generator`,
    `mirelo-ai/sfx1.6/text-to-audio`, and both arms of
    `fal-ai/stable-audio-3/small/sfx/*`.

  **The overlap is deliberate and NARROWED.** fal's resale of ElevenLabs' model
  differs from the native route four ways: the length caps at 22 seconds instead of
  30, `output_format` moves from the query string into the body, `text` caps at 450
  characters, and there is no `model_id` because the endpoint IS the model. That
  comparison is pinned in `test/unified/golden/sfx/plain/` rather than described.

  **`loop` is deliberately not a canonical word.** One vendor of five publishes it.
  Mirelo's `ambience` looks like a second witness and is not — it produces a tileable
  ambience _bed_, which changes what is generated rather than where it ends, the same
  disqualifier the lipsync `sync_mode` table carries. It rides as a per-model extra,
  fully typed, and `test/unified/sfx-capabilities.test.ts` holds the decline as an
  assertion that FAILS the day a second vendor spells it compatibly. Same for
  `prompt_influence`, `seed`, `negative_prompt`, `guidance_scale` and `num_samples`.

  **Correction to a recorded reason.** `docs/providers.md` said no SFX route was
  curated because "an `sfx` category with one witness would be a guess". That was
  wrong on the facts, not just on the conclusion: the live roster has five
  independent vendors, and the vocabulary was never the blocker. The sentence is
  replaced, and the six ids are now curated rather than declined.

  **Also new:** `unmodel/elevenlabs` gains `sfx`, `soundEffectsUrl`,
  `SOUND_EFFECTS_URL`, `SOUND_EFFECTS_OUTPUT_FORMATS`, `DEFAULT_SFX_MODEL_ID`,
  `SFX_MODEL_IDS` and the bounds constants; `unmodel/elevenlabs/types` gains
  `SfxBody`; `unmodel/fal/types` gains `SfxBody` and `FalSfxArm` /
  `FalSfxBodyById` / `FalSfxResultById`; both providers' `/values` entries gain
  `SFX_MODEL_PARAMS` and `SFX_MODELS` (ElevenLabs' also `SFX_FORMAT_SPEC`);
  `unmodel/types` gains `SfxParams`, `SfxParamsBase` and `SfxModelParams`; and the
  CLI gains `elevenlabs.sfx`, `fal.sfx` and `unified.sfx`.

- c1228c4: **New category: `unmodel/sts` — voice conversion, two providers, four refs.**

  A recording goes in, the same performance comes out in a different voice. The
  sixth category added in 2026 and the smallest pack in the library, and the only
  one where **three of five canonical words are required**.

  ```ts
  import { sts } from "unmodel/sts";

  sts({
    model: "elevenlabs/eleven_multilingual_sts_v2",
    audio: { file: recording },
    voice: "21m00Tcm4TlvDq8ikWAM",
  });
  // → { audio: <Blob>, model_id: "eleven_multilingual_sts_v2" }
  //   …posted to /v1/speech-to-speech/21m00Tcm4TlvDq8ikWAM, because at this
  //   endpoint the voice is a URL PATH segment.

  sts({
    model: "hume/voice-conversion",
    audio: { file: recording },
    voice: { name: "Male English Actor" },
  });
  // → { audio: <Blob>, voice: { name: "Male English Actor" } }
  ```

  **Five canonical words** — `model`, `audio`, `voice`, `outputFormat?` plus
  `providerOptions`. `model`, `audio` and `voice` are all **required**: a
  text-to-speech request can omit the voice and get a default speaker, and a
  conversion with no target voice is not a conversion. There is no `text`, no
  `speed` and no `language`, because the words, the timing and the delivery all
  come from the recording.

  **The address is `<provider>.sts`** — the category id, the same construction
  `tts` and `stt` use, all three being the operation's own initialism rather than
  a wire path. `voiceConvert` was the near-miss and lost on the property
  `src/cli-registry.test.ts` exists to keep: the word you type at
  `unmodel/<category>` and the word you type at `unmodel/<provider>` must be the
  same word, and `unmodel/voice-convert` would have put a fourth `voice*` entry
  point next to `voiceClone` and `voiceDesign` for an operation that creates no
  voice at all — it spends one. Retired before they ever shipped, and pinned in
  that test so a rename has to delete an assertion: `elevenlabs.speechToSpeech`
  (the wire path), `elevenlabs.voiceChanger` (ElevenLabs' _and_ Cartesia's product
  name), `elevenlabs.voiceConvert`, `hume.voiceConversion`.

  **The whole category is library-only, by design.** `audio` is a required binary
  form part at both witnesses with no URL, base64 or upload-handle alternative, so
  no JSON params document can express a request: `elevenlabs.sts` and `hume.sts`
  are `MULTIPART_ONLY` and there is deliberately **no `unified.sts` CLI entry** —
  the only pack without one. Send it with each provider's own
  `stsToFormData(validated)`.

  **New addresses.**
  - `elevenlabs.sts` — `POST /v1/speech-to-speech/{voice_id}`, multipart, typed
    from the live `api.elevenlabs.io/openapi.json` (re-fetched 2026-08-31). Three
    models. `voice_id` is a PATH segment and `output_format` + `enable_logging` are
    QUERY params, so all three are stripped from the body and live in
    `.request.url`; the 27-value format enum is byte-identical to the
    text-to-speech one and is reused rather than re-declared. `voice_settings` is a
    **JSON-encoded string** part — typed structured, serialized by `stsToFormData`.
    `model_id` defaults to `eleven_english_sts_v2` server-side (the English model,
    not the multilingual one the docs recommend). Priced at $0.12 per minute of
    processed audio, estimated from
    `options.media = [{ path: ["audio"], durationSeconds }]`.
  - `hume.sts` — `POST /v0/tts/voice_conversion/file`, multipart. Six fields and
    that is the complete list. **No model field and no `version`**, so the catalog
    row is the synthetic id `voice-conversion` and the ref is
    `hume/voice-conversion`. No cost: hume.ai/pricing carries voice conversion as a
    feature-availability row with no rate attached, so the estimate returns
    `undefined` rather than a guess.

  **`voice` is the word the two vendors spell differently**, and it is the only
  canonical word in the library that lands outside the request body at one provider
  and inside it at another: a URL path segment at ElevenLabs (`{ id }` only —
  `{ name }` is an error naming the id) and a form part at Hume (`{ id }` and
  `{ name }` both, which is what the canonical `Voice`'s three arms exist for).

  **Two deliberate ElevenLabs omissions.** `optimize_streaming_latency` is a fourth
  query param the OpenAPI marks `deprecated: true` _on this operation_, so it is
  not typed. And `/v1/speech-to-speech/{voice_id}/stream` is not a second address:
  a normalised diff of the two body schemas is identical except for the schema
  title, and their query sets match, so there is nothing for a second validator to
  validate.

  **The 5-minute / 10,000-character tension, resolved as no check.** The capability
  page says "Maximum segment length: 5 minutes"; the models page publishes a
  10,000-character limit annotated "~10 minutes". They measure different things —
  a per-request cap and a billing quota at 1,000 characters per minute — and
  neither becomes a check, because unmodel cannot read a duration out of a `Blob`
  and the `options.media` figure is for pricing, not for refusing a request the API
  may well fulfil.

  **Two vendors with catalogued speech-to-speech models are excluded, each with a
  reason, a source and a date recorded in its own `models.ts`.**
  - **cartesia** — `POST /voice-changer/bytes` and `/voice-changer/sse` are
    **sunset**: the deprecations page lists them under "These endpoints are being
    sunset. Requests after an endpoint's sunset date return an error." with
    replacement "—" and sunset date **August 20, 2026** (fetched 2026-08-31), and
    both are gone from the api-reference index. `@cartesia/cartesia-js` 4.1.0,
    published six days _after_ that date, still ships an undeprecated
    `VoiceChanger` resource; the docs are the stronger source, and typing a route
    that answers an error is the reverse of what this library is for.
  - **resemble** — its speech-to-speech is not a separate endpoint. It is the same
    `POST /synthesize` route already addressed as `resemble.tts`, switched into
    conversion mode by passing SSML containing `<resemble:convert src="…">` — where
    the source is an **HTTPS URL**, not a file part. A second address for one wire
    is what the naming law forbids, and the category cannot reach it anyway.

  **What is not a canonical word:** every knob on both wires, because every one has
  exactly ONE witness — `remove_background_noise`, `seed`, `voice_settings`,
  `file_format`, `enable_logging` at ElevenLabs; `strip_headers`, `context`,
  `include_timestamp_types` at Hume. Each is a per-model extra typed from its own
  route's wire interface, and `test/unified/sts-capabilities.test.ts` holds the
  decline as an assertion that FAILS the day a name appears on both rows.

  **Also new:** `unmodel/elevenlabs` gains `sts`, `stsToFormData`,
  `speechToSpeechUrl`, `SPEECH_TO_SPEECH_BASE_URL`, `DEFAULT_STS_MODEL_ID`,
  `STS_FILE_FORMATS`, `STS_SEED_MIN`/`STS_SEED_MAX` and `STS_MODEL_IDS`;
  `unmodel/hume` gains `sts`, `stsToFormData`, `VOICE_CONVERSION_URL`,
  `VOICE_CONVERSION_JSON_URL` and `STS_MODEL_ID`; both providers' `/types` entries
  gain `StsBody` (plus `SpeechToSpeechParams`/`SpeechToSpeechFormFields`/
  `SpeechToSpeechSdkParams`/`ElevenlabsStsFileFormat` and
  `VoiceConversionBody`/`VoiceConversionSdkParams`); both `/values` entries gain
  `STS_MODEL_PARAMS`, `STS_MODELS` and `STS_FORMAT_SPEC`; `unmodel/types` gains
  `StsParams`, `StsParamsBase` and `StsAudioInput`; and the CLI gains
  `elevenlabs.sts` and `hume.sts` as `MULTIPART_ONLY` entries.

  **Also:** `unmodel/hume/unified` becomes a barrel over `unified-tts.ts` and
  `unified-sts.ts`, so `unmodel/tts` no longer reaches this provider through a
  module that also carries the conversion adapter. The exported names are
  unchanged. And `scripts/leaderboard-audit.ts`'s `speech-to-speech` row moves from
  `categories: null` to `["sts"]` — the last AA media category unmodel had no
  surface for, so the weekly audit now sweeps it like any other.

### Patch Changes

- 6ba935c: **`MINIMAX_BASE_RESP_INFO` is now indexable by the checker's own `finishReason`.**
  An adopter hit TS7053 pairing the two exports this library ships side by side:
  `checkTts`'s `finishReason` is open-tailed (`MinimaxBaseRespStatus` carries a
  `(number & {})` arm, because MiniMax can mint codes we have not transcribed), but
  the table declared only exact numeric keys, so `MINIMAX_BASE_RESP_INFO[report.finishReason]`
  needed a widening cast.

  The export's declared type is now the literal table intersected with a numeric
  index signature — both reads work without a cast, and both are pinned in
  `test/types/minimax.test-d.ts`:
  - `MINIMAX_BASE_RESP_INFO[report.finishReason]` → `MinimaxBaseRespInfo | undefined`
  - `MINIMAX_BASE_RESP_INFO[1004].retryable` → still the literal `false`

  **Declined as asked:** typing the export `Partial<Record<MinimaxBaseRespStatus, …>>`
  would have allowed the first read by destroying the second — every exact-key
  lookup would degrade to `MinimaxBaseRespInfo | undefined` and every literal
  payload to its wide type. An accessor function was also unnecessary once the
  intersection carries both.

- 3960356: Add `bria/fibo-edit/relight` to fal's exact provider-native `imageEdit` surface
  without exposing it through the prompt-required unified adapter. Its request
  and result types, enums, checks, route, catalog row, and $0.04-per-image price
  are generated from fal's published schema and documented model page.

  Also let Google and MiniMax `checkTts` inspect decoded `unknown` JSON safely;
  nulls, primitives, and malformed nested values now produce a report instead of
  throwing, while the exported structural response interfaces remain available
  for callers that want them. Google's checker now counts audio only when an
  `audio/*` part carries non-empty inline bytes or a non-empty file URI, and an
  unspecified prompt block reason no longer hides an empty-audio warning.
  The Google checker now also follows the exported delivery descriptor exactly:
  only the documented first response part can satisfy the audio check.

## 0.4.2

### Patch Changes

- eb9ac2e: **v0.4.0 triage: the `finishReason` unlock, and branching between two requests.** Two adopter
  complaints against 0.4.0, both verified adversarially against the repo, the published package
  and the live provider docs before anything was written. Both turned out to be right about the
  friction and wrong about the cause, so what shipped is not what was asked for — and the
  corrections are recorded here too.

  ## Fixed
  - **MiniMax's in-band failure is now the report's outcome, not a warning count.**
    `minimax.checkTts` returns `ResponseReport<MinimaxBaseRespStatus>` and puts
    `base_resp.status_code` on `finishReason` — the same field the five job checkers
    (`revai.checkJob` → `"failed"`, `speechmatics.checkJob` → `"rejected"`, …) have always used
    for a terminal status. `/v1/t2a_v2` answers `200` for every outcome, so before this a `1004`
    auth failure and a cosmetic finding were distinguishable only by reading warning text.
    **`0` is the only success and `0` is falsy**: branch on `finishReason !== 0`, never on
    truthiness.
  - **`resemble.checkTts` too.** `success: false` was the same defect at the provider MiniMax's
    module header cites as its precedent, so the precedent was teaching the wrong thing. It now
    returns `ResponseReport<ResembleSynthesisOutcome>` with `finishReason: "success" | "failure"`,
    absent when the response omits `success` entirely.

  ## Added
  - **`MINIMAX_BASE_RESP_INFO`** from `unmodel/minimax` — the eight documented
    `base_resp.status_code` values as data rather than a JSDoc table, each mapping to MiniMax's own
    `statusMsg` and, where that message answers it, `retryable`. `1002` (rate limit) is `true`,
    `1004` (auth failed) is `false`, and `1000` ("unknown error") carries no `retryable` at all,
    because the docs do not classify it and a guess there would make the other seven untrustworthy.
    The same value lands on the issue's `meta.retryable`. Type: `MinimaxBaseRespInfo`.
  - **`ResponseReport`'s `Reason` parameter accepts `string | number`** (default still `string`).
    A vocabulary is whatever the provider publishes, and MiniMax publishes numbers — the old
    `string` constraint locked the one provider whose route reports every outcome in band out of
    the field that exists to carry it. Fully additive: every existing annotation, including
    `const x: string | undefined = r.finishReason`, still compiles.
  - **`docs/validation.md` § "Branching between two requests"** — the recipe for
    `cond ? safe(a) : safe(b)`, with every ✅/❌ pasted from a real `tsc` run and pinned by
    `test/types/atlascloud.test-d.ts` and `test/types/unified-video.test-d.ts`.
  - **`docs/surfaces.md` § "Response checks"** — the response-check surface had no section at
    all; it was documented only in per-provider tables and module JSDoc.

  ## Declined, with the reason
  - **No `outcome` union on `ResponseReport`** (`docs/decisions.md` §9). It would restate
    `finishReason` for the twelve checkers that already answer, and it would collapse the
    distinction the caller actually needs: MiniMax's codes split _three_ ways, not two, and
    `outcome: "failed"` tells a caller to give up on a `1002` rate limit that clears in a second.
  - **No error-severity issues in `warnings`** (§9). `ResponseReport` has exactly one array and it
    is named `warnings`; an `Issue` with `severity: "error"` inside it is self-contradictory, and
    `warnings.some(w => w.severity === "error")` is not an improvement on the `warnings.length > 0`
    it would replace. The request side can partition because `partition()` runs there and `.safe()`
    returns a discriminated `ok`; the response side has no such partition.
  - **No variance change to `ValidateResult` / `Validated`, and no `ValidateResultLike`.** The
    reported cause was wrong: `Validated` is _already_ covariant (`ValidateResult<VA>` is assignable
    to `ValidateResult<VA | VB>`), and `toSdk` is already method shorthand. What actually fails is a
    stock TypeScript rule — it never unions multiple covariant inference candidates for a naked type
    parameter — and it reproduces on `type Box<T> = { readonly value: T }`, which has no members to
    make variant. A structural `ValidateResultLike` was tested and does not fix it either, and every
    `*Like` in this repo is an input-position reader for untrusted provider responses, never a
    loosened unmodel output. The fix is on the consumer's side of the call, and it is now
    documented: type the parameter `ValidateResult<{ request: RequestMeta }>`, which accepts the raw
    ternary _and_ single-arm results and still feeds `toRequestInit`, or hoist the ternary into the
    params so there is one call. The hoist costs no exactness — a typo'd key or a wrong-route field
    in either arm still fails to compile.

  ## Still filed

  A `ResponseIssueKind` union for the sixteen ad-hoc `meta.kind` values across the checkers.
  `docs/tts.md` tells callers to branch on `meta.kind: "provider_error"`, but `Issue.meta` is
  `Record<string, unknown>`, so the documented discriminator is not reachable in strict TypeScript
  without a cast. It is a larger, separate change and is not in this release.

## 0.4.1

### Patch Changes

- Release automation: the package now publishes from GitHub Actions via npm
  trusted publishing (OIDC) — a version change in package.json pushed to main
  releases hands-free, with provenance. No tokens stored anywhere.

## 0.4.0

### Minor Changes

- 0a925e7: **v0.3.0 adopter feedback, all four tiers.** A production adopter filed twenty complaints and
  requests against 0.3.0. Every one was verified against the repo, the published package and the
  live provider APIs before anything was written; the ones that turned out to be real are below,
  and so are the ones that turned out not to be, with the reason.

  Five of these were bugs the complaints walked _past_ rather than reported.

  ## Fixed
  - **Nine OpenAI refs that could only ever come back 400 are gone from `unmodel/chat`.**
    `gpt-5.3-codex`, `gpt-5.3-codex-spark`, three `text-embedding-*`, three image rows and
    `gpt-realtime-2.1` are catalog models OpenAI does not serve on `/v1/chat/completions`, and they
    were `ChatModelRef` arms all the same — offered by autocomplete, compiling clean, addressing the
    chat endpoint. `CHAT_MODEL_REFS` goes 1,339 → 1,330, the generated chat tables lose them, and
    `openai.chat` now warns by name on a catalog row it recognises but cannot route, saying which
    surface serves it instead (`/v1/responses` for the codex pair, `/v1/embeddings`, `/v1/images`,
    `/v1/realtime`). The exclusion is data (`chatScopeExclude` in
    `data/availability-overrides.json`), the reasoning is `docs/decisions.md` §7, and
    `test/chat/refs.test.ts` now asserts every surviving `openai/…` ref is an `OpenaiChatModelId`.
  - **fal's aspect-ratio classifier refused decimal ratios.** The regex behind the generated
    `ratios` rows required integers on both sides, so `2.35:1`, `19.5:9` and `9:19.5` were dropped
    from every endpoint that declares them and could not be reached through
    `video({ aspectRatio })`. Widened to mirror `RATIO_SPELLING` in `core/unified/derive.ts`, and
    the fix carries an invariant rather than a patch: codegen now throws, naming the endpoint and
    the member, if any closed `aspect_ratio` enum value is missing from the row's `ratios` and is
    not the one recorded non-shape (`"auto"`, which is a schema default on 17 of 20 rows and is
    reached through `providerOptions.fal.aspect_ratio`).
  - **`.toSdk("openai")` no longer needs a cast, and its JSDoc no longer lies.** The comment
    claimed the SDK hand-off carried `stream: false`; it did not, and typing the wire that way
    would have lied to streaming callers instead. The caller's `stream` is now threaded through the
    unified surface — `ChatPackResult` carries the caller's `T`, so the result has no `stream` key
    when it was never set and the literal `true`/`false` when it was, and
    `client.chat.completions.create(chat({…}).toSdk("openai"))` typechecks either way. The
    confirmation is that `SdkComparable` in `test/types/chat.test-d.ts` LOST its stream
    special-case: the test got simpler.
  - **TS2883/TS2742 for downstream libraries that emit declarations.** A library wrapping unmodel
    and shipping its own `.d.ts` could not compile: the inferred type of its own function named
    `Validated`, `RequestMeta`, `ExactKeys`, `ValidateOptions`, `ValidateResult` and `Retargeted`
    through a hashed internal chunk path. Half of those were already exported — the error persists
    anyway, because TypeScript can only name a symbol through a module already in the consumer's
    program. So the carrier set now ships from `src/core/carriers.ts` and is re-exported from every
    entry a consumer might import alone: the root, `unmodel/chat`, `unmodel/chat/factory`, every
    provider `index.ts` and every `src/unified/*` pack. A new `test/types/declaration-portability.test.ts`
    builds `dist/`, emits declarations against it from both a flat and a pnpm-style nested
    `node_modules`, and fails on either error code.
  - **MiniMax TTS prose that was false in three places.** `index.ts`, `tts.ts` and the
    `tts-params.ts` JSDoc all said MiniMax has no response checker because its errors arrive as
    HTTP status codes. They do not — see `checkTts` below — and the three sentences moved in
    lockstep with the checker that replaces them.

  ## Added
  - **`atlascloud` — a new provider.** `atlascloud.video` compiles
    `POST https://api.atlascloud.ai/api/v1/model/generateVideo` for **23 curated models** across
    four families (Seedance 2.5 / 2.0 / 2.0-mini / 2.0-fast / v1.5-pro, Wan 3.0 + 3.0-prime,
    Veo 3.1), with per-model wire arms, a unified adapter at `unmodel/atlascloud/unified`, and the
    usual four entries (`unmodel/atlascloud`, `/unified`, `/types`, `/values`). It joins
    `unmodel/video` as the fourteenth provider.

    Atlas is a **third transport for weights unmodel already reaches**: `bytedance/seedance-*` is
    also `bytedance.video` (ByteDance's own ModelArk) and `fal.video`; `google/veo3.1/*` is also
    `google.video` and `fal.video`. The three compile to visibly different bodies and no
    normalisation runs between them — feeding one provider's body to another's validator fails,
    which is the point.

    Two facts worth calling out for callers. `model` is a **real, required body field** that names
    the route as well as the model: there is no `endpoint` pseudo-param, because
    `bytedance/seedance-2.5/text-to-video` and `.../image-to-video` are two refs with two OpenAPI
    documents, and a caller who adds `image` to the text ref is told to pick the image ref rather
    than silently rerouted to a model with a different price. And **no `atlascloud` model ships a
    `cost`**: Atlas publishes no unit for its rates — 335 of its 337 media catalog rows carry a
    bare `base_price` with no `unit`, 152 of 473 rows carry a 40–90% promotional discount, and the
    model page renders the same figure as a per-run price, a per-second rate and a per-1000-token
    rate from three templates in one bundle. The caveat ships instead, as
    `ATLASCLOUD_PRICING_CAVEAT`, and the validator declares no `estimate` at all.

    Auth is `Authorization: Bearer <ATLASCLOUD_API_KEY>`; the POST creates a prediction, so poll
    `predictionUrl(id)` (`resultUrl(id)` is the second spelling five of the schemas use).
    Snapshots, curation and the pricing caveat live in `data/atlascloud/`; `bun run audit:atlascloud`
    diffs the live catalog and re-hashes every snapshot, weekly in CI, and never writes.

  - **`elevenlabs.dub` and `elevenlabs.dubLanguage` — dubbing, wire-only.**
    `POST /v1/dubbing/project` (multipart, file XOR `source_url`, transcript ⇒ `source_language`,
    ≤500 reference clips, ≤3 webhook ids, the full keyterms battery, per-model BCP-47
    `target_language` with v1's no-dialects refusal) plus `POST /v1/dubbing/{id}/language` for
    adding a target to an existing project. Two models join the catalog: `dubbing_v1` ($0.50/min —
    the no-watermark rate, since this route has no `watermark` field for the discounted one to
    apply to) and `dubbing_v2` ($2.20/min). `checkDubbingProject` prices
    duration × languages × rate and warns on `failed`; `checkDubbingLanguage` warns on a stale
    revision. The reference page most people find (`/docs/api-reference/dubbing/create`)
    308-redirects to the LEGACY route, which has no `model_id` at all and so cannot reach Dubbing
    v2 — unmodel serves the project surface and deliberately not that one.
  - **`minimax.checkTts` — MiniMax answers HTTP 200 for every outcome.** The T2A reference declares
    exactly one response code and documents no non-200: failure rides in band on
    `base_resp.status_code`, so `if (res.ok) use(body.data.audio)` hands the empty string on as
    audio after an authentication failure. `checkTts` reads the envelope, warns quoting
    `status_msg` with `meta.kind: "provider_error"`, reports empty audio separately, and prices the
    call from `usage_characters`. MiniMax moves to `docs/tts.md`'s ships-a-checker table.
  - **`sync.generationUrl(id, query)` takes the three documented query params.** `wait`, `timeout`
    and `include`, as an XOR union — `include: "progress"` cannot be combined with `wait`/`timeout`,
    which the spec forbids and which is now a compile error rather than a 400. The JSDoc carries
    all three verbatim, the 1–10 `timeout` range, the `X-Sync-Wait-Mode` /
    `X-Sync-Wait-Timeout-Seconds` response headers, and the caveat that `progress_percent` is
    described only on the param and is not a declared property of the `Generation` model. Not
    validated; exported for convenience.
  - **`detail` is canonical chat vocabulary.** `ChatFilePart.detail?: "auto" | "low" | "medium" | "high"`
    compiles to OpenAI's `image_url.detail` (with `medium` → `high` as an `approximated_param`), to
    Gemini's per-part `mediaResolution.level`, and to an explicit `dropped_param` on Anthropic.
    Both interop encoders used to warn that the _other_ dialect's field had no equivalent — a
    matched pair of warnings is the signature of a missing vocabulary word. `estimateChatTokens`
    now reads it for the image-token term, from catalog data rather than a hardcoded constant.
    `docs/decisions.md` §8.
  - **`providerOptions.openai` is typed.** All twelve OpenAI-only chat params (including
    `verbosity`) complete and are enumerated there — plus OpenAI's exact `reasoning_effort` and
    `service_tier` unions where the shared dialect leaves the string open — read from a new
    type-only `src/providers/openai/wire.ts`
    through `retarget/dialects.ts` — so `verbosity: "extreme"` is a compile error and
    `providerOptions.openai.messages` no longer typechecks at all. The hand-mirrored
    `OpenAiChatServiceTier` is deleted and its drift-guard replaced by an identity assertion
    against the real union. The wire leaf names **no catalog**: the body is generic in its model id
    and `openai/chat.ts` closes it, because the version that closed it in the leaf put 80 KiB of
    literal ids into fifty-seven declaration graphs.
  - **Six fal video endpoints, and `FAL_EXCLUDED` at the API surface.** The roster goes 165 → 171:
    `fal-ai/veo3.1/reference-to-video`, `fal-ai/kling-video/v3/pro/motion-control` (its image is a
    _reference_, not a first frame — recorded on the row), `fal-ai/kling-video/o1/video-to-video/edit`,
    `fal-ai/minimax/hailuo-2.3/pro/text-to-video`, `fal-ai/lightx/relight` and
    `topaz/upscale/video/generative`. Alongside them, the exclusion records go 9 → 66 and now
    _reach the caller_: an id unmodel deliberately declined arrives as ``unmodel deliberately does
not serve `X`: <reason>`` instead of the generic "catalog data may lag behind", from
    `FAL_EXCLUDED` / `FAL_EXCLUDED_CATEGORIES` on `unmodel/fal`.
  - **`FalQueueError` and `FalQueueResult<T>`, and the ten `Fal<Verb>ResultById` maps are now
    findable.** The response types have shipped since the fal wave; nothing pointed at them, so an
    adopter hand-rolled `{ video: { url: string } }` per endpoint. `unmodel/fal/types` now names
    all ten, and `FalQueueResult<T>` gives the failure arm a type — necessary because fal's queue
    declares no `FAILED` status and a failed request reports `COMPLETED` with its error in the
    RESULT document. `"error" in body` is the discriminant; `test/types/fal.test-d.ts` pins the
    narrowing and pins each result map against its request map, key for key.
  - **`src/core/carriers.ts`** — see TS2883 above; the type re-exports are a public, documented
    surface now, not an accident of chunking.

  ## Declined, with reasons
  - **A zod schema per fal result document.** 171 schemas restating the generated types, refreshed
    on fal's clock, to validate a document unmodel never fetches. The types ship; the validation
    does not.
  - **A `retryable` field on `UnmodelValidationError`.** It would read `false` on 100% of
    instances. Validation is a pure function of the params, so the documented answer is "never
    retry, classify at the catch" — with the patterns, the durable-runtime one-liners and the
    `structuredClone` caveat now in `docs/validation.md`.
  - **Auto-suppressing `unknown_param` on fal's widened arm** (and a `widened_endpoint` code, and
    aggregating the warnings). The widened arm is the one path where the type system has also stood
    down, so it is the last remaining signal on the call with the least help — and it is quieter
    than it sounds: 15.6% of keys on average, zero keys for 58% of endpoints. `{ severity: {
unknown_param: "off" } }` is the per-call answer, and `docs/providers.md` now documents it.
  - **`verbosity` promoted to canonical chat vocabulary.** One witness. `detail` had two, and got
    promoted in the same wave — which is what makes it a rule rather than a preference.
  - **`openai.chatResponses`.** Queued as its own wave, not built here: `/v1/responses` is a
    substrate address, not a fifth dialect. The four clauses are in `docs/decisions.md` §7.
  - **Typing the wire `stream?: false`.** It would lie to every streaming caller.
  - **Widening `TtsDelivery`'s `errorPath`** for MiniMax's in-band envelope; a provider-level const
    is the future data form if the second witness arrives.
  - **An `unmodel/dubbing` category.** Two witnesses that do not share a request shape: ElevenLabs
    is a two-request project/target model with an editable transcript and a revision counter,
    HeyGen `/v3/video-translations` is a one-shot job.
  - **Atlas codegen, and Atlas chat / TTS / image / 3D.** The codegen bar is recorded in
    `data/atlascloud/curation.json`: ~1,500 LoC worth writing past roughly 40 curated ids, and it
    would need two lowering rules fal's does not have. The chat surface is the cheap next wave (an
    `openai-compatible` overlay at `api.atlascloud.ai/v1`); TTS is blocked on hand-curating an
    ElevenLabs voice enum of 21 opaque ids.
  - **`duration: -1` as canonical vocabulary.** Atlas's Seedance and Wan schemas use `-1` for "the
    model picks the length"; the canonical `duration` is a positive number of seconds at every
    provider, and a sentinel is not a duration. It is reached through
    `providerOptions.atlascloud.duration`, pinned by a golden, and still gated per model.

## 0.3.0

### Minor Changes

- 61ca88e: **New provider: fal.ai**, and three new unified categories that arrived with it.

  `unmodel/fal` covers **146 curated endpoints across nine verbs** — `image` (32),
  `imageEdit` (17), `video` (30), `lipsync` (10), `upscale` (10), `avatar` (8), `tts` (23),
  `stt` (6), `music` (10) — all bare ids, plus a unified adapter per category at
  `unmodel/fal/unified`, wire types at `unmodel/fal/types` and runtime tables at
  `unmodel/fal/values`.

  Three things about fal are unlike every other provider in this package:
  - **The model IS the route.** `POST https://queue.fal.run/{endpoint_id}` takes a flat JSON
    body with no model field in it, so the route selector is a pseudo-param named `endpoint`
    that is stripped in `finalize` and interpolated into the URL. It could not be `model`,
    because `model` is a genuine wire field on several fal endpoints (sync-lipsync v2, the
    Topaz and ESRGAN upscalers, Gemini TTS); codegen hard-errors on a top-level `model`
    property unless `data/fal/curation.json` allow-lists it. Unified refs are unaffected:
    `"fal/fal-ai/flux/dev"` splits on the FIRST slash, so unified callers still write `model:`.
  - **`.request.url` is the queue submit.** The response is an envelope (`request_id`, `status`,
    and the `response_url` / `status_url` / `cancel_url` to follow), not a file. `unmodel/fal`
    exports `falQueueUrl` / `falSyncUrl` / `falStatusUrl` / `falResultUrl` / `falCancelUrl` and
    documents the contract, including the two traps: fal's queue declares no failure state,
    and `metadata.model_url` is the sync host rather than the submit URL. Polling stays with
    your transport code.
  - **Auth is stated, never derived.** `Authorization: Key ${FAL_KEY}`. The `Key ` prefix is
    real and fal's own OpenAPI security scheme omits it, so no unmodel export builds this
    header for you.

  **Types generated from the provider's own published OpenAPI.** fal serves an OpenAPI 3.0.4
  document per endpoint through its documented Platform API, which makes it the first provider
  where "types from docs, never SDKs" has a machine-readable source. `scripts/codegen-fal.ts`
  emits `src/providers/fal/gen/` (wire interfaces, one `looseObject` union schema per category,
  the per-endpoint constraint IR, unified rows and catalog rows) from per-endpoint snapshots
  committed under `data/fal/openapi/`. The generator emits DATA and TYPES only: every check,
  message, estimate and doc comment is hand-written beside it, and no generated file is ever
  hand-edited. New commands: `codegen:fal`, `codegen:fal:refresh`, `codegen:fal:check`,
  `codegen:fal:audit`, plus a weekly refresh workflow. Curation, pricing and overlays stay
  hand-maintained in `data/fal/`, each row carrying a source URL, a date and a quote.

  **Three new unified categories**, each a full buildout rather than an arm bolted onto an
  existing one:
  - **`unmodel/lipsync`** (`lipsync`, `createLipsync`) — a clip in, an audio track in, a clip
    whose mouth matches the audio out. Five canonical words (`model`, `source`, `audio`,
    `seed`, `providerOptions`) and no geometry, because the output's shape is the input's.
  - **`unmodel/avatar`** (`avatar`, `createAvatar`) — the still-driven twin. The split from
    lipsync is by INPUT rather than by vendor, which is why `fal-ai/sync-lipsync/v3` and
    `fal-ai/sync-lipsync/v3/image-to-video` land in different categories. `image` is narrowed
    per model and types as `never` at the two routes whose performer is a catalogued id.
  - **`unmodel/upscale`** (`upscale`, `createUpscale`) — `factor` is the one cross-vendor
    word, and it has three answers per model: a range, a closed set, or absent. The only
    category with no fixed modality: seven of the ten routes take a still and three take a
    clip, so `source` is narrowed per model and the output modality is read off each
    endpoint's own response schema.

  Each ships the full set: vocabulary, kernel id and canonical keys, pack entry and package
  subpath, CLI id, `unmodel/values` entries, `unmodel/types` entries and test scaffolding.
  Existing packs gain fal too: `image()` now spans 17 providers, `tts()` 19, `video()` 13,
  `stt()` 13, `image-edit()` 5 and `music()` 5.

  **Repo rules that landed with the generated data**, and are enforced by
  `test/import-graph.test.ts`:
  - `src/providers/*/gen/**` is DATA: wire modules are type-only, only the schema module may
    import zod, and no generated module may reach the pipeline, request layer, validators or
    catalog.
  - A `<category>-params.ts` leaf may import `./gen/<category>-params.gen.ts` and nothing else
    under `gen/`, which is what keeps zod from ending up behind a values entry.
  - `src/providers/fal/gen/**` is importable only from `src/providers/fal/**`, and the merged
    `models.ts` catalog only from `index.ts` — asserted explicitly, because the same-directory
    rule cannot catch a sibling import.
  - The SPLIT provider set (providers whose adapters are one file per category) is now
    **derived from disk** rather than listed, so a newly split provider cannot silently skip
    its per-category budgets.
  - Every pack now carries a `.d.ts` declaration budget alongside its bundle budget.

  **Not yet:** `.toApi("fal")`. Retargeting a first-party media request onto fal's queue needs
  a media retarget layer that does not exist today (chat only), and `EndpointAuth.scheme` has
  no `"Key"` arm.

- c9e02dd: **Media retargeting: `.toApi("fal")` on validated native image, video and speech requests.**

  `.toApi(provider)` has been chat-only since it shipped, and the reason given was that media has
  no shared wire dialect to translate through and no availability data to derive a target union
  from. Both halves are still true. What changed is the conclusion: the overlap is a hand table
  per family and the crossing is a hand mapping per family, checked at compile time against fal's
  own generated wire types.

  ```ts
  import { video } from "unmodel/kling";

  const request = video({
    model_name: "kling-v2-5-turbo",
    prompt: "A slow push-in through a rainy neon alley",
    mode: "pro",
    duration: "10",
  });

  const onFal = request.toApi("fal");
  onFal.request.url; // https://queue.fal.run/fal-ai/kling-video/v2.5-turbo/pro/text-to-video
  onFal.warnings; // []  ← empty means the mapping was exact
  onFal.toSdk("fal"); // { input: { … } }, the shape @fal-ai/client takes
  ```

  Six provider families across three categories, transcribed from fal's endpoint pages on
  2026-08-25 and drift-guarded against fal's curated roster:

  | source                                    | models                                                                       |
  | ----------------------------------------- | ---------------------------------------------------------------------------- |
  | `kling.video` / `kling.videoFromImage`    | `kling-v3`, `kling-v2-6`, `kling-v2-5-turbo`                                 |
  | `pixverse.video`                          | `v6`                                                                         |
  | `lightricks.video`                        | `ltx-2-5-pro`                                                                |
  | `elevenlabs.tts`                          | `eleven_v3`, `eleven_multilingual_v2`, `eleven_turbo_v2_5`                   |
  | `minimax.tts`                             | `speech-2.8-hd`, `speech-2.8-turbo`, `speech-02-hd`                          |
  | `black-forest-labs.image` / `.imageFlux1` | `flux-2-pro`, `flux-2-max`, `flux-pro-1.1`, `flux-pro-1.1-ultra`, `flux-dev` |

  **The loss policy, stated normatively.** A parameter fal cannot express is an **error** naming
  the parameter, the fal endpoint and the reason — never a silent drop, because a dropped
  `camera_control` produces a different video rather than a lossier one. A value fal expresses
  approximately is exactly one `approximated_param` warning carrying `requested` and `achieved`.
  So `warnings.length === 0` _means_ the mapping was exact, and the goldens assert it.

  **`.toApi` exists only where a mapping does.** Where chat degrades an unrecognised model to the
  full target union — its catalog is a models.dev snapshot that lags a release by days — the
  media tables are hand-written, so "unmapped" and "unknown" are the same thing:
  `kling.video({ model_name: "kling-v1", … }).toApi` is a compile error naming a member that is
  not on the type. Every model outside the tables carries a recorded reason rather than a bare
  "unknown model", including the ones refused on purpose: Recraft as a whole family (fal's rows
  drop `num_images`, `seed` and `negative_prompt` and speak a style vocabulary Recraft retired),
  `mode: "std"` on Kling 2.5-turbo and 2.6 (fal serves the pro tier only, and promoting a tier
  changes the resolution and the price), `safety_tolerance: 0` at Black Forest Labs (fal's enum
  starts at `"1"`, and 0 is the _strictest_ native setting — promoting it would loosen
  moderation), and zero-retention, webhooks and account-scoped ids everywhere.

  **`EndpointAuth.scheme` gains `"Key"`**, because retargeting invalidates the auth header the
  caller already wrote: Kling takes `authorization: Bearer <key>`, fal takes
  `authorization: Key <FAL_KEY>` — the literal word `Key`, which fal's own OpenAPI security
  scheme omits. Stated, never derived.

  **The media packs are byte-identical.** `unmodel/video`, `unmodel/tts`, `unmodel/image` and the
  other nine reach these providers through their `unified-<category>.ts` adapter leaves, whose
  results carry no `.toApi` at all — so the seam is applied in `src/providers/<p>/index.ts`, the
  one module only `unmodel/<p>` imports, rather than in the endpoint module's `finalize` where
  chat wires its own. `test/bundle-budget.test.ts` asserts both directions.

  New type exports from the root entry: `MediaApiMember`, `MediaApiTargetId`, `MediaOverlapTable`,
  `MediaRetargeted`, `MediaMapContext`, `MediaOverlapRow`, `MediaRetargetSpec`,
  `MediaTargetEndpoint` and `EndpointAuth`. Each family's overlap and refusal tables are exported
  from its own provider entry (`KLING_VIDEO_FAL_OVERLAP`, `ELEVENLABS_TTS_FAL_REFUSALS`, …) so a
  caller can ask what is mappable before calling.

- 61ca88e: **Native provider wave: leaderboard-gap coverage across TTS, image, video and music.**

  An audit of the current TTS / image / video / music leaderboards against the native catalogs,
  then coverage for every gap a public developer API can reach.

  Two new providers:
  - **`unmodel/breezeblue`** — Breeze TTS 2 (`breezeblue.tts`), with a unified adapter, wire
    types and values entry.
  - **`unmodel/mureka`** — song and instrumental generation (`mureka.music`,
    `mureka.instrumental`) on the async create-then-poll shape, mureka-7.6 through 9.5, with a
    unified `music` adapter.

  New endpoints on providers that were already here:
  - **stepfun** — StepAudio 2.5 TTS (`stepfun.tts`, `/v1/audio/speech`), a hand catalog
    mirroring the generated chat rows.
  - **alibaba** — Qwen3-TTS on DashScope (`alibaba.tts`, unary HTTP; the realtime-WebSocket-only
    ids ship as catalog rows the unary validator rejects by name) and DashScope video synthesis
    (`alibaba.video`: Wan 3.0/2.7/2.6/2.5/2.2/2.1 plus HappyHorse 1.0/1.1, async
    create-then-poll). Chat moves to a dedicated leaf so `unmodel/chat` stops paying for the
    provider barrel.
  - **xai** — Grok Imagine image (`xai.image`, `/v1/images/generations`) and video
    (`xai.video`, `xai.videoEdit`, `xai.videoExtend`), with the same chat-leaf split.
  - **google** — Lyria 3 Pro / Clip music over the Gemini Interactions API (`google.music`),
    with a hand-mirrored catalog so `unmodel/music` stays free of the generated catalog.
  - **azure** — the Microsoft Foundry MAI-Image-2.5 family (`/mai/v1/images/generations` plus
    multipart edits) under the deployment-name doctrine: wire validators only, no unified refs,
    the same rule azure chat already follows.

  Catalog refreshes: cartesia (`sonic-preview` identified as the Sonic 3.6 beta, dated legacy
  snapshots and sunset dates), elevenlabs (`eleven_v3_conversational` plus legacy v1 rows),
  speechify (the simba retirement schedule).

  Also recorded, so the gaps stay explained rather than looking like oversights: Suno, VUI Labs,
  MAGI-2 and MiniMax Music are not addable (no public developer API, or closed to new users).

- f7f9bcd: **Two native providers — `unmodel/sync` and `unmodel/topaz` — and with them, second witnesses
  for `unmodel/lipsync`, `unmodel/avatar` and `unmodel/upscale`.**

  Those three categories shipped on fal alone, which was always the thing to fix rather than a
  property of them. A vocabulary read off one provider is that provider's request schema with the
  field names changed, and here the risk was sharper than usual: four of fal's ten lipsync
  endpoints ARE sync.'s models resold, so the words were being checked against the same vendor
  twice. Now they are checked against the vendor's own API, and against a second vendor in
  `upscale`, and the disagreements are exactly where a second witness earns its keep.

  ```ts
  import { lipsync } from "unmodel/lipsync";

  JSON.stringify(
    lipsync({
      model: "sync/lipsync-2",
      source: { url: clip },
      audio: { url: vo },
    }),
  );
  // → {"model":"lipsync-2","input":[{"type":"video","url":"…"},{"type":"audio","url":"…"}]}
  //   POST https://api.sync.so/v2/generate

  JSON.stringify(
    lipsync({
      model: "fal/fal-ai/sync-lipsync/v2",
      source: { url: clip },
      audio: { url: vo },
    }),
  );
  // → {"video_url":"…","audio_url":"…"}
  //   POST https://queue.fal.run/fal-ai/sync-lipsync/v2
  ```

  Same weights, two bodies. The array is what carries `refId`s, `segments` and dubbing, none of
  which fal's flattening can express; the flat pair is what accepts inline bytes, which sync.'s
  fetch-only fields do not. **Neither is a superset**, and that comparison is pinned in the golden
  tree rather than described.

  ## `unmodel/sync` — sync.'s own lipsync API

  `https://api.sync.so/v2`, JSON bodies, `x-api-key: <SYNC_API_KEY>`. Two addresses on ONE url
  (`POST /v2/generate`): `sync.lipsync` takes a source CLIP, `sync.avatar` takes a STILL. They are
  separate addresses because the required fields differ — a still narrows `model` to `sync-3` and
  can carry neither `segments` (no timeline to slice) nor `dubParams` (no track to extract).

  Five models: `sync-3` (the default; 4K native; the only one that reads an image), `lipsync-2`,
  `lipsync-2-pro`, the legacy `lipsync-1.9.0-beta`, and `react-1`, whose `options.prompt` is a
  six-word emotion enum rather than a sentence. Per-second output rates are on every catalog row.

  The provider id is `sync` rather than `sync-so` because unmodel's provider ids are vendor names
  and not domains — `kling`, not `klingai.com` — and sync.'s own SDKs import as `sync` and read
  `SYNC_API_KEY`.

  Six documented rules are checked here rather than at the API, each of them a 4xx or a silent
  no-op otherwise: `input` is an ARRAY with an arity rule (exactly one visual, one voice), each
  media item needs a `url` OR an `assetId` (the spec encodes that as an `anyOf`, so both fields
  are individually optional and `{ type: "video" }` type-checks), an image input narrows the model
  to `sync-3`, four of the six `options` are model-gated, `dubParams` forbids the voice input the
  request would otherwise need, and `segments` links its tracks by `refId`.

  The model gate is a **warning** and not an error, deliberately: sync. ignores an option a model
  does not take rather than refusing it, so `temperature: 0.9` at `sync-3` is a successful,
  identically-billed generation in which the dial did nothing. Refusing it would reject a request
  the API fulfils; staying silent would let a caller believe the dial worked.

  Deliberately not served: `POST /v2/tts` and the `/v2/voices` clone surface (an ElevenLabs
  passthrough — unmodel carries ElevenLabs natively, with the real voice roster rather than a
  two-field projection of it), and `/v2/assets`, `/v2/projects`, `/v2/batch` (storage,
  organisation and an envelope around the body this provider already validates).

  Subpaths: `unmodel/sync`, `/unified`, `/types`, `/values`. `SYNC_ERROR_CODES` publishes all 62
  codes sync.'s unauthenticated `GET /v2/errors` catalogue serves, because branching on the code
  rather than the message is what its docs ask for.

  ## `unmodel/topaz` — Topaz Labs' image API

  `https://api.topazlabs.com/image/v1`, **multipart form** bodies, `X-API-Key: <TOPAZ_API_KEY>`.
  Two addresses, because Topaz publishes two real URLs with disjoint model enums and different
  dials: `topaz.upscale` (`POST /enhance/async`, the six classic Gigapixel models) and
  `topaz.upscaleGenerative` (`POST /enhance-gen/async`, the nine generative Wonder and Bloom
  ones). `unmodel/upscale` hides the fork — its adapter picks the URL from the ref.

  Neither path declares a JSON arm, so even a request whose only input is `source_url` is
  form-encoded: results carry `request.body === "form"` and **empty headers** (`fetch` derives the
  multipart boundary), and the body goes out through `topaz.toFormData(params)`.

  The model ids are Topaz's own product names, spaces and all — `"topaz/Standard V2"`,
  `"topaz/Upscale High Fidelity V3"`, `"topaz/Bloom Realism"`. Slugging them would invent a
  vocabulary and then need a table to undo it.

  **The reason this provider is hand-written**: every request schema in Topaz's published OpenAPI
  document ends `additionalProperties: { type: string }`, so the machine-readable half knows the
  envelope and nothing at all about `creativity`, `texture`, `faceEnhancement`, `denoise`,
  `strength` or `prompt` — the dials that decide what the output looks like. Those are documented
  only in prose, per model, and Topaz **ignores** a dial a model does not read. A wrong setting is
  therefore a silent no-op at the API, billed identically. `TOPAZ_SETTINGS_BY_MODEL` is that prose
  transcribed, and it turns the no-op into a warning that names the models which do read it.

  Topaz brings the category two things fal's resale of three of its endpoints cannot. The first is
  `prompt`: nine of its fifteen models steer on one, which turns a word with one real witness into
  a word with two. The second is a `factor` that is `never`:

  ```ts
  upscale({ model: "fal/fal-ai/recraft/upscale/crisp", source, factor: 2 }); // no multiplier: it chooses
  upscale({ model: "topaz/Standard V2", source, factor: 2 }); // no multiplier: you state a size
  ```

  Two ways to have no multiplier, two different messages, and it took a second provider for the
  empty `factors` list to stop looking like a special case.

  Cost is exact here, which is rare for a media provider: Topaz bills per output megapixel
  (`credits = ceil(outputMP / mpPerCredit)`, at 24 MP/credit for Gigapixel, 4 for Wonder, 2 for
  Bloom, $0.12 a credit), and the request states the output size. A request that lets Topaz choose
  the size estimates `undefined` rather than guessing.

  Deliberately not served: the rest of the Image API — `/denoise`, `/sharpen`, `/sharpen-gen`,
  `/restore-gen`, `/lighting`, `/matting` — which are separate routes that clean, sharpen, relight
  or cut out a picture at the size it arrived rather than upscaling it. And the **Video API**,
  which is not a request but a five-step protocol (quote → accept → S3 multipart upload →
  complete-upload → poll) in which only the first step has a body, whose body needs facts about
  the file unmodel has no words for (`container`, `duration`, `frameCount`, `frameRate`,
  `resolution`), and whose model ids are opaque codes (`prob-4`, `iris-3`, `thd-3`) with no
  published mapping to the product names. `unmodel/upscale` reaches Topaz video through fal, which
  is the sort of gap an aggregator is for.

  Subpaths: `unmodel/topaz`, `/unified`, `/types`, `/values`.

  ## What else moved
  - `unmodel validate` gains `sync.lipsync`, `sync.avatar`, `topaz.upscale` and
    `topaz.upscaleGenerative`.
  - `.toSdk("sync")` and `.toSdk("topaz")` return the same body; sync.'s is exactly what
    `@sync.so/sdk`'s `generations.create` takes, and Topaz ships no JavaScript SDK.
  - `unmodel/lipsync`, `unmodel/avatar` and `unmodel/upscale` each reach two providers now. Their
    ready-made packs grew accordingly (measured 318.0, 312.5 and 337.0 KiB), and the composition
    tests gained the assertion a native provider makes possible: sync. serves both audio-driven
    categories from one url through two adapter leaves, so a lipsync bundle containing
    `sync/unified-avatar.ts` would be a leak with no filename tell.
  - No canonical word was promoted. `sync_mode` remains a per-model extra at both providers,
    because sync. agreeing with itself through a reseller is one witness rather than two — and
    the two spell it at different depths (`sync_mode` at fal's body root, `options.sync_mode`
    natively), which is a difference the extras mechanism can carry and a vocabulary could not.

- 62417e9: **Two more native providers — `unmodel/veed` and `unmodel/heygen` — which take `unmodel/lipsync`
  and `unmodel/avatar` from two providers to four, and finally make the category's oldest open
  vocabulary question answerable.**

  Four of fal's ten lipsync endpoints are sync.'s models resold; two more are VEED's and two more
  are HeyGen's. Those three vendors are now here at their own APIs, which means the words in
  `LipsyncParams` and `AvatarParams` are checked against four independent request schemas rather
  than against one aggregator's flattening of them.

  ```ts
  import { lipsync } from "unmodel/lipsync";

  JSON.stringify(
    lipsync({
      model: "veed/lipsync-2.0",
      source: { url: clip },
      audio: { url: vo },
    }),
  );
  // → {"video_url":"…","audio_url":"…"}
  //   POST https://api.veed.io/v1/lipsync-2.0

  JSON.stringify(
    lipsync({
      model: "heygen/lipsync-precision",
      source: { url: clip },
      audio: { url: vo },
    }),
  );
  // → {"video":{"type":"url","url":"…"},"audio":{"type":"url","url":"…"},"mode":"precision"}
  //   POST https://api.heygen.com/v3/lipsyncs
  ```

  ## The promotion rule ran, and the answer was no

  `unmodel/lipsync` has never had a canonical word for "what happens when the track and the clip
  are different lengths", and the rule for adding one is two INDEPENDENT vendors spelling it
  compatibly. With four providers that is finally testable:

  | vendor                               | field                             | value space                 |
  | ------------------------------------ | --------------------------------- | --------------------------- |
  | sync. (natively, and resold at fal)  | `sync_mode` / `options.sync_mode` | 5-arm enum                  |
  | LatentSync (at fal)                  | `loop_mode`                       | 2-arm enum                  |
  | HeyGen (natively, and resold at fal) | `enable_dynamic_duration`         | boolean, default `true`     |
  | VEED                                 | —                                 | the route has no such field |

  Five rows, three vendors — a vendor agreeing with itself through a reseller is one witness.
  Three shapes and one outright absence is not a vocabulary: a canonical `durationMismatch` would
  have to pick a value space, and a boolean and a five-strategy enum have none in common. So it
  stays a per-model extra everywhere, and `test/unified/lipsync-capabilities.test.ts` now holds
  that as an assertion which FAILS the day two of them agree.

  ## `unmodel/veed` — the smallest request surface in the library

  `https://api.veed.io/v1`, JSON, `Authorization: Bearer vp_…` (`VEED_API_KEY`). Two URLs with
  disjoint schemas: `veed.lipsync` posts `{ video_url, audio_url }` to `/v1/lipsync-2.0`, and
  `veed.avatar` posts `{ image_url, audio_url, resolution }` to `/v1/fabric-1.0`. Everything is
  typed from one publicly fetchable OpenAPI 3.1.0 document; VEED ships no SDK, so there was no
  tiebreak to run.

  Three facts from that document decide the provider. Every request schema is
  `additionalProperties: false`, so an undeclared key is a **422 with no job created** rather than
  a field VEED ignores — the opposite of sync. and Topaz, and the reason the unknown-param check
  here reports an error where theirs report warnings. Every media field carries the pattern
  `^[Hh][Tt][Tt][Pp][Ss]?://` and an 8192-character ceiling, and VEED publishes **no upload arm of
  any kind** — no multipart, no base64, no asset ids — so a `data:` URI, an `s3://` reference and
  a bare path are three 422s that look like URLs. And `resolution` on `fabric-1.0` is `required`
  with **no default**, which makes `{ image_url, audio_url }` a 422 and makes this the one route
  in either category that needs a word the vocabulary has not got. It rides as a per-model extra,
  and the refusal quotes both rates rather than choosing: 480p is $0.08 per second of output and
  720p is $0.15, so a default unmodel invented would be a line item.

  Pricing is in the spec — each submit operation carries an `x-veed-pricing` extension with
  currency, unit, rounding and rates that may be conditioned on a request field — so the rates
  change in the same diff as a schema change. Where the published numbers disagree, veed.io/api
  says Fabric is $0.08–$0.20/sec and the model page, the tools page and the machine-readable
  extension all say $0.08–$0.15; the outlier is not followed.

  VEED's lipsync row declares **no extras at all**, and that emptiness is the evidence behind the
  promotion decision above. Its avatar row is the OPPOSITE of the same vendor's row at fal:
  `fal/veed/avatars/audio-to-video` is a presenter library with `sources: []`, and VEED's own API
  has no presenter roster (`POST /v1/avatars` answers a real JSON 404), so `veed/fabric-1.0` is
  `sources: ["image"]`. Same vendor, two products, opposite rows.

  Not served: the `video-background-removal` family — three variants and six of VEED's ten
  operations. A real, priced, documented product that matches no category unmodel has, and a
  one-provider `matting` category read off a single witness is what this library declines to
  build.

  ⚠️ VEED's docs, schemas and playground are fully public, but keys are not self-serve: every page
  links to contact-sales. The types are as exact as any in the library and were never exercised
  against a live key.

  ## `unmodel/heygen` — the one with two specs and a moved doc host

  `https://api.heygen.com/v3`, JSON, `x-api-key: <HEYGEN_API_KEY>`. `heygen.avatar` is
  `POST /v3/videos` and `heygen.lipsync` is `POST /v3/lipsyncs` — two URLs with two response
  shapes and **two different status enums** (`processing` on the video route, `running` on the
  lipsync one; a shared polling `switch` over them falls through).

  Two traps this provider exists to have already walked into. HeyGen serves **two** OpenAPI
  documents and both answer 200: `developers.heygen.com/openapi.yaml` is a v4.0.8 document with 52
  v1/v2 paths and no `/v3/videos` at all, and `openapi/external-api.json` is the current one (98
  paths, 300 schemas). And `docs.heygen.com` is gone — it 301s to `developers.heygen.com`, where
  the old canonical slugs 404. Every URL cited here was re-resolved by fetching it.

  **Neither route has a `model` field, and both defaults are prices.** The video route has an
  `engine` discriminated union — `avatar_iii`, `avatar_iv` (applied when `engine` is omitted),
  `avatar_v` — and those three are the catalog rows, because they are three products with three
  pages and a four-fold price spread. The lipsync route has `mode: "speed" | "precision"` (default
  `"speed"`), catalogued as `lipsync-speed` and `lipsync-precision` after HeyGen's own doc slugs.
  Both adapters write the wire value out on every call: a ref that names a price should not depend
  on a server-side default to get it.

  Seven cross-field rules are checked, every one of them prose in the spec on fields that are all
  individually optional: `type` decides which visual source is required and which is refused (both
  arms are `additionalProperties: false`, and HeyGen's own documented example error is that
  mistake); Avatar III does not render raw image input; `expressiveness` is Avatar IV only and
  `motion_prompt` is not Avatar III, both REJECTED rather than ignored; `script` and the audio
  fields are mutually exclusive; `voice_id` is required with a script unless `avatar_id` supplies
  a default voice; `voice_settings` is silently ignored beside uploaded audio (a warning, because
  it is a no-op); and `output_format: "webm"` rejects any `background`.

  HeyGen brings the category a third answer to inline bytes. fal builds a `data:` URI for a field
  that fetches URLs; sync. and VEED refuse bytes because their fields only fetch; HeyGen has a
  real `{ type: "base64", media_type, data }` arm on its own `oneOf`, so the bytes go in
  structurally — and its `audio_url` does not have that arm, so one request accepts bytes for the
  still and refuses them for the track.

  Pricing is public USD. Two of the five rows carry a band, because HeyGen's table is keyed by
  engine × avatar type and the avatar type lives on the look rather than in the request: Avatar
  III $0.0167–$0.0433/sec, Avatar IV $0.05–$0.0667, Avatar V $0.0667 exactly, lipsync speed
  $0.0333 and precision $0.0667 exactly. Rows carry the top of each band. Nothing estimates: every
  rate is per second of output and the output's length follows the audio's.

  **`heygen.tts` is a deliberate exclusion.** `POST /v3/voices/speech` publishes no model id at all
  (the engine is fixed to Starfish and stated only in prose), `voice_id` is an account-scoped
  handle with no published roster, `input_type` is a bare `string`, and there is no format, sample
  rate, codec or bitrate control — which is most of what `unmodel/tts`'s vocabulary is. A row that
  narrows nothing would widen the tts matrix while telling a caller less than every other row in
  it. Also excluded with reasons: `type: "cinematic_avatar"` (a prompt-to-video model wearing an
  avatar route's URL — no audio input, a `prompt` and an array of look ids), `type: "studio"` (a
  fifty-scene timeline document), video translation, background removal, HyperFrames, AI clipping,
  filler-word removal, and the whole platform surface.

  **Argil and Tencent's native Hunyuan3D** were researched in the same rounds and are recorded as
  declined in `docs/providers.md`: Argil publishes no aggregated OpenAPI document (the advertised
  one 404s; the schemas exist only as fences in 23 `.md` pages) and no USD pricing at all, and
  Hunyuan3D's native API is a Tencent Cloud product whose auth is TC3-HMAC-SHA256 request signing
  rather than a header key. Both vendors' models remain reachable through fal.

  ## New subpaths

  `unmodel/veed`, `unmodel/veed/unified`, `unmodel/veed/types`, `unmodel/veed/values`,
  `unmodel/heygen`, `unmodel/heygen/unified`, `unmodel/heygen/types`, `unmodel/heygen/values`.
  `unmodel/lipsync` and `unmodel/avatar` gain two providers each with no API change; pack budgets
  move 350 → 445 KiB (measured 395.2) and 345 → 445 KiB (measured 396.4), and the two stay within
  2% of each other, which is the assertion that has teeth.

- c22997c: **New unified category `unmodel/3d`, and the native `unmodel/tripo3d` provider that made it
  possible.**

  The first category in the library that did **not** ship on one provider, and that was the
  point. `unmodel/lipsync`, `unmodel/avatar` and `unmodel/upscale` all arrived with fal alone
  (they gain their second witnesses in the same release — see the sync./Topaz entry below);
  3D waited for a second, independent witness, because a vocabulary read off a single vendor is
  that vendor's request schema with the field names changed — and 3D is where that shows fastest.
  Two schemas in, `texture` already had five spellings (`texture`, `textured_mesh`,
  `enable_texture`, `should_texture`, `texture_mode`) and the output container had four more plus
  a boolean that changes it as a side effect. None of them is in the vocabulary.

  ```ts
  import { threeD } from "unmodel/3d";

  JSON.stringify(
    threeD({
      model: "tripo3d/v3.1-20260211",
      prompt: "a brass astrolabe",
      seed: 7,
    }),
  );
  // → {"model":"v3.1-20260211","prompt":"a brass astrolabe","model_seed":7}
  //   POST https://openapi.tripo3d.ai/v3/generation/text-to-model
  ```

  **Five canonical words**, and the first category whose two content words are ALTERNATIVES
  rather than companions: `model`, `prompt` XOR `image`, `seed`, `providerOptions`. One row field
  (`inputs`) moves both in opposite directions, with three populated arms — text-only routes type
  `image` as `never`, image-only routes do the reverse, and a route that publishes both (fal's
  Hyper3D Rodin, and every Tripo model) leaves both optional. No `size`, no `aspectRatio`, no
  `resolution`, no `n`: a mesh has no frame, and these routes return one object per request.

  **`unmodel/tripo3d`** — Tripo's own v3 API, `https://openapi.tripo3d.ai/v3`, flat JSON,
  `Authorization: Bearer <TRIPO_API_KEY>`. Two endpoints (`tripo3d.threeD` for
  `POST /v3/generation/text-to-model`, `tripo3d.threeDFromImage` for `…/image-to-model`) across
  four models — `v3.1-20260211`, `v3.0-20250812`, `v2.5-20250123` and the low-poly
  `P1-20260311`. Subpaths: `unmodel/tripo3d`, `/unified`, `/types`, `/values`.

  Three cross-field rules Tripo documents, each of them a 4xx otherwise, are compile-time or
  validation errors here: seven parameters are gated on the model version and `v2.5-20250123`
  takes none of them; `generate_parts: true` requires `texture`, `pbr` and `quad` all false, and
  the first two DEFAULT to true; and the polycount ceiling moves with the model, with Ultra mode
  and with `quad`. Its `input` is one polymorphic string — a `file_…` token, a public URL or a
  prior `task_…` id, never inline bytes — so a `{ data }` ref is refused naming `POST /v3/files`
  rather than compiled into a `data:` URI Tripo would reject.

  Tripo is also the rare media provider whose estimate is **exact**: the price is a pure function
  of the request body (a per-task credit base plus the add-ons the body switched on, at $0.01 a
  credit), with no duration to guess and no output pixel count to infer from a URL. P1 declines,
  because its credit table is rendered client-side only on Tripo's pricing page.

  **`fal.threeD`** — 19 curated endpoints from seven vendors, taking `unmodel/fal` to **165
  endpoints across ten verbs**. Tripo H3.1 and P1 (text and image), Tripo v2.5 image and
  multiview, Hunyuan3D 2.0 and turbo, Hunyuan 3D 3.1 Pro and Rapid, TRELLIS and TRELLIS 2,
  TripoSR, Hyper3D Rodin v2.5 and its text-only sibling, Meshy 7, Hi3D v3.0. The verb is `threeD`
  rather than `3d` for a mechanical reason: an endpoint id's second segment is a module export
  name and `3d` is not a JavaScript identifier. The category id, the package subpath
  (`unmodel/3d`) and the CLI's `unified.3d` all keep the digit.

  The two providers overlap on purpose. `tripo3d/h3.1/image-to-3d` at fal and
  `tripo3d/v3.1-20260211` natively are the same model reached two ways, and they compile to
  visibly different bodies — which is the comparison the category exists to make cheap:

  ```ts
  threeD({ model: "fal/tripo3d/h3.1/image-to-3d", image: { url } });
  // → {"image_url":"…"}                          POST https://queue.fal.run/tripo3d/h3.1/image-to-3d

  threeD({ model: "tripo3d/v3.1-20260211", image: { url } });
  // → {"model":"v3.1-20260211","input":"…"}      POST https://openapi.tripo3d.ai/v3/generation/image-to-model
  ```

  Also in this release:
  - `Modality` gains a `"3d"` member. A mesh is not a picture of one, and every route here also
    returns a preview render — filing the whole category under `"image"` would have made
    `modalities.output` lie about what the request bought.
  - `unmodel/fal` now exports a `provider` `ProviderInfo` (`{ id: "fal", name: "fal.ai",
env: ["FAL_KEY"] }`), which every other hand-catalogued provider already had.
  - `unmodel validate` gains `fal.threeD`, `tripo3d.threeD`, `tripo3d.threeDFromImage` and
    `unified.3d`.

## 0.2.0

### Minor Changes

- 62f3e01: **The speech response surface, said out loud — a false `empty_audio` fixed, a
  delivery descriptor on all fifteen TTS adapters, the auth header named where
  retargeting moves it, and `toRequestInit` so nobody retypes a fetch init
  again.**

  Every item here is the same shape of fix: the package already knew the thing
  and made you find it somewhere else. Six of them.

  ## `google.checkTts` no longer reports `empty_audio` on a `fileData` response

  A real bug, and the package's own validator is what proved it. `hasAudioPart`
  scanned `candidates[0].content.parts[].inlineData.mimeType` only — so a
  response to a request that set `responseFormat.audio.delivery: "URI"`, which
  `google.tts` validates and `GEMINI_AUDIO_DELIVERY_MODES` enumerates, came back
  as a `fileData` part carrying a `fileUri` and was reported as
  `invalid_shape` / `empty_audio` with the message telling you to retry. The
  checker now counts both deliveries, and the message names both
  (`"neither inlineData nor a fileData URI"`) so the remaining case still reads
  as the real one it is.

  ## `toRequestInit(result)` — the four fetch arguments, minus the key

  ```ts
  const { url, ...init } = toRequestInit(request);
  await fetch(url, { ...init, headers: { ...init.headers, authorization } });
  ```

  url, method, static headers and the JSON framing are all things the package
  knows and the caller currently retypes — and spreading a result to retype them
  silently drops `.request`, which is non-enumerable by design. Returns
  `FetchArgs` (`{ url, method, headers, body }`), with `headers` a copy so
  adding auth to it cannot reach the validator's own object. It never calls
  `fetch` and takes no credential.

  Two whole classes of endpoint cannot reach it, both at compile time: socket
  configs (`SocketMeta.method` is `"GET"`) and the multipart endpoints, whose
  `ValidatedForm` result type makes the call a type error naming the
  `toFormData` helper to use instead. `recraft.imageEdit`, the one endpoint
  whose framing is decided per call, is caught at runtime with the same message.

  Lives at `src/core/request-init.ts` — an import-free leaf reached only from
  the root entry — so `unmodel/groq`, which never builds a fetch call, pays zero
  bytes for it.

  ## `TargetEndpoint.auth` and `CHAT_AUTH` — the header retargeting invalidates

  `.toApi("openai")` moves a validated Anthropic request to a new host, and the
  `x-api-key` header the caller already wrote goes with it, unchanged and now
  wrong. The retarget endpoint table is the only place that knows both halves of
  that swap, so it now carries the second half:

  ```ts
  import { CHAT_AUTH } from "unmodel/chat";

  const { header, scheme } = CHAT_AUTH[provider];
  headers[header] = scheme === undefined ? key : `${scheme} ${key}`;
  ```

  Names only, never values — unmodel still never touches a key, the same way
  `ProviderInfo.env` already names the env var without reading it. `CHAT_AUTH`
  is a deliberate _mirror_ of the endpoint table's new `auth` column rather than
  a re-export of it: retaining any binding from `endpoints.ts` retains all 30
  chat/completions URLs, which would put 6.1 KiB behind a 3 KiB per-export
  budget on `unmodel/values`. Restating three frozen descriptors costs 0.3, and
  `test/chat/providers.test.ts` compares every row against the endpoint that
  provider actually resolves to, so the copy cannot drift. The four targets with
  a second way in (google's `?key=`, azure's Entra token, google-vertex's
  OAuth-only access token, bedrock's SigV4) are argued in the `EndpointAuth`
  docblock, which names the one form that always works and why.

  ## `TtsDelivery` — where the audio is, on all fifteen adapters

  A TTS response puts the audio in one of five places and a boolean would lie
  about four of them, so `delivery` is a descriptor: `bytes`, `base64` (with the
  path), `hex` (MiniMax), `url` (there are no bytes in hand — naming that is the
  point) and `sse`. Three shapes, because the providers genuinely disagree about
  what decides it: flat, `byRequestField` (OpenAI's `stream_format`, Deepgram's
  `callback`, MiniMax's `output_format`, Gemini's `responseFormat.audio.delivery`,
  Murf's `encodeAsBase64`), and `byModel` (Murf again, where `gen2` and
  `falcon-2` are served by two different routes). A `byRequestField` variant
  whose value is a _string_ is a declared gap in the `unsupported` idiom: it
  says why that request carries no audio at all, which is how Deepgram's
  `callback` ack is spelled.

  Declared as a const on each provider's import-free `tts-params` leaf and
  re-exported as `TTS_DELIVERY` from `unmodel/<provider>/values`, so a picker
  can read it without pulling that provider's validator. unmodel validates
  requests, so this is a description and never a parser: no module in this
  library reads a response body off one.

  ## `GEMINI_TTS_VOICE_INFO` — the 30 voice descriptors

  Google publishes a one-word character note beside each preset voice ("Zephyr:
  Bright", "Kore: Firm"), and a picker that wants to label the option had to
  invent the word. Now it does not. Display data, never enforced: no check reads
  this table, `voiceName` is still typed from `GEMINI_TTS_VOICES`, and the value
  is an object rather than a bare string so a second published column can join
  without breaking callers. `as const satisfies` makes a 31st voice a build
  error until its descriptor is transcribed too.

  ## `docs/tts.md` — the integrator's matrix, split by provenance

  Fifteen providers' auth header, response delivery, response checker and wire
  quirks in one place, with the drift liability engineered out rather than
  accepted. URL, method and static headers are already properties of a compiled
  `.request`, so a hand-written table of them is a copy: those columns are
  generated by `scripts/gen-tts-matrix.ts` (`bun run gen:tts-matrix`) from real
  `tts()` calls, and `test/docs/tts-matrix.test.ts` re-runs those calls against
  the committed rows, asserts the row set equals the adapters `unmodel/tts`
  registers, and asserts the doc is byte-identical to a fresh regeneration. Auth
  has no API surface on purpose and stays prose; the delivery and checker
  columns cite the const and the export by name rather than restating them, and
  the test pins those citations by reference.

  Four module headers were wrong or silent about their own response side and are
  fixed: `openai/tts.ts` was the one TTS module that never named its auth
  scheme; `hume/tts.ts` and `speechify/tts.ts` both answer JSON and never said
  why they have no checker; and `murf/tts.ts` read as if Murf had none, when
  `/v1/speech/generate` has one and only `/v1/speech/stream` does not.

  ## README

  Executed, not asserted, as always. The two hand-rolled JSON fetch inits are
  now the `toRequestInit` idiom; the Values section states that `voices` exists
  only where a provider publishes a closed list (OpenAI and Google, of fifteen)
  and that `SPEECH_VOICES` / `GEMINI_TTS_VOICES` are `===` the row's array
  rather than a rival API; a new "Estimating cost" block documents
  `estimate.costUSD`, the `maxCostUSD` gate and the four public cost helpers
  (`resolveModelInfo`, `computeCharacterCostUSD`, `computeAudioMinutesCostUSD`,
  `computeCostUSD`) which had zero mentions; and the `getModel` example now says
  it reads the models.dev snapshot only, pointing media users at
  `import { models } from "unmodel/<provider>"` instead of an `undefined` they
  would reasonably read as missing data.

## 0.1.1

### Patch Changes

- Correct the repository, homepage and bugs URLs — the project lives under the
  `cluely` organization on GitHub, not a personal account.

## 0.1.0

### Minor Changes

- 82884c9: **`unmodel/chat` now composes the real provider validators, and there is a
  narrow entry for applications that only call two of them.**

  A unified chat call used to be checked against a slim per-model profile table
  that lived beside the provider validators and could disagree with them. It no
  longer is. `chat()` validates the canonical shape, compiles it to the target
  dialect once, and hands the body to **that provider's own `chat()`** — the same
  function `unmodel/anthropic` exports, with its schema, its catalog, its
  hand-written constraint tables, its capability and media checks and its cost
  estimate. There is one definition of a valid request per provider, and unified
  chat is not a second one.

  **What you get back is that provider's result.** Enumerable properties are its
  exact wire body and `.request` is its URL, as before — but now `.toSdk(target)`
  _and_ `.toApi(target)` are the provider's own, typed off its generated
  availability table. `chat({ model: "anthropic/claude-opus-5", … })
.toApi("openrouter")` retargets a request you authored canonically, and
  `.toApi("groq")` on the same request is a compile error because the catalog
  says Groq does not serve that model. (This corrects the "no `.toApi()` on a
  unified result" note in the `unified-surfaces` changeset, which is now a
  statement about the six media packs only.)

  Issue paths still come back in the vocabulary you wrote: a finding the provider
  reports at `["max_completion_tokens"]` is returned at `["maxOutputTokens"]` —
  and the _message_ now says which wire param it was compiled from, so a
  canonical path never arrives attached to a sentence about a param that does not
  exist in the API you are using. A wire param with no canonical name keeps its
  wire spelling and gains ``(supplied via `providerOptions`)``.

  **New export: `unmodel/chat/factory`.**

  ```ts
  import { createChat } from "unmodel/chat/factory";
  import { chat as anthropic } from "unmodel/anthropic";
  import { chat as openai } from "unmodel/openai";

  const chat = createChat({ anthropic, openai });
  ```

  Same compiler, same vocabulary, byte-identical requests — from only the
  validators you register. The registry key and the validator under it are one
  claim: every chat validator is structurally identical and providers share model
  ids, so `createChat({ groq: togetherai })` would otherwise compile and quietly
  post to the wrong host. It is a compile error, and a `TypeError` at
  construction for a hand-written validator that carries no provider claim.
  A ref naming a provider you did not register has no usable result type either —
  the call can only throw, so the type says so instead of offering `.request`.

  `createChat` is **not** re-exported from `unmodel/chat`. It would be the same
  function at eleven times the weight: `chat` is a top-level call that anchors the
  whole registry, and no bundler removes it. The type re-exports are free and stay.

  **Removed: `ChatOptions.catalog`.** A catalog layered beside a concrete provider
  validator is a second authority that can disagree with the first — exactly the
  thing this change removes everywhere else. Configure the validator instead and
  register it:

  ```ts
  const chat = createChat({
    openai: createOpenAICompatible<string, never, "openai">({
      id: "openai",
      baseUrl: "…",
      catalog: myCatalog,
    }).chat,
  });
  ```

  **Also removed:** `chatConstraintsFor` and `CHAT_CONSTRAINT_ENDPOINTS` from
  `unmodel/chat`. They exposed the chat-side copy of the deny/enum tables, which
  no longer exists; each provider's validator applies its own.

  **New issue code: `media_declaration_dropped`** (warning). Only a compiling
  surface can produce it: a `ValidateOptions.media` declaration whose part did not
  survive compilation is reported and dropped, rather than forwarded at a path
  that now addresses a different attachment.

  **Deeper checks, everywhere — not just here.** Pushing validation down to the
  substrate made several of them wider than they were, on the provider subpaths
  as well as on `unmodel/chat`:
  - `reasoning_effort` on a model the catalog marks `reasoning: false` is now an
    `unsupported_capability` error in the shared chat-completions battery, so
    OpenAI _and_ all 30 OpenAI-compatible providers refuse a request their APIs 400. It surfaces as `["reasoning"]` through `unmodel/chat`.
  - `structuredOutput` is tri-state everywhere now: absent means "the catalog has
    no answer" and never fails a request. `google.chat` and `google-vertex.chat`
    used to read absent as `false`.
  - Estimate findings carry a path: `over_context` / `near_context` point at the
    prompt-bearing param, `over_budget` at `["model"]`.
  - A `tools` refusal names the tools that were supplied again.

  **Bundle.** `unmodel/chat` measures **1718.7 KiB** (budget 1800) — 32 validators,
  their catalogs and 11 availability tables. About 379 KiB of that is the
  `chatProfiles` discovery snapshot, which is public API and no longer read by any
  validation path; it is kept for discovery and priced honestly here rather than
  quietly. `unmodel/chat/factory` measures **144.0 KiB** (budget 150) and contains
  no provider module beyond the three dialect codecs, asserted rather than
  described. `dist/chat/index.d.ts` is 455 KiB, down from 892, and now has a
  budget of its own — a declaration regression is invisible to every other gate.

- 196d9be: Media endpoint wave: image editing, TTS/STT, and video post-production validators.

  New request validators (all on existing subpaths — no new package exports):
  - `unmodel/openai`: `imageEdit` (+ `imageEditToFormData`), `tts` (TTS),
    `stt` (+ `sttToFormData`).
  - `unmodel/google`: `image` (Imagen 4 fast/standard/ultra).
  - `unmodel/black-forest-labs`: `imageFlux1`, `imageEditFill`, `imageEditExpand`, and the
    FLUX Tools routes `imageEditOutpainting`, `imageEditErase`, `imageEditDeblur`,
    `imageEditVto`.
  - `unmodel/ideogram`: `imageV4`, `imageEdit`, `imageEditRemix`, `imageEditReframe`,
    `imageEditReplaceBackground`.
  - `unmodel/recraft`: `imageEdit`, `imageEditInpaint`, `imageEditOutpaint`,
    `imageEditGenerateBackground`, `imageEditReplaceBackground`.
  - `unmodel/stability`: `imageEditErase`, `imageEditInpaint`, `imageEditOutpaint`,
    `imageEditSearchAndReplace`, `imageEditSearchAndRecolor`,
    `imageEditRemoveBackground`.
  - `unmodel/luma`: `videoModify`, `videoReframe`, `imageEditReframe`, `videoUpscale`,
    `videoAddAudio`.
  - `unmodel/runway`: `videoFromVideo`.

  Types across every audited endpoint were re-derived from the providers' current
  documentation rather than their SDKs — narrowed where the SDK permits what the API
  rejects, widened where the SDK enum is a subset of the documented range (e.g.
  `gpt-image-2` now accepts free-form `WIDTHxHEIGHT` sizes and rejects only
  `background: "transparent"`). Every deviation carries its doc URL.

  The `unmodel validate` CLI registry now covers all 77 JSON-bodied endpoints and
  reports multipart-upload endpoints as library-only instead of failing on a type error.

- 196d9be: Realtime session configs for the TTS/STT providers — the documented JSON config object
  of each socket surface, never the socket lifecycle.

  New request validators (all on existing subpaths — no new package exports):
  - `unmodel/cartesia`: `ttsWebsocket` (+ `ttsWebsocketUrl`), `sttWebsocket`
    (+ `sttWebsocketUrl`, `sttWebsocketConstraints`).
  - `unmodel/deepgram`: `listenLive`, `listenFlux` + its mid-stream `fluxConfigure`
    message, `speakLive` (+ `listenLiveUrl`, `listenFluxUrl`, `speakLiveUrl`).
  - `unmodel/elevenlabs`: `textToSpeechStreamInput` (+ `textToSpeechStreamInputUrl`,
    `toInitializeConnectionMessage`), `speechToTextRealtime`
    (+ `speechToTextRealtimeUrl`).
  - `unmodel/inworld`: `stt` (sync STT — base64 audio inline in the JSON body),
    `realtimeTranscribeConfig` and `realtimeVoiceContext` (the first frame of each
    bidirectional socket).
  - `unmodel/soniox`: `realtimeTranscription` (the configuration message sent right
    after connecting).

  These follow the `openai.realtimeSession` pattern: unmodel validates the config
  object — a connection-URL query set, a first configuration frame, or a per-chunk
  generation message — with the same catalog awareness, documented bounds and
  per-model gates as any REST endpoint. Opening the connection, framing audio,
  keepalives and every server event stay out of scope, as each module's header states
  next to the doc URL it was verified against.

  Where the socket address follows from the config, `.request` describes the socket
  (`wss://` url, method `"GET"` — a handshake is an HTTP GET upgrade); the surfaces
  whose address must be assembled from the params export a URL builder instead.

  `unmodel validate` now covers these too and labels them `transport: websocket`
  rather than mistaking a header-less socket config for a multipart body.

- 196d9be: **Breaking:** `.toSdk()` now takes a target, and chat validators gain `.toApi(provider)`.

  `.toSdk()` no longer exists in its zero-argument form. Every endpoint declares the
  SDK shapes it can honestly produce and you name one:

  ```diff
  - const completion = await openai.chat.completions.create(validated.toSdk());
  + const completion = await openai.chat.completions.create(validated.toSdk("openai"));
  ```

  Targets are catalog provider ids (`"openai"`, `"anthropic"`, `"google"`,
  `"amazon-bedrock"`, `"cohere"`, …) plus one reserved non-catalog id, `"ai-sdk"`, for the
  Vercel AI SDK. An unknown target is a compile error, not a wrongly-shaped object.

  New in this release:
  - **`.toApi(provider)` on chat validators** — retargets a validated request to another
    provider that serves the same model, translating the wire format across dialects and
    respelling the model id. The target union is typed per model from generated per-provider
    availability tables (`src/catalog/availability/<id>.gen.ts`), so
    `chat({ model: "claude-opus-5", … }).toApi("openai")` is a compile error rather than
    a 404. `.toApiSafe(provider)` is the non-throwing form. The endpoint factories
    (`amazon-bedrock`, `google-vertex`, `azure`) are excluded from the union for now — they
    need per-instance config a one-argument call cannot supply — and a two-argument overload
    is reserved as a non-breaking follow-up. Media endpoints have `.toSdk` but no `.toApi`.
  - **Translation warnings.** `.toApi` never throws on lossiness and never silently drops:
    every removal or approximation lands in the non-enumerable `.warnings` array.
    `id_respelled` is always present, so a translation whose only warning is `id_respelled`
    is lossless.
  - **`toSdk("ai-sdk")` on chat endpoints**, emitting the AI SDK's stable `generateText` /
    `streamText` option shape.
  - **New subpath `unmodel/ai-sdk`**, exporting `withJsonSchemaTools(options, jsonSchema)`.
    It takes `ai`'s `jsonSchema` helper as an argument, so unmodel gains no dependency and no
    peer dependency on `ai` and the adapter keeps working across `ai` versions.

  Also breaking for anyone calling it directly: `toValidated`'s argument order is now
  `(body, request, init)`.

- b681286: TTS and STT become first-class categories, and Gemini joins both.

  Two things happened, and the first is a **breaking rename** of every audio
  address in the library.

  ## 1. `speech` → `tts`, `transcribe` → `stt`

  The two audio modalities now carry the names the rest of the world uses for
  them, matching `chat` and `image` as first-class category objects. This is the
  address-vs-wire naming law applied to the category verb itself: the _addresses_
  move, the _wire_ names do not.

  **The two subpaths:**

  | old                  | new           |
  | -------------------- | ------------- |
  | `unmodel/speech`     | `unmodel/tts` |
  | `unmodel/transcribe` | `unmodel/stt` |

  `speech` / `createSpeech` are now `tts` / `createTts`; `transcribe` /
  `createTranscribe` are now `stt` / `createStt`. The CLI ids moved with them:
  `unified.speech` → `unified.tts`, `unified.transcribe` → `unified.stt`.

  **The 29 endpoint ids** (every one of these is also the export name, the module
  filename, and the CLI id):

  | old                       | new                   |
  | ------------------------- | --------------------- |
  | `openai.speech`           | `openai.tts`          |
  | `cartesia.speech`         | `cartesia.tts`        |
  | `deepgram.speech`         | `deepgram.tts`        |
  | `elevenlabs.speech`       | `elevenlabs.tts`      |
  | `fish-audio.speech`       | `fish-audio.tts`      |
  | `hume.speech`             | `hume.tts`            |
  | `inworld.speech`          | `inworld.tts`         |
  | `lmnt.speech`             | `lmnt.tts`            |
  | `lmnt.speechDetailed`     | `lmnt.ttsDetailed`    |
  | `minimax.speech`          | `minimax.tts`         |
  | `murf.speech`             | `murf.tts`            |
  | `murf.speechStream`       | `murf.ttsStream`      |
  | `resemble.speech`         | `resemble.tts`        |
  | `resemble.speechStream`   | `resemble.ttsStream`  |
  | `rime.speech`             | `rime.tts`            |
  | `smallest-ai.speech`      | `smallest-ai.tts`     |
  | `speechify.speech`        | `speechify.tts`       |
  | `speechify.speechStream`  | `speechify.ttsStream` |
  | `openai.transcribe`       | `openai.stt`          |
  | `assemblyai.transcribe`   | `assemblyai.stt`      |
  | `cartesia.transcribe`     | `cartesia.stt`        |
  | `deepgram.transcribe`     | `deepgram.stt`        |
  | `elevenlabs.transcribe`   | `elevenlabs.stt`      |
  | `gladia.transcribe`       | `gladia.stt`          |
  | `inworld.transcribe`      | `inworld.stt`         |
  | `mistral.transcribe`      | `mistral.stt`         |
  | `revai.transcribe`        | `revai.stt`           |
  | `soniox.transcribe`       | `soniox.stt`          |
  | `speechmatics.transcribe` | `speechmatics.stt`    |

  `openai.transcribeToFormData` is `openai.sttToFormData`; every `*Constraints`,
  `check*`, `*SdkTargets` and `unified-*` sibling followed its endpoint
  (`cartesia.speechConstraints` → `ttsConstraints`, `unified-speech.ts` →
  `unified-tts.ts`, and so on).

  **The category-named types**, in one line: `SpeechParams` → `TtsParams`,
  `TranscribeParams` → `SttParams`, and every sibling with them —
  `*ParamsBase`, `*ParamsFor`, `*ModelParams`, `*ModelParamTable`,
  `*ModelNarrowing`, `*AdapterFor`, `*Validator`, `Any*Adapter`. The kernel's
  category ids are `"tts"` and `"stt"`.

  **Wire-shaped names are untouched**, deliberately, because they describe bytes
  rather than addresses: `elevenlabs.TEXT_TO_SPEECH_BASE_URL`, `minimax.T2A_URL`,
  `deepgram.SpeakParams`, `elevenlabs.speechToTextRealtime`, MiniMax's
  `speech-*` model ids, and every realtime socket surface read exactly as they
  did. So does `AudioFormatSpec`, `Voice`, `Diarization` and the rest of the
  shared audio vocabulary — those are not category addresses.

  ## 2. Gemini joins both packs

  Google has no speech endpoint: TTS is `:generateContent` with
  `responseModalities: ["AUDIO"]` + a `speechConfig`, and STT is
  `:generateContent` with audio parts. Until now that meant Gemini speech was
  typed as _chat_. It now has two dedicated surfaces — and the chat route keeps
  serving the same ids, because a validator that refused a request the API
  fulfils is the one failure this library must never have. See
  `docs/decisions.md` §4 for why one wire route carries three addresses.

  **New: `tts` at `unmodel/google`** (plus `checkTts`, `generateTtsUrl`,
  `ttsStreamUrl`, `ttsSupportsStreaming`, `ttsModels`). A Tier-A view of the same
  bytes `google.chat` sends:
  - `generationConfig` is **required** and its `responseModalities` is pinned to
    `["AUDIO"]`;
  - every chat-only knob is `?: never` — tools, structured output, `imageConfig`,
    media resolution, sampling penalties, including the ones nested under
    `generationConfig`;
  - `speechConfig` is a compile-time **XOR** of its single- and multi-speaker
    arms, and `speakerVoiceConfigs` is a bounded `[one] | [one, two]` tuple
    (the guide says up to 2);
  - `voiceName` is the closed 30-voice preset list, from the same `as const`
    array the runtime check reads;
  - `languageCode` completes the **78** primary language subtags the
    speech-generation guide tabulates (hand-transcribed 2026-08-21, count pinned),
    with a `(string & {})` tail and a _warning_ — not an error — off-list;
  - `responseFormat.audio` is a discriminated union, so `bitRate` exists only on
    the compressed arms and asking for one on raw PCM is refused;
  - the estimate is bounded by the real 32,768-token TTS session limit.

  Five new checks (`responseFormat.audio` enums, the `bitRate` rule, sample-rate
  sanity and band, off-table `languageCode`) live in **one shared battery** both
  surfaces call, so `google.chat` gained them too and the two cannot drift.
  `google.chat` on a TTS id without `["AUDIO"]` now names `google.tts` and
  `unmodel/tts` in the error.

  **New: `stt` at `unmodel/google`** (plus `checkStt`, `generateSttUrl`). 13
  curated Gemini ids; the 6 audio-capable ids it deliberately does not serve are
  listed **by name and reason** (`gemini-3.1-flash-live-preview` and
  `gemini-3.5-live-translate-preview` are Live API/WebSocket, `gemini-embedding-2`
  is `:embedContent`, `gemini-robotics-er-1.6-preview` has no documented
  transcription behaviour, the two Deep Research previews are an agentic surface),
  and a drift test asserts every audio-input catalog id is curated **or**
  excluded — a codegen refresh has to classify a new model, not absorb it.
  `contents` narrows to text and audio parts only, `inlineData.mimeType` is the
  closed seven-value audio set, and `audioTranscriptionConfig` is fully typed:
  its acceptance on the **unary** route was verified against the live API (200
  for `{ wordTimestamp, diarization }`, and Google 400s unknown fields, so
  acceptance is proof) rather than inferred from the Live API's docs.

  **Both unified packs grew**: `unmodel/tts` 14 → **15** providers,
  `unmodel/stt` 11 → **12**. `tts({ model: "google/…" })` maps `voice`,
  `outputFormat`, `language` (via the primary subtag, warning on a dropped
  regional one) and nests the extras; `stt({ model: "google/…" })` maps
  `language`/`languages`/`timestamps: "word"`/`diarization.enabled` onto
  `audioTranscriptionConfig`.

  ## 3. The `data` audio-input kind

  `AudioInputKind` gains a fourth member, `"data"` — `{ data, mimeType? }`,
  `DataRef` verbatim, the same shape `image`, `image-edit` and `video` already
  carry. `mimeType` is optional in the vocabulary and required by whichever
  adapter cannot sniff the format; Gemini's refusal names all seven MIME
  spellings it takes.

  This retires a real wart: **inworld's `audioInputs` was `[]`** — a provider
  registered in the STT pack that no canonical request could reach, because its
  route takes base64 in the JSON body and the vocabulary had no word for that.
  It is now `["data"]` and `stt({ model: "inworld/inworld/inworld-stt-1", audio:
{ data } })` compiles and validates. `google.stt` declares
  `["data", "fileId"]`; `{ url }` is refused with the Files-API upload path
  spelled out, because `fileData.fileUri` is a Files API name and Gemini fetches
  no third-party host.

  ## 4. `computeCostUSD` prices audio input

  `TokenBreakdown` gains an **`audioInputTokens`** slot, re-rated the way
  `cachedInputTokens` already is: subtracted from fresh input and billed at the
  catalog's `inputAudio` rate, falling back to `input` where a model publishes
  none. It is the first consumer of the `inputAudio` rates the hand catalogs have
  been carrying.

  `google.stt` fills it: audio tokens are `ceil(durationSeconds × 32)` — 32
  tokens per second, documented — read from `options.media`. Declaring a duration
  turns the estimate into a real number:

  ```ts
  stt.safe(params, {
    media: [{ path: ["contents", 0, "parts", 0], durationSeconds: 600 }],
  });
  // estimate: { inputTokens: 19204, costUSD: 0.18304120000000002 }
  ```

  Duration is the caller's to declare, so an undeclared clip is normally silent —
  except with `maxCostUSD` set, where the same call now warns
  (`media_duration_undeclared`) rather than passing a budget check made on a known
  undercount. `checkChat` / `checkStt` also read the real per-modality counts
  Gemini returns in `usageMetadata.promptTokensDetails`.

  ## Budgets

  Three committed bundle budgets moved, each set to measured × 1.07 with the
  module-naming rationale the file demands:

  | entry            | old     | new     | why                                                                                                                                                                                                                              |
  | ---------------- | ------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `unmodel/google` | 235 KiB | 310 KiB | two new endpoints and their leaves — `tts.ts`, `stt.ts`, `tts-checks.ts`, `tts-check.ts`, `tts-models.ts`, `tts-constraints.ts`, `audio-constraints.ts`. All google's own; nothing foreign leaked in                             |
  | `unmodel/tts`    | 430 KiB | 500 KiB | Gemini's hand TTS catalog and the 78-language table. The zero-catalog pin **stays** — the pack still reaches no generated catalog, which is why `tts-constraints.ts` is an import-free leaf rather than part of `constraints.ts` |
  | `unmodel/stt`    | 420 KiB | 520 KiB | `google.stt` reads the generated `google.gen` catalog (there is no doc correction to make, so hand rows would be a second opinion on generated data — the `mistral.gen` precedent)                                               |

- 9c32ad2: **Every type unmodel knows is now importable without importing unmodel.**
  `unmodel/<provider>/types` (70 new subpaths) and `unmodel/types` (one hub) are
  type-only entries: they emit an **empty JavaScript module**, so the whole
  surface is free at runtime.

  They exist for the developer who wants the doc-corrected request shapes and is
  sending the request themselves — with `fetch`, with the vendor SDK, or through
  a client they already have. Nothing here is new _knowledge_; the types were
  already on the provider subpaths. What is new is that reaching them no longer
  means resolving a module that also carries a zod schema, a generated catalog
  and a validation pipeline, and that they are now uniformly discoverable.

  ```ts
  import type { ImageBody } from "unmodel/openai/types";

  const body = {
    model: "gpt-image-2",
    prompt: "a lighthouse at dusk",
    size: "3840x1280",
    background: "transparent",
  } satisfies ImageBody;
  // Type '"transparent"' is not assignable to type '"auto" | "opaque" | null | undefined'.
  ```

  That error is the product: `gpt-image-2` returns a 400 for a transparent
  background, so the type does not have the value — while `size` stays open to
  the whole documented `WIDTHxHEIGHT` rule space. `satisfies` rather than an
  annotation, so the literal types survive.

  **Two families of name, and the difference is deliberate.** Each provider entry
  re-exports that provider's **wire names verbatim** (`MessagesBody`,
  `ListenParams`, `Flux2Body`, `GenerateTtsBody`) — they are how you find the
  endpoint in the vendor's own documentation, and `docs/decisions.md` §2 is why
  they are not respelled. Alongside them, one uniform **`<Endpoint>Body` alias per
  endpoint address** the provider serves, named after the word you already type at
  `unmodel/<provider>` and `unmodel validate`: `ChatBody`, `TtsBody`, `SttBody`,
  `ImageBody`, `ImageEditBody`, `VideoBody`, `MusicBody`, plus the qualified
  extras (`ImageFlux1Body`, `TtsStreamBody`, `VideoV3FromImageBody`,
  `ImageEditSearchAndReplaceBody`, `RealtimeSessionBody`, …). 155 endpoint
  addresses across 65 providers; 149 new alias declarations, 6 names that already
  were the wire spelling, and 5 more `ChatBody` aliases for the factory-configured
  providers that have no CLI endpoint id (amazon-bedrock, azure,
  cloudflare-workers-ai, google-vertex, openai-compatible) — 154 alias
  declarations in all. Every one is a pure `export type X = Y`: an addition,
  never a rename.

  Six of those names were **already** the provider's wire spelling — cohere's
  `ChatBody`, fish-audio's and hume's and smallest-ai's `TtsBody`, openai's
  `ImageEditBody` and `RealtimeSessionBody`. There, the wire name wins and _is_
  the alias; declaring a second one would be the rename the law forbids.

  Generic wire types stay generic through the alias, so the escape hatches
  survive: `ImageBody<"gpt-image-9">` opts into the future-model arm exactly as
  `ImagesBody<"gpt-image-9">` does, and the 31 OpenAI-compatible overlays get
  `ChatBody<ModelId>` defaulted to **their own** catalog union — `unmodel/xai/types`
  completes Grok ids, `unmodel/groq/types` completes Groq's, from the same shared
  dialect leaf their validators check against. Those overlays also surface the
  chat dialect's message, content-part and tool types for the first time on their
  own subpath; previously they were reachable only via
  `unmodel/openai-compatible`.

  **`unmodel/types` is the hub, and it is small on purpose.** It carries the
  canonical camelCase vocabulary the unified surfaces speak — `ChatParams`,
  `TtsParams`, `SttParams`, `ImageParams`, `ImageEditParams`, `VideoParams`,
  `MusicParams`, and the words they are built from (`AspectRatio`, `AudioFormat`,
  `Voice`, `Diarization`, `Dimensions`, the media input refs) — the
  `"provider/model"` ref unions (`ChatModelRef`, `ChatProviderId`), the result
  vocabulary (`Issue`, `ValidateResult`, `ResponseReport`, `UsageReport`,
  `TranslationWarning`, `Retargeted`, `SdkTargetId`, `ApiTargetId`) and the
  catalog/constraint shapes.

  It does **not** aggregate provider wire types, and that is the whole design.
  The 70 provider entries carry ~2,140 type exports between them; one module
  naming all of them is a ~900 KB declaration file that every consumer would
  have to parse to reach one interface. Per-provider entries mean
  you pay for the provider you call: the hub declares ~307 KiB (against 233 KiB
  for the root `unmodel` entry it extends), and the fattest provider types entry
  is ~298 KiB, dominated by that provider's own generated model-id union.

  **The guarantees are tested, not asserted.** `test/types-entries.test.ts` pins,
  against a real build:
  - **zero runtime** — every one of the 71 built entries is an empty JavaScript
    module, and every source file contains `import type` / `export type`
    statements and nothing else (under `verbatimModuleSyntax` a value import here
    would be a value import in the output);
  - **completeness drift** — the endpoint list comes from `src/cli-registry.ts`,
    so a new endpoint that lands without its `<Endpoint>Body` fails the build
    rather than shipping a release behind;
  - **packaging** — every entry has its `exports` subpath and its tsdown entry.

  `test/import-graph.test.ts` adds amendment A8: a provider types entry may name
  only its own directory, its own generated catalog and the two structural
  dialect bases (`openai-compatible`, and `google` for `google-vertex`); the hub
  may name no provider at all. `test/bundle-budget.test.ts` pins the declaration
  budgets, including the rule that a types entry can never cost more than that
  provider's main entry. `test/types/types-entries.test-d.ts` checks the aliases
  resolve to the wire types they claim to be — the one thing a regex over the
  source cannot see.

  Runtime values are unchanged and stay where they were: URL constants, `check*`
  helpers, `toFormData`, the models tables and the validators remain on
  `unmodel/<provider>`, which tree-shakes to the few bytes a URL string costs.
  Nothing was renamed, moved or removed.

- b7837fd: **New: seven standardized surfaces that compile to any provider's exact wire
  body** — `unmodel/chat`, plus one pack per media category.

  unmodel's per-provider validators exist because they mirror a wire format
  _exactly_: `unmodel/anthropic`'s `chat()` takes `max_tokens` and `cache_control`
  because that is what `POST /v1/messages` takes, and a validator that renamed
  things would be lying about the request it validates. That stays the default and
  it is not going away. These entries are the other half of the trade — **one**
  camelCase vocabulary, and the compiler emits whichever wire body the model ref
  names:

  ```ts
  import { chat } from "unmodel/chat";

  const req = chat({
    model: "anthropic/claude-opus-5",
    messages: [{ role: "user", content: "Explain retargeting." }],
    reasoning: { budgetTokens: 2048 },
    maxOutputTokens: 4096,
  });

  req.request.url; // https://api.anthropic.com/v1/messages
  JSON.stringify(req); // {"model":"claude-opus-5","max_tokens":4096,…,
  //  "thinking":{"type":"enabled","budget_tokens":2048}}
  ```

  Change the ref to `"openai/gpt-5.2"` and the same object compiles to
  `max_completion_tokens` + `reasoning_effort: "low"` at
  `api.openai.com/v1/chat/completions`, with an `approximated_param` warning
  naming both the requested budget and the bucket it landed in. That is the entire
  proposition.

  **New package exports**

  | Entry                  | Function(s)                    | Providers              |
  | ---------------------- | ------------------------------ | ---------------------- |
  | `unmodel/chat`         | `chat`                         | 32                     |
  | `unmodel/chat/factory` | `createChat`                   | whichever you register |
  | `unmodel/image`        | `image`, `createImage`         | 15                     |
  | `unmodel/tts`          | `tts`, `createTts`             | 14                     |
  | `unmodel/stt`          | `stt`, `createStt`             | 11                     |
  | `unmodel/video`        | `video`, `createVideo`         | 10                     |
  | `unmodel/image-edit`   | `imageEdit`, `createImageEdit` | 4                      |
  | `unmodel/music`        | `music`, `createMusic`         | 2                      |

  …plus `unmodel/<provider>/unified` for each of the 36 providers that ship an
  adapter, and `unified.image` / `unified.imageEdit` / `unified.music` /
  `unified.tts` / `unified.stt` / `unified.video` on `unmodel validate`.

  **The result is a provider result.** A unified call does not validate the
  request itself. It compiles the canonical params to the provider's wire params
  and then runs **that provider's own validator** — the same `image()` from
  `unmodel/openai` you would have called by hand, with its catalog, its constraint
  tables, its media limits and its cost estimate. So there is no second definition
  of what a valid request is and the two cannot disagree, and what comes back is
  an ordinary `Validated`: enumerable properties are the provider's exact wire
  body, `.request` is its URL/method/static headers, `.toSdk(target)` is its SDK
  shape. Dropping to the wire layer is deleting one import, not a migration.

  **The ref convention.** `model` is `"provider/model"`, split on the **first**
  slash. OpenRouter's own ids contain slashes, so
  `"openrouter/anthropic/claude-opus-5"` is provider `openrouter`, model
  `anthropic/claude-opus-5`; splitting on the last slash — the obvious
  implementation — would route it to a provider called `openrouter/anthropic`. The
  generated ref unions drive autocomplete but never gate the API, so a model
  released after the catalog snapshot is still callable. `unmodel/chat`'s return
  type is keyed off the provider half at the type level: `"anthropic/…"` is typed
  as a `/v1/messages` body, `"google/…"` as a Gemini body with no `model` key (it
  lives in the URL), everything else as chat-completions, and an unrecognised
  provider degrades to the union of the three rather than to `any`.

  **The loss policy, in three rules.** A param the provider cannot express at all
  is an **error** naming what it does offer. A value it can only express
  approximately is an `approximated_param` **warning** naming both the requested
  and the achieved value. Everything else is silent. So `warnings.length === 0`
  _means_ the request mapped exactly — asserted per category by a golden matrix
  that compiles one canonical request at every provider that can express it.

  ```ts
  image({
    model: "black-forest-labs/flux-pro-1.1",
    prompt: "…",
    aspectRatio: "16:9",
    resolution: "1k",
  }).warnings;
  // [approximated_param] `aspectRatio` 16:9 at 1k does not land on this model's
  // 32px grid: 1344×768 (1.750:1, requested 1.778:1).

  image({ model: "openai/gpt-image-1", prompt: "…", seed: 7 });
  // throws: `seed` is not supported by "openai/gpt-image-1" — POST
  // /v1/images/generations has no seed field, so a seed could only be dropped.
  ```

  **`providerOptions` is the escape hatch, and it is still validated.** Anything
  genuinely one-off — OpenAI's `store`, OpenRouter's `provider` routing block,
  Vidu's reference `images` — rides in a bucket keyed by provider id, deep-merged
  over the compiled body **before** validation, so it goes through the provider's
  own checks rather than around them. Buckets that do not match the ref are inert,
  so one request object can carry tuned settings for several providers and stay
  portable.

  **Narrowings that happen at compile time.** `audio` narrows to the STT
  route (AssemblyAI fetches a URL, Cartesia takes multipart bytes, Soniox takes a
  URL or its own file id, Mistral takes all three); `image` narrows the same way
  in `unmodel/image-edit`; `aspectRatio` and `dimensions` are an XOR; the presence
  of `image` / `video` chooses the video endpoint, and a model with no arm for the
  derived route says so by name; `operation` is `"edit"` and only `"edit"` in v1.
  One declaration drives both halves in each case — the same array types the
  caller's field and backs it at run time with a message naming the shapes the
  route does take, for JavaScript callers and refs built at run time.

  **What each vocabulary actually buys**, in one line per category — these are the
  translations that would otherwise be hand-written per provider:
  - **chat** — `maxOutputTokens` is `max_completion_tokens` / `max_tokens` /
    `generationConfig.maxOutputTokens`; `temperature` is canonical 0–2 and clamps
    (never rescales) to Anthropic's ceiling of 1 with a warning; `reasoning`
    buckets a token budget into `reasoning_effort` where no budget field exists;
    `tools` is a `Record` so duplicate names are unrepresentable rather than
    detectable; `cache` breakpoints reach `cache_control`, `cachePoint` and
    `prompt_cache_breakpoint`.
  - **image / image-edit** — `aspectRatio` XOR `dimensions` plus a `resolution`
    tier compiles to all six shapes a provider might offer: a closed ratio enum, a
    grid-snapped pixel pair, a documented size enum, a free-form `WxH`, an open
    ratio string with numeric bounds, and a bare tier name.
  - **image-edit** — `strength` means one thing in one direction: `0` keeps the
    source, `1` ignores it. Ideogram's `image_weight` runs **backwards**, so
    `strength: 0` compiles to `image_weight: 100`. Every adapter declares its
    scale as the wire values at canonical 0 and 1, so the inversion is one number
    swapped rather than a minus sign hidden in a branch, and the capability sweep
    asserts the direction by compiling two requests and checking which way the
    wire value moves.
  - **video** — `duration` is a plain number of seconds and compiles to five wire
    shapes: `8`, `"8"`, `"8s"`, a nested `settings.duration`, and the documented
    `null` "automatic duration". A duration a model does not offer is an
    `invalid_enum_value` listing the ones it does — never the nearest, because a
    9-second clip is not approximately a 5-second one at any price.
  - **stt** — `diarization: { enabled: true }` reaches a flag
    (`speaker_labels`, `diarize`, `enable_speaker_diarization`), an enum
    (`diarization: "speaker"`), an **inverted** flag (`skip_diarization: false`)
    and a flag-plus-config-object; `timestamps: "word"` is an array at OpenAI, a
    scalar enum at ElevenLabs, a boolean at Deepgram, and free at the four routes
    that report word timings unconditionally — where `timestamps: "segment"` is an
    error naming what they _do_ report.
  - **music** — the unit is in the name: `durationSeconds: 90` is
    `music_length_ms: 90000` at ElevenLabs and `duration: 90` at Stability. The
    conversion is exact and therefore silent; a length that lands between two
    milliseconds is refused rather than rounded.
  - **tts** — `outputFormat` reconciles container, sample rate and bitrate
    across fourteen providers that each publish a different subset; a provider
    with no speaking-rate field says so instead of dropping `speed`.

  **Bundle cost is opt-in and pinned.** Per-provider entries carry none of this;
  the adapters live in their own `unified-<category>.ts` modules behind the
  separate `unmodel/<provider>/unified` export, and `test/bundle-budget.test.ts`
  holds every entry — provider and pack alike — to a committed byte budget
  measured over the real `dist/` import graph. Measured today, unminified ESM with
  `zod` excluded: chat 1718.7 KiB (`chat/factory` 144.0), image 755.7, video
  614.4, tts 409.8, stt 401.7, image-edit 276.1, music 149.8. A pack is
  the whole category;
  `createTts([openai, rime])` and its siblings pay only for the providers you
  register.

  **Declared gaps, each a typed refusal rather than a surprise.**
  `inworld.stt` carries base64 audio inside its JSON body, which a
  synchronous compile step cannot produce from a `Blob`; Black Forest Labs'
  Kontext `input_image` is a JSON string, so its `imageInputs` is
  `["data", "url"]` and `{ file }` does not type-check; Recraft's `strength` is
  required with no documented default, so a request without one is an error rather
  than a number unmodel picked; Stability's `musicFromAudio` / `musicInpaint` and
  the sixteen masked editing routes take controls no other provider has, so they
  stay reachable by name at `unmodel/<provider>` where they work perfectly well.

  **No `.toApi()` on a unified _media_ result, deliberately.** A provider result
  offers `.toApi(target)` because it starts in one dialect and may want another.
  A unified media result has no dialect to leave: retargeting it means changing
  `model` and calling again, which is a string edit rather than an API — and
  adding `.toApi` would bundle the availability tables the six media packs exist
  without. `unmodel/chat` is the exception and pays for it on purpose: it returns
  the provider's own `Validated`, so `.toApi` and `.toSdk` are there because they
  were never removed. See the `chat-composition` changeset.

  ## `unmodel/image` knows what _one model_ takes

  The two image surfaces narrow per **model**, not per provider — because that is
  where the disagreement actually is. `gpt-image-2` takes a free-form `size` up to
  3840 px and a `background` of `"opaque" | "auto"`; `gpt-image-1` — same
  provider, same endpoint — takes a three-value `size` enum and a `background`
  that also accepts `"transparent"`. One adapter, two request surfaces, and the
  difference is the model id.

  ```ts
  image({ model: "openai/gpt-image-2", prompt, size: "3840x2160" });
  //                                          ^ that model's own presets

  image({ model: "openai/gpt-image-1", prompt, background: "transparent" }); // ok
  image({ model: "openai/gpt-image-2", prompt, background: "transparent" }); // compile error
  ```

  That second line is the whole argument for this library in one call. The OpenAI
  SDK's own type offers `transparent` on every GPT image model; gpt-image-2
  answers a 400 — _"Requests with `background` set to `transparent` will return an
  error for these models; use `opaque` or `auto` instead"_ — which unmodel keeps
  as a recorded fixture.

  **What narrows.** `size` (a new canonical field, joining `aspectRatio` and
  `dimensions` in the XOR — three spellings of one decision, at most one given),
  `aspectRatio`, `resolution`, and the per-model params the canonical vocabulary
  has no word for. `size` is a string on purpose: `"3840x2160"` is what the docs,
  the dashboards and the models themselves call it, and one token autocompletes
  where a `{ width, height }` pair cannot.

  **The presets are provable.** A closed enum gets no template tail — the list
  _is_ the limit, so `size: "1920x1080"` does not compile on `dall-e-3`. A
  free-form field gets `` `${number}x${number}` `` beside the presets, because it
  genuinely accepts more than the list; there `"1920x1080"` compiles and fails at
  run time on gpt-image-2's own 16-px rule, which is why it is absent from the
  presets and `"2560x1440"` is in them. Every preset in every table — across all
  19 adapters — is compiled through the adapter and run past the provider's own
  validator, with zero errors and zero warnings, in
  `test/unified/image-presets.test.ts`.

  **The extras are identity, and still checked.** A per-model param is already
  spelled the way the provider spells it, so it goes on the wire unchanged, before
  `providerOptions` is merged (which therefore still wins). The provider's own
  schema and deny tables then re-check it: a JavaScript caller who passes
  `background: "transparent"` to gpt-image-2 gets the same refusal a TypeScript
  caller got at compile time. An extra sent to a model that does not take it is an
  `unsupported_param` naming the models that do.

  Unknown and run-time-built refs degrade to the wide vocabulary, exactly as an
  unrecognised model already does: the union drives autocomplete, it does not gate
  the API.

- b7837fd: **Breaking: every endpoint is now addressed by its category's verb.**

  An endpoint id is public API twice over — it is what `unmodel validate <id>`
  takes on the command line, and it is the route label the availability data and
  `.toApi` warnings name — so this is the migration guide, and it is complete.
  `src/cli-registry.test.ts` is the same list made executable: it pins every
  current id and asserts every retired one is gone.

  **The law.** An endpoint's _address_ is uniform across providers even where the
  wire spelling is not. Fifty-plus providers had spelled the same six operations
  about thirty different ways — a wire path (`imageToImage`, `text2video`), a
  product family (`fluxKontext`, `krea2`), a bare verb (`edit`, `listen`,
  `speak`), a plural noun (`images`, `videos`, `jobs`, `generations`) and a noun
  phrase (`replaceBackground`, `contentGenerationTasks`). All of them now address
  their category as `chat`, `image`, `imageEdit`, `tts`, `stt`, `video`
  or `music`, with each _extra_ route at a provider qualified by what makes it
  different — never the primary one, so the word a caller reaches for first is the
  same word everywhere.

  **Wire-shaped names deliberately did not move.** `MESSAGES_URL`,
  `GenerateContentBody`, `ConverseParams`, `IMAGES_GENERATIONS_URL`, `Flux2Body`,
  `TEXT2VIDEO_URL`, `STABLE_AUDIO_TEXT_TO_AUDIO_URL`, `AUDIO_TRANSCRIPTIONS_URL`,
  `IDEOGRAM_V3_REMIX_URL`, `StableImageEraseParams`, `JobConfig`, the dialect ids
  — all unchanged. The rule is _address-shaped names go uniform, wire-shaped names
  keep the wire spelling_, and the reason is that those two kinds of name answer
  different questions: an address is "which endpoint do I call", and it should
  read the same at every provider; a wire name describes the bytes on the wire,
  and respelling it would make the type lie about the request. `docs/decisions.md`
  records this as a standing decision so it does not get "corrected" later.

  ## Chat

  | old                             | new                   |
  | ------------------------------- | --------------------- |
  | `anthropic.messages`            | `anthropic.chat`      |
  | `google.generateContent`        | `google.chat`         |
  | `google-vertex.generateContent` | `google-vertex.chat`  |
  | `amazon-bedrock.converse`       | `amazon-bedrock.chat` |

  `openai.chat`, `cohere.chat`, `azure.chat`, `cloudflare-workers-ai.chat` and
  every one of the 29 OpenAI-compatible overlays already had the uniform name.
  The checkers and constraint tables move with the endpoints:
  `anthropic.checkMessages`, `google.checkGenerateContent` and
  `amazon-bedrock.checkConverse` are all `checkChat` now (matching
  `openai.checkChat`), `messagesConstraints` / `generateContentConstraints` are
  `chatConstraints`, `messagesFamilyRules` is `chatFamilyRules`, the
  `MessagesSdkTargets` type is `ChatSdkTargets`, and the Bedrock factory's
  `AmazonBedrockConverse` type is `AmazonBedrockChat`.

  Two **retarget route labels** in the generated availability data changed with
  them, because Vertex serves three different wire surfaces and the label has to
  say which:

  | old label                       | new label                      | what it means                                                                                                                                                                                                                                  |
  | ------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `google-vertex.generateContent` | `google-vertex.chat`           | Gemini on Vertex — the surface `createGoogleVertex(…).chat` validates                                                                                                                                                                          |
  | `google-vertex.chat`            | `google-vertex.chatMaas`       | the OpenAI-compatible MaaS surface Vertex serves `*-maas` models on                                                                                                                                                                            |
  | —                               | `google-vertex.chatRawPredict` | new, and dormant: the Anthropic-shaped `rawPredict` route Claude-on-Vertex uses. unmodel has no module for it, so those rows stay denied in `data/availability-overrides.json`; the label exists so the rule is already correct when one lands |

  ## TTS (text to speech)

  | old                                                 | new                                   |
  | --------------------------------------------------- | ------------------------------------- |
  | `elevenlabs.textToSpeech`                           | `elevenlabs.tts`                      |
  | `cartesia.tts`                                      | `cartesia.tts`                        |
  | `deepgram.speak`                                    | `deepgram.tts`                        |
  | `hume.tts`                                          | `hume.tts`                            |
  | `minimax.t2a`                                       | `minimax.tts`                         |
  | `rime.tts`                                          | `rime.tts`                            |
  | `fish-audio.tts`                                    | `fish-audio.tts`                      |
  | `smallest-ai.tts`                                   | `smallest-ai.tts`                     |
  | `inworld.tts`                                       | `inworld.tts`                         |
  | `murf.speechGenerate`                               | `murf.tts`                            |
  | `resemble.synthesize` / `resemble.synthesizeStream` | `resemble.tts` / `resemble.ttsStream` |
  | `speechify.stream`                                  | `speechify.ttsStream`                 |

  `openai.tts`, `lmnt.tts`, `lmnt.ttsDetailed`, `murf.ttsStream` and
  `speechify.tts` were already spelled with the category's verb and moved with
  it. The rows where old and new read alike are the providers whose own wire word
  was already `tts`. Constraint tables and checkers follow:
  `elevenlabs.textToSpeechConstraints` → `ttsConstraints` (likewise cartesia,
  rime, smallest-ai, inworld), and `resemble.checkSynthesis` → `checkTts`,
  matching `murf.checkTts`.

  ## STT (speech to text)

  | old                       | new                |
  | ------------------------- | ------------------ |
  | `openai.transcription`    | `openai.stt`       |
  | `mistral.transcription`   | `mistral.stt`      |
  | `elevenlabs.speechToText` | `elevenlabs.stt`   |
  | `soniox.transcriptions`   | `soniox.stt`       |
  | `deepgram.listen`         | `deepgram.stt`     |
  | `assemblyai.transcript`   | `assemblyai.stt`   |
  | `gladia.preRecorded`      | `gladia.stt`       |
  | `revai.jobs`              | `revai.stt`        |
  | `speechmatics.jobs`       | `speechmatics.stt` |
  | `cartesia.stt`            | `cartesia.stt`     |

  `inworld.stt` moved with the rest of the category; `cartesia.stt` reads alike in
  both columns because `stt` was already Cartesia's own wire word.
  `openai.transcriptionToFormData` moves with its endpoint to
  `openai.sttToFormData`.

  ## Image generation

  | old                                                                 | new                                                        |
  | ------------------------------------------------------------------- | ---------------------------------------------------------- |
  | `openai.images`                                                     | `openai.image`                                             |
  | `google.generateImages`                                             | `google.image`                                             |
  | `black-forest-labs.flux2` / `black-forest-labs.flux1`               | `black-forest-labs.image` / `black-forest-labs.imageFlux1` |
  | `ideogram.generate` / `ideogram.generateV4`                         | `ideogram.image` / `ideogram.imageV4`                      |
  | `recraft.generations`                                               | `recraft.image`                                            |
  | `stability.stableImageUltra` / `stableImageCore` / `stableImageSd3` | `stability.image` / `imageCore` / `imageSd3`               |
  | `luma.imageGenerations`                                             | `luma.image`                                               |
  | `bytedance.imageGenerations`                                        | `bytedance.image`                                          |
  | `runway.textToImage`                                                | `runway.image`                                             |
  | `kling.imageGenerations` / `kling.omniImage`                        | `kling.image` / `kling.imageOmni`                          |
  | `vidu.reference2image`                                              | `vidu.imageFromReference`                                  |
  | `bria.imageGenerate` / `bria.imageGenerateLite`                     | `bria.image` / `bria.imageLite`                            |
  | `leonardo.generations`                                              | `leonardo.image`                                           |
  | `krea.krea2`                                                        | `krea.image`                                               |
  | `reve.create` / `reve.createV2`                                     | `reve.image` / `reve.imageV2`                              |

  Constraint tables move with them (`openai.imagesConstraints` →
  `imageConstraints`, likewise google, black-forest-labs, bytedance, runway and
  recraft's family rules).

  ## Image editing

  Twenty-six routes across eight providers, each extra one qualified by _what it
  does to the picture_ rather than by the wire path or the vendor's product name.

  | old                                     | new                                      |
  | --------------------------------------- | ---------------------------------------- |
  | `black-forest-labs.fluxKontext`         | `black-forest-labs.imageEdit`            |
  | `black-forest-labs.fluxFill`            | `black-forest-labs.imageEditFill`        |
  | `black-forest-labs.fluxExpand`          | `black-forest-labs.imageEditExpand`      |
  | `black-forest-labs.fluxErase`           | `black-forest-labs.imageEditErase`       |
  | `black-forest-labs.fluxDeblur`          | `black-forest-labs.imageEditDeblur`      |
  | `black-forest-labs.fluxOutpainting`     | `black-forest-labs.imageEditOutpainting` |
  | `black-forest-labs.fluxVto`             | `black-forest-labs.imageEditVto`         |
  | `ideogram.edit`                         | `ideogram.imageEdit`                     |
  | `ideogram.remix`                        | `ideogram.imageEditRemix`                |
  | `ideogram.reframe`                      | `ideogram.imageEditReframe`              |
  | `ideogram.replaceBackground`            | `ideogram.imageEditReplaceBackground`    |
  | `recraft.imageToImage`                  | `recraft.imageEdit`                      |
  | `recraft.inpaint`                       | `recraft.imageEditInpaint`               |
  | `recraft.outpaint`                      | `recraft.imageEditOutpaint`              |
  | `recraft.generateBackground`            | `recraft.imageEditGenerateBackground`    |
  | `recraft.replaceBackground`             | `recraft.imageEditReplaceBackground`     |
  | `stability.stableImageErase`            | `stability.imageEditErase`               |
  | `stability.stableImageInpaint`          | `stability.imageEditInpaint`             |
  | `stability.stableImageOutpaint`         | `stability.imageEditOutpaint`            |
  | `stability.stableImageSearchAndReplace` | `stability.imageEditSearchAndReplace`    |
  | `stability.stableImageSearchAndRecolor` | `stability.imageEditSearchAndRecolor`    |
  | `stability.stableImageRemoveBackground` | `stability.imageEditRemoveBackground`    |
  | `luma.reframeImage`                     | `luma.imageEditReframe`                  |
  | `reve.edit`                             | `reve.imageEdit`                         |
  | `reve.remix`                            | `reve.imageEditRemix`                    |

  `openai.imageEdit` and `bria.imageEdit` already had the uniform name, and
  `openai.imageEditToFormData` is unchanged.

  ## Video

  | old                                                          | new                                                                    |
  | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
  | `openai.videos`                                              | `openai.video`                                                         |
  | `google.generateVideos`                                      | `google.video`                                                         |
  | `bytedance.contentGenerationTasks`                           | `bytedance.video`                                                      |
  | `runway.textToVideo` / `imageToVideo` / `videoToVideo`       | `runway.video` / `videoFromImage` / `videoFromVideo`                   |
  | `kling.textToVideo` / `imageToVideo`                         | `kling.video` / `videoFromImage`                                       |
  | `kling.textToVideoV3` / `imageToVideoV3` / `omniVideo`       | `kling.videoV3` / `videoV3FromImage` / `videoOmni`                     |
  | `luma.generations`                                           | `luma.video`                                                           |
  | `luma.modifyVideo` / `reframeVideo` / `upscale` / `addAudio` | `luma.videoModify` / `videoReframe` / `videoUpscale` / `videoAddAudio` |
  | `minimax.videoGeneration` / `videoGenerationV2`              | `minimax.video` / `videoV2`                                            |
  | `vidu.text2video` / `img2video` / `reference2video`          | `vidu.video` / `videoFromImage` / `videoFromReference`                 |
  | `pixverse.textToVideo` / `imageToVideo`                      | `pixverse.video` / `videoFromImage`                                    |
  | `lightricks.textToVideo` / `imageToVideo` / `audioToVideo`   | `lightricks.video` / `videoFromImage` / `videoFromAudio`               |

  Constraint tables move with them (`openai.videosConstraints` →
  `videoConstraints`, google's `generateVideosConstraints` / `FamilyRules` /
  `Models`, runway's three `*Constraints` / `*Required` / `*ShapeRules` triples,
  bytedance's `contentGenerationTasksConstraints`, luma's
  `modifyVideoConstraints`, vidu's three).

  ## Music

  | old                                 | new                        |
  | ----------------------------------- | -------------------------- |
  | `stability.stableAudioTextToAudio`  | `stability.music`          |
  | `stability.stableAudioAudioToAudio` | `stability.musicFromAudio` |
  | `stability.stableAudioInpaint`      | `stability.musicInpaint`   |

  `elevenlabs.music` already had the uniform name.

  ## What did _not_ get renamed

  **The realtime surfaces**, on purpose: a socket config is a different endpoint
  from a batch POST, and folding them in would make `tts` and `stt` each
  mean two transports. `openai.realtimeSession`, `elevenlabs.textToSpeechStreamInput`,
  `elevenlabs.speechToTextRealtime`, `soniox.realtimeTranscription`,
  `deepgram.listenLive` / `listenFlux` / `fluxConfigure` / `speakLive`,
  `cartesia.ttsWebsocket` / `sttWebsocket`, `inworld.realtimeTranscribeConfig` and
  `inworld.realtimeVoiceContext` are all unchanged.

  **Module filenames moved with the addresses** — `messages.ts`, `converse.ts`,
  `generate-content.ts`, `images-edit.ts`, `kontext.ts`, `transform.ts`,
  `listen.ts`, `pre-recorded.ts`, `jobs.ts`, `stt.ts`, `audio.ts` and the rest are
  now named for the endpoint they serve. That is not cosmetic:
  `test/bundle-budget.test.ts` asserts a unified pack can only reach a provider
  through a file with the uniform name, so the rename is structural.

  ## Migrating

  Mechanically: rename the import, rename the CLI id, rename the checker. The
  params, the URL, the response and the `.toSdk` targets are all exactly what they
  were — this wave changed no wire format and no validation rule.

  ```diff
  - import { messages, checkMessages } from "unmodel/anthropic";
  + import { chat, checkChat } from "unmodel/anthropic";

  - import { generateImages } from "unmodel/google";
  + import { image } from "unmodel/google";

  - echo "$params" | unmodel validate openai.transcription
  + echo "$params" | unmodel validate openai.stt
  ```

- 90f2c5b: **The runtime lists behind the types: `unmodel/<provider>/values` and a
  `unmodel/values` hub.**

  `unmodel/<provider>/types` gave a client-side app the shapes. It could not give
  it the _values_: which voices `openai/gpt-4o-mini-tts` has, which sizes
  `gpt-image-2` takes, which durations `kling-v2-5-turbo-pro` allows. A type
  cannot be mapped over, so every app that wanted a picker retyped the list by
  hand — and that copy is wrong the day a provider adds a voice.

  Those lists now ship as arrays. 36 providers — exactly the ones with a unified
  adapter — publish `unmodel/<provider>/values`, and every entry names the same
  uniform exports for each category it serves:

  ```tsx
  import { TTS_MODELS, TTS_MODEL_PARAMS } from "unmodel/openai/values";

  <select name="voice">
    {TTS_MODEL_PARAMS["gpt-4o-mini-tts"].voices.map((v) => (
      <option key={v}>{v}</option>
    ))}
  </select>;
  ```

  `<CATEGORY>_MODEL_PARAMS` is the per-model narrowing table (voices, sizes,
  aspect ratios, durations, resolutions, codecs, languages, timestamp
  granularities and the per-model `extras`), `<CATEGORY>_MODELS` is the model-id
  list, and `<CATEGORY>_FORMAT_SPEC` is the audio format spec where the category
  has one — with `IMAGE_`, `IMAGE_EDIT_`, `VIDEO_`, `TTS_`, `STT_` and `MUSIC_`
  prefixes. Beside them, each entry re-exports that provider's own published enums
  under their own names (`GEMINI_TTS_VOICES`, `GPT_IMAGE_2_SIZES`,
  `BFL_ASPECT_RATIOS`, `RECRAFT_V3_STYLES`, `KLING_ASPECT_RATIOS`, …), including
  nine lists that existed but had never been reachable from any subpath.

  **They are the adapter's own objects, not copies.** `TTS_MODEL_PARAMS` is
  `===` the table `unmodel/tts` compiles with, so a picker built from it and the
  request built from the same params cannot disagree. That is asserted by
  reference in `test/values-entries.test.ts`, not by deep equality.

  **`unmodel/values`** is the canonical hub: the closed unions as arrays —
  `ASPECT_RATIO_PRESETS`, `RESOLUTION_TIERS`, `VIDEO_RESOLUTIONS`,
  `IMAGE_OUTPUT_FORMATS`, `OUTPUT_DELIVERIES`, `AUDIO_FORMAT_CODECS`,
  `AUDIO_CONTAINERS`, `TIMESTAMP_GRANULARITIES`, `AUDIO_INPUT_KINDS` — plus
  `CANONICAL_KEY_LISTS` (the exact params each category accepts, which is the list
  the kernel's envelope check is built from) and `CHAT_PROVIDERS`. Each array is
  proved equal to its union in **both** directions by a type test, so a word added
  to the vocabulary and forgotten in the array is a compile error rather than a
  picker that quietly offers eight options out of nine.

  **`unmodel/values/chat-refs`** carries `CHAT_MODEL_REFS`, the runtime twin of
  `ChatModelRef` — all 1,339 `"provider/model"` pairs `chat()` accepts, generated
  beside the union and asserted equal to it. It is a separate subpath because it is
  45 KiB: measured both ways, exporting it from the hub instead put all 1,339
  strings into `values/index.js` and took that entry from 2.4 KiB to 49.

  **Light bundles are the point, and they are measured.** A values entry that
  re-exported its lists from the modules that declare them would have dragged that
  provider's validator, zod schema and sometimes its generated catalog — 30–82 KiB
  for one array, measured. So the per-model tables moved out of the adapters onto
  import-free `<category>-params.ts` leaves that the adapters themselves import,
  and nine providers' value spaces moved out of validator modules onto import-free
  constraint leaves. The result, per single export, against a real build:

  | Import                              | Cost        |
  | ----------------------------------- | ----------- |
  | any array from `unmodel/values`     | 0.2–1.5 KiB |
  | the median provider export          | ~1 KiB      |
  | the worst (`unmodel/runway/values`) | 19.4 KiB    |
  | `CHAT_MODEL_REFS`                   | 49 KiB      |

  `test/values-entries.test.ts` runs that measurement for all 267 provider exports
  on every test run and holds each to a budget; `test/import-graph.test.ts`
  (amendment A9) holds the source-level rule that makes it possible — a values
  entry names only its own provider directory, and never an adapter.

  Nothing was renamed or removed. The six media packs and the provider entries
  carry the same modules they did; splitting the data onto its own leaves cost
  ~0.65 KiB per leaf in unminified ESM, which moved four pack budgets and is
  accounted for module by module where those budgets are declared.

- 53f3065: **Voice creation is now a first-class, validated capability — two new
  categories, thirteen new wire-exact endpoints, and the packs on top.**

  Creating a voice used to be the hole the library talked around: ElevenLabs'
  text-to-voice models sat in the catalog with a "which unmodel does not
  validate" note, Fish Audio's inline cloning payload was deliberately excluded
  from unified TTS, and Speechify's clone routes carried a `NOT VALIDATED HERE`.
  This wave closes it, in the order `docs/providers.md` has always prescribed:
  wire-exact subpaths first, adapters second.

  ## The wire wave — 13 endpoints across 7 providers

  Every shape was verified against the provider's API reference AND its official
  SDK types / OpenAPI (the resolver where the prose docs disagreed with
  themselves — Fish's `reference_text` cap is 150, not the feature page's 300;
  Cartesia's pre-2026 `mode`/`enhance`/`transcript` fields are gone; MiniMax's
  spelling is `need_volume_normalization`, whatever third-party samples say):
  - `elevenlabs.voiceClone` (POST /v1/voices/add — IVC, multipart),
    `elevenlabs.voiceDesign` (POST /v1/text-to-voice/design, with the
    ttv_v3-only field gate) and `elevenlabs.voiceDesignSave` (POST
    /v1/text-to-voice — the phase-2 save, deliberately wire-only).
  - `fish-audio.voiceClone` (POST /model — voices 1–20, the
    visibility-defaults-to-PUBLIC footgun warned on omission, cover_image
    required-if-public) and `fish-audio.voiceDesign` (POST /v1/voice-design,
    required `model: voice-design-1` header, $0.01/request estimated flat).
  - `inworld.voiceClone` (voices:clone — base64 samples, 4MB cap checked from
    the payload), `inworld.voiceDesign` (designPrompt 30–250) and
    `inworld.voiceDesignPublish` (the draft-voice save, wire-only).
  - `minimax.voiceClone` (POST /v1/voice_clone — the caller-chosen `voice_id`
    grammar enforced; preview text priced at the chosen speech model's rate;
    `toVoiceUploadFormData` builds the upload prerequisite) and
    `minimax.voiceDesign` (single-phase; preview text priced at $30/1M chars).
  - `cartesia.voiceClone` (POST /voices/clone, Cartesia-Version 2026-08-14,
    language REQUIRED from a closed 44-code list).
  - `lmnt.voiceClone` (POST /v1/ai/voice, lmnt-version 1.2 — the flat one-file
    form; the old files[]+metadata shape is not typed).
  - `speechify.voiceClone` + `speechify.voiceConsentChallenge` — the consent
    challenge/response ceremony, wire-exact, with the deprecated declarative
    `consent` JSON typed as such.

  Multipart endpoints ship `voiceCloneToFormData` helpers and sit in
  `MULTIPART_ONLY`; every endpoint has its `<Endpoint>Body` alias on
  `unmodel/<provider>/types`.

  ## The categories — `unmodel/voice-clone` and `unmodel/voice-design`

  Two categories, not one `voice()` with a mode flag, by the image-vs-imageEdit
  test: disjoint required fields (audio samples + name vs a text prompt),
  different wire routes at every provider serving both, different model lists —
  and one word, `description`, that means **metadata** on the clone side and
  **the generative prompt** on the design side. Both carry a required
  `operation` literal (`"clone"` / `"design"`) so future arms (remix, re-train)
  land without a break.
  - **`samples` narrows per model at compile time** — stt's `audioInputs`
    mechanism, one field over: `{ file }` at the multipart four, `{ data }` at
    Inworld, `{ fileId }` at MiniMax, with per-route counts (Fish 1–20,
    Cartesia/LMNT/MiniMax exactly one) enforced by the new
    `resolveVoiceSamples` with the bounds in the message.
  - **The wires' asymmetries are vocabulary, not trivia**: `visibility`
    (private/unlisted/public — Fish defaults public, Cartesia private),
    `voiceId` (required by MiniMax, the one wire where the caller mints the
    handle; refused by name everywhere else), per-sample `transcript` (Fish's
    parallel `texts[]`, Inworld's `transcription`, MiniMax's
    `text_validation`), and `previewText` (required at Inworld/MiniMax,
    `auto_generate_text: true` when omitted at ElevenLabs, refused at Fish).
  - **Phase 1 only, by charter.** The packs validate the generative request;
    the provider-minted handle that comes back is yours to use on `unmodel/tts`
    as `voice`. The two-phase saves are wire-only because their correlating
    handles share no vocabulary, and voice _management_ is out of scope.
  - Model refs where the wire has none use **synthetic route-shaped ids**
    (`elevenlabs/ivc`, `fish-audio/fast`, `cartesia/voice-clone`, …), now a
    documented convention in `src/providers/HAND_CATALOGS.md`.

  Both packs are budgeted (`voice-clone` ≤220 KiB, `voice-design` ≤190 KiB,
  measured with the accounting written down), golden-matrixed (one canonical
  request per case compiled at every provider that can express it, exact bodies
  committed), capability-probed (every `unsupported` declaration rejected at the
  canonical path by a real call), and type-tested (the sample-shape table in
  both directions, the ttv_v3 extras gate, the `prompt`/`description` word
  split).

  ## Knock-on structure, all of it measured
  - **minimax grew a `chat.ts` leaf** (the anthropic/google/openai pattern):
    the chat registry imported the minimax barrel, and the new voice validators
    would have ridden into every chat bundle. The import-graph and chat-graph
    tests now pin the leaf.
  - **fish-audio and lmnt split `unified-tts.ts` out of their barrels** for the
    same reason on the tts pack (494 KiB, back under its budget).
  - `inworld/audio-bytes.ts` and `minimax/models.ts` picked up one shared
    helper and one shared enum each, so the voice packs stopped paying ~50 KiB
    for an STT validator and a TTS validator they never call.
