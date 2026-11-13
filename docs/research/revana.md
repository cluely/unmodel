# Revana — wire research

Researched 2026-11-12 for the `unmodel/revana` provider. Three sources, per the
provider-work rule: the docs, the API reference, and — because Revana ships no
SDK — the live API itself, which turned out to be the only source that answers
the questions the other two leave open.

| Source | URL | What it settles |
| --- | --- | --- |
| Docs | https://revana.si/docs, https://revana.si/chat, https://revana.si/llms-full.txt | routes, auth, billing, the prose rules |
| API reference | https://revana.si/openapi.json (`info.version` `2026-10-31`) | the three input schemas, the response objects |
| Catalog | `GET https://api.revana.si/v1/models` (keyless) | per-model options, tasks, capabilities, prices |
| Live API | `POST /v1/generations/quote` (free; validates like a create) | what the validator actually accepts |

Snapshots of the reference and the catalog are committed at
`data/revana/openapi.json` and `data/revana/models.json`.

## What Revana is

A router. One key and one prepaid balance over image, video, speech, music and
language models from two dozen makers; each model is served by one or more
*routes* (upstream providers), a request starts on the cheapest and falls back
on failure, and only the route that succeeds is charged.

- Base URL `https://api.revana.si/v1`, `Authorization: Bearer <key>`, keys look
  like `sr_live_…`.
- Media: `POST /v1/generations` with `{ model, input }` → `202` and a queued
  `Generation`; poll `GET /v1/generations/{id}`; download
  `GET /v1/generations/{id}/content[/n]` (a `302`).
- Language models: `POST /v1/chat/completions`, OpenAI-compatible, SSE
  streaming.
- No SDK. The queue page points at fal's client with a URL rewrite.

The roster moves fast enough to matter: the catalog listed 226 models when this
research started and 237 three hours later (`genjutsu-*`, `ltx-2.5-*`,
`recraft-v4.1*`, `soul*`, `ideogram-v4`, `marketing-studio-image`). That is the
argument for the generated tier, and for never treating an unknown id as an
error.

## The quote endpoint is a free validation oracle

`POST /v1/generations/quote` takes the same body as a create and "answers
`quoted_usd` … Nothing is created or held; free." It runs the same validation,
and its refusals are specific sentences. Two properties make it usable as an
oracle:

1. **Value checks run before media is fetched.** A request whose only fault is
   an unreachable reference answers `cannot use image …: Media download failed
   (HTTP 404)`; every other refusal comes first. So a placeholder URL
   (`https://example.com/a.png`) is enough to ask "would this validate?" —
   "passed" is a `200` *or* a media-download failure.
2. **Refusals are of two kinds, and the wording tells them apart.** A fact
   about the MODEL is stated as one (`veo-3.1 takes no input.resolution`,
   `input.duration must be 4, 6, 8 seconds for veo-3.1`). A fact about today's
   ROUTES starts `No route for <id> can take this input (…)`.

unmodel encodes the first kind as errors and — with one exception, below —
ignores the second, because a route fact changes when a route is added.

Every rule in `src/providers/revana/checks.ts` was then checked against this
oracle by a differential run: for each of the 138 media models, 25–40 request
bodies (the model's own boundaries: each listed value, one past each end, each
media field alone and in combination, each foreign field), unmodel's verdict
beside the API's. See "Verification" at the end.

## The three input schemas, and the `oneOf` that cannot be honoured

`GenerationRequest.input` is `oneOf [SeedanceInput, NemesisInput, ModelInput]`,
with the prose "SeedanceInput for seedance-2.5. NemesisInput for nemesis … and
nemesis-lite … ModelInput for every other model."

Read as JSON Schema, that `oneOf` refuses the most ordinary request there is:
`{ "prompt": "…" }` matches both `SeedanceInput` and `ModelInput`. The server
selects by `model`, and so does unmodel (`InputFor<M>` in `generation-wire.ts`).

The schemas also differ in strictness, which the document does not say:

| | `ModelInput` | `SeedanceInput` / `NemesisInput` |
| --- | --- | --- |
| enum matching | case-INSENSITIVE (`"4k"` is `"4K"`, `"1080P"` is `"1080p"`) | exact (`"1080P"` → `expected one of "480p"\|"720p"\|"1080p"`) |
| unknown key | `Unrecognized key` | `Unrecognized key` |
| `seed` | accepted by every model | `Unrecognized key: "seed"` |
| `prompt: ""` | refused (`>=1 characters`) | Seedance refuses; **Nemesis accepts** (its schema has no `minLength`) |

## `ModelInput` is wider than the document

The published `ModelInput` has seventeen properties and
`additionalProperties: false`. The validator recognises more:

