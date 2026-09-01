---
"unmodel": minor
---

**New category: `unmodel/sfx` — text to sound effects, two providers, seven refs.**

The fifth category added in 2026 and the one that arrived with the most evidence
behind it: **five independent vendor witnesses on day one** — ElevenLabs, Sonilo,
CassetteAI, Stability and Mirelo — where `3d` shipped with two and `lipsync`,
`avatar` and `upscale` each shipped with one.

```ts
import { sfx } from "unmodel/sfx";

sfx({
  model: "elevenlabs/eleven_text_to_sound_v2",
  prompt: "a heavy oak door creaking open in a stone hall",
  durationSeconds: 4,
  outputFormat: "mp3",
});
// → { text: "…", model_id: "eleven_text_to_sound_v2", duration_seconds: 4 }
//   …with ?output_format=mp3_44100_128 on the URL, because at this endpoint the
//   format is a QUERY param.
```

**Four canonical words** — `model`, `prompt`, `durationSeconds?`, `outputFormat?`
plus `providerOptions` — the smallest vocabulary in the library, and every one of
them is also a `music` word.

**Why it is not `unmodel/music`.** At ElevenLabs, the one vendor serving both, the
two wires are disjoint and so are their model-id enums: `/v1/music` counts
MILLISECONDS with a floor of 3 000 and takes a `composition_plan` and a
`force_instrumental`; `/v1/sound-generation` counts seconds with a floor of **0.5**
and takes a `loop` and a `prompt_influence`. Merging them would have pushed the
category floor from three seconds to half of one and put `instrumental?: boolean`
on a door creak.

**Omitting `durationSeconds` means the PROVIDER's default, never `"auto"`** — the
decision the category is built on, because the five vendors give three different
answers:

| ref | absent means | what you get |
|---|---|---|
| `elevenlabs/eleven_text_to_sound_v2`, `fal/fal-ai/elevenlabs/sound-effects/v2` | the model reads a length off the prompt | nothing — nothing was invented, so nothing warns |
| `fal/sonilo/v1.1/text-to-sound-effects` | 8 seconds | `approximated_param` naming 8 |
| `fal/mirelo-ai/sfx1.6/text-to-audio` | 10 seconds | `approximated_param` naming 10 |
| `fal/fal-ai/stable-audio-3/small/sfx/*` | 30 seconds | `approximated_param` naming 30 |
| `fal/cassetteai/sound-effects-generator` | HTTP 422 — the field is required | a **compile error**, and a typed refusal |

The default is warned about and never sent: writing 8 into `duration` would pin a
number the provider is free to change.

**New addresses.**

- `elevenlabs.sfx` — `POST /v1/sound-generation`, typed from the live
  `api.elevenlabs.io/openapi.json`. `text` required; `duration_seconds` 0.5–30
  nullable; `loop`; `prompt_influence` 0–1; `model_id`; `output_format` as a
  **query param** whose 21-member enum is NOT `/v1/music`'s (there is no 48 kHz
  MP3 arm here, so `SOUND_EFFECTS_OUTPUT_FORMATS` is its own constant rather than
  a shared one that would have accepted four values this endpoint rejects). The
  catalog row already existed and now carries its $0.12-per-generated-minute rate.
- `fal.sfx` — six curated endpoints from five vendors, taking `unmodel/fal` to
  **178 endpoints across eleven verbs**: `fal-ai/elevenlabs/sound-effects/v2`,
  `sonilo/v1.1/text-to-sound-effects`, `cassetteai/sound-effects-generator`,
  `mirelo-ai/sfx1.6/text-to-audio`, and both arms of
  `fal-ai/stable-audio-3/small/sfx/*`.

**The overlap is deliberate and NARROWED.** fal's resale of ElevenLabs' model
differs from the native route four ways: the length caps at 22 seconds instead of
30, `output_format` moves from the query string into the body, `text` caps at 450
characters, and there is no `model_id` because the endpoint IS the model. That
comparison is pinned in `test/unified/golden/sfx/plain/` rather than described.

**`loop` is deliberately not a canonical word.** One vendor of five publishes it.
Mirelo's `ambience` looks like a second witness and is not — it produces a tileable
ambience *bed*, which changes what is generated rather than where it ends, the same
disqualifier the lipsync `sync_mode` table carries. It rides as a per-model extra,
fully typed, and `test/unified/sfx-capabilities.test.ts` holds the decline as an
assertion that FAILS the day a second vendor spells it compatibly. Same for
`prompt_influence`, `seed`, `negative_prompt`, `guidance_scale` and `num_samples`.

**Correction to a recorded reason.** `docs/providers.md` said no SFX route was
curated because "an `sfx` category with one witness would be a guess". That was
wrong on the facts, not just on the conclusion: the live roster has five
independent vendors, and the vocabulary was never the blocker. The sentence is
replaced, and the six ids are now curated rather than declined.

**Also new:** `unmodel/elevenlabs` gains `sfx`, `soundEffectsUrl`,
`SOUND_EFFECTS_URL`, `SOUND_EFFECTS_OUTPUT_FORMATS`, `DEFAULT_SFX_MODEL_ID`,
`SFX_MODEL_IDS` and the bounds constants; `unmodel/elevenlabs/types` gains
`SfxBody`; `unmodel/fal/types` gains `SfxBody` and `FalSfxArm` /
`FalSfxBodyById` / `FalSfxResultById`; both providers' `/values` entries gain
`SFX_MODEL_PARAMS` and `SFX_MODELS` (ElevenLabs' also `SFX_FORMAT_SPEC`);
`unmodel/types` gains `SfxParams`, `SfxParamsBase` and `SfxModelParams`; and the
CLI gains `elevenlabs.sfx`, `fal.sfx` and `unified.sfx`.
