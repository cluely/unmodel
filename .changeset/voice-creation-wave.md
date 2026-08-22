---
"unmodel": minor
---

**Voice creation is now a first-class, validated capability — two new
categories, thirteen new wire-exact endpoints, and the packs on top.**

Creating a voice used to be the hole the library talked around: ElevenLabs'
text-to-voice models sat in the catalog with a "which unmodel does not
validate" note, Fish Audio's inline cloning payload was deliberately excluded
from unified TTS, and Speechify's clone routes carried a `NOT VALIDATED HERE`.
This wave closes it, in the order `docs/providers.md` has always prescribed:
wire-exact subpaths first, adapters second.

## The wire wave — 13 endpoints across 7 providers

Every shape was verified against the provider's API reference AND its official
SDK types / OpenAPI (the resolver where the prose docs disagreed with
themselves — Fish's `reference_text` cap is 150, not the feature page's 300;
Cartesia's pre-2026 `mode`/`enhance`/`transcript` fields are gone; MiniMax's
spelling is `need_volume_normalization`, whatever third-party samples say):

- `elevenlabs.voiceClone` (POST /v1/voices/add — IVC, multipart),
  `elevenlabs.voiceDesign` (POST /v1/text-to-voice/design, with the
  ttv_v3-only field gate) and `elevenlabs.voiceDesignSave` (POST
  /v1/text-to-voice — the phase-2 save, deliberately wire-only).
- `fish-audio.voiceClone` (POST /model — voices 1–20, the
  visibility-defaults-to-PUBLIC footgun warned on omission, cover_image
  required-if-public) and `fish-audio.voiceDesign` (POST /v1/voice-design,
  required `model: voice-design-1` header, $0.01/request estimated flat).
- `inworld.voiceClone` (voices:clone — base64 samples, 4MB cap checked from
  the payload), `inworld.voiceDesign` (designPrompt 30–250) and
  `inworld.voiceDesignPublish` (the draft-voice save, wire-only).
- `minimax.voiceClone` (POST /v1/voice_clone — the caller-chosen `voice_id`
  grammar enforced; preview text priced at the chosen speech model's rate;
  `toVoiceUploadFormData` builds the upload prerequisite) and
  `minimax.voiceDesign` (single-phase; preview text priced at $30/1M chars).
- `cartesia.voiceClone` (POST /voices/clone, Cartesia-Version 2026-08-14,
  language REQUIRED from a closed 44-code list).
- `lmnt.voiceClone` (POST /v1/ai/voice, lmnt-version 1.2 — the flat one-file
  form; the old files[]+metadata shape is not typed).
- `speechify.voiceClone` + `speechify.voiceConsentChallenge` — the consent
  challenge/response ceremony, wire-exact, with the deprecated declarative
  `consent` JSON typed as such.

Multipart endpoints ship `voiceCloneToFormData` helpers and sit in
`MULTIPART_ONLY`; every endpoint has its `<Endpoint>Body` alias on
`unmodel/<provider>/types`.

## The categories — `unmodel/voice-clone` and `unmodel/voice-design`

Two categories, not one `voice()` with a mode flag, by the image-vs-imageEdit
test: disjoint required fields (audio samples + name vs a text prompt),
different wire routes at every provider serving both, different model lists —
and one word, `description`, that means **metadata** on the clone side and
**the generative prompt** on the design side. Both carry a required
`operation` literal (`"clone"` / `"design"`) so future arms (remix, re-train)
land without a break.

- **`samples` narrows per model at compile time** — stt's `audioInputs`
  mechanism, one field over: `{ file }` at the multipart four, `{ data }` at
  Inworld, `{ fileId }` at MiniMax, with per-route counts (Fish 1–20,
  Cartesia/LMNT/MiniMax exactly one) enforced by the new
  `resolveVoiceSamples` with the bounds in the message.
- **The wires' asymmetries are vocabulary, not trivia**: `visibility`
  (private/unlisted/public — Fish defaults public, Cartesia private),
  `voiceId` (required by MiniMax, the one wire where the caller mints the
  handle; refused by name everywhere else), per-sample `transcript` (Fish's
  parallel `texts[]`, Inworld's `transcription`, MiniMax's
  `text_validation`), and `previewText` (required at Inworld/MiniMax,
  `auto_generate_text: true` when omitted at ElevenLabs, refused at Fish).
- **Phase 1 only, by charter.** The packs validate the generative request;
  the provider-minted handle that comes back is yours to use on `unmodel/tts`
  as `voice`. The two-phase saves are wire-only because their correlating
  handles share no vocabulary, and voice *management* is out of scope.
- Model refs where the wire has none use **synthetic route-shaped ids**
  (`elevenlabs/ivc`, `fish-audio/fast`, `cartesia/voice-clone`, …), now a
  documented convention in `src/providers/HAND_CATALOGS.md`.

Both packs are budgeted (`voice-clone` ≤220 KiB, `voice-design` ≤190 KiB,
measured with the accounting written down), golden-matrixed (one canonical
request per case compiled at every provider that can express it, exact bodies
committed), capability-probed (every `unsupported` declaration rejected at the
canonical path by a real call), and type-tested (the sample-shape table in
both directions, the ttv_v3 extras gate, the `prompt`/`description` word
split).

## Knock-on structure, all of it measured

- **minimax grew a `chat.ts` leaf** (the anthropic/google/openai pattern):
  the chat registry imported the minimax barrel, and the new voice validators
  would have ridden into every chat bundle. The import-graph and chat-graph
  tests now pin the leaf.
- **fish-audio and lmnt split `unified-tts.ts` out of their barrels** for the
  same reason on the tts pack (494 KiB, back under its budget).
- `inworld/audio-bytes.ts` and `minimax/models.ts` picked up one shared
  helper and one shared enum each, so the voice packs stopped paying ~50 KiB
  for an STT validator and a TTS validator they never call.