- **Speech fields** — `text`, `voice`, `dialogue`, `stability`,
  `similarity_boost`, `speed`, `language_code`. None is in the OpenAPI
  document; `text` and `voice` appear on each speech model's page. The API
  names the set itself: `elevenlabs-v3 reads text aloud and does not take
  input.seed. It takes text, voice, dialogue, stability and language_code.`
  Bounds, from its own 422s: `stability` and `similarity_boost` 0–1, `speed`
  0.7–1.2, `dialogue` ≥ 1 item of strict `{ text, voice? }`.
- **Documented aliases** — `n` for `num_images`, `input.task` for `task`, and
  `generate_audio` for `audio`. The last is in no schema; the queue page states
  it once ("`generate_audio` maps to `audio`"), for three fal aliases, and both
  routes take it on every model that takes `audio`: priced as `audio`
  (`veo-3.1`, 720p, 8 s: $1.60 without, $3.20 with either spelling), refused
  with `audio`'s own sentence where the model has none, and a 422 beside
  `audio` even when the two agree. unmodel types it and checks it as `audio`.
- **Undocumented aliases**, recognised but described nowhere:
  `start_image_url`, `first_frame_url`, `last_image_url`, `last_frame_url`,
  `tail_image_url`, `reference_images`, `reference_image_urls`,
  `reference_videos`. unmodel does not type them: a caller who sends one gets
  an `unknown_param` warning and the request goes through.

## Per-model rules, and where each comes from

Everything below is a model-level sentence from the oracle, derivable from the
catalog row alone.

| Field | Catalog | Rule |
| --- | --- | --- |
| `resolution` | `options.resolutions` | a list is an enum; ABSENT → `<id> takes no input.resolution.` |
| `aspect_ratio` | `options.aspect_ratios` | a list is an enum; absent → free-form, `must look like 16:9` (`W:H`, decimals allowed, or `auto` / `adaptive`) |
| `duration` | `options.durations` | a list or a `{min,max}` range; absent → `<id> sets its own length; leave input.duration out.`; on a picture model → `makes pictures; input.duration does not apply.` |
| `audio` | `options.audio` | `true` only where the option is `true` → else `does not make sound; leave input.audio out.` (`false` passes validation everywhere) |
| `quality` | `options.qualities` | a list is an enum; absent → accepted, any value |
| `num_images` / `n` | `options.max_images` | a count of ONE is taken by every `ModelInput` model (video, upscaler, speech and music included); above one, picture models only, up to the max, and not an upscaler; both at once is refused |
| `image_urls` | `options.max_input_images` | `<id> takes at most N pictures in input.image_urls.` |
| `voice` | `options.voices` | must be a listed id |
| `language_code` | `options.languages` | list → enum; `[]` → `picks the language from the text; leave input.language_code out.`; absent → any code |
| `text` length | `options.max_characters` | 5000 passes, 5001 is refused |

### Media: one combination per request

The API does not check media fields independently. It reads a request as ONE of
the combinations a model offers and answers, when that one is not offered,
`<id> cannot take this combination of inputs. It takes: a prompt alone;
input.image_url; input.image_url with input.end_image_url; input.image_urls.`

That list is the model's `tasks`:

| Task | Combination |
| --- | --- |
| `text_to_video`, `text_to_image` | a prompt alone |
| `image_to_video`, `image_to_image`, `upscale` | `image_url` |
| `first_last_frame` | `image_url` with `end_image_url` |
| `reference_to_video`, `image_to_image` | `image_urls` |
| `video_to_video`, `upscale` | `video_url` |

and the combination a request is in is decided by its highest-ranking field:
a clip, then a first frame (with or without a last one), then references. A
lower-ranking field beside it rides along — `image_urls` next to an
`image_url` on a model that lists only `input.image_url`, or an `image_url`
next to a `video_url` (the character picture of a motion-control model, which
its routes in fact require). The first draft of the check tested each field
for membership and refused all of those; the differential run is what caught
it.

Three footnotes to that, each from the same run: `end_image_url` always needs
`image_url`, whatever else is sent; the `image_urls` cap is enforced on every
picture request but, on video, only when the request is made FROM references;
and an upscaler takes the thing to enlarge as `image_urls` too.

`audio_url` is separate: `<id> does not take input.audio_url.` unless
`capabilities.audio_input`, and `<id> needs input.audio_url: the voice or sound
it animates to.` where it is.

### `prompt`

"Required unless the model only transforms media (an upscaler)" is narrower in
practice. What answers `input.prompt is required.`:

- a video request made from a prompt or from references — one made from a
  first frame or a clip passes without a prompt;
- any request to a picture model that can generate from text, an edit
  included.

