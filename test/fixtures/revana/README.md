# Revana fixtures

Real responses from `https://api.revana.si/v1`, recorded 2026-11-12 and
2026-11-13. Each file is `{ status, body }`: the HTTP status and the JSON body
exactly as answered. The two `queue.webhook.*` files are the other direction —
what Revana POSTed — and are `{ headers, body }`, see below.

| File | Request |
| --- | --- |
| `generation.image.created.json` | `POST /v1/generations` — `z-image`, one picture (`202`, queued) |
| `generation.image.running.json` | `GET /v1/generations/{id}` while it ran |
| `generation.image.succeeded.json` | the same poll, finished |
| `generation.tts.succeeded.json` | `GET /v1/generations/{id}` — `elevenlabs-turbo-2.5`, finished |
| `generation.error.invalid_input.json` | `POST /v1/generations` — `veo-3.1` with `resolution: "480p"` |
| `generation.error.not_found.json` | `GET /v1/generations/gen_does_not_exist` |
| `generation.error.model_unavailable.json` | `POST /v1/generations` — `z-image` with `max_wait_s: 1` (`503`, nothing created) |
| `generation.upscale.created.json` | `POST /v1/generations` — `recraft-crisp-upscale` on a link to 64 random bytes (`202`) |
| `generation.upscale.failed.json` | `GET /v1/generations/{id}` — the same job, failed, `cost_usd: 0` |
| `chat.completion.json` | `POST /v1/chat/completions` — `gpt-6-luna`, `max_tokens: 5` |
| `chat.error.unsupported_parameter.json` | the same, with `web_search_options: {}` |
| `quote-oracle.json` | `POST /v1/generations/quote`, once per body — see below |
| `queue.image.submitted.json` | `POST /v1/queue/revana/z-image` with an `Idempotency-Key` (`202`) |
| `queue.image.replayed.json` | the same POST, same key (`200`, the same request) |
| `queue.image.status.early.json` | `GET {status_url}?logs=1` while it ran |
| `queue.image.result.not_ready.json` | `GET {response_url}` while it ran (`409`) |
| `queue.image.cancel.json` | `PUT {cancel_url}` (`405`) |
| `queue.image.status.completed.json` | `GET {status_url}`, finished |
| `queue.image.result.json` | `GET {response_url}`, finished |
| `queue.image.content.json` | `GET` the result's file URL, not followed (`302`; `location` cut to its origin) |
| `queue.error.not_found.json` | `GET` the status of a request id that does not exist |
| `queue.error.model_unavailable.json` | `POST /v1/queue/revana/z-image` with `max_wait_s: 1` (`503`) |
| `queue.upscale.status.failed.json` | `GET {status_url}` — `recraft-crisp-upscale` on the same 64 bytes: `COMPLETED`, with `error` |
| `queue.upscale.result.failed.json` | `GET {response_url}` of that request (`422`) |
| `queue.webhook.ok.json` | the delivery to `fal_webhook` for a `z-image` request that succeeded |
| `queue.webhook.error.json` | the delivery for the upscale that failed |
| `queue-oracle.json` | `POST /v1/queue/revana/{model_id}`, once per body — see below |

## `queue.webhook.*.json`

`headers` are the ones Revana set (the receiver's own `host` left out), and
`body` is the request body as one string, byte for byte — the signature is
over those bytes, so it is not stored parsed. The `revana-signature` values
are Revana's real ones. They verify only with the recording account's signing
secret, which is not here; `src/providers/revana/webhook.test.ts` signs the
same bodies with a stand-in instead.

## `quote-oracle.json`

The quote endpoint validates a body exactly as a create does, charges nothing,
and checks every value BEFORE it fetches a reference. So a body whose only
fault is an unreachable placeholder URL answers `Media download failed` — and
that answer means the body passed validation.

Each row is one body and what the API said about it:

- `passes` — a `200`, or a media-download failure;
- `level` — for a refusal, `"model"` (a fact about the model: `veo-3.1 takes no
  …`) or `"route"` (`No route for … can take this input`, a fact about that
  day's routes);
- `message` — the API's sentence, verbatim;
- `quoted_usd` — on a `200`.

`src/providers/revana/oracle.test.ts` replays every row through unmodel's
validators. It is a sample — thirty-four models out of 138, chosen to cover each
rule — of a run that asked the same questions of all of them
(`docs/research/revana.md`, "Verification").

A row here goes stale when Revana changes the model it is about. When a
catalog refresh fails this test, re-ask the quote endpoint for that row; do not
edit the expectation to match the code.

## `queue-oracle.json`

The queue route has no quote endpoint, so each body was submitted for real with
`max_cost_usd: 0.00001` beside it. The route validates first and prices
second: a body it accepts then answers `422 max_cost_exceeded` ("No route can
run this generation within max_cost_usd"), and nothing is created or charged.
So here `passes` is that answer or a media-download failure, and every other
field means what it does above. `input` is the body without the cap.

176 bodies over twenty-four models: a sample of ordinary ones, to show the
route answers the generation route's own sentences; the cases where the two
routes part — `num_images`, and a string `duration`; and the undocumented
second names, which both routes read alike. The same bodies are in
`quote-oracle.json`, so the difference between the routes is the difference
between the two files. `src/providers/revana/queue.test.ts` replays it.
