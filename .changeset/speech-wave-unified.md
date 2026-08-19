---
"unmodel": minor
---

The speech wave: one `speech()` for every text-to-speech provider, and one name
for the endpoint at all fourteen of them.

**Endpoint renames (breaking).** The address-vs-wire law says an endpoint's
*address* is uniform across providers even where the wire spelling is not, so
every synthesis route is now addressed as `speech`. The wire spellings survive
exactly where they belong — URL constants, wire types, SDK shapes — and the
realtime/websocket surfaces are untouched.

| old | new |
| --- | --- |
| `elevenlabs.textToSpeech` | `elevenlabs.speech` |
| `cartesia.tts` | `cartesia.speech` |
| `deepgram.speak` | `deepgram.speech` |
| `hume.tts` | `hume.speech` |
| `minimax.t2a` | `minimax.speech` |
| `rime.tts` | `rime.speech` |
| `fish-audio.tts` | `fish-audio.speech` |
| `smallest-ai.tts` | `smallest-ai.speech` |
| `inworld.tts` | `inworld.speech` |
| `murf.speechGenerate` | `murf.speech` |
| `resemble.synthesize` / `resemble.synthesizeStream` | `resemble.speech` / `resemble.speechStream` |
| `speechify.stream` | `speechify.speechStream` |

`openai.speech`, `lmnt.speech`, `lmnt.speechDetailed` and `murf.speechStream`
already had the uniform name and are unchanged. The renamed constraint tables
and response checkers follow the same rule: `elevenlabs.textToSpeechConstraints`
→ `speechConstraints` (likewise cartesia, rime, smallest-ai, inworld) and
`resemble.checkSynthesis` → `checkSpeech`, matching `murf.checkSpeech`. The CLI
ids move with them (`unmodel validate elevenlabs.speech`).

**`unmodel/speech` now ships a ready-made pack.** `speech()` carries all
fourteen adapters — openai, elevenlabs, cartesia, deepgram, hume, minimax, rime,
lmnt, fish-audio, murf, resemble, smallest-ai, speechify, inworld — so one
canonical request reaches any of them:

```ts
import { speech } from "unmodel/speech";

const req = speech({
  model: "elevenlabs/eleven_flash_v2_5",
  text: "The lighthouse keeper checked the lamp.",
  voice: "JBFqnCBsd6RMkjVDRZzb",
  outputFormat: { format: "mp3", sampleRate: 44100, bitrate: 128000 },
});
```

The result is that provider's own `Validated`: its `.request`, its `.toSdk(…)`,
its estimate and its findings, because a unified call ends in the same validator
a hand-written one does. To pay for two providers instead of fourteen, build
your own pack from the new `unmodel/<provider>/unified` subpaths:

```ts
import { createSpeech } from "unmodel/speech";
import { speech as openai } from "unmodel/openai/unified";
import { speech as rime } from "unmodel/rime/unified";

const speech = createSpeech([openai, rime]);
```

**New package exports:** `unmodel/<provider>/unified` for each of the fourteen.

**The loss contract holds across all of them.** A param a provider cannot
express is an error naming what it does offer (LMNT publishes no speaking rate;
OpenAI's `response_format` has no sample-rate field); a value it expresses
approximately is an `approximated_param` warning naming both numbers (Murf's
integral percentage `rate`, a BCP-47 region a provider's ISO 639-1 field cannot
carry, a documented default filled in on your behalf). Zero warnings means the
request mapped exactly — asserted by a golden matrix that compiles one canonical
request at every provider that can express it.
