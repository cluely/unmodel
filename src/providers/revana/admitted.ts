/**
 * A Revana input as the API reads it: every field under its first name.
 *
 * **Import-free.** The check battery and the price both have to read a body
 * the way the server does, and the price is reachable without the battery.
 *
 * `generate_audio` is `audio`. It is in no schema Revana publishes — the queue
 * page mentions it once, for three fal aliases ("`generate_audio` maps to
 * `audio`", https://revana.si/queue.md) — but both routes take it on every
 * model, price it as `audio` (`veo-3.1` at 720p for 8 s: $1.60 without, $3.20
 * with either spelling) and answer a model that has no `audio` with that
 * field's own sentence (2026-11-12). Sending both is a 422 even when they
 * agree, so here the first name wins and `./checks.ts` reports the pair.
 */
export function admittedInput(sent: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  if (sent["generate_audio"] === undefined) return sent;
  const { generate_audio, ...input } = sent;
  return sent["audio"] === undefined ? { ...input, audio: generate_audio } : input;
}

/** `"8"`, `"8s"`, `"08"` — and not `"8.0s"`, `"8S"`, `"8 s"` or `"+8"`. */
export const QUEUE_DURATION = /^\d+s?$/;

/**
 * The same, for the body of `POST /v1/queue/revana/{model_id}`, which reads
 * two fields its own way before the shared rules apply (`./checks.ts`,
 * `checkQueueLeniencies`): `num_images` is dropped, and a string `duration` is
 * the number of seconds it spells. A string that spells none is left as it is,
 * for the battery to refuse.
 */
export function admittedQueueInput(sent: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const { num_images, ...input } = admittedInput(sent) as Record<string, unknown>;
  const duration = input["duration"];
  if (typeof duration === "string" && QUEUE_DURATION.test(duration)) {
    input["duration"] = Number.parseInt(duration, 10);
  }
  return input;
}
