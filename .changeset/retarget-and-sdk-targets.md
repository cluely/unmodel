---
"unmodel": minor
---

**Breaking:** `.toSdk()` now takes a target, and chat validators gain `.toApi(provider)`.

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
  `messages({ model: "claude-opus-5", … }).toApi("openai")` is a compile error rather than
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
