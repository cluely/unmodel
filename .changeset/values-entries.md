---
"unmodel": minor
---

**The runtime lists behind the types: `unmodel/<provider>/values` and a
`unmodel/values` hub.**

`unmodel/<provider>/types` gave a client-side app the shapes. It could not give
it the *values*: which voices `openai/gpt-4o-mini-tts` has, which sizes
`gpt-image-2` takes, which durations `kling-v2-5-turbo-pro` allows. A type
cannot be mapped over, so every app that wanted a picker retyped the list by
hand — and that copy is wrong the day a provider adds a voice.

Those lists now ship as arrays. 36 providers — exactly the ones with a unified
adapter — publish `unmodel/<provider>/values`, and every entry names the same
uniform exports for each category it serves:

```tsx
import { TTS_MODELS, TTS_MODEL_PARAMS } from "unmodel/openai/values";

<select name="voice">
  {TTS_MODEL_PARAMS["gpt-4o-mini-tts"].voices.map((v) => <option key={v}>{v}</option>)}
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

| Import | Cost |
| --- | --- |
| any array from `unmodel/values` | 0.2–1.5 KiB |
| the median provider export | ~1 KiB |
| the worst (`unmodel/runway/values`) | 19.4 KiB |
| `CHAT_MODEL_REFS` | 49 KiB |

`test/values-entries.test.ts` runs that measurement for all 267 provider exports
on every test run and holds each to a budget; `test/import-graph.test.ts`
(amendment A9) holds the source-level rule that makes it possible — a values
entry names only its own provider directory, and never an adapter.

Nothing was renamed or removed. The six media packs and the provider entries
carry the same modules they did; splitting the data onto its own leaves cost
~0.65 KiB per leaf in unminified ESM, which moved four pack budgets and is
accounted for module by module where those budgets are declared.
