# Types-only and values entries

← back to the [README](../README.md)

Why these entries exist: the official SDKs both accept requests the API rejects and hide parameters a model accepts. Every example below was executed against `openai@7.4.0` and this package; the errors are pasted from real `tsc` runs, not written by hand.

At `size:` on a `gpt-image-2` request, the OpenAI SDK completes **8** values: a mixed DALL·E bag (`256x256`, `1792x1024`, …) offered regardless of model, none of them the 4K, 2:1 or 21:9 resolutions gpt-image-2 renders. Its `(string & {})` tail swallows anything else. unmodel completes the real **23** presets (`2880x2880`, `3840x2160`, `2048x1024`, `3360x1440`, …), each proven against the validator by a test. Free-form `WxH` stays legal, grid and pixel rules enforced:

```ts
import { image } from "unmodel/openai";

image({
  model: "gpt-image-2",
  prompt: "a lighthouse",
  size: "3840x2160" // ✅ unmodel completes 4K. The OpenAI SDK doesn't even suggest it
});
```

Allowed values autocomplete per model. Gemini TTS has exactly 30 preset voices. Type `voice: "` and all 30 complete. An off-list voice is refused with the full list in the message:

```ts
import { tts } from "unmodel/tts";

tts({
  model: "google/gemini-2.5-flash-preview-tts",
  text: "Have a wonderful day!",
  voice: "Kore"
});
// voice: "¦" → completes Zephyr, Puck, Charon, Kore, Fenrir, Leda, Orus, Aoede, … (all 30)
// voice: "Zephyrr" → `voiceName` must be one of the 30 prebuilt Gemini TTS voices; got "Zephyrr".
```

The same lists ship as runtime values for your UI. `GEMINI_TTS_VOICES` from `unmodel/google/values` is the array the validator enforces, by object identity.

## Types only

Already have a client, or build the body in one place and send it from another? Every type is published on its own subpath, and those subpaths ship **no JavaScript at all**.

`unmodel/<provider>/types` is one provider's whole type surface: the doc-corrected wire bodies, the per-model arms, the closed enums and preset unions, the model-id unions, the response `*Like` shapes.

```ts
import type { ImageBody } from "unmodel/openai/types";

const body = {
  model: "gpt-image-2",
  prompt: "a lighthouse at dusk",
  size: "3840x1280",
  background: "transparent",
} satisfies ImageBody;
```

```text
error TS1360: Type '{ model: "gpt-image-2"; prompt: string; size: "3840x1280"; background: "transparent"; }'
  does not satisfy the expected type 'ImageBody'.
  Types of property 'background' are incompatible.
    Type '"transparent"' is not assignable to type '"auto" | "opaque" | null | undefined'.
```

A real `tsc` message, and the point of the entry. `gpt-image-2` returns a 400 for a transparent background, so the type does not have the value. `size` stays open to the documented `WIDTHxHEIGHT` rule space, closed to everything else. Use `satisfies`, not an annotation, so the literal types survive.

Each provider entry exports its **wire names verbatim**: `MessagesBody`, `ListenParams`, `Flux2Body`, straight from the vendor's docs. On top sits one uniform `<Endpoint>Body` alias per endpoint address it serves: `ChatBody`, `TtsBody`, `SttBody`, `ImageBody`, `ImageEditBody`, `VideoBody`, `MusicBody`, plus qualified extras (`ImageFlux1Body`, `TtsStreamBody`, `VideoV3FromImageBody`). Aliases are additions, never renames. Where the alias already *is* the wire name (cohere's `ChatBody`, hume's `TtsBody`), the wire name wins, no duplicate.

`unmodel/types` is the small hub: the canonical camelCase vocabulary the unified surfaces speak (`ChatParams`, `TtsParams`, `SttParams`, `ImageParams`, `ImageEditParams`, `VideoParams`, `MusicParams`, plus `AspectRatio`, `AudioFormat`, `Voice`, `Diarization` and friends), the `"provider/model"` ref unions (`ChatModelRef`, `ChatProviderId`), the result vocabulary (`Issue`, `ValidateResult`, `ResponseReport`, `TranslationWarning`, `Retargeted`).

```ts
import type { ChatParams } from "unmodel/types";

export const prompt = {
  model: "anthropic/claude-sonnet-4-5",
  messages: [{ role: "user", content: "Summarise this." }],
  maxOutputTokens: 512,
} satisfies ChatParams;
```

The hub deliberately does **not** aggregate provider wire types. The 70 provider entries carry ~2,140 type exports. One module naming all of them is a ~900 KB declaration file every consumer parses to reach one interface. Import the provider you actually call.

Three properties are tested rather than promised, in `test/types-entries.test.ts` against a real build:

- **zero runtime**: every one of the 71 entries emits an empty JavaScript module.
- **complete**: every endpoint id the CLI can validate has a `<Endpoint>Body` type on its provider's entry, so no endpoint ships with types a release behind.
- **packaged**: every entry has its `exports` subpath and its build entry.

URL constants, `check*` helpers, `toFormData` and the models tables are runtime values, so they stay on the main subpath (`unmodel/openai`). It tree-shakes to the few bytes a URL string costs, if that is all you import.

