/**
 * The ONE check battery behind every `revana.*` media address.
 *
 * `revana.video`, `revana.image`, `revana.tts`, `revana.music` and the four
 * narrower views (`imageEdit`, `upscale`, `lipsync`, `avatar`) all post the
 * same `{ model, input }` body to the same URL, so they share this module and
 * cannot drift about what a valid generation is (`docs/decisions.md` §4). What
 * differs per address is the table it is handed: its own rows,
 * `REVANA_<ADDRESS>_SHAPES`.
 *
 * The four `*Queue` addresses share it too. Their route takes the input as the
 * whole body, at a different URL, and admits it by these same rules — it
 * answers the generation route's own sentences. They pass `flat`, which
 * changes where a finding points and adds the two fields that route reads its
 * own way (`checkQueueLeniencies`); nothing else forks.
 *
 * # Where each rule comes from
 *
 * Every rule here is one the API states itself. "Unknown fields, and values
 * the model does not offer, are refused with 422 invalid_input before anything
 * is charged" (https://revana.si/openapi.json), and the values a model offers
 * are its catalog row. The exact sentence the API answers for each refusal was
 * collected from `POST /v1/generations/quote` — which validates the same body
 * and is free — on 2026-11-12, and the messages below quote those sentences so
 * that what unmodel says and what a 422 would have said are the same words.
 * `docs/research/revana.md` has the transcript.
 *
 * # What is deliberately NOT checked
 *
 * Revana is a router, and some refusals are a property of today's routes
 * rather than of the model: "No route for <id> can take this input (…)". Those
 * move when a route is added, so unmodel never turns one into an error. The
 * single route fact it reports at all is `negative_prompt` — a documented
 * `ModelInput` field that all but two models' routes refuse — and it reports
 * that as a WARNING.
 *
 * Likewise unchecked: which models serve `task: "video_edit"` /
 * `"video_extend"` ("Only the routes that do that task are used"), the
 * free-form `aspect_ratio` of a model that lists none, and anything about the
 * media behind a URL.
 */

import type { PipelineContext } from "../../core/pipeline";
import { admittedInput, admittedQueueInput, DOCUMENTED_SECOND_NAMES, QUEUE_DURATION, SECOND_NAMES } from "./admitted";
import type { RevanaMediaField, RevanaModelShape, RevanaSpeechField } from "./shape-types";

/** The generation API reference; `meta.source` on every finding below. */
export const REVANA_API_SOURCE = "https://revana.si/openapi.json";
/** The queue route's own page; `meta.source` on the findings only it produces. */
export const REVANA_QUEUE_SOURCE = "https://revana.si/queue.md";
/** The catalog the per-model values come from. */
export const REVANA_MODELS_SOURCE = "https://api.revana.si/v1/models";

/** The models whose `input` is not `ModelInput`. */
const SEEDANCE_25 = "seedance-2.5";
const NEMESIS_MODELS: readonly string[] = ["nemesis", "nemesis-lite"];

const MEDIA_FIELDS = [
  "image_url",
  "end_image_url",
  "image_urls",
  "video_url",
  "audio_url",
] as const satisfies readonly RevanaMediaField[];

const SPEECH_FIELDS = [
  "text",
  "voice",
  "dialogue",
  "stability",
  "similarity_boost",
  "speed",
  "language_code",
] as const satisfies readonly RevanaSpeechField[];

const MUSIC_FIELDS = ["lyrics", "style", "instrumental"] as const;

/** One field under two names; a count of one is taken by every `ModelInput` model. */
const COUNT_FIELDS: readonly string[] = ["num_images", "n"];

/** What a picture or video `ModelInput` may carry besides media. */
const VISUAL_FIELDS: readonly string[] = [
  "prompt",
  "negative_prompt",
  "resolution",
  "aspect_ratio",
  "duration",
  "audio",
  "quality",
  "seed",
  "num_images",
  "n",
  "task",
];

/** Every key the API's `ModelInput` validator recognises. */
const MODEL_INPUT_FIELDS: readonly string[] = [
  ...VISUAL_FIELDS,
  ...MEDIA_FIELDS,
  ...SPEECH_FIELDS,
  ...MUSIC_FIELDS,
];

const SEEDANCE_FIELDS: readonly string[] = [
  "prompt",
  "resolution",
  "duration",
  "aspect_ratio",
  "audio",
  "image_url",
  "end_image_url",
  "image_urls",
  "video_url",
  "video_urls",
  "audio_urls",
  "task",
];

const NEMESIS_FIELDS: readonly string[] = [
  "video_url",
  "image_urls",
  "roles",
  "target_frame",
  "guide",
  "sound",
  "face_mesh",
  "resolution",
  "prompt",
  "task",
];

/** Every key any of the three input schemas has — what `./generation.ts` declares. */
const WIRE_FIELDS: readonly string[] = [...MODEL_INPUT_FIELDS, ...SEEDANCE_FIELDS, ...NEMESIS_FIELDS];

/** `SeedanceInput.video_urls` / `.audio_urls`: `maxItems: 10`. */
const SEEDANCE_MAX_REFERENCE_CLIPS = 10;
/** `NemesisInput.prompt`: `maxLength: 5000`. */
const NEMESIS_MAX_PROMPT = 5000;
/** "prompt (at most 3000 characters there) is the idea" — music models. */
const MUSIC_MAX_PROMPT = 3000;

type Input = Readonly<Record<string, unknown>>;

/**
 * A narrower view of one kind's models — the thing that makes `revana.imageEdit`
 * a different address from `revana.image` over the same route.
 */
export interface RevanaView {
  /** The ids this address serves. */
  readonly ids: readonly string[];
  /** What those ids have in common, for the message: "edit a picture". */
  readonly does: string;
  /** The wide address that serves the kind's other models. */
  readonly wide: string;
  /** Media fields of which at least one must be sent for the request to be this view's. */
  readonly needsOneOf?: readonly RevanaMediaField[];
}

