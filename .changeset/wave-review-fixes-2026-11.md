---
"unmodel": patch
---

`unmodel/chat` narrows reasoning effort to the target model's documented ladder; `alibaba.chat` accepts Kimi K3's `top_p: 0.95`; Gemini `XHIGH` off Hydrogen warns

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

- `kimi-k3` pins `top_p` at `0.95`. Alibaba documents it as the model's default
  ("| kimi-k3 | … | 1.0 | 0.95 | 0.0 |"), and Moonshot fixes the K3 series at
  it ("`top_p` | Fixed at `0.95`", "passing any other value returns an
  error"). `top_p: 0.95` used to be refused and is now accepted. `top_p: 1` is
  now refused with `invalid_enum_value`. `temperature` (1 only) and
  `presence_penalty` (unpinned) are unchanged.

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
  sampling)`'s `sampling` slot and is what a dialect should wrap: it honours
  the spec's `enums` pins (Kimi's `top_p: 0.95`) and its `fixedSampling:
  "overridden"` reading. `checkSamplingParams` is the unpinned,
  `"rejected"`-only reading, and wrapping it for an overlay with pinned or
  `"overridden"` sampling refuses requests the API fulfils.