## Values

A type cannot be rendered. `unmodel/<provider>/values` publishes the same vocabulary as **runtime arrays**: the voices, sizes, aspect ratios, durations, resolutions, codecs, sample rates, languages, timestamp granularities and model ids behind the enriched types. Use them for the `<select>` a user picks from, and to validate form fields client-side.

```tsx
import { TTS_MODELS, TTS_MODEL_PARAMS } from "unmodel/openai/values";

<select name="model">
  {TTS_MODELS.map((id) => <option key={id}>{id}</option>)}
</select>;

// The row is per model, because the answer is: gpt-4o-mini-tts has 13 voices,
// tts-1 has 9, and offering the wrong nine is a 400 the user sees.
const voices = TTS_MODEL_PARAMS["gpt-4o-mini-tts"].voices;
<select name="voice">
  {voices.map((voice) => <option key={voice}>{voice}</option>)}
</select>;
```

`voices` is on the row only where the provider publishes a closed list, which today is two of the fifteen TTS providers: OpenAI (9 for `tts-1`, 13 for `gpt-4o-mini-tts`) and Google (30 Gemini presets). Everywhere else the catalog is per-account because of cloning, runs to thousands of entries, and turns over between releases, so there is no row and no array to import: fetch the voices from the provider. Deepgram is the exception that looks like one, since its voice *is* the model, which makes `TTS_MODELS` the voice picker.

Where a list does exist, the provider's own name for it is an alias, not a rival:

```ts
import { SPEECH_VOICES, TTS_MODEL_PARAMS } from "unmodel/openai/values";
import { GEMINI_TTS_VOICES, TTS_MODEL_PARAMS as GOOGLE } from "unmodel/google/values";

SPEECH_VOICES === TTS_MODEL_PARAMS["gpt-4o-mini-tts"].voices;            // true
GEMINI_TTS_VOICES === GOOGLE["gemini-2.5-flash-preview-tts"].voices;     // true
```

Each entry exports three uniform names per category it serves: `<CATEGORY>_MODEL_PARAMS`, `<CATEGORY>_MODELS`, and `<CATEGORY>_FORMAT_SPEC` where the category has an audio format spec. Prefixes are `IMAGE_`, `IMAGE_EDIT_`, `VIDEO_`, `TTS_`, `STT_`, `MUSIC_`, `VOICE_CLONE_`, `VOICE_DESIGN_`. Next to those sit the provider's own lists under their own names (`GEMINI_TTS_VOICES`, `GPT_IMAGE_2_SIZES`, `BFL_ASPECT_RATIOS`, `RECRAFT_V3_STYLES`, `KLING_ASPECT_RATIOS`, …). Those are aliases of the same objects the uniform names reach, not a second source of truth, so there is never a question of which one is current. 36 providers ship a values entry: exactly the ones with a unified adapter.

The tables are **the same objects the adapter compiles with**, re-exported not copied, so a picker and the request it builds cannot disagree. `test/values-entries.test.ts` asserts that by reference (`===`), not deep equality.

`unmodel/values` is the canonical hub: the closed unions as arrays.

```ts
import { ASPECT_RATIO_PRESETS, AUDIO_FORMAT_CODECS, CANONICAL_KEY_LISTS } from "unmodel/values";

const isCodec = (value: string): value is (typeof AUDIO_FORMAT_CODECS)[number] =>
  (AUDIO_FORMAT_CODECS as readonly string[]).includes(value);

CANONICAL_KEY_LISTS.tts; // ["model", "text", "voice", "speed", "outputFormat", "language", "providerOptions"]
```

`ASPECT_RATIO_PRESETS`, `RESOLUTION_TIERS`, `VIDEO_RESOLUTIONS`, `IMAGE_OUTPUT_FORMATS`, `OUTPUT_DELIVERIES`, `AUDIO_FORMAT_CODECS`, `AUDIO_CONTAINERS`, `TIMESTAMP_GRANULARITIES`, `AUDIO_INPUT_KINDS`, `CANONICAL_KEY_LISTS` and `CHAT_PROVIDERS`. `test/types/values-hub.test-d.ts` proves each array equal to its union in both directions, so a word added to the vocabulary and forgotten in the array is a compile error, not a picker that quietly offers eight options out of nine.

The 1,339 `"provider/model"` chat refs are the runtime twin of `ChatModelRef`. They get their own subpath because they are 45 KiB:

```ts
import { CHAT_MODEL_REFS } from "unmodel/values/chat-refs";
```

What this costs, measured against a real build, per export, with a tree-shaking bundler. `test/values-entries.test.ts` runs the measurement and holds each entry to a budget:

| Import | Cost |
| --- | --- |
| any one array from `unmodel/values` | 0.2–1.5 KiB |
| the median export of a provider entry | ~1 KiB |
| the most expensive one (`unmodel/runway/values`) | 19.4 KiB |
| `CHAT_MODEL_REFS` | 49 KiB, hence its own subpath |

That is the point of the layout. The per-model tables live on import-free `<category>-params.ts` leaves the adapter also reads, so importing one voice list does not pull that provider's validator, zod schema or catalog. Before that split the same measurement read 30–82 KiB.