export interface RevanaCheckSpec {
  /** This address's kind rows. */
  readonly shapes: Readonly<Record<string, RevanaModelShape>>;
  /** Absent on the wide addresses. */
  readonly view?: RevanaView;
  /** Every other media address's ids, by address — for the signpost. */
  readonly elsewhere: Readonly<Record<string, readonly string[]>>;
  /**
   * Set by the queue addresses, whose body IS the input
   * (`POST /v1/queue/revana/{model_id}`, "without a `{model, input}`
   * wrapper"). The rules are the same ones — the queue answers the generation
   * route's own sentences — so the only differences are the two things that
   * route reads leniently ({@link admittedQueueInput}) and where a finding points.
   */
  readonly flat?: boolean;
}

interface Scope {
  readonly model: string;
  readonly ctx: PipelineContext;
  /** The body IS the input — see {@link RevanaCheckSpec.flat}. */
  readonly flat: boolean;
  /** Fields the caller sent under their second name: `{ audio: "generate_audio" }`. */
  readonly spelled: Readonly<Record<string, string>>;
}

type Finding = Parameters<PipelineContext["report"]>[0];

/**
 * Reports one finding in the caller's own words.
 *
 * Every rule below is written once, about `input.<field>` under the field's
 * first name — the generation body, and the API's own phrasing on both routes.
 * Two things can make that not what the caller typed, and both are put right
 * here rather than in seventy messages: a field sent under its second name
 * (`generate_audio`), and the queue route, where the fields sit at the top of
 * the body.
 */
function emit(scope: Scope, finding: Finding): void {
  let path = finding.path ?? [];
  let message = finding.message;
  for (const [field, sent] of Object.entries(scope.spelled)) {
    if (path[0] === "input" && path[1] === field) path = ["input", sent, ...path.slice(2)];
    message = message.replaceAll(`\`input.${field}\``, `\`input.${sent}\``);
  }
  if (scope.flat) {
    if (path[0] === "input") path = path.slice(1);
    message = message.replaceAll("`input.", "`");
  }
  scope.ctx.report({ ...finding, path, message });
}

function fail(
  scope: Scope,
  code: "invalid_shape" | "invalid_enum_value" | "unsupported_param" | "unsupported_capability",
  field: string,
  message: string,
  meta: Record<string, unknown> = {},
): void {
  emit(scope, {
    code,
    path: ["input", field],
    model: scope.model,
    message,
    meta: { source: REVANA_MODELS_SOURCE, ...meta },
  });
}

function has(input: Input, field: string): boolean {
  return input[field] !== undefined;
}

/** The API matches `ModelInput` settings ignoring case: `"4k"` is `"4K"`. */
function listedIgnoringCase(allowed: readonly string[], value: string): boolean {
  const lower = value.toLowerCase();
  return allowed.some((entry) => entry.toLowerCase() === lower);
}

function quoted(values: readonly (string | number)[]): string {
  return values.join(", ");
}

// ---------------------------------------------------------------------------
// Shared: unknown keys, media URLs, `task`
// ---------------------------------------------------------------------------

/**
 * A key the model's input schema does not have. Two cases, and they are not
 * the same finding:
 *
 * - a key of ANOTHER Revana schema (`video_urls` on a `ModelInput` model,
 *   `seed` on `seedance-2.5`). All three schemas are closed and unmodel has
 *   all three, so this one is certain, and an error;
 * - a key no schema has. A warning, like every `unknown_param` in this
 *   library — Revana adds fields faster than a snapshot tracks them — but the
 *   message says what the API does today, which is refuse it.
 */
function reportUnknownKeys(scope: Scope, input: Input, known: readonly string[], schema: string): void {
  for (const key of Object.keys(input)) {
    if (known.includes(key)) continue;
    if (WIRE_FIELDS.includes(key)) {
      fail(
        scope,
        "unsupported_param",
        key,
        `"${scope.model}" takes \`${schema}\`, which has no \`${key}\` — the API answers 'Unrecognized key: "${key}"'.`,
        { source: REVANA_API_SOURCE },
      );
      continue;
    }
    // On the queue route the input IS the top of the body, where the pipeline
    // already reports a key no input schema has.
    if (scope.flat) continue;
    emit(scope, {
      code: "unknown_param",
      path: ["input", key],
      model: scope.model,
      message:
        `\`input.${key}\` is not a field unmodel knows for "${scope.model}"; it was passed through ` +
        'unvalidated. Revana refuses an unknown input field with `422 invalid_input` ("Unrecognized key").',
      meta: { source: REVANA_API_SOURCE },
    });
  }
}

/**
 * `prompt: ""` — "expected string to have >=1 characters" on `ModelInput` and
 * `SeedanceInput`. Not in the wire schema because `NemesisInput.prompt`
 * declares no `minLength` and the API takes an empty one there.
 */
function refusesEmptyPrompt(scope: Scope, input: Input): boolean {
  if (input["prompt"] !== "") return false;
  fail(scope, "invalid_shape", "prompt", "`input.prompt` must have at least 1 character; leave it out instead.", {
    source: REVANA_API_SOURCE,
  });
  return true;
}

/** "Media must be public https URLs that download directly." */
function checkMediaUrls(scope: Scope, input: Input, fields: readonly string[]): void {
  for (const field of fields) {
    const value = input[field];
    const urls = Array.isArray(value) ? value : value === undefined ? [] : [value];
    urls.forEach((url, index) => {
      if (typeof url !== "string" || url.startsWith("https://")) return;
      emit(scope, {
        code: "invalid_shape",
        path: Array.isArray(value) ? ["input", field, index] : ["input", field],
        model: scope.model,
        message:
          `\`input.${field}\` must be a public https URL — Revana fetches every reference itself and ` +
          "refuses `http:` and `data:` alike. For a local file, `POST /v1/uploads` returns a URL to use.",
        meta: { source: REVANA_API_SOURCE },
      });
    });
  }
}

