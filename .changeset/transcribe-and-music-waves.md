---
"unmodel": minor
---

The transcribe and music waves: one `transcribe()` for every speech-to-text
provider, one `music()` for every music provider, and one name for each
endpoint at all of them.

**Endpoint renames (breaking).** The address-vs-wire law says an endpoint's
*address* is uniform across providers even where the wire spelling is not. Eleven
providers spelled the same operation eight different ways; all eleven now
address it as `transcribe`.

| old | new |
| --- | --- |
| `openai.transcription` | `openai.transcribe` |
| `mistral.transcription` | `mistral.transcribe` |
| `elevenlabs.speechToText` | `elevenlabs.transcribe` |
| `soniox.transcriptions` | `soniox.transcribe` |
| `deepgram.listen` | `deepgram.transcribe` |
| `assemblyai.transcript` | `assemblyai.transcribe` |
| `gladia.preRecorded` | `gladia.transcribe` |
| `revai.jobs` | `revai.transcribe` |
| `speechmatics.jobs` | `speechmatics.transcribe` |
| `cartesia.stt` | `cartesia.transcribe` |
| `inworld.transcribe` | (already uniform) |

And the music routes:

| old | new |
| --- | --- |
| `stability.stableAudioTextToAudio` | `stability.music` |
| `stability.stableAudioAudioToAudio` | `stability.musicFromAudio` |
| `stability.stableAudioInpaint` | `stability.musicInpaint` |
| `elevenlabs.music` | (already uniform) |

`openai.transcriptionToFormData` moves with its endpoint to
`transcribeToFormData`, and the module filenames move with the addresses as
they did in the image, speech and video waves: eleven files named for their
wire route (`transcription.ts`, `transcriptions.ts`, `transcript.ts`,
`speech-to-text.ts`, `listen.ts`, `pre-recorded.ts`, `jobs.ts`, `stt.ts`) are
now `transcribe.ts`, and `stability/audio.ts` is `music.ts`. The rename is made
structural by `test/bundle-budget.test.ts`, which asserts each pack can only
reach a provider through a file with the uniform name.

The **realtime** surfaces keep their own names on purpose — a
socket config is a different endpoint from a batch POST, and collapsing the two
would make `transcribe` mean two transports: `elevenlabs.speechToTextRealtime`,
`soniox.realtimeTranscription`, `deepgram.listenLive` / `listenFlux` /
`fluxConfigure`, `cartesia.sttWebsocket` and `inworld.realtimeTranscribeConfig`
are unchanged. Wire-shaped names — `AUDIO_TRANSCRIPTIONS_URL`, `LISTEN_URL`,
`SPEECH_TO_TEXT_URL`, `speechToTextUrl`, `TranscriptBody`, `JobConfig`,
`STABLE_AUDIO_TEXT_TO_AUDIO_URL`, `STABLE_AUDIO_STEPS` — keep their wire
spelling.

**`unmodel/transcribe` now ships a ready-made pack**, and `audio` narrows to the
route **at compile time**. Transcription APIs disagree about how audio arrives,
and the disagreement is per route rather than per provider — so each adapter
declares the shapes its route accepts, and the ref you write decides which ones
type-check:

```ts
import { transcribe } from "unmodel/transcribe";

transcribe({ model: "assemblyai/universal-2", audio: { url } });   // ok
transcribe({ model: "assemblyai/universal-2", audio: { file } });  // compile error
transcribe({ model: "cartesia/ink-whisper",  audio: { file } });   // ok
transcribe({ model: "cartesia/ink-whisper",  audio: { url } });    // compile error
```

One declaration drives both halves: the same array types the caller's `audio`
and backs it at run time with an `unsupported_param` naming the shapes the route
does take, for JavaScript callers and refs built at run time.

The rest of the vocabulary translates the way the others do. `diarization:
{ enabled: true }` reaches four different wire shapes — a flag
(`speaker_labels`, `diarize`, `enable_speaker_diarization`), an enum
(`diarization: "speaker"`), an **inverted** flag (`skip_diarization: false`) and
a flag plus a config object — and a speaker bound the provider has no field for
is an error at `diarization.maxSpeakers` rather than a bound that went nowhere.
`timestamps: "word"` is an array at OpenAI and Mistral, a scalar enum at
ElevenLabs, a boolean at Deepgram and Gladia, and nothing at all at the four
routes that report word timings unconditionally — where `timestamps: "segment"`
is an error naming what they do report.

**`unmodel/music` ships a pack too, and the unit is in the name.**
`durationSeconds: 90` is `music_length_ms: 90000` at ElevenLabs and
`duration: 90` at Stability; the conversion is exact and therefore silent, and a
length that lands between two milliseconds is refused rather than rounded.
Stability's `musicFromAudio` and `musicInpaint` stay wire-only: both take
controls no other provider has, so a canonical vocabulary for them would be a
vocabulary of one.

**One honest gap.** `inworld.transcribe` is registered in the pack and cannot be
called through it: POST /stt/v1/transcribe carries its audio as base64 inside
the JSON body, and a `Blob` cannot be base64-encoded without awaiting, which a
synchronous compile step cannot do. Its adapter declares `audio` unsupported —
so the call does not type-check, and the runtime error names the reason and
points at `unmodel/inworld`, where the endpoint works perfectly well.

**New package exports:** `unmodel/assemblyai/unified`, `unmodel/gladia/unified`,
`unmodel/mistral/unified`, `unmodel/revai/unified`, `unmodel/soniox/unified` and
`unmodel/speechmatics/unified`. Five more providers that serve more than one
media category now split their adapter per category behind the same
`unmodel/<provider>/unified` barrel (`unified-transcribe.ts` /
`unified-music.ts` alongside `unified-speech.ts` / `unified-image.ts`), so no
pack pays for another category's catalog. `unmodel validate` gains
`unified.transcribe` and `unified.music`.