Everywhere else a missing prompt is a route's complaint (`No route … (needs
prompt)`: the avatar models, the two edit-only picture models) and unchecked.
`prompt: ""` is refused by `ModelInput` and `SeedanceInput`.

## The route-level facts, and the one unmodel reports

`No route for <id> can take this input (…)` covers, among others:
`negative_prompt`, `audio: false` on models whose routes always make sound,
`quality` values, free-form aspect ratios, `needs image_url` on motion-control
models, `needs prompt` on avatar models.

`negative_prompt` is the only one reported, as a **warning**. It is a
documented `ModelInput` field ("What to avoid, on models that take it") that
all but two models' routes refuse (`hunyuan-image-3.5-preview` and
`kling-2.5-turbo-pro` priced it; every other `ModelInput` model answered
`cannot take negative_prompt`). That is common and silent enough to be worth a
sentence, and unstable enough that it must never fail a request. The two ids
are recorded in `data/revana/overlays.json`.

## `task`

Top-level `task: "video_edit" | "video_extend"`, "also accepted as input.task".
Model-level rules: both spellings disagreeing is refused; it is "for video
models"; it "needs input.video_url". Which models serve which task is
route-level ("Only the routes that do that task are used") and unchecked.

## Chat

`POST /v1/chat/completions`, OpenAI's body. Verified live:

| Sent | Answer |
| --- | --- |
| `web_search_options` | `400 unsupported_parameter` — "Web search is not offered." |
| `prediction` | `400` — "Predicted outputs are not offered." |
| `audio` | `400` — "Audio output is not offered." |
| `modalities: ["text","audio"]` | `400` — "only text output is offered." (`["text"]` passes) |
| a non-function tool | `400` — "tools: only function tools are offered." |
| an `input_audio` / `file` part | `400` — "Message content of type … is not offered: send text and image_url parts." |
| an unknown top-level param | accepted and ignored |

The response's `id` starts `chat_`, and `usage.cost_usd` is the exact charge.
`stream_options.include_usage` adds a final usage chunk carrying it.

Revana's catalog publishes no per-model capability flags for language models,
and 38 of the 99 rows list no context size. The generated rows therefore state
the endpoint's envelope (text and image in, tools allowed) rather than a
per-model claim, and `limit.context` is `0` where none is listed.

## Pricing

- "100 credits = $1"; "Every price is a whole number of credits, rounded up" —
  a total rounds up to the cent.
- `price.usd` is a number or a map keyed by setting: `"720p"`,
  `"720p+audio"`, `"1080p+video_input"`, `"1:1-high"`, `"balanced"`. Optional
  `fee_usd` (a per-job fee, same keys) and `billed:
  "input_and_output_seconds"` (Nemesis).
- **The listed price is a lower bound on a quote, not always equal to it.** In
  the differential run every priced request came out at or below `quoted_usd`,
  and three came out below: `seedream-5.0-pro` at 2K (listed $0.04, quoted
  $0.07 — the cheapest route does not serve 2K) and `seedance-2.5` with
  `audio: true` (the listed rate has no audio key). The docs say as much:
  "Some inputs cost more than the listed per-second rate …, so quote the exact
  request."
- **No worst case is computed.** What a backup route adds is stated two ways:
  the docs say "what those attempts cost plus 10%, whichever is more", the
  OpenAPI document says "billed at its provider's cost plus one cent". A quote
  answers the real cap as `reserved_usd`.
- Defaults are unpublished (only `default_quality` and `default_voice`), so a
  request that omits a price-deciding field has no listed price unmodel can
  name.

## Discrepancies between Revana's own pages

| Topic | One page says | Another says |
| --- | --- | --- |
| Backup-route billing | "plus 10%, whichever is more" (docs) | "plus one cent" (OpenAPI) |
| `max_cost_usd` | `maximum: 100` (OpenAPI) | the API prices a request with `101` normally |
| Speech input | no speech field in `ModelInput` (OpenAPI) | `text` + `voice` (model pages), seven fields (the API) |
| `guide`, `face_mesh` | "nemesis-lite only" (docs) | accepted on `nemesis` too (the API) |
| Failed-generation codes | ten codes (docs) | eleven — adds `review_required` (OpenAPI) |
| `Generation` | no `progress` (OpenAPI) | every response carries one (the API) |
| `/v1/videos` | "continue[s] to work unchanged" (queue.md) | documented nowhere |
| Scope | "One API key for image and video models" (home) | speech, music and 99 language models (catalog) |

Where a page and the API disagree, unmodel follows the API and says so in the
code beside the rule.

## The queue route

`POST /v1/queue/revana/{model_id}` (https://revana.si/queue.md) runs the same
jobs through fal's HTTP convention. It was first read as a second spelling of
`/v1/generations` and declined; it is a second route, with one capability the
first lacks, and is addressed as `revana.videoQueue`, `imageQueue`, `ttsQueue`
and `musicQueue`.

| | `/v1/generations` | `/v1/queue/revana/{model_id}` |
|---|---|---|
| Model | `model` in the body | the URL path; `model` in the body is `Unrecognized key` |
| Body | `{ model, input, … }` | the input fields, "without a `{model, input}` wrapper", with `max_cost_usd` / `max_wait_s` beside them |
| Answer | a `Generation` (`queued` …) | fal's envelope: `IN_QUEUE` / `IN_PROGRESS` / `COMPLETED`, `status_url`, `response_url` |
| Result | `output.urls`, `cost_usd` | `{ images }` / `{ video }` / `{ audio, audios }`, and no cost |
| Completion | poll | poll, or `?fal_webhook=<url>` |
| Auth | `Bearer` | `Key` or `Bearer` |

What the probes established, 2026-11-12:

- **Admission is the generation route's.** The queue answers that route's own
  sentences, `input.` prefix included (`input.resolution must be one of 720p,
  1080p, 4K for veo-3.1.`) — so one check battery serves both, and unmodel
  drops the prefix when it reports about a flat body.
- **It validates before it prices.** A body it accepts, sent with a
  `max_cost_usd` nothing can meet, answers `422 max_cost_exceeded` and creates
  nothing. That is the queue's free oracle, the way the quote endpoint is the
  generation route's.
- **Two fields are read differently.** `num_images` is taken only as the number
  1 ("Only num_images: 1 is supported; submit separate requests for more
  images") on every model, and is then dropped — so it rides beside an `n`,
  and on `seedance-2.5` and `nemesis`, whose schemas have no such key.
  `duration` also takes a string of digits with an optional lowercase `s`
  (`"8"`, `"8s"`, `"08"`; not `"8.0s"`, `"8S"`, `"8 s"`), read as seconds
  and then held to the model's list.
- **`fal_webhook` is checked at submit, before the body.** "Webhook must be a
  reachable public HTTPS URL on port 443 without credentials or fragments."
  Refused: `http:`, userinfo, a fragment, port 8443, an IPv6 literal,
  `10.0.0.1`, `localhost`, a host that does not resolve, an empty value.
  Taken: an explicit `:443`, a query string, a public IPv4 literal. In the
  body it is an unrecognised key.
- **A queue `request_id` is a generation id.** `GET /v1/generations/{id}`
  answers the same job, with the `cost_usd` the queue's documents never state.
- **Cancelling is a `405`**, an `Idempotency-Key` replay a `200` with the same
  request, the result before completion a `409 not_ready`, and every queue
  error carries fal's `detail` beside Revana's `error`.

The three fal alias paths (`/v1/queue/fal-ai/nano-banana-2`,
`…/nano-banana-pro`, `…/veo3.1/fast`) are not addressed: they are a
migration aid for fal clients over the same three models, whose canonical
paths take the full input. Declined in `data/revana/curation.json`.

## Not addressed

- `POST /v1/queue/fal-ai/{alias}` — see above.
- `POST /v1/videos` — no published shape.
- Polling, downloads, uploads, balance — transport. The URLs are exported.

## Verification

The differential run, 2026-11-12, against `POST /v1/generations/quote`:

- **First pass** (3,331 bodies): 3,048 agreed. 39 were requests unmodel refused
  and the API accepted — every one a media field riding along with a
  higher-ranking one, a video request with media and no prompt, or Nemesis's
  empty prompt. All three rules were rewritten. 80 were requests unmodel
  accepted and the API refused at model level (the free-form `aspect_ratio`
  shape, `num_images` on the upscaler); both rules were added. 164 were
  route-level and are left alone by design.
- **Final pass** (5,167 bodies, with the combination, prompt and aspect-ratio
  cases added): 4,839 agreed, **none** was a request unmodel refused and the
  API accepted, and 314 were route-level. The remaining 14 were one rule
  (`end_image_url` without `image_url` beside a clip), fixed and re-asked for
  the models it touched. Of 942 priced answers, unmodel named a listed price
  for 281: 278 equal to `quoted_usd`, 3 below it, none above.

A 658-row sample of that run — twenty-two models, the API's verbatim answer
per body — is committed as `test/fixtures/revana/quote-oracle.json` and
replayed offline by `src/providers/revana/oracle.test.ts`.

**What that run missed.** Probing the queue route turned up two things the
generation route accepts that the battery did not, because the run never asked:
a count of one on a model that makes one thing (`num_images: 1` on a video,
upscale, speech or music model — it had only tried 2), and `generate_audio`.
Both are fixed, and 56 rows asking exactly those questions joined the fixture
(714 rows, twenty-five models). The queue route has its own:
`test/fixtures/revana/queue-oracle.json`, 85 bodies over nine models, none
refused by unmodel and accepted by the API.

The harness is not committed: it needs a key, and it spends nothing but should
not run in CI against someone's account. Re-running it is the right first step
after any change to `checks.ts`.