/**
 * `task` — top-level, "also accepted as input.task", and only meaningful with
 * a clip on a video model.
 */
function checkTask(scope: Scope, params: Input, input: Input, kind: RevanaModelShape["kind"]): void {
  const top = params["task"];
  const nested = input["task"];
  if (top !== undefined && nested !== undefined && top !== nested) {
    emit(scope, {
      code: "invalid_shape",
      path: ["input", "task"],
      model: scope.model,
      message: `\`task\` (${JSON.stringify(top)}) and \`input.task\` (${JSON.stringify(nested)}) disagree; send \`task\` once, at the top of the body.`,
      meta: { source: REVANA_API_SOURCE },
    });
    return;
  }
  const task = top ?? nested;
  if (task === undefined) return;
  const path = top !== undefined ? ["task"] : ["input", "task"];
  if (kind !== "video") {
    emit(scope, {
      code: "unsupported_param",
      path,
      model: scope.model,
      message: `\`task: ${JSON.stringify(task)}\` is for video models; "${scope.model}" ${kind === "image" ? "makes pictures" : "makes sound"}.`,
      meta: { source: REVANA_API_SOURCE },
    });
    return;
  }
  if (!has(input, "video_url")) {
    emit(scope, {
      code: "invalid_shape",
      path: ["input", "video_url"],
      model: scope.model,
      message: `\`task: ${JSON.stringify(task)}\` needs \`input.video_url\`: the clip to ${task === "video_extend" ? "extend" : "edit"}.`,
      meta: { source: REVANA_API_SOURCE },
    });
  }
}

// ---------------------------------------------------------------------------
// ModelInput on a picture or video model
// ---------------------------------------------------------------------------

/** "It takes: a prompt alone; input.image_url; …" — the model's inputs, in the API's own words. */
function describeInputs(shape: RevanaModelShape): string {
  const options: string[] = [];
  if (takesPromptAlone(shape)) options.push("a prompt alone");
  for (const field of shape.media) {
    if (field === "audio_url") continue;
    options.push(
      field === "end_image_url" ? "`input.image_url` with `input.end_image_url`" : `\`input.${field}\``,
    );
  }
  return options.join("; ");
}

function takesPromptAlone(shape: RevanaModelShape): boolean {
  return shape.tasks.includes("text_to_video") || shape.tasks.includes("text_to_image");
}

function isUpscaler(shape: RevanaModelShape): boolean {
  return shape.tasks.every((task) => task === "upscale");
}

function checkVisualFields(scope: Scope, input: Input, shape: RevanaModelShape): void {
  for (const field of SPEECH_FIELDS) {
    if (has(input, field)) {
      fail(scope, "unsupported_param", field, `\`input.${field}\` is for speech models; "${scope.model}" does not take it.`);
    }
  }
  for (const field of MUSIC_FIELDS) {
    if (has(input, field)) {
      fail(scope, "unsupported_param", field, `\`input.${field}\` is for music models; "${scope.model}" does not take it.`);
    }
  }
  reportUnknownKeys(scope, input, MODEL_INPUT_FIELDS, "ModelInput");
  checkPrompt(scope, input, shape);
}

/**
 * `prompt` — "Required unless the model only transforms media (an upscaler)",
 * which the API reads more narrowly than the sentence suggests. What it
 * answers "input.prompt is required." to, model by model:
 *
 * - a VIDEO request made from a prompt or from references. One made from a
 *   first frame or a clip passes without a prompt — the picture or the clip
 *   says what to make;
 * - any request to a PICTURE model that can generate from text, an edit
 *   included.
 *
 * Elsewhere a missing prompt is a route's complaint ("No route … (needs
 * prompt)" — the avatar models, the two edit-only picture models), and so not
 * unmodel's to make.
 */
function checkPrompt(scope: Scope, input: Input, shape: RevanaModelShape): void {
  if (refusesEmptyPrompt(scope, input)) return;
  if (has(input, "prompt") || isUpscaler(shape)) return;
  const mode = inputMode(input);
  const required =
    shape.kind === "video" ? mode === "prompt" || mode === "image_urls" : takesPromptAlone(shape);
  // A request with nothing in it, to a model that cannot run on a prompt alone,
  // gets the more useful sentence from `checkVisualMedia`: what it takes.
  if (!required || (mode === "prompt" && !takesPromptAlone(shape))) return;
  fail(scope, "invalid_shape", "prompt", `\`input.prompt\` is required by "${scope.model}".`, {
    source: REVANA_API_SOURCE,
  });
}

/** What a request is made FROM — the one media field that decides it, or the prompt. */
type InputMode = "video_url" | "end_image_url" | "image_url" | "image_urls" | "prompt";

/**
 * Which of the model's inputs a request is using.
 *
 * The API does not check media fields one by one; it reads the request as ONE
 * of the combinations the model lists ("a prompt alone; input.image_url;
 * input.image_url with input.end_image_url; input.image_urls") and refuses
 * the request when that one is not offered. A clip outranks a first frame, a
 * first frame outranks references — so an `image_url` beside a `video_url`
 * (the character picture of a motion-control model) rides along rather than
 * being refused, and so does `image_urls` beside an `image_url` on a picture
 * model. A video model is stricter about that last pair
 * ({@link checkFrameBesideReferences}). Established against the quote endpoint
 * for every model; see docs/research/revana.md.
 */
function inputMode(input: Input): InputMode {
  if (has(input, "video_url")) return "video_url";
  if (has(input, "image_url")) return has(input, "end_image_url") ? "end_image_url" : "image_url";
  if (has(input, "image_urls")) return "image_urls";
  return "prompt";
}

