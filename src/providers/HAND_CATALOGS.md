# Hand-maintained catalogs

Some providers (speech, image, video vendors) are absent from models.dev, so
they cannot get a generated `src/catalog/<id>.gen.ts`. Those providers keep a
hand-written `models.ts` colocated with their validator instead.

Rules, identical to the codegen contract:

- `export const models = { ... } as const satisfies Record<string, ModelInfo>;`
  and id unions derived from it (`export type FooModelId = keyof typeof models;`).
- Header comment at the top of the file:
  `// Hand-maintained — <provider> is not in models.dev; refresh from <pricing/docs URLs>.`
  Keep the refresh URLs current — they are the file's provenance.
- `limit.context: 0` for non-token models (TTS/STT/image/video) — the
  pipeline skips context-window checks when `context` is 0.
- Media pricing lives on `ModelCost`: `perMillionCharacters` (TTS input),
  `perAudioMinute` (STT), `perImage`, `perVideoSecond`. TTS input caps live on
  `ModelLimit.characters`. Cost helpers: `computeCharacterCostUSD` /
  `computeAudioMinutesCostUSD` in `src/core/cost.ts`.
