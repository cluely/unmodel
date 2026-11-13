---
"unmodel": patch
---

rime: retire `arcana`, `arcanav2` and `arcanav3`, replaced by `coda`

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
