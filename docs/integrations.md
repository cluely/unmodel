# Sending, catalog, CLI

← back to the [README](../README.md)

## Send requests

### Fetch

For JSON endpoints, `toRequestInit` turns a validated result into fetch's arguments:

```ts
import { toRequestInit } from "unmodel";

const { url, ...init } = toRequestInit(request);
await fetch(url, {
  ...init,
  headers: { ...init.headers, authorization: `Bearer ${apiKey}` },
});
```

`.request.headers` holds the required static headers such as `content-type` or `anthropic-version`. Never credentials, which is why `toRequestInit` takes no key: it hands back `{ url, method, headers, body }` and you add the auth header. `headers` is a copy, so mutating it is safe. It never calls `fetch` and unmodel never sends anything.

Multipart endpoints cannot reach it, and that is enforced at compile time rather than documented: their result type declares `body: "form"`, so passing one to `toRequestInit` is a type error naming the `toFormData` helper to use instead.

### Provider SDKs

`.toSdk(target)` returns an endpoint's declared handoff shape. Official SDK targets are reshaped as needed. Providers without an official SDK may expose their wire shape:

```ts
import OpenAI from "openai";
import { chat } from "unmodel/openai";

const client = new OpenAI();
const request = chat({
  model: "gpt-5.2",
  messages: [{ role: "user", content: "Hello!" }],
});

await client.chat.completions.create(request.toSdk("openai"));
```

Targets are typed per endpoint and always explicit. Google uses `"google"`, Vertex uses `"google-vertex"`, and OpenAI-compatible, Anthropic, Google, and Vertex chat endpoints expose `"ai-sdk"`.

### Vercel AI SDK

```sh
npm install ai @ai-sdk/openai
```

```ts
import { generateText } from "ai";
import { openai as model } from "@ai-sdk/openai";
import { chat } from "unmodel/chat";

const request = chat({
  model: "openai/gpt-5.2",
  messages: [{ role: "user", content: "Hello!" }],
});

await generateText({
  model: model("gpt-5.2"),
  ...request.toSdk("ai-sdk"),
});
```

For tools, wrap the emitted JSON Schemas with your AI SDK's `jsonSchema`:

```ts
import { jsonSchema } from "ai";
import { withJsonSchemaTools } from "unmodel/ai-sdk";

const options = withJsonSchemaTools(request.toSdk("ai-sdk"), jsonSchema);
```

`"ai-sdk"` is an SDK target. `"vercel"` in `.toApi("vercel")` means Vercel AI Gateway.

### Multipart and WebSockets

Multipart endpoints export form-data helpers such as `sttToFormData`, `imageEditToFormData`, or provider-level `toFormData`. Do not set `content-type`. `fetch` adds the boundary.

WebSocket validators return either a ready `wss://` URL in `.request.url` or a validated first-frame/config object plus a provider URL builder.

## Catalog and CLI

Read the generated models.dev snapshot:

```ts
import { getModel, getProvider } from "unmodel/catalog";

const model = getModel("openai", "gpt-5.2");
model?.limit.context;
model?.limit.output;
model?.cost?.input;

const provider = getProvider("anthropic");
```

Catalog model IDs are plain strings. Provider modules export generated model unions for autocomplete. Request validators may still accept future IDs and warn at runtime.

`getModel` reads the models.dev snapshot and nothing else, so it is a chat-and-LLM surface. models.dev does not cover speech, image or video models, and their catalogs are hand-maintained per provider instead, which means `getModel("openai", "gpt-4o-mini-tts")` is `undefined` rather than a row with no price. Those catalogs are exported under their provider's own subpath:

```ts
import { models } from "unmodel/elevenlabs";

models["eleven_multilingual_v2"].cost; // { perMillionCharacters: 100 }
```

Single-category providers export one `models`; the multi-category ones name the catalog after the category (`speechModels`, `transcriptionModels`, and so on at `unmodel/openai`). Either way `resolveModelInfo(catalog, id)` is the lookup, and it is the one that handles dated snapshots and aliases.

Query and validate from the terminal:

```sh
npx unmodel models openai gpt-5.2
npx unmodel validate openai.chat request.json
npx unmodel validate unified.image image.json --max-cost 0.05
npx unmodel validate unified.stt transcription.json --json
```

`validate` exits non-zero for invalid params. Blob-only inputs stay library-only because JSON cannot represent them.

## Providers

Each implemented provider validator has its own subpath with native field names, model IDs, routes, pricing, and quirks:

```ts
import { chat, image, imageEdit, tts, stt, video } from "unmodel/openai";
```

Providers whose URL depends on your account expose factories:

- `createAzure({ endpoint })`
- `createGoogleVertex({ project, location })`
- `createAmazonBedrock({ region })`
- `createCloudflare(accountId)`

The [provider roster](providers.md) lists every validator, unified adapter, SDK target, transport, and planned endpoint. Catalog metadata may include embeddings or rerank models, but those request validators are not implemented yet.

For a proxy or self-hosted Chat Completions endpoint, build a validator with `createOpenAICompatible` from `unmodel/openai-compatible`.
