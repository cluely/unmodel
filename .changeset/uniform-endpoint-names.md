---
"unmodel": minor
---

**Breaking: every endpoint is now addressed by its category's verb.**

An endpoint id is public API twice over — it is what `unmodel validate <id>`
takes on the command line, and it is the route label the availability data and
`.toApi` warnings name — so this is the migration guide, and it is complete.
`src/cli-registry.test.ts` is the same list made executable: it pins every
current id and asserts every retired one is gone.

**The law.** An endpoint's *address* is uniform across providers even where the
wire spelling is not. Fifty-plus providers had spelled the same six operations
about thirty different ways — a wire path (`imageToImage`, `text2video`), a
product family (`fluxKontext`, `krea2`), a bare verb (`edit`, `listen`,
`speak`), a plural noun (`images`, `videos`, `jobs`, `generations`) and a noun
phrase (`replaceBackground`, `contentGenerationTasks`). All of them now address
their category as `chat`, `image`, `imageEdit`, `tts`, `stt`, `video`
or `music`, with each *extra* route at a provider qualified by what makes it
different — never the primary one, so the word a caller reaches for first is the
same word everywhere.

**Wire-shaped names deliberately did not move.** `MESSAGES_URL`,
`GenerateContentBody`, `ConverseParams`, `IMAGES_GENERATIONS_URL`, `Flux2Body`,
`TEXT2VIDEO_URL`, `STABLE_AUDIO_TEXT_TO_AUDIO_URL`, `AUDIO_TRANSCRIPTIONS_URL`,
`IDEOGRAM_V3_REMIX_URL`, `StableImageEraseParams`, `JobConfig`, the dialect ids
— all unchanged. The rule is *address-shaped names go uniform, wire-shaped names
keep the wire spelling*, and the reason is that those two kinds of name answer
different questions: an address is "which endpoint do I call", and it should
read the same at every provider; a wire name describes the bytes on the wire,
and respelling it would make the type lie about the request. `docs/decisions.md`
records this as a standing decision so it does not get "corrected" later.

## Chat

| old | new |
| --- | --- |
| `anthropic.messages` | `anthropic.chat` |
| `google.generateContent` | `google.chat` |
| `google-vertex.generateContent` | `google-vertex.chat` |
| `amazon-bedrock.converse` | `amazon-bedrock.chat` |

`openai.chat`, `cohere.chat`, `azure.chat`, `cloudflare-workers-ai.chat` and
every one of the 29 OpenAI-compatible overlays already had the uniform name.
The checkers and constraint tables move with the endpoints:
`anthropic.checkMessages`, `google.checkGenerateContent` and
`amazon-bedrock.checkConverse` are all `checkChat` now (matching
`openai.checkChat`), `messagesConstraints` / `generateContentConstraints` are
`chatConstraints`, `messagesFamilyRules` is `chatFamilyRules`, the
`MessagesSdkTargets` type is `ChatSdkTargets`, and the Bedrock factory's
`AmazonBedrockConverse` type is `AmazonBedrockChat`.

Two **retarget route labels** in the generated availability data changed with
them, because Vertex serves three different wire surfaces and the label has to
say which:

| old label | new label | what it means |
| --- | --- | --- |
| `google-vertex.generateContent` | `google-vertex.chat` | Gemini on Vertex — the surface `createGoogleVertex(…).chat` validates |
| `google-vertex.chat` | `google-vertex.chatMaas` | the OpenAI-compatible MaaS surface Vertex serves `*-maas` models on |
| — | `google-vertex.chatRawPredict` | new, and dormant: the Anthropic-shaped `rawPredict` route Claude-on-Vertex uses. unmodel has no module for it, so those rows stay denied in `data/availability-overrides.json`; the label exists so the rule is already correct when one lands |

## TTS (text to speech)

| old | new |
| --- | --- |
| `elevenlabs.textToSpeech` | `elevenlabs.tts` |
| `cartesia.tts` | `cartesia.tts` |
| `deepgram.speak` | `deepgram.tts` |
| `hume.tts` | `hume.tts` |
| `minimax.t2a` | `minimax.tts` |
| `rime.tts` | `rime.tts` |
| `fish-audio.tts` | `fish-audio.tts` |
| `smallest-ai.tts` | `smallest-ai.tts` |
| `inworld.tts` | `inworld.tts` |
| `murf.speechGenerate` | `murf.tts` |
| `resemble.synthesize` / `resemble.synthesizeStream` | `resemble.tts` / `resemble.ttsStream` |
| `speechify.stream` | `speechify.ttsStream` |

