---
"unmodel": minor
---

**A container you asked for is never silently dropped.** `resolveAudioFormat`
had one branch that accepted an explicit `outputFormat.container` without
checking it: when an endpoint declares no container list for a codec, it has no
wire field for a container either, so the ask could not be sent — and nothing
said so. `{ format: "opus", container: "webm" }` was an error at
`elevenlabs/music_v1` and a silent success at `fal/fal-ai/elevenlabs/music`.
It is now an `approximated_param` warning naming the container the endpoint
actually serves, and the resolved format reports that container rather than the
one that was asked for. This reaches 2 fal music rows and 3 fal speech rows
generically; every hand-written adapter declares its containers and is
unchanged.

**DiffRhythm sings your prompt, and now says so.** `fal/fal-ai/diffrhythm`'s only
text field is `lyrics` — the words the model sings — so a canonical `prompt`
written there comes back sung verbatim. That compile now carries an
`approximated_param` on `prompt`.

**Two shipped pricing rows were wrong about their own provenance.** The
ElevenLabs catalog claimed elevenlabs.io/pricing/api "publishes no separate USD
rate" for speech-to-speech and for sound effects. The page publishes both, in
the same card set and tier this catalog already reads for Music and Dubbing:
"Voice Changer and Voice Isolator $0.12 per minute. Sound Effects $0.12 per
minute" (verified 2026-08-31). `eleven_multilingual_sts_v2`,
`eleven_english_sts_v2`, `eleven_english_sts_v1` and `eleven_text_to_sound_v2`
now carry `cost.perAudioMinute`, and `unmodel/elevenlabs` exports the two rates
beside the ones it already published:

- `VOICE_CHANGER_PER_AUDIO_MINUTE` (new)
- `SOUND_EFFECTS_PER_AUDIO_MINUTE` (new)

**A codec fal publishes can no longer vanish from a row.** `codegen:fal` now
runs `assertCodecsComplete` over every closed `output_format` enum, the twin of
the `aspect_ratio` guard: each member either canonicalises into the row's
`codecs` or is named in a recorded-refusal set with its argument. The `ogg` and
`m4a` declines at `fal-ai/stable-audio-3/medium/text-to-audio`, and MiniMax's
`url`/`hex` delivery switch, moved out of generator comments into that set.

**The instrumental refusal names its siblings** instead of counting them:
`"fal-ai/elevenlabs/music" and "fal-ai/minimax-music/v2.6" do take one`.

### Corrections for the report this came from

- **Nothing types canonical `instrumental` as `never`.**
  `music.safe({ model: "fal/fal-ai/minimax-music/v2.6", prompt, instrumental: true })`
  compiles and sends `is_instrumental: true`; the same word reaches
  `force_instrumental` at ElevenLabs Music and Mureka's
  `POST /v1/instrumental/generate` route. Only `outputFormat` narrows to `never`
  at a music ref, and only where the row declares no codecs.
- **The wire spelling `is_instrumental` is refused by design**, at both layers,
  and is on no row's `extras`. A gap in the canonical vocabulary is a typed
  refusal, never a wire word smuggled through — so it is not the workaround it
  was taken for.
- `docs/surfaces.md` now states which music words narrow at compile time and
  which refuse at run time, with the executed output of both.
