---
"unmodel": minor
---

**Mureka can take a prompt-only vocal request.** `mureka.musicFromPrompt` is a
new wire address for `POST /v1/song/easy-generate` ("Prompt to song"), the route
that writes the lyrics itself. It is typed from the OpenAPI document embedded in
the docs bundle (`SongEasyGenerateReq`, verified 2026-08-31): every field is
optional — `model` included, which both generate routes require — `prompt` is
capped at **2000** characters, and `styles` takes one or more of a closed
thirteen-value enum (`pop`, `rock`, `jazz`, `r&b`, `edm`, `ambient`, `folk`,
`latin`, `k-pop`, `j-pop`, `house`, `gospel`, `lo-fi`), published as `STYLES` on
`unmodel/mureka` and `unmodel/mureka/values`. It is async like its siblings and
polls with the `songQueryUrl()` that already shipped.

**The music adapter now dispatches three ways**, and this is a behavior change:

- `instrumental: true` → `POST /v1/instrumental/generate`
- a `lyrics` extra → `POST /v1/song/generate`
- neither → `POST /v1/song/easy-generate`

So `music({ model: "mureka/mureka-9.5", prompt })` **used to be an
`invalid_shape` error on `lyrics` and is now a successful compile to a different
URL**, with zero warnings. `gender`, `melody_id` and `instrumental_id` are
absent from the new route's body and are refused there with the route that does
take each one named. Nothing is fabricated on the way: the canonical `prompt`
reaches `prompt` unchanged and Mureka writes the words.

**One wart, written down rather than smoothed over.** The effective cap on the
canonical `prompt` is now route-dependent — 2000 characters on easy-generate,
1024 on the other two — so the same prompt can pass or fail depending on whether
a `lyrics` extra rode along with it. Each wire schema carries its own accurate
cap; the adapter and module headers say so.

`styles` stays a per-model extra rather than canonical vocabulary: no other
music provider in the roster has any style or genre field, so it has one witness
(decisions.md §8).

### Corrections for the report this came from

- **"Every other music provider writes lyrics from the prompt" was 2 of 4**, not
  4 of 4. ElevenLabs Music and Google Lyria take prompt-only vocals; Stability
  has no vocals at all; and at fal, `minimax/music-3` and
  `fal-ai/minimax-music/v2` refuse a prompt-only request exactly as Mureka did,
  which is a standing recorded decision (unmodel does not invent lyrics), not an
  oversight.
- **`styles` is an array, not a single style**, and `prompt` is optional too — a
  `styles`-only request is legal. The route also carries `reference_id`,
  `vocal_id`, `n` and `stream`.
- The related silent-prompt-to-lyrics defect at `fal/fal-ai/diffrhythm` was
  fixed separately: that compile has carried an `approximated_param` since the
  previous release.
