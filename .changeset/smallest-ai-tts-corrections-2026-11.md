---
"unmodel": patch
---

smallest-ai: correct the Waves TTS character cap, the default model, pricing and two missing body params

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