`openai.tts`, `lmnt.tts`, `lmnt.ttsDetailed`, `murf.ttsStream` and
`speechify.tts` were already spelled with the category's verb and moved with
it. The rows where old and new read alike are the providers whose own wire word
was already `tts`. Constraint tables and checkers follow:
`elevenlabs.textToSpeechConstraints` → `ttsConstraints` (likewise cartesia,
rime, smallest-ai, inworld), and `resemble.checkSynthesis` → `checkTts`,
matching `murf.checkTts`.

## STT (speech to text)

| old | new |
| --- | --- |
| `openai.transcription` | `openai.stt` |
| `mistral.transcription` | `mistral.stt` |
| `elevenlabs.speechToText` | `elevenlabs.stt` |
| `soniox.transcriptions` | `soniox.stt` |
| `deepgram.listen` | `deepgram.stt` |
| `assemblyai.transcript` | `assemblyai.stt` |
| `gladia.preRecorded` | `gladia.stt` |
| `revai.jobs` | `revai.stt` |
| `speechmatics.jobs` | `speechmatics.stt` |
| `cartesia.stt` | `cartesia.stt` |

`inworld.stt` moved with the rest of the category; `cartesia.stt` reads alike in
both columns because `stt` was already Cartesia's own wire word.
`openai.transcriptionToFormData` moves with its endpoint to
`openai.sttToFormData`.

## Image generation

| old | new |
| --- | --- |
| `openai.images` | `openai.image` |
| `google.generateImages` | `google.image` |
| `black-forest-labs.flux2` / `black-forest-labs.flux1` | `black-forest-labs.image` / `black-forest-labs.imageFlux1` |
| `ideogram.generate` / `ideogram.generateV4` | `ideogram.image` / `ideogram.imageV4` |
| `recraft.generations` | `recraft.image` |
| `stability.stableImageUltra` / `stableImageCore` / `stableImageSd3` | `stability.image` / `imageCore` / `imageSd3` |
| `luma.imageGenerations` | `luma.image` |
| `bytedance.imageGenerations` | `bytedance.image` |
| `runway.textToImage` | `runway.image` |
| `kling.imageGenerations` / `kling.omniImage` | `kling.image` / `kling.imageOmni` |
| `vidu.reference2image` | `vidu.imageFromReference` |
| `bria.imageGenerate` / `bria.imageGenerateLite` | `bria.image` / `bria.imageLite` |
| `leonardo.generations` | `leonardo.image` |
| `krea.krea2` | `krea.image` |
| `reve.create` / `reve.createV2` | `reve.image` / `reve.imageV2` |

