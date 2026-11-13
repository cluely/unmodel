---
"unmodel": patch
---

rime: Coda takes Italian and Dutch, inline phonemes work on English Mist v3, and dropped params warn instead of failing

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