function checkVisualMedia(scope: Scope, input: Input, shape: RevanaModelShape): void {
  const mode = inputMode(input);
  const offered =
    mode === "prompt"
      ? takesPromptAlone(shape)
      : // An upscaler takes the thing to enlarge however it is handed over:
        // `image_urls` alone passed its validation too.
        shape.media.includes(mode) || isUpscaler(shape);

  if (has(input, "end_image_url") && !has(input, "image_url")) {
    fail(scope, "invalid_shape", "end_image_url", "`input.end_image_url` needs `input.image_url` (the first frame).", {
      source: REVANA_API_SOURCE,
    });
  } else if (!offered) {
    fail(
      scope,
      "unsupported_capability",
      mode === "prompt" ? (shape.media[0] ?? "prompt") : mode,
      `"${scope.model}" cannot take this combination of inputs. It takes: ${describeInputs(shape)}.`,
      { tasks: [...shape.tasks] },
    );
  }

  checkFrameBesideReferences(scope, input, shape);

  if (has(input, "audio_url") && !shape.media.includes("audio_url")) {
    fail(
      scope,
      "unsupported_capability",
      "audio_url",
      `"${scope.model}" does not take \`input.audio_url\` — only the talking-avatar and lip-sync models animate to a sound.`,
    );
  }
  if (shape.media.includes("audio_url") && !has(input, "audio_url")) {
    fail(scope, "invalid_shape", "audio_url", `"${scope.model}" needs \`input.audio_url\`: the voice or sound it animates to.`);
  }

  // The cap is enforced on every picture request, and on a video request made
  // FROM references; beside a first frame or a clip a video model was seen to
  // take more, so it is not claimed there.
  const references = input["image_urls"];
  const limit = referenceLimit(shape);
  if (
    Array.isArray(references) &&
    limit !== undefined &&
    references.length > limit &&
    (shape.kind === "image" || mode === "image_urls")
  ) {
    fail(
      scope,
      "unsupported_capability",
      "image_urls",
      `"${scope.model}" takes at most ${limit} ${limit === 1 ? "picture" : "pictures"} in \`input.image_urls\`; got ${references.length}.`,
      { count: references.length, limit },
    );
  }

  checkMediaUrls(scope, input, MEDIA_FIELDS);
}

/**
 * How many pictures `image_urls` may hold: the row's `max_input_images`, and
 * ONE where a model that takes references lists no number — "qwen-image takes
 * at most 1 picture in input.image_urls." All eight such models answered that
 * to two pictures on 2026-11-12: the seven `ideogram`, `qwen` and `midjourney`
 * picture models without a figure, and `kling-o1`.
 */
function referenceLimit(shape: RevanaModelShape): number | undefined {
  return shape.maxInputImages ?? (shape.media.includes("image_urls") ? 1 : undefined);
}

/**
 * A video model reads `image_url` as the first frame and `image_urls` as
 * references, and takes one or the other: "Send input.image_url (the first
 * frame) or input.image_urls (references), not both." What it lets through is
 * a list that only repeats the frames — every entry the `image_url` or the
 * `end_image_url` — and it refuses the pair whatever else the request carries,
 * a `video_url` included. It is the gateway's rule and not a model's: every
 * `ModelInput` video model that takes both fields answered that sentence on
 * 2026-11-13, the avatar models among them (where `image_url` is a face), and
 * so did five that do not take both. A picture model takes both.
 */
function checkFrameBesideReferences(scope: Scope, input: Input, shape: RevanaModelShape): void {
  const references = input["image_urls"];
  if (shape.kind !== "video" || !has(input, "image_url") || !Array.isArray(references)) return;
  const frames = [input["image_url"], input["end_image_url"]];
  if (references.every((reference) => frames.includes(reference))) return;
  fail(
    scope,
    "invalid_shape",
    "image_urls",
    "Send `input.image_url` (the first frame) or `input.image_urls` (references), not both. To start on one picture and end on another, send `input.image_url` and `input.end_image_url`.",
    { source: REVANA_API_SOURCE },
  );
}

function checkResolution(scope: Scope, input: Input, shape: RevanaModelShape): void {
  const resolution = input["resolution"];
  if (typeof resolution !== "string") return;
  if (shape.resolutions === undefined) {
    fail(scope, "unsupported_param", "resolution", `"${scope.model}" takes no \`input.resolution\`.`);
    return;
  }
  if (listedIgnoringCase(shape.resolutions, resolution)) return;
  fail(
    scope,
    "invalid_enum_value",
    "resolution",
    `\`input.resolution\` must be one of ${quoted(shape.resolutions)} for "${scope.model}"; got ${JSON.stringify(resolution)}.`,
    { allowed: [...shape.resolutions], value: resolution },
  );
}

/** `16:9`, `1.5:1` — and the two words a model without a list still accepts as a shape. */
const RATIO_SHAPE = /^\d+(\.\d+)?:\d+(\.\d+)?$/;
const RATIO_WORDS: readonly string[] = ["auto", "adaptive"];

function checkAspectRatio(scope: Scope, input: Input, shape: RevanaModelShape): void {
  const ratio = input["aspect_ratio"];
  if (typeof ratio !== "string") return;
  if (shape.aspectRatios === undefined) {
    // A model that lists none takes the field free-form. Which shapes its
    // routes then serve is not a fact about the model; that it must BE a shape is.
    const trimmed = ratio.trim();
    if (RATIO_SHAPE.test(trimmed) || RATIO_WORDS.includes(trimmed.toLowerCase())) return;
    fail(scope, "invalid_shape", "aspect_ratio", `\`input.aspect_ratio\` must look like 16:9; got ${JSON.stringify(ratio)}.`, {
      value: ratio,
      source: REVANA_API_SOURCE,
    });
    return;
  }
  if (listedIgnoringCase(shape.aspectRatios, ratio)) return;
  fail(
    scope,
    "invalid_enum_value",
    "aspect_ratio",
    `\`input.aspect_ratio\` must be one of ${quoted(shape.aspectRatios)} for "${scope.model}"; got ${JSON.stringify(ratio)}.`,
    { allowed: [...shape.aspectRatios], value: ratio },
  );
}

