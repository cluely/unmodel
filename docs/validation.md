# Validation, cost, retargeting, response checks

← back to the [README](../README.md)

## Validation

Invalid params throw `UnmodelValidationError`. An unregistered or structurally unavailable translation throws `TranslationUnavailableError`. Use `.safe()` to get either back as issues:

```ts
const result = chat.safe({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "Hello!" }],
});

if (result.ok) {
  result.params;   // validated provider body
  result.warnings; // non-fatal validation findings
  result.estimate; // input tokens and worst-case cost, when known

  result.params.warnings;
  // unified compilation loss: approximated_param, dropped_param, ...
} else {
  result.errors;
}
```

Use `.safe()` for typed values. The seven standardized surfaces also expose `.safeUnknown()` for JSON, queues, and other untrusted boundaries:

```ts
const value: unknown = JSON.parse(text);
const result = image.safeUnknown(value);
```

Keeping them separate preserves exact-key and model-specific inference on normal TypeScript calls. Direct provider validators expose `.safe()`. `.safeUnknown()` belongs to the standardized surfaces.

For standardized calls, `result.warnings` reports validation findings and `result.params.warnings` reports compilation loss. The throwing form exposes the latter as `request.warnings`.

### What is checked

- Shape, unknown fields, enums, and mutually exclusive params
- Model existence, deprecation, capabilities, and per-model exceptions
- Context, input, output, media, and provider-specific limits
- Estimated budget via `maxCostUSD`
- Unsupported or lossy unified translations

Unified compilation never drops intent silently:

| Mapping | Media packs | Chat |
| --- | --- | --- |
| Exact | no warning | no warning |
| Approximate | `approximated_param` warning | `approximated_param` warning |
| No target representation | validation error | explicit `dropped_*` warning |

```ts
const request = image({
  model: "black-forest-labs/flux-pro-1.1",
  prompt: "a lighthouse in fog",
  aspectRatio: "16:9",
  resolution: "1k",
});

request.warnings[0];
// → [approximated_param] 16:9 at 1k became 1344×768 on this model's 32px grid
```

Known `providerOptions` fields get types, autocomplete, and provider validation. Unknown keys stay accepted for forward compatibility and may produce `unknown_param` warnings:

```ts
image({
  model: "vidu/viduq1",
  prompt: "a quiet train platform",
  providerOptions: {
    vidu: { images: ["https://example.com/reference.png"] },
  },
});
```

### Options

Pass unmodel options as the second argument so the request body stays provider-native:

```ts
const result = chat.safe(params, {
  maxCostUSD: 0.05,
  tokenizer: { count: (text) => tokenizer.encode(text).length },
  severity: { near_context: "error", deprecated_model: "off" },
  media: [{ path: ["messages", 0, "content", 0], durationSeconds: 42 }],
});
```

`media[].path` uses the vocabulary you called: canonical paths for unified entries, wire paths for provider entries.

### Future model IDs

Model-discriminated body aliases that expose a future-model generic are closed over known models by default:

```ts
import type { ImagesBody } from "unmodel/openai";

const future: ImagesBody<"gpt-image-9"> = {
  model: "gpt-image-9",
  prompt: "a watercolor fox",
  experimental_option: true,
};
```

Use `<string>` only for model IDs genuinely discovered at runtime. It gives up per-model narrowing on purpose.

A new model at a registered provider stays callable. It emits `unknown_model` and continues with the checks that do not need catalog metadata.

## Estimating cost

`.safe()` carries an `estimate` alongside the validated body, and `maxCostUSD` turns that estimate into a gate:

```ts
const result = tts.safe(
  { model: "elevenlabs/eleven_multilingual_v2", text: "The lighthouse is ready.", voice: voiceId },
  { maxCostUSD: 0.01 },
);

result.ok && result.estimate.costUSD; // 0.0024
```

Over budget is an error, not a warning, so a runaway request never leaves the process:

```ts
// text.length === 2000, maxCostUSD: 0.0001
result.errors[0].message;
// → "Estimated worst-case cost $0.2000 exceeds maxCostUSD $0.0001."
```

The arithmetic behind it is public. `resolveModelInfo` finds the row, `computeCharacterCostUSD` / `computeAudioMinutesCostUSD` / `computeCostUSD` price it, and all four are root exports:

```ts
import { computeCharacterCostUSD, resolveModelInfo } from "unmodel";
import { models } from "unmodel/elevenlabs";

const info = resolveModelInfo(models, "eleven_multilingual_v2");
info?.cost; // { perMillionCharacters: 100 }
computeCharacterCostUSD(info?.cost, "The lighthouse is ready.".length); // 0.0024
```

Reach for those when you are pricing text you have not validated yet. For a request you are about to send, `estimate.costUSD` is already the answer, and it is the more correct one: it uses the basis the provider bills in, which is not always characters. Fish Audio prices UTF-8 bytes, so CJK costs about 3x what a `.length` estimator would report. Hume multiplies by `num_generations`. Gemini prices the full worst-case token ceiling.

Two absences are deliberate and mean exactly what they say. `gpt-4o-mini-tts` is token-billed on audio tokens whose count is unknowable before the call, so it gets no per-call estimate rather than a guess. Cartesia bills in credits with no published USD rate, and Resemble publishes none either. In all three `estimate.costUSD === undefined` is the honest answer, not a bug; the rationale for each lives in that provider's `models.ts` docblock.

## Retarget chat

Chat validators backed by an availability map expose `.toApi(provider)`. It moves one validated request to another provider that serves the same model:

```ts
import { chat } from "unmodel/anthropic";

const request = chat({
  model: "claude-opus-5",
  max_tokens: 4096,
  thinking: { type: "enabled", budget_tokens: 2048 },
  messages: [{ role: "user", content: "Explain retargeting." }],
});

const moved = request.toApi("openrouter");
moved.model;       // "anthropic/claude-opus-5"
moved.request.url; // https://openrouter.ai/api/v1/chat/completions
moved.warnings;    // id respelling or lossy translations

request.toApi("openai");
//            ~~~~~~~~ TypeScript error: OpenAI does not serve Claude
```

The auth header moves with the provider and is the one thing the moved request cannot carry for you: that request now wants `authorization: Bearer …`, not `x-api-key`. `CHAT_AUTH` from `unmodel/chat` is the lookup, keyed the same way the ref is, and it holds header names only.

```ts
import { CHAT_AUTH } from "unmodel/chat";

CHAT_AUTH.anthropic;  // { header: "x-api-key" }
CHAT_AUTH.openrouter; // { header: "authorization", scheme: "Bearer" }
```

`.toApiSafe(provider)` is the non-throwing form. Retargeting reruns the destination deny/enum rules it has available. For full schema, nested, catalog, context, and budget checks, pass the result through the destination validator. Chat-only, one hop.

## Check responses

Provider `check*` helpers inspect raw responses and normalize quality and usage signals:

```ts
import { checkChat } from "unmodel/openai";

const payload = await response.json();
if (!response.ok) throw new Error(`Provider error ${response.status}`);

const report = checkChat(payload);
report.warnings;     // truncation, filtering, refusals
report.finishReason; // normalized finish reason
report.usage;        // input, output, cached, reasoning
report.costUSD;      // actual cost from catalog rates
```

Every chat provider uses `checkChat`. Use the checker from the provider that returned the response: change the request provider and the response shape changes with it. Handle HTTP/API error payloads before calling a checker. Media checker names follow their response documents, such as `checkImages`, `checkTranscription`, `checkListen`, or `checkTts`.
