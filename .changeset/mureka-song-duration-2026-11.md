---
"unmodel": patch
---

mureka: the song route takes a target `duration` (mureka-9.5), and the pricing notes cite the published per-song rates

- `mureka.music` (POST /v1/song/generate) accepts `duration`, an integer
  number of seconds from 120 to 300. Mureka's spec reads "Target song
  duration, in seconds. Value range: [120,300]. If not provided, the model
  determines the duration automatically. Supported only by mureka-9.5." and
  the changelog for 2026.10.29 says "Lyrics to song API supports duration
  control"
  (https://platform.mureka.ai/docs/api/operations/post-v1-song-generate.html,
  https://platform.mureka.ai/docs/en/changelog.html, checked 2026-11-12).
  Before this change, a typed call with `duration` did not compile and an
  untyped one passed with an `unknown_param` warning. Now a length outside
  120–300, or a fractional one, is refused at `duration`.
  `mureka-7.6`, `mureka-o2`, `mureka-8` and `mureka-9` refuse it with
  `unsupported_param` ("Supported only by mureka-9.5"), and
  `constraintsFor(id)` exposes each row. `auto` accepts it, because the spec
  does not say whether the alias honours it. `DURATION_MIN_SECONDS` and
  `DURATION_MAX_SECONDS` are exported from `unmodel/mureka`.
- `unmodel/music`: `durationSeconds` on a `mureka/…` ref is no longer refused
  as unsupported. With the `lyrics` extra it compiles to the song route's
  `duration`, unchanged because both are seconds. The range and the
  mureka-9.5-only rule are reported at `durationSeconds`. The prompt-to-song
  and instrumental routes have no length field, so they still refuse
  `durationSeconds`, and the message now names the song route and mureka-9.5.
- Mureka publishes its USD prices per generated song. They differ by route as
  well as by model. Lyrics-to-song costs $0.03 (7.6), $0.045 (o2/8/9) and
  $0.15 (9.5). Prompt-to-song costs $0.30 (7.6/o2/8/9) and $0.50 (9.5).
  Instrumental (BGM) costs $0.03, $0.045 and $0.15. Sources are the static
  chunk behind https://platform.mureka.ai/pricing, corroborated by fal.ai's
  Mureka page. `cost` is still omitted, but the module notes now give the
  right reason: `ModelCost` has no per-song unit, and one id has a different
  price on each route. The old reason, that no rate list was published, was
  wrong.
- Doc-comment corrections in `unmodel/mureka`: mureka-9.5 is generally
  available, not early access. The route inventory now lists the video, TTS,
  podcast, describe/recognize/transcribe, finetuning, billing and uploads
  routes that are not validated, and it no longer files
  `/v1/song/easy-generate` (validated as `mureka.musicFromPrompt`) as
  doc-note-only. The mureka-o1 `stream` carve-out is attributed to the song
  route alone.