function checkQuality(scope: Scope, input: Input, shape: RevanaModelShape): void {
  const quality = input["quality"];
  if (typeof quality !== "string" || shape.qualities === undefined) return;
  if (listedIgnoringCase(shape.qualities, quality)) return;
  fail(
    scope,
    "invalid_enum_value",
    "quality",
    `\`input.quality\` must be one of ${quoted(shape.qualities)} for "${scope.model}"; got ${JSON.stringify(quality)}.`,
    { allowed: [...shape.qualities], value: quality },
  );
}

function checkDuration(scope: Scope, input: Input, shape: RevanaModelShape): void {
  const duration = input["duration"];
  if (typeof duration !== "number") return;
  if (shape.kind === "image") {
    fail(scope, "unsupported_param", "duration", `"${scope.model}" makes pictures; \`input.duration\` does not apply.`);
    return;
  }
  const allowed = shape.durations;
  if (allowed === undefined) {
    fail(scope, "unsupported_param", "duration", `"${scope.model}" sets its own length; leave \`input.duration\` out.`);
    return;
  }
  if ("min" in allowed) {
    if (duration >= allowed.min && duration <= allowed.max) return;
    fail(
      scope,
      "invalid_enum_value",
      "duration",
      `\`input.duration\` must be ${allowed.min}–${allowed.max} seconds for "${scope.model}"; got ${duration}.`,
      { min: allowed.min, max: allowed.max, value: duration },
    );
    return;
  }
  if (allowed.includes(duration)) return;
  fail(
    scope,
    "invalid_enum_value",
    "duration",
    `\`input.duration\` must be ${quoted(allowed)} seconds for "${scope.model}"; got ${duration}.`,
    { allowed: [...allowed], value: duration },
  );
}

function checkAudioToggle(scope: Scope, input: Input, shape: RevanaModelShape): void {
  // `audio: false` is accepted by every model; only asking for sound can fail.
  if (input["audio"] !== true || shape.audio === true) return;
  fail(scope, "unsupported_capability", "audio", `"${scope.model}" does not make sound; leave \`input.audio\` out.`);
}

/**
 * `num_images` / `n` on any `ModelInput` model — pictures, videos, sound.
 *
 * ONE is what every model makes, and the API takes a count of one wherever it
 * takes `ModelInput`: `num_images: 1` on a video model, an upscaler, a speech
 * or a music model all priced normally (2026-11-12). Only a count above one
 * is a question about the model.
 */
function checkImageCount(scope: Scope, input: Input, shape: RevanaModelShape): void {
  if (has(input, "num_images") && has(input, "n")) {
    fail(scope, "invalid_shape", "n", "`input.num_images` and `input.n` are the same field; send one.", {
      source: REVANA_API_SOURCE,
    });
    return;
  }
  const field = has(input, "num_images") ? "num_images" : "n";
  const count = input[field];
  if (typeof count !== "number" || count === 1) return;
  if (shape.kind !== "image") {
    fail(
      scope,
      "unsupported_param",
      field,
      `\`input.${field}\` is for picture models; "${scope.model}" makes ${shape.kind === "video" ? "videos" : "sound"}. Send one request per output.`,
      { source: REVANA_API_SOURCE },
    );
    return;
  }
  if (isUpscaler(shape)) {
    fail(
      scope,
      "unsupported_param",
      field,
      `\`input.${field}\` does not apply to an upscale; "${scope.model}" returns one picture for each picture sent.`,
      { source: REVANA_API_SOURCE },
    );
    return;
  }
  if (shape.maxImages === undefined || count <= shape.maxImages) return;
  fail(
    scope,
    "invalid_enum_value",
    field,
    `\`input.${field}\` must be 1 to ${shape.maxImages} for "${scope.model}"; got ${count}.`,
    { min: 1, max: shape.maxImages, value: count },
  );
}

/**
 * The one route-level fact reported — as a warning. See the module docstring
 * and `data/revana/overlays.json` for the provenance.
 */
function checkNegativePrompt(scope: Scope, input: Input, shape: RevanaModelShape): void {
  if (!has(input, "negative_prompt") || shape.negativePrompt === true) return;
  emit(scope, {
    code: "unsupported_param",
    severity: "warning",
    path: ["input", "negative_prompt"],
    model: scope.model,
    message:
      `No route for "${scope.model}" took \`negative_prompt\` when unmodel last asked (2026-11-12): the API ` +
      'answered `422 invalid_input` — "cannot take negative_prompt". Describe what to avoid inside ' +
      "`prompt`, or confirm with `POST /v1/generations/quote`, which is free.",
    meta: { source: "data/revana/overlays.json", verified: "2026-11-12" },
  });
}

function checkVisual(scope: Scope, input: Input, shape: RevanaModelShape): void {
  checkVisualFields(scope, input, shape);
  checkVisualMedia(scope, input, shape);
  checkResolution(scope, input, shape);
  checkAspectRatio(scope, input, shape);
  checkQuality(scope, input, shape);
  checkDuration(scope, input, shape);
  checkAudioToggle(scope, input, shape);
  checkImageCount(scope, input, shape);
  checkNegativePrompt(scope, input, shape);
}

// ---------------------------------------------------------------------------
// ModelInput on a speech model
// ---------------------------------------------------------------------------

function describeSpeechFields(shape: RevanaModelShape): string {
  return (shape.speechFields ?? []).map((field) => `\`${field}\``).join(", ");
}

function checkVoice(scope: Scope, voice: unknown, shape: RevanaModelShape, path: (string | number)[]): void {
  if (typeof voice !== "string" || shape.voices === undefined || shape.voices.includes(voice)) return;
  emit(scope, {
    code: "invalid_enum_value",
    path,
    model: scope.model,
    message:
      `${JSON.stringify(voice)} is not a voice of "${scope.model}". Send one of the voice ids in ` +
      `\`GET /v1/models\` (\`options.voices\`)${shape.defaultVoice === undefined ? "" : `, e.g. ${shape.defaultVoice}`}.`,
    meta: { source: REVANA_MODELS_SOURCE, value: voice },
  });
}