Constraint tables move with them (`openai.imagesConstraints` →
`imageConstraints`, likewise google, black-forest-labs, bytedance, runway and
recraft's family rules).

## Image editing

Twenty-six routes across eight providers, each extra one qualified by *what it
does to the picture* rather than by the wire path or the vendor's product name.

| old | new |
| --- | --- |
| `black-forest-labs.fluxKontext` | `black-forest-labs.imageEdit` |
| `black-forest-labs.fluxFill` | `black-forest-labs.imageEditFill` |
| `black-forest-labs.fluxExpand` | `black-forest-labs.imageEditExpand` |
| `black-forest-labs.fluxErase` | `black-forest-labs.imageEditErase` |
| `black-forest-labs.fluxDeblur` | `black-forest-labs.imageEditDeblur` |
| `black-forest-labs.fluxOutpainting` | `black-forest-labs.imageEditOutpainting` |
| `black-forest-labs.fluxVto` | `black-forest-labs.imageEditVto` |
| `ideogram.edit` | `ideogram.imageEdit` |
| `ideogram.remix` | `ideogram.imageEditRemix` |
| `ideogram.reframe` | `ideogram.imageEditReframe` |
| `ideogram.replaceBackground` | `ideogram.imageEditReplaceBackground` |
| `recraft.imageToImage` | `recraft.imageEdit` |
| `recraft.inpaint` | `recraft.imageEditInpaint` |
| `recraft.outpaint` | `recraft.imageEditOutpaint` |
| `recraft.generateBackground` | `recraft.imageEditGenerateBackground` |
| `recraft.replaceBackground` | `recraft.imageEditReplaceBackground` |
| `stability.stableImageErase` | `stability.imageEditErase` |
| `stability.stableImageInpaint` | `stability.imageEditInpaint` |
| `stability.stableImageOutpaint` | `stability.imageEditOutpaint` |
| `stability.stableImageSearchAndReplace` | `stability.imageEditSearchAndReplace` |
| `stability.stableImageSearchAndRecolor` | `stability.imageEditSearchAndRecolor` |
| `stability.stableImageRemoveBackground` | `stability.imageEditRemoveBackground` |
| `luma.reframeImage` | `luma.imageEditReframe` |
| `reve.edit` | `reve.imageEdit` |
| `reve.remix` | `reve.imageEditRemix` |

`openai.imageEdit` and `bria.imageEdit` already had the uniform name, and
`openai.imageEditToFormData` is unchanged.

## Video

| old | new |
| --- | --- |
| `openai.videos` | `openai.video` |
| `google.generateVideos` | `google.video` |
| `bytedance.contentGenerationTasks` | `bytedance.video` |
| `runway.textToVideo` / `imageToVideo` / `videoToVideo` | `runway.video` / `videoFromImage` / `videoFromVideo` |
| `kling.textToVideo` / `imageToVideo` | `kling.video` / `videoFromImage` |
| `kling.textToVideoV3` / `imageToVideoV3` / `omniVideo` | `kling.videoV3` / `videoV3FromImage` / `videoOmni` |
| `luma.generations` | `luma.video` |
| `luma.modifyVideo` / `reframeVideo` / `upscale` / `addAudio` | `luma.videoModify` / `videoReframe` / `videoUpscale` / `videoAddAudio` |
| `minimax.videoGeneration` / `videoGenerationV2` | `minimax.video` / `videoV2` |
| `vidu.text2video` / `img2video` / `reference2video` | `vidu.video` / `videoFromImage` / `videoFromReference` |
| `pixverse.textToVideo` / `imageToVideo` | `pixverse.video` / `videoFromImage` |
| `lightricks.textToVideo` / `imageToVideo` / `audioToVideo` | `lightricks.video` / `videoFromImage` / `videoFromAudio` |

Constraint tables move with them (`openai.videosConstraints` →
`videoConstraints`, google's `generateVideosConstraints` / `FamilyRules` /
`Models`, runway's three `*Constraints` / `*Required` / `*ShapeRules` triples,
bytedance's `contentGenerationTasksConstraints`, luma's
`modifyVideoConstraints`, vidu's three).

## Music

| old | new |
| --- | --- |
| `stability.stableAudioTextToAudio` | `stability.music` |
| `stability.stableAudioAudioToAudio` | `stability.musicFromAudio` |
| `stability.stableAudioInpaint` | `stability.musicInpaint` |

`elevenlabs.music` already had the uniform name.

## What did *not* get renamed

**The realtime surfaces**, on purpose: a socket config is a different endpoint
from a batch POST, and folding them in would make `tts` and `stt` each
mean two transports. `openai.realtimeSession`, `elevenlabs.textToSpeechStreamInput`,
`elevenlabs.speechToTextRealtime`, `soniox.realtimeTranscription`,
`deepgram.listenLive` / `listenFlux` / `fluxConfigure` / `speakLive`,
`cartesia.ttsWebsocket` / `sttWebsocket`, `inworld.realtimeTranscribeConfig` and
`inworld.realtimeVoiceContext` are all unchanged.

**Module filenames moved with the addresses** — `messages.ts`, `converse.ts`,
`generate-content.ts`, `images-edit.ts`, `kontext.ts`, `transform.ts`,
`listen.ts`, `pre-recorded.ts`, `jobs.ts`, `stt.ts`, `audio.ts` and the rest are
now named for the endpoint they serve. That is not cosmetic:
`test/bundle-budget.test.ts` asserts a unified pack can only reach a provider
through a file with the uniform name, so the rename is structural.

## Migrating

Mechanically: rename the import, rename the CLI id, rename the checker. The
params, the URL, the response and the `.toSdk` targets are all exactly what they
were — this wave changed no wire format and no validation rule.

```diff
- import { messages, checkMessages } from "unmodel/anthropic";
+ import { chat, checkChat } from "unmodel/anthropic";

- import { generateImages } from "unmodel/google";
+ import { image } from "unmodel/google";

- echo "$params" | unmodel validate openai.transcription
+ echo "$params" | unmodel validate openai.stt
```
