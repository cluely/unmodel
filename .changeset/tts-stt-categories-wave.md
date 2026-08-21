---
"unmodel": minor
---

TTS and STT become first-class categories, and Gemini joins both.

Two things happened, and the first is a **breaking rename** of every audio
address in the library.

## 1. `speech` → `tts`, `transcribe` → `stt`

The two audio modalities now carry the names the rest of the world uses for
them, matching `chat` and `image` as first-class category objects. This is the
address-vs-wire naming law applied to the category verb itself: the *addresses*
move, the *wire* names do not.

**The two subpaths:**

| old | new |
| --- | --- |
| `unmodel/speech` | `unmodel/tts` |
| `unmodel/transcribe` | `unmodel/stt` |

`speech` / `createSpeech` are now `tts` / `createTts`; `transcribe` /
`createTranscribe` are now `stt` / `createStt`. The CLI ids moved with them:
`unified.speech` → `unified.tts`, `unified.transcribe` → `unified.stt`.

**The 29 endpoint ids** (every one of these is also the export name, the module
filename, and the CLI id):

| old | new |
| --- | --- |
| `openai.speech` | `openai.tts` |
| `cartesia.speech` | `cartesia.tts` |
| `deepgram.speech` | `deepgram.tts` |
| `elevenlabs.speech` | `elevenlabs.tts` |
| `fish-audio.speech` | `fish-audio.tts` |
| `hume.speech` | `hume.tts` |
| `inworld.speech` | `inworld.tts` |
| `lmnt.speech` | `lmnt.tts` |
| `lmnt.speechDetailed` | `lmnt.ttsDetailed` |
| `minimax.speech` | `minimax.tts` |
| `murf.speech` | `murf.tts` |
| `murf.speechStream` | `murf.ttsStream` |
| `resemble.speech` | `resemble.tts` |
| `resemble.speechStream` | `resemble.ttsStream` |
| `rime.speech` | `rime.tts` |
| `smallest-ai.speech` | `smallest-ai.tts` |
| `speechify.speech` | `speechify.tts` |
| `speechify.speechStream` | `speechify.ttsStream` |
| `openai.transcribe` | `openai.stt` |
| `assemblyai.transcribe` | `assemblyai.stt` |
| `cartesia.transcribe` | `cartesia.stt` |
| `deepgram.transcribe` | `deepgram.stt` |
| `elevenlabs.transcribe` | `elevenlabs.stt` |
| `gladia.transcribe` | `gladia.stt` |
| `inworld.transcribe` | `inworld.stt` |
| `mistral.transcribe` | `mistral.stt` |
| `revai.transcribe` | `revai.stt` |
| `soniox.transcribe` | `soniox.stt` |
| `speechmatics.transcribe` | `speechmatics.stt` |

`openai.transcribeToFormData` is `openai.sttToFormData`; every `*Constraints`,
`check*`, `*SdkTargets` and `unified-*` sibling followed its endpoint
(`cartesia.speechConstraints` → `ttsConstraints`, `unified-speech.ts` →
`unified-tts.ts`, and so on).

**The category-named types**, in one line: `SpeechParams` → `TtsParams`,
`TranscribeParams` → `SttParams`, and every sibling with them —
`*ParamsBase`, `*ParamsFor`, `*ModelParams`, `*ModelParamTable`,
`*ModelNarrowing`, `*AdapterFor`, `*Validator`, `Any*Adapter`. The kernel's
category ids are `"tts"` and `"stt"`.

**Wire-shaped names are untouched**, deliberately, because they describe bytes
rather than addresses: `elevenlabs.TEXT_TO_SPEECH_BASE_URL`, `minimax.T2A_URL`,
`deepgram.SpeakParams`, `elevenlabs.speechToTextRealtime`, MiniMax's
`speech-*` model ids, and every realtime socket surface read exactly as they
did. So does `AudioFormatSpec`, `Voice`, `Diarization` and the rest of the
shared audio vocabulary — those are not category addresses.

## 2. Gemini joins both packs

Google has no speech endpoint: TTS is `:generateContent` with
`responseModalities: ["AUDIO"]` + a `speechConfig`, and STT is
`:generateContent` with audio parts. Until now that meant Gemini speech was
typed as *chat*. It now has two dedicated surfaces — and the chat route keeps
serving the same ids, because a validator that refused a request the API
fulfils is the one failure this library must never have. See
`docs/decisions.md` §4 for why one wire route carries three addresses.

**New: `tts` at `unmodel/google`** (plus `checkTts`, `generateTtsUrl`,
`ttsStreamUrl`, `ttsSupportsStreaming`, `ttsModels`). A Tier-A view of the same
bytes `google.chat` sends:

- `generationConfig` is **required** and its `responseModalities` is pinned to
  `["AUDIO"]`;
- every chat-only knob is `?: never` — tools, structured output, `imageConfig`,
  media resolution, sampling penalties, including the ones nested under
  `generationConfig`;
- `speechConfig` is a compile-time **XOR** of its single- and multi-speaker
  arms, and `speakerVoiceConfigs` is a bounded `[one] | [one, two]` tuple
  (the guide says up to 2);
