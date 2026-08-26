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

### Errors, and why none of them is worth retrying

Two error classes leave this library, and each carries a static `isInstance` — the supported check, and the one to reach for:

```ts
import { TranslationUnavailableError, UnmodelValidationError } from "unmodel";

try {
  await callTheModel(params);
} catch (error) {
  if (UnmodelValidationError.isInstance(error)) error.issues; // [{ code: "invalid_shape", path: ["max_tokens"], … }]
  if (TranslationUnavailableError.isInstance(error)) error.message;
  throw error;
}
```

Prefer it over `instanceof`. Two copies of unmodel in one dependency tree — or a Worker, a `vm` context, an iframe — give you a structurally identical class from a different realm, and `instanceof` answers `false` for every one of them.

**Both are deterministic, and neither is ever worth a retry.** Validation is a pure function of the params: no network, no clock, no shared state, so the second attempt fails on the same issue as the first. There is no `retryable` field on an unmodel error and deliberately will not be one — a field that reads `false` on 100% of instances is a field that invites a caller to branch on it as though it might one day read `true`.

That leaves two shapes worth writing, and durable-execution runtimes are where the difference shows. Validate **before** the step, so a bad request never becomes a retried one:

```ts
const result = chat.safe(params);
if (!result.ok) return { rejected: result.errors }; // never reaches the durable step
await step.do("call-model", () => fetch(url, { method: "POST", body: JSON.stringify(result.params) }));
```

Or classify **at the catch** and rethrow as your runtime's terminal error, which is one line in every one of them:

```ts
import { NonRetryableError } from "cloudflare:workflows";

await step.do("call-model", async () => {
  try {
    return await callTheModel(params);
  } catch (error) {
    if (UnmodelValidationError.isInstance(error)) throw new NonRetryableError(error.message);
    throw error; // a 429, a 5xx, a socket hang-up — those are the retryable ones
  }
});
```

Temporal spells that `ApplicationFailure.nonRetryable(...)`, Inngest `NonRetriableError`, Restate `TerminalError`. Same shape, different import.

**Classify before the boundary, not after it.** `structuredClone` — what a durable runtime uses to persist a failure across a step, and what `postMessage` does across a worker — does not round-trip a custom error:

```ts
const clone = structuredClone(new UnmodelValidationError("openai.chat", issues));
clone.name;                                 // "Error"  ← not "UnmodelValidationError"
(clone as UnmodelValidationError).issues;   // undefined
UnmodelValidationError.isInstance(clone);   // false
```

The clone keeps `message` and `stack` and nothing else: `name` collapses to `"Error"` because the structured-clone algorithm only preserves the seven native error names, and `issues` is an own property, which it does not carry at all. So an `isInstance` check on the far side of a serialization boundary reports "not a validation error" about a validation error. Decide on the near side and carry the decision, not the instance.

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

`.toApiSafe(provider)` is the non-throwing form. Retargeting reruns the destination deny/enum rules it has available. For full schema, nested, catalog, context, and budget checks, pass the result through the destination validator. One hop.

## Retarget media

Media requests retarget too, to exactly one destination: `.toApi("fal")`, which moves a validated native image, video or speech request onto fal's queue — same model, same vendor, different host.

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
onFal.warnings;    // []  ← empty means the mapping was exact
onFal.toSdk("fal");// { input: { … } } for @fal-ai/client

video({ model_name: "kling-v1", prompt: "…" }).toApi("fal");
//                                             ~~~~~ TypeScript error: fal serves no Kling v1
```

It is a different mechanism from chat's, not the same one widened, and the differences are the ones you will feel:

- **The target union is hand-written, not generated.** models.dev carries no media availability, so which models fal also serves was looked up endpoint page by endpoint page. A model that is not in the table has no `.toApi` on its result type at all — where chat degrades an unrecognised model to the full target union (its catalog is a snapshot that lags releases), a hand table has no such excuse.
- **The auth scheme changes.** fal wants `authorization: Key <FAL_KEY>` — the literal word `Key`, which fal's own OpenAPI document omits. Your Kling key went in `authorization: Bearer`.
- **A parameter fal cannot express is an error, not a dropped field.** A derived or snapped value is exactly one `approximated_param` warning carrying what you asked for and what was achieved. So `warnings.length === 0` *means* the mapping was exact.
- **Native → fal only, one hop.** A fal body has nowhere left to go, and fal → native would have to guess which native route an endpoint id came from.

Which families ship, which are deliberately refused, and why: [docs/providers.md](providers.md#media-retargeting--toapifal).

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
