/**
 * A Revana input as the API reads it: every field under its first name.
 *
 * **Import-free.** The check battery and the price both have to read a body
 * the way the server does, and the price is reachable without the battery.
 *
 * # Nine second names
 *
 * Before it validates anything, the API renames nine keys — on both routes and
 * for every model, whichever of the three input schemas the model takes. What
 * each is renamed TO was read off the API's own answers on 2026-11-12: a wrong
 * type is reported under the first name (`start_image_url: 5` →
 * `input.image_url: Invalid input: expected string, received number`), and so
 * is every rule that follows (`last_frame_url` alone → `input.end_image_url
 * needs input.image_url (the first frame).`).
 *
 * A renamed key is then an ordinary field of the model's schema, or not one:
 * `reference_videos` becomes `video_urls`, which only `SeedanceInput` has, so
 * on any other model the answer is `Unrecognized key: "video_urls"`.
 *
 * Sending a field under two of its names is a 422 even when the values agree
 * (`… are the same field; send one.`), so here the first name wins and
 * `./checks.ts` reports the pair.
 */
export const SECOND_NAMES = {
  generate_audio: "audio",
  start_image_url: "image_url",
  first_frame_url: "image_url",
  last_image_url: "end_image_url",
  last_frame_url: "end_image_url",
  tail_image_url: "end_image_url",
  reference_images: "image_urls",
  reference_image_urls: "image_urls",
  reference_videos: "video_urls",
} as const satisfies Record<string, string>;

/**
 * The one second name a Revana page states: "`generate_audio` maps to
 * `audio`" (https://revana.si/queue.md, said there of three fal aliases; both
 * routes take it on every model, and price it as `audio` — `veo-3.1` at 720p
 * for 8 s is $1.60 without and $3.20 with either spelling). The other eight
 * are in no schema and on no page.
 */
export const DOCUMENTED_SECOND_NAMES: readonly string[] = ["generate_audio"];

export function admittedInput(sent: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  let input: Record<string, unknown> | undefined;
  for (const [second, first] of Object.entries(SECOND_NAMES)) {
    if (sent[second] === undefined) continue;
    input ??= { ...sent };
    delete input[second];
    if (input[first] === undefined) input[first] = sent[second];
  }
  return input ?? sent;
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