- `voiceName` is the closed 30-voice preset list, from the same `as const`
  array the runtime check reads;
- `languageCode` completes the **78** primary language subtags the
  speech-generation guide tabulates (hand-transcribed 2026-08-21, count pinned),
  with a `(string & {})` tail and a *warning* — not an error — off-list;
- `responseFormat.audio` is a discriminated union, so `bitRate` exists only on
  the compressed arms and asking for one on raw PCM is refused;
- the estimate is bounded by the real 32,768-token TTS session limit.

Five new checks (`responseFormat.audio` enums, the `bitRate` rule, sample-rate
sanity and band, off-table `languageCode`) live in **one shared battery** both
surfaces call, so `google.chat` gained them too and the two cannot drift.
`google.chat` on a TTS id without `["AUDIO"]` now names `google.tts` and
`unmodel/tts` in the error.

**New: `stt` at `unmodel/google`** (plus `checkStt`, `generateSttUrl`). 13
curated Gemini ids; the 6 audio-capable ids it deliberately does not serve are
listed **by name and reason** (`gemini-3.1-flash-live-preview` and
`gemini-3.5-live-translate-preview` are Live API/WebSocket, `gemini-embedding-2`
is `:embedContent`, `gemini-robotics-er-1.6-preview` has no documented
transcription behaviour, the two Deep Research previews are an agentic surface),
and a drift test asserts every audio-input catalog id is curated **or**
excluded — a codegen refresh has to classify a new model, not absorb it.
`contents` narrows to text and audio parts only, `inlineData.mimeType` is the
closed seven-value audio set, and `audioTranscriptionConfig` is fully typed:
its acceptance on the **unary** route was verified against the live API (200
for `{ wordTimestamp, diarization }`, and Google 400s unknown fields, so
acceptance is proof) rather than inferred from the Live API's docs.

**Both unified packs grew**: `unmodel/tts` 14 → **15** providers,
`unmodel/stt` 11 → **12**. `tts({ model: "google/…" })` maps `voice`,
`outputFormat`, `language` (via the primary subtag, warning on a dropped
regional one) and nests the extras; `stt({ model: "google/…" })` maps
`language`/`languages`/`timestamps: "word"`/`diarization.enabled` onto
`audioTranscriptionConfig`.

## 3. The `data` audio-input kind

`AudioInputKind` gains a fourth member, `"data"` — `{ data, mimeType? }`,
`DataRef` verbatim, the same shape `image`, `image-edit` and `video` already
carry. `mimeType` is optional in the vocabulary and required by whichever
adapter cannot sniff the format; Gemini's refusal names all seven MIME
spellings it takes.

This retires a real wart: **inworld's `audioInputs` was `[]`** — a provider
registered in the STT pack that no canonical request could reach, because its
route takes base64 in the JSON body and the vocabulary had no word for that.
It is now `["data"]` and `stt({ model: "inworld/inworld/inworld-stt-1", audio:
{ data } })` compiles and validates. `google.stt` declares
`["data", "fileId"]`; `{ url }` is refused with the Files-API upload path
spelled out, because `fileData.fileUri` is a Files API name and Gemini fetches
no third-party host.

## 4. `computeCostUSD` prices audio input

`TokenBreakdown` gains an **`audioInputTokens`** slot, re-rated the way
`cachedInputTokens` already is: subtracted from fresh input and billed at the
catalog's `inputAudio` rate, falling back to `input` where a model publishes
none. It is the first consumer of the `inputAudio` rates the hand catalogs have
been carrying.

`google.stt` fills it: audio tokens are `ceil(durationSeconds × 32)` — 32
tokens per second, documented — read from `options.media`. Declaring a duration
turns the estimate into a real number:

```ts
stt.safe(params, { media: [{ path: ["contents", 0, "parts", 0], durationSeconds: 600 }] });
// estimate: { inputTokens: 19204, costUSD: 0.18304120000000002 }
```

Duration is the caller's to declare, so an undeclared clip is normally silent —
except with `maxCostUSD` set, where the same call now warns
(`media_duration_undeclared`) rather than passing a budget check made on a known
undercount. `checkChat` / `checkStt` also read the real per-modality counts
Gemini returns in `usageMetadata.promptTokensDetails`.

## Budgets

Three committed bundle budgets moved, each set to measured × 1.07 with the
module-naming rationale the file demands:

| entry | old | new | why |
| --- | --- | --- | --- |
| `unmodel/google` | 235 KiB | 310 KiB | two new endpoints and their leaves — `tts.ts`, `stt.ts`, `tts-checks.ts`, `tts-check.ts`, `tts-models.ts`, `tts-constraints.ts`, `audio-constraints.ts`. All google's own; nothing foreign leaked in |
| `unmodel/tts` | 430 KiB | 500 KiB | Gemini's hand TTS catalog and the 78-language table. The zero-catalog pin **stays** — the pack still reaches no generated catalog, which is why `tts-constraints.ts` is an import-free leaf rather than part of `constraints.ts` |
| `unmodel/stt` | 420 KiB | 520 KiB | `google.stt` reads the generated `google.gen` catalog (there is no doc correction to make, so hand rows would be a second opinion on generated data — the `mistral.gen` precedent) |