function checkSpeech(scope: Scope, input: Input, shape: RevanaModelShape): void {
  const takes: readonly string[] = shape.speechFields ?? SPEECH_FIELDS;
  for (const key of Object.keys(input)) {
    if (key === "prompt" || takes.includes(key) || COUNT_FIELDS.includes(key)) continue;
    if (!MODEL_INPUT_FIELDS.includes(key)) continue;
    fail(
      scope,
      "unsupported_param",
      key,
      key === "dialogue"
        ? `"${scope.model}" reads one voice at a time; send \`input.text\` and \`input.voice\`. For several voices in one take use a dialogue model.`
        : `"${scope.model}" reads text aloud and does not take \`input.${key}\`. It takes ${describeSpeechFields(shape)}.`,
      { source: "data/revana/overlays.json" },
    );
  }
  reportUnknownKeys(scope, input, MODEL_INPUT_FIELDS, "ModelInput");
  checkImageCount(scope, input, shape);

  const dialogue = takes.includes("dialogue") ? input["dialogue"] : undefined;
  if (dialogue !== undefined) {
    if (has(input, "text") || has(input, "voice") || has(input, "prompt")) {
      fail(
        scope,
        "invalid_shape",
        "dialogue",
        "Send `input.dialogue` (lines, each with its own voice) or `input.text` with `input.voice`, not both.",
      );
    }
    if (Array.isArray(dialogue)) {
      dialogue.forEach((line, index) => {
        checkVoice(scope, (line as { voice?: unknown } | null)?.voice, shape, ["input", "dialogue", index, "voice"]);
      });
    }
  } else if (has(input, "text") && has(input, "prompt")) {
    fail(
      scope,
      "invalid_shape",
      "prompt",
      "Send the words to read in `input.text`; `input.prompt` is read as the text only when `input.text` is left out.",
    );
  } else if (!has(input, "text") && !has(input, "prompt")) {
    fail(scope, "invalid_shape", "text", `\`input.text\` is required: the words "${scope.model}" reads aloud.`);
  }

  const words = input["text"] ?? input["prompt"];
  if (typeof words === "string" && shape.maxCharacters !== undefined && words.length > shape.maxCharacters) {
    fail(
      scope,
      "unsupported_capability",
      has(input, "text") ? "text" : "prompt",
      `"${scope.model}" reads at most ${shape.maxCharacters} characters per request; got ${words.length}.`,
      { count: words.length, limit: shape.maxCharacters },
    );
  }

  checkVoice(scope, input["voice"], shape, ["input", "voice"]);

  const language = input["language_code"];
  if (typeof language === "string" && takes.includes("language_code") && shape.languages !== undefined) {
    if (shape.languages.length === 0) {
      fail(scope, "unsupported_param", "language_code", `"${scope.model}" picks the language from the text; leave \`input.language_code\` out.`);
    } else if (!listedIgnoringCase(shape.languages, language)) {
      fail(
        scope,
        "invalid_enum_value",
        "language_code",
        `\`input.language_code\` must be one of ${quoted(shape.languages)} for "${scope.model}"; got ${JSON.stringify(language)}.`,
        { allowed: [...shape.languages], value: language },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// ModelInput on a music model
// ---------------------------------------------------------------------------

const MUSIC_TAKES: readonly string[] = ["prompt", ...MUSIC_FIELDS];

function checkMusic(scope: Scope, input: Input, shape: RevanaModelShape): void {
  for (const key of Object.keys(input)) {
    if (MUSIC_TAKES.includes(key) || COUNT_FIELDS.includes(key)) continue;
    if (!MODEL_INPUT_FIELDS.includes(key)) continue;
    fail(
      scope,
      "unsupported_param",
      key,
      `"${scope.model}" makes music and does not take \`input.${key}\`. It takes \`prompt\`, \`style\`, \`lyrics\` and \`instrumental\`.`,
      { source: REVANA_API_SOURCE },
    );
  }
  reportUnknownKeys(scope, input, MODEL_INPUT_FIELDS, "ModelInput");
  checkImageCount(scope, input, shape);
  refusesEmptyPrompt(scope, input);

  if (!has(input, "style") && !has(input, "lyrics")) {
    fail(
      scope,
      "invalid_shape",
      "style",
      'Send `input.style` (a genre and sound, such as "indie folk, warm vocals") or `input.lyrics`, with `input.prompt` for the idea.',
      { source: REVANA_API_SOURCE },
    );
  }
  if (has(input, "lyrics") && input["instrumental"] === true) {
    fail(scope, "invalid_shape", "instrumental", "An instrumental has no words: send `input.lyrics` or `input.instrumental`, not both.", {
      source: REVANA_API_SOURCE,
    });
  }
  const prompt = input["prompt"];
  if (typeof prompt === "string" && prompt.length > MUSIC_MAX_PROMPT) {
    fail(
      scope,
      "unsupported_capability",
      "prompt",
      `On a music model \`input.prompt\` is the idea, at most ${MUSIC_MAX_PROMPT} characters; got ${prompt.length}.`,
      { count: prompt.length, limit: MUSIC_MAX_PROMPT, source: REVANA_API_SOURCE },
    );
  }
}

// ---------------------------------------------------------------------------
// SeedanceInput and NemesisInput
// ---------------------------------------------------------------------------

/** These two schemas are matched exactly — `"1080P"` is refused where `ModelInput` would take it. */
function checkExactEnum(scope: Scope, input: Input, field: string, allowed: readonly string[] | undefined): void {
  const value = input[field];
  if (typeof value !== "string" || allowed === undefined || allowed.includes(value)) return;
  fail(
    scope,
    "invalid_enum_value",
    field,
    `\`input.${field}\` must be one of ${quoted(allowed)} for "${scope.model}" (matched exactly, case included); got ${JSON.stringify(value)}.`,
    { allowed: [...allowed], value },
  );
}

function checkArrayCap(scope: Scope, input: Input, field: string, limit: number | undefined): void {
  const value = input[field];
  if (!Array.isArray(value) || limit === undefined || value.length <= limit) return;
  fail(
    scope,
    "unsupported_capability",
    field,
    `"${scope.model}" takes at most ${limit} entries in \`input.${field}\`; got ${value.length}.`,
    { count: value.length, limit, source: REVANA_API_SOURCE },
  );
}

function checkSeedance(scope: Scope, input: Input, shape: RevanaModelShape): void {
  reportUnknownKeys(scope, input, SEEDANCE_FIELDS, "SeedanceInput");

  if (!refusesEmptyPrompt(scope, input) && !has(input, "prompt")) {
    fail(scope, "invalid_shape", "prompt", `\`input.prompt\` is required by "${scope.model}".`, { source: REVANA_API_SOURCE });
  }
  checkExactEnum(scope, input, "resolution", shape.resolutions);
  checkExactEnum(scope, input, "aspect_ratio", shape.aspectRatios);
  checkDuration(scope, input, shape);

  if (has(input, "image_url") && ["image_urls", "video_urls", "audio_urls"].some((field) => has(input, field))) {
    fail(
      scope,
      "invalid_shape",
      "image_url",
      "`input.image_url` (an exact first frame) cannot be combined with reference media; use `input.image_urls` for a looser visual reference.",
      { source: REVANA_API_SOURCE },
    );
  }
  if (has(input, "end_image_url") && !has(input, "image_url")) {
    fail(scope, "invalid_shape", "end_image_url", "`input.end_image_url` needs `input.image_url` (the first frame).", {
      source: REVANA_API_SOURCE,
    });
  }
  if (has(input, "duration") && has(input, "video_url")) {
    fail(
      scope,
      "invalid_shape",
      "duration",
      "`input.duration` cannot be set with `input.video_url`: the edited clip keeps the length of the source.",
      { source: REVANA_API_SOURCE },
    );
  }
  checkArrayCap(scope, input, "image_urls", shape.maxInputImages);
  checkArrayCap(scope, input, "video_urls", SEEDANCE_MAX_REFERENCE_CLIPS);
  checkArrayCap(scope, input, "audio_urls", SEEDANCE_MAX_REFERENCE_CLIPS);
  checkMediaUrls(scope, input, ["image_url", "end_image_url", "image_urls", "video_url", "video_urls", "audio_urls"]);
}

function checkNemesis(scope: Scope, input: Input, shape: RevanaModelShape): void {
  reportUnknownKeys(scope, input, NEMESIS_FIELDS, "NemesisInput");

  for (const field of ["video_url", "image_urls"] as const) {
    if (!has(input, field)) {
      fail(scope, "invalid_shape", field, `\`input.${field}\` is required by "${scope.model}".`, { source: REVANA_API_SOURCE });
    }
  }
  checkArrayCap(scope, input, "image_urls", shape.maxInputImages);
  checkExactEnum(scope, input, "resolution", shape.resolutions);
  checkExactEnum(scope, input, "guide", shape.guides);
  checkExactEnum(scope, input, "sound", shape.sounds);

  const roles = input["roles"];
  const pictures = input["image_urls"];
  if (Array.isArray(roles)) {
    roles.forEach((role, index) => {
      if (typeof role !== "string" || shape.roles === undefined || shape.roles.includes(role)) return;
      emit(scope, {
        code: "invalid_enum_value",
        path: ["input", "roles", index],
        model: scope.model,
        message: `\`input.roles[${index}]\` must be one of ${quoted(shape.roles)}; got ${JSON.stringify(role)}.`,
        meta: { allowed: [...shape.roles], value: role, source: REVANA_MODELS_SOURCE },
      });
    });
    if (Array.isArray(pictures) && roles.length !== pictures.length) {
      fail(
        scope,
        "invalid_shape",
        "roles",
        `\`input.roles\` has ${roles.length} entries; give one for each of the ${pictures.length} \`input.image_urls\`, or leave it out (every picture is then a person).`,
        { source: REVANA_API_SOURCE },
      );
    }
  }
  const prompt = input["prompt"];
  if (typeof prompt === "string" && prompt.length > NEMESIS_MAX_PROMPT) {
    fail(scope, "unsupported_capability", "prompt", `\`input.prompt\` is at most ${NEMESIS_MAX_PROMPT} characters on "${scope.model}"; got ${prompt.length}.`, {
      count: prompt.length,
      limit: NEMESIS_MAX_PROMPT,
      source: REVANA_API_SOURCE,
    });
  }
  checkMediaUrls(scope, input, ["video_url", "image_urls"]);
}

// ---------------------------------------------------------------------------
// The view, and the entry point
// ---------------------------------------------------------------------------

/**
 * A narrower address refuses what is not its own — which is what makes it
 * narrower — and names the wide address that takes it.
 */
function checkView(scope: Scope, input: Input, view: RevanaView, endpoint: string): boolean {
  if (!view.ids.includes(scope.model)) {
    emit(scope, {
      code: "unsupported_capability",
      path: ["model"],
      model: scope.model,
      message: `${endpoint} serves the Revana models that ${view.does}, and "${scope.model}" is not one of them. \`${view.wide}\` validates it.`,
      meta: { source: REVANA_MODELS_SOURCE },
    });
    return false;
  }
  const needs = view.needsOneOf;
  if (needs !== undefined && !needs.some((field) => has(input, field))) {
    fail(
      scope,
      "invalid_shape",
      needs[0] as string,
      `${endpoint} is for requests that ${view.does}: send ${needs.map((field) => `\`input.${field}\``).join(" or ")}. Without one this is a plain generation, which \`${view.wide}\` validates.`,
    );
  }
  return true;
}

/** Points at the address that types a model id this one does not. */
function signpost(scope: Scope, endpoint: string, elsewhere: RevanaCheckSpec["elsewhere"]): void {
  for (const [address, ids] of Object.entries(elsewhere)) {
    if (!ids.includes(scope.model)) continue;
    emit(scope, {
      code: "unsupported_capability",
      severity: "warning",
      path: ["model"],
      model: scope.model,
      message:
        `"${scope.model}" is a Revana model that \`${address}\` validates; ${endpoint} checked only the body's shape. ` +
        `The request itself is unaffected — ${scope.flat ? "the model id is the path, whichever address builds it" : "every media model posts to the same URL"}.`,
      meta: { source: REVANA_MODELS_SOURCE },
    });
    return;
  }
}

/**
 * Runs every model-dependent rule for one request. `params` has already passed
 * the wire schema, so `input` is an object and every known field has its
 * declared primitive type.
 */
export function runGenerationChecks(
  params: Readonly<Record<string, unknown>>,
  spec: RevanaCheckSpec,
  ctx: PipelineContext,
): void {
  const model = params["model"] as string;
  const sent = params["input"] as Input;
  const flat = spec.flat === true;
  const input = flat ? admittedQueueInput(sent) : admittedInput(sent);
  const { spelled, twice } = secondNames(sent);
  const scope: Scope = { model, ctx, flat, spelled };

  const shape = Object.hasOwn(spec.shapes, model) ? spec.shapes[model] : undefined;
  if (shape === undefined) {
    signpost(scope, ctx.endpoint, spec.elsewhere);
    return;
  }
  if (spec.view !== undefined && !checkView(scope, input, spec.view, ctx.endpoint)) return;

  for (const [second, other] of twice) {
    fail(scope, "invalid_shape", second, `\`input.${second}\` and \`input.${other}\` are the same field; send one.`, {
      source: REVANA_API_SOURCE,
    });
  }
  reportUndocumentedNames(scope, sent);
  if (flat) checkQueueLeniencies(scope, sent);
  checkTask(scope, params, input, shape.kind);
  if (model === SEEDANCE_25) checkSeedance(scope, input, shape);
  else if (NEMESIS_MODELS.includes(model)) checkNemesis(scope, input, shape);
  else if (shape.kind !== "audio") checkVisual(scope, input, shape);
  else if (shape.tasks.includes("text_to_speech")) checkSpeech(scope, input, shape);
  else checkMusic(scope, input, shape);
}

/**
 * Which fields the caller sent under a second name (`./admitted.ts`), and
 * which they sent twice.
 *
 * `spelled` is first name → the name sent, for {@link emit}. `twice` pairs a
 * second name with the other spelling of the same field that is also there —
 * the first name, or an earlier second name.
 */
function secondNames(sent: Input): { spelled: Record<string, string>; twice: [second: string, other: string][] } {
  const spelled: Record<string, string> = {};
  const twice: [string, string][] = [];
  for (const [second, first] of Object.entries(SECOND_NAMES)) {
    if (!has(sent, second)) continue;
    const other = has(sent, first) ? first : spelled[first];
    if (other === undefined) spelled[first] = second;
    else twice.push([second, other]);
  }
  return { spelled, twice };
}

/**
 * A second name no Revana schema or page has. The API takes it, so this is not
 * a refusal and the field is checked like the one it is; but nothing published
 * says it will go on being taken, and the caller should know which name is the
 * documented one.
 */
function reportUndocumentedNames(scope: Scope, sent: Input): void {
  for (const [second, first] of Object.entries(SECOND_NAMES)) {
    if (!has(sent, second) || DOCUMENTED_SECOND_NAMES.includes(second)) continue;
    scope.ctx.report({
      code: "unknown_param",
      path: scope.flat ? [second] : ["input", second],
      model: scope.model,
      message:
        `\`${scope.flat ? "" : "input."}${second}\` is \`${first}\` under a name in no Revana schema or page. The API reads it as ` +
        `\`${first}\` today, and unmodel checked it as that; \`${first}\` is the documented spelling.`,
      meta: { kind: "undocumented_second_name", field: first, source: REVANA_API_SOURCE },
    });
  }
}

/**
 * The two fields the queue route reads its own way, before the shared rules
 * see them (2026-11-12; `test/fixtures/revana/queue-oracle.json`).
 *
 * `num_images` must be the number 1 — "Only num_images: 1 is supported; submit
 * separate requests for more images" — on every model, a picture model with a
 * `max_images` of four included, and is then dropped: beside an `n`, or on
 * `seedance-2.5`, whose schema has no such key, the request goes through.
 *
 * `duration` may be a string of digits with an optional `s`, fal's spelling
 * ("String durations such as \"5\" and \"8s\" are accepted"). It is read as that
 * many seconds and then held to the model's own list.
 */
function checkQueueLeniencies(scope: Scope, sent: Input): void {
  if (has(sent, "num_images") && sent["num_images"] !== 1) {
    fail(
      scope,
      "unsupported_param",
      "num_images",
      `The queue route takes \`input.num_images\` only as 1 — "Only num_images: 1 is supported; submit separate requests for more images." For several pictures in one request use \`${scope.ctx.endpoint.replace(/Queue$/, "")}\`.`,
      { value: sent["num_images"], source: REVANA_QUEUE_SOURCE },
    );
  }
  const duration = sent["duration"];
  if (typeof duration === "string" && !QUEUE_DURATION.test(duration)) {
    fail(
      scope,
      "invalid_shape",
      "duration",
      `\`input.duration\` must be whole seconds — a number, or a string such as "8" or "8s"; got ${JSON.stringify(duration)}.`,
      { value: duration, source: REVANA_QUEUE_SOURCE },
    );
  }
}
