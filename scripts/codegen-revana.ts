/**
 * Generates the Revana model surface from Revana's OWN published catalog, plus
 * two hand-maintained inputs for what the catalog cannot say.
 *
 *   bun run codegen:revana           regenerate src/providers/revana/gen/** from data/revana/
 *   bun run codegen:revana:refresh   re-fetch the two keyless snapshots first, then regenerate
 *   bun run codegen:revana:check     re-fetch and compare against the committed snapshots (network; no writes)
 *
 * ## Why Revana gets a generator
 *
 * Revana is a router: 127 image, video, speech and music models and 99 language
 * models behind one key, with a roster that moves weekly. It publishes that
 * roster machine-readably and keylessly — `GET https://api.revana.si/v1/models`
 * lists "every model you can generate with right now, with options and
 * prices" — and its API refuses "values the model does not offer … with 422
 * invalid_input". So the per-model resolutions, aspect ratios, durations,
 * reference caps, voices and rates are data, and hand-transcribing two hundred
 * rows of someone else's data would be a rolling liability.
 *
 * ## The thesis, the same one `scripts/codegen-fal.ts` states
 *
 * **The generator emits DATA and TYPES-AS-DATA; hand code owns BEHAVIOUR.** No
 * file this script writes contains a check, a message, an estimate or a
 * `createValidator`. It emits the per-model shape rows (`REVANA_<ADDRESS>_SHAPES`), the id
 * lists per address, the listed prices and the catalog rows. What a bad request
 * is told lives in `src/providers/revana/*.ts`, hand-written, once.
 *
 * ## Two kinds of row, from the one snapshot
 *
 *   • `shapes-<address>.gen.ts` — the WIRE rows: what a model takes on
 *     `POST /v1/generations`, in Revana's own spelling. The check battery and
 *     the per-model body types read these.
 *   • `<category>-params.gen.ts` — the UNIFIED rows: the same facts in the
 *     canonical vocabulary (`"4k"` for the catalog's `"4K"`, a duration list
 *     as an enum, an empty list where the model has no such field), which the
 *     category packs (`unmodel/video`, `unmodel/tts`, …) narrow a
 *     `revana/<model>` ref by. One file per category, because a category pack
 *     must not pay for another category's roster.
 *
 * ## Why the catalog and not the OpenAPI document
 *
 * `data/revana/openapi.json` is snapshotted for drift detection and is what
 * `src/providers/revana/generation-wire.ts` was transcribed from, but it is not lowered:
 * it declares ONE `ModelInput` for 122 models, with `resolution`, `quality` and
 * `aspect_ratio` typed as bare strings ("Which fields and values a model takes
 * … are in /data/models.json"). The per-model truth is the catalog's `options`.
 *
 * ## The two hand inputs
 *
 *   • `data/revana/curation.json` — which video models are the `lipsync` and
 *     `avatar` views (Revana files both under `kind: "video"`), and what is
 *     deliberately not addressed.
 *   • `data/revana/overlays.json` — facts the API states only in its own 422
 *     messages: the fields each speech model takes, and which models take
 *     `negative_prompt`. Every entry carries a quote, a source and a date.
 *
 * ## Determinism and loud failure
 *
 * Output is a pure function of the committed inputs: no clock, no network,
 * everything sorted, shared vocabularies named by content hash so a new model
 * does not renumber its neighbours. Every catalog construct this script does
 * not model — an unknown `kind`, task, option key, price unit or price field —
 * is a HARD ERROR naming the model, never a silently dropped fact. So is a
 * video model with `capabilities.audio_input` that curation has not classified:
 * a new talking-head model must be filed under a verb by a human.
 */

import { z } from "zod";
import { num, quote, renderLimit, renderMediaCost, renderStringArray, sortKeysDeep } from "./emit";

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/** The keyless catalog. Stated in the OpenAPI document as needing no key. */
const MODELS_URL = "https://api.revana.si/v1/models";
const OPENAPI_URL = "https://revana.si/openapi.json";

const DATA_DIR = new URL("../data/revana/", import.meta.url).pathname;
const MODELS_PATH = `${DATA_DIR}models.json`;
const OPENAPI_PATH = `${DATA_DIR}openapi.json`;
const CURATION_PATH = `${DATA_DIR}curation.json`;
const OVERLAYS_PATH = `${DATA_DIR}overlays.json`;
const GEN_DIR = new URL("../src/providers/revana/gen/", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// The catalog, parsed strictly — an unmodelled key stops the generator
// ---------------------------------------------------------------------------

const MEDIA_TASKS = [
  "text_to_video",
  "image_to_video",
  "first_last_frame",
  "reference_to_video",
  "video_to_video",
  "text_to_image",
  "image_to_image",
  "upscale",
  "text_to_speech",
  "text_to_music",
] as const;
type MediaTask = (typeof MEDIA_TASKS)[number];

const durationsSchema = z.union([
  z.array(z.number().int().positive()).min(1),
  z.strictObject({ min: z.number().int().positive(), max: z.number().int().positive() }),
]);

const optionsSchema = z.strictObject({
  resolutions: z.array(z.string().min(1)).min(1).optional(),
  aspect_ratios: z.array(z.string().min(1)).min(1).optional(),
  durations: durationsSchema.optional(),
  audio: z.boolean().optional(),
  max_input_images: z.number().int().positive().optional(),
  max_images: z.number().int().positive().optional(),
  qualities: z.array(z.string().min(1)).min(1).optional(),
  default_quality: z.string().min(1).optional(),
  voices: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .min(1)
    .optional(),
  default_voice: z.string().min(1).optional(),
  max_characters: z.number().int().positive().optional(),
  dialogue: z.boolean().optional(),
  // `[]` is meaningful and distinct from absent — see `lowerShape`.
  languages: z.array(z.string().min(1)).optional(),
  instrumental: z.boolean().optional(),
  outputs_per_job: z.number().int().positive().optional(),
  guides: z.array(z.string().min(1)).min(1).optional(),
  sounds: z.array(z.string().min(1)).min(1).optional(),
  roles: z.array(z.string().min(1)).min(1).optional(),
});

const rateSchema = z.union([z.number().nonnegative(), z.record(z.string(), z.number().nonnegative())]);

const mediaPriceSchema = z.strictObject({
  unit: z.enum(["per_image", "per_second", "per_1k_chars", "per_job"]),
  usd: rateSchema,
  /** A flat fee added once per job, keyed like `usd`. */
  fee_usd: rateSchema.optional(),
  billed: z.enum(["input_and_output_seconds"]).optional(),
});

const capabilitiesSchema = z.strictObject({
  edit: z.boolean(),
  image_input: z.boolean(),
  video_input: z.boolean(),
  audio_input: z.boolean(),
  audio_output: z.boolean(),
  first_last_frame: z.boolean(),
  reference_images: z.boolean(),
  upscale: z.boolean(),
});

const mediaModelSchema = z.strictObject({
  id: z.string().min(1),
  object: z.literal("model"),
  name: z.string().min(1),
  maker: z.string().min(1),
  kind: z.enum(["video", "image", "audio"]),
  tasks: z.array(z.enum(MEDIA_TASKS)).min(1),
  options: optionsSchema,
  price: mediaPriceSchema,
  capabilities: capabilitiesSchema,
  // Every route's `[usd, fee_usd]`. Snapshotted, deliberately not lowered: which
  // route runs is decided per request, so only the listed price is a fact about
  // the model (src/providers/revana/pricing.ts).
  route_prices: z.record(z.string(), z.array(z.tuple([z.number(), z.number()]))),
});

const chatPriceSchema = z.strictObject({
  unit: z.literal("per_million_tokens"),
  currency: z.literal("USD"),
  input: z.number().nonnegative(),
  cached_input: z.number().nonnegative(),
  cache_write: z.number().nonnegative(),
  cache_write_1h: z.number().nonnegative(),
  output: z.number().nonnegative(),
  // The three surcharges. Their presence is recorded on the row's comment; the
  // base rates above are what reaches `ModelInfo.cost`.
  tiers: z
    .array(
      z.strictObject({
        prompt_tokens_above: z.number().int().positive(),
        input: z.number(),
        cached_input: z.number(),
        cache_write: z.number(),
        cache_write_1h: z.number(),
        output: z.number(),
      }),
    )
    .optional(),
  peak_multiplier: z.number().positive().optional(),
  peak_hours: z.string().optional(),
  effort_max_multiplier: z.number().positive().optional(),
});

const chatModelSchema = z.strictObject({
  id: z.string().min(1),
  object: z.literal("model"),
  owned_by: z.string().min(1),
  name: z.string().min(1),
  maker: z.string().min(1),
  kind: z.literal("text"),
  tasks: z.tuple([z.literal("chat_completions")]),
  endpoint: z.literal("/v1/chat/completions"),
  context_tokens: z.number().int().positive().optional(),
  max_output_tokens: z.number().int().positive().optional(),
  price: chatPriceSchema,
});

const catalogSchema = z.strictObject({
  object: z.literal("list"),
  data: z.array(z.union([chatModelSchema, mediaModelSchema])),
});

type MediaModel = z.infer<typeof mediaModelSchema>;
type ChatModel = z.infer<typeof chatModelSchema>;

// ---------------------------------------------------------------------------
// The hand inputs
// ---------------------------------------------------------------------------

const provenanceSchema = z.strictObject({
  reason: z.string().min(1),
  source: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const curationSchema = z.strictObject({
  $comment: z.string().optional(),
  views: z.strictObject({
    lipsync: z.record(z.string(), provenanceSchema),
    avatar: z.record(z.string(), provenanceSchema),
  }),
  excluded: z.strictObject({
    routes: z.record(z.string(), provenanceSchema),
  }),
});

const SPEECH_FIELDS = [
  "text",
  "voice",
  "dialogue",
  "stability",
  "similarity_boost",
  "speed",
  "language_code",
] as const;

const overlaysSchema = z.strictObject({
  $comment: z.string().optional(),
  speechFields: z.record(
    z.string(),
    z.strictObject({
      fields: z.array(z.enum(SPEECH_FIELDS)).min(1),
      quote: z.string().min(1),
      source: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  ),
  negativePrompt: z.strictObject({
    acceptedBy: z.array(z.string().min(1)),
    quote: z.string().min(1),
    source: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
});

export interface GenerateInput {
  catalog: unknown;
  curation: unknown;
  overlays: unknown;
}

// ---------------------------------------------------------------------------
// Lowering
// ---------------------------------------------------------------------------

/** The models whose `input` is not `ModelInput` (the OpenAPI `oneOf`'s other two arms). */
const SEEDANCE_25 = "seedance-2.5";
const NEMESIS_IDS: readonly string[] = ["nemesis", "nemesis-lite"];

/** The five media fields of `ModelInput`, in the order the API's own messages list them. */
type MediaField = "image_url" | "end_image_url" | "image_urls" | "video_url" | "audio_url";

/**
 * Which media fields a model takes, read off its published `tasks` and
 * `capabilities`.
 *
 * The API answers a request outside this set with "… cannot take this
 * combination of inputs. It takes: a prompt alone; input.image_url; …", and
 * that sentence was collected for all 122 `ModelInput` models on 2026-11-12
 * and agrees with this table on every one (docs/research/revana.md).
 */
function mediaFields(model: MediaModel): MediaField[] {
  const has = (task: MediaTask): boolean => model.tasks.includes(task);
  const fields: MediaField[] = [];
  if (has("image_to_video") || has("image_to_image") || has("upscale")) fields.push("image_url");
  if (has("first_last_frame")) fields.push("end_image_url");
  if (has("reference_to_video") || has("image_to_image")) fields.push("image_urls");
  if (has("video_to_video") || has("upscale")) fields.push("video_url");
  if (model.capabilities.audio_input) fields.push("audio_url");
  return fields;
}

class Vocabularies {
  private readonly arrays = new Map<string, string>();
  private readonly objects = new Map<string, string>();

  /** A hoisted `as const` array, named by content so a new model renumbers nothing. */
  name(prefix: string, values: readonly (string | number)[]): string {
    const literal = `[${values.map((v) => JSON.stringify(v)).join(", ")}]`;
    return this.hoist(this.arrays, prefix, literal);
  }

  /**
   * A hoisted `as const` object literal, named the same way. Kept apart from
   * the arrays because an object may NAME one (`(typeof Q_1a2b3c)[number]`),
   * so every array has to be declared first.
   */
  object(prefix: string, literal: string): string {
    return this.hoist(this.objects, prefix, literal);
  }

  render(): string {
    return [this.arrays, this.objects]
      .flatMap((byName) => [...byName.entries()].sort(([a], [b]) => (a < b ? -1 : 1)))
      .map(([name, literal]) => `const ${name} = ${literal} as const;`)
      .join("\n");
  }

  private hoist(byName: Map<string, string>, prefix: string, literal: string): string {
    const name = `${prefix}_${contentHash(literal)}`;
    const existing = byName.get(name);
    if (existing !== undefined && existing !== literal) {
      throw new Error(`vocabulary hash collision on ${name}`);
    }
    byName.set(name, literal);
    return name;
  }
}

/** FNV-1a, 24 bits, hex. Stable across runtimes; not security-relevant. */
function contentHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) & 0xffffff).toString(16).padStart(6, "0");
}

function lowerShape(
  model: MediaModel,
  vocab: Vocabularies,
  overlays: z.infer<typeof overlaysSchema>,
): string {
  const o = model.options;
  const fields: string[] = [
    `kind: ${quote(model.kind)}`,
    `tasks: ${renderStringArray(model.tasks)}`,
    `media: ${renderStringArray(mediaFields(model))}`,
  ];
  if (o.resolutions) fields.push(`resolutions: ${vocab.name("R", o.resolutions)}`);
  if (o.aspect_ratios) fields.push(`aspectRatios: ${vocab.name("A", o.aspect_ratios)}`);
  if (o.durations) {
    fields.push(
      Array.isArray(o.durations)
        ? `durations: ${vocab.name("D", o.durations)}`
        : `durations: { min: ${num(o.durations.min)}, max: ${num(o.durations.max)} }`,
    );
  }
  if (o.audio !== undefined) fields.push(`audio: ${o.audio}`);
  if (o.max_input_images !== undefined) fields.push(`maxInputImages: ${num(o.max_input_images)}`);
  if (o.max_images !== undefined) fields.push(`maxImages: ${num(o.max_images)}`);
  if (o.qualities) {
    fields.push(`qualities: ${vocab.name("Q", o.qualities)}`);
    if (o.default_quality === undefined || !o.qualities.includes(o.default_quality)) {
      throw new Error(`${model.id}: qualities without a default_quality that is one of them`);
    }
    fields.push(`defaultQuality: ${quote(o.default_quality)}`);
  } else if (o.default_quality !== undefined) {
    throw new Error(`${model.id}: default_quality without qualities`);
  }
  if (o.voices) {
    const ids = o.voices.map((v) => v.id);
    fields.push(`voices: ${vocab.name("V", ids)}`);
    if (o.default_voice === undefined || !ids.includes(o.default_voice)) {
      throw new Error(`${model.id}: voices without a default_voice that is one of them`);
    }
    fields.push(`defaultVoice: ${quote(o.default_voice)}`);
  }
  if (o.max_characters !== undefined) fields.push(`maxCharacters: ${num(o.max_characters)}`);
  if (o.dialogue !== undefined) fields.push(`dialogue: ${o.dialogue}`);
  // Three states, all observed: a list is an enum, `[]` means the model "picks
  // the language from the text" and refuses `language_code`, and ABSENT means
  // any code is accepted. The empty array must therefore survive lowering.
  if (o.languages) {
    fields.push(
      o.languages.length === 0 ? "languages: []" : `languages: ${vocab.name("L", o.languages)}`,
    );
  }
  if (o.instrumental !== undefined) fields.push(`instrumental: ${o.instrumental}`);
  if (o.outputs_per_job !== undefined) fields.push(`outputsPerJob: ${num(o.outputs_per_job)}`);
  if (o.guides) fields.push(`guides: ${vocab.name("G", o.guides)}`);
  if (o.sounds) fields.push(`sounds: ${vocab.name("S", o.sounds)}`);
  if (o.roles) fields.push(`roles: ${vocab.name("O", o.roles)}`);

  const speech = overlays.speechFields[model.id];
  if (model.tasks.includes("text_to_speech")) {
    if (speech === undefined) {
      throw new Error(
        `${model.id}: a speech model with no \`speechFields\` entry in data/revana/overlays.json — ` +
          "ask the quote endpoint which fields it takes and record its answer.",
      );
    }
    fields.push(`speechFields: ${renderStringArray(speech.fields)}`);
  }
  if (overlays.negativePrompt.acceptedBy.includes(model.id)) fields.push("negativePrompt: true");

  return `  ${quote(model.id)}: { ${fields.join(", ")} },`;
}

function renderRate(rate: number | Record<string, number>): string {
  if (typeof rate === "number") return num(rate);
  return `{ ${Object.entries(rate)
    .map(([key, usd]) => `${quote(key)}: ${num(usd)}`)
    .join(", ")} }`;
}

function lowerPrice(model: MediaModel): string {
  const fields = [`unit: ${quote(model.price.unit)}`, `usd: ${renderRate(model.price.usd)}`];
  if (model.price.fee_usd !== undefined) fields.push(`feeUsd: ${renderRate(model.price.fee_usd)}`);
  if (model.price.billed !== undefined) fields.push(`billed: ${quote(model.price.billed)}`);
  return `  ${quote(model.id)}: { ${fields.join(", ")} },`;
}

/** `ModelInfo.modalities.input`, from what the model's tasks take. */
function inputModalities(model: MediaModel): string[] {
  const fields = mediaFields(model);
  const modalities: string[] = [];
  if (!model.tasks.every((task) => task === "upscale")) modalities.push("text");
  if (fields.includes("image_url") || fields.includes("image_urls")) modalities.push("image");
  if (fields.includes("audio_url")) modalities.push("audio");
  if (fields.includes("video_url")) modalities.push("video");
  return modalities;
}

/**
 * The flat half of a listed price, where `ModelCost` can state it.
 *
 * A rate keyed by setting (`"720p+audio"`, `"1:1-high"`) or carrying a per-job
 * fee is not a `ModelCost`: those stay in `prices-<address>.gen.ts` and are resolved per
 * request by `revanaCostUSD`. A music job is flat per JOB, a unit `ModelCost`
 * has no field for, so it is priced the same way.
 */
function flatCost(model: MediaModel): string | undefined {
  const { unit, usd, fee_usd: fee, billed } = model.price;
  if (typeof usd !== "number" || fee !== undefined || billed !== undefined) return undefined;
  return renderMediaCost({
    ...(unit === "per_image" && { perImage: usd }),
    ...(unit === "per_second" && { perVideoSecond: usd }),
    // "per 1,000 characters" → the catalog's per-million unit.
    ...(unit === "per_1k_chars" && { perMillionCharacters: usd * 1000 }),
  });
}

function lowerMediaRow(model: MediaModel): string {
  const lines = [
    `  ${quote(model.id)}: {`,
    `    id: ${quote(model.id)},`,
    `    name: ${quote(model.name)},`,
    `    attachment: ${mediaFields(model).length > 0},`,
    "    reasoning: false,",
    "    toolCall: false,",
    "    openWeights: false,",
    `    modalities: { input: ${renderStringArray(inputModalities(model))}, output: ${renderStringArray([model.kind])} },`,
    `    limit: ${renderLimit({ context: 0, characters: model.options.max_characters })},`,
  ];
  const cost = flatCost(model);
  if (cost !== undefined) lines.push(`    cost: ${cost},`);
  lines.push("  },");
  return lines.join("\n");
}

function chatSurcharges(model: ChatModel): string[] {
  const notes: string[] = [];
  for (const tier of model.price.tiers ?? []) {
    notes.push(
      `above ${tier.prompt_tokens_above} prompt tokens the whole request bills at $${tier.input} in / $${tier.output} out`,
    );
  }
  if (model.price.peak_multiplier !== undefined) {
    notes.push(`${model.price.peak_multiplier}× during ${model.price.peak_hours ?? "peak hours"}`);
  }
  if (model.price.effort_max_multiplier !== undefined) {
    notes.push(`${model.price.effort_max_multiplier}× at effort max`);
  }
  return notes;
}

function lowerChatRow(model: ChatModel): string {
  const surcharges = chatSurcharges(model);
  const lines: string[] = [];
  if (surcharges.length > 0) {
    lines.push(
      `  // Base rates only — Revana also lists: ${surcharges.join("; ")}. \`usage.cost_usd\` on the response is exact.`,
    );
  }
  lines.push(
    `  ${quote(model.id)}: {`,
    `    id: ${quote(model.id)},`,
    `    name: ${quote(model.name)},`,
    "    attachment: true,",
    "    reasoning: true,",
    "    toolCall: true,",
    "    openWeights: false,",
    '    modalities: { input: ["text", "image"], output: ["text"] },',
    `    limit: ${renderLimit({ context: model.context_tokens ?? 0, output: model.max_output_tokens })},`,
    `    cost: { input: ${num(model.price.input)}, output: ${num(model.price.output)}, cacheRead: ${num(model.price.cached_input)}, cacheWrite: ${num(model.price.cache_write)} },`,
    "  },",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Lowering — the unified rows
// ---------------------------------------------------------------------------

/**
 * The canonical size words of `unmodel/video` and `unmodel/image`, restated
 * because this script imports no source module. The emitted tables `satisfies`
 * the kernel's own row types, so a word that is not one fails `tsc`.
 */
const VIDEO_TIERS = ["480p", "720p", "1080p", "1440p", "4k"] as const;
const IMAGE_TIERS = ["1k", "2k", "4k"] as const;

/** `16:9`, `19.5:9` — a shape. `auto`, `Auto` and `adaptive` mean "follow the input" and are not one. */
const RATIO_SHAPE = /^\d+(\.\d+)?:\d+(\.\d+)?$/;

type Overlays = z.infer<typeof overlaysSchema>;

/**
 * The canonical tiers a model can express, and the catalog's spelling of each.
 *
 * A tier maps to a listed resolution only when the two are the SAME WORD
 * ignoring case — `"4k"` and `"4K"` — which is the rule the API itself matches
 * `ModelInput` settings by ("4k" is "4K"). Nothing is mapped by meaning:
 * Revana does not publish how many lines `2K` is, so `1440p` reaches no model
 * and `2K`, `768p`, `1MP` and the rest stay reachable in their own spelling
 * through `providerOptions.revana.input.resolution`.
 *
 * No list at all is a fact too ("<id> takes no input.resolution."): the tiers
 * are then empty and there is no wire map.
 */
function tierFields(
  listed: readonly string[] | undefined,
  canonical: readonly string[],
  keys: { tiers: string; wire: string },
  vocab: Vocabularies,
): string[] {
  if (listed === undefined) return [`${keys.tiers}: []`];
  const pairs = canonical.flatMap((tier) => {
    const spelling = listed.find((value) => value.toLowerCase() === tier);
    return spelling === undefined ? [] : [[tier, spelling] as const];
  });
  const tiers = pairs.map(([tier]) => tier);
  const wire = pairs.map(([tier, spelling]) => `${quote(tier)}: ${quote(spelling)}`).join(", ");
  return [
    `${keys.tiers}: ${tiers.length === 0 ? "[]" : vocab.name("T", tiers)}`,
    `${keys.wire}: ${vocab.object("W", pairs.length === 0 ? "{}" : `{ ${wire} }`)}`,
  ];
}

/** The listed aspect ratios that are shapes, or nothing when the model lists none (free-form). */
function ratioFields(listed: readonly string[] | undefined, vocab: Vocabularies): string[] {
  if (listed === undefined) return [];
  const shapes = listed.filter((value) => RATIO_SHAPE.test(value));
  return [`ratios: ${shapes.length === 0 ? "[]" : vocab.name("A", shapes)}`];
}

/** `extras: X_…` — the per-model params the canonical vocabulary has no word for. */
function extrasField(entries: readonly string[], vocab: Vocabularies): string[] {
  return entries.length === 0 ? [] : [`extras: ${vocab.object("X", `{ ${entries.join(", ")} }`)}`];
}

/** `quality`, where the catalog lists the model's tiers; elsewhere it has no listed values to type. */
function qualityExtra(model: MediaModel, vocab: Vocabularies): string[] {
  const { qualities } = model.options;
  return qualities === undefined ? [] : [`quality: EXTRA as (typeof ${vocab.name("Q", qualities)})[number]`];
}

/**
 * A video row: the clip lengths, the canonical tiers, the shapes.
 *
 * `durations` is a list where the catalog lists one, ABSENT where it publishes
 * a range (`duration` then stays the wide `number` and the range is checked on
 * the way out) and EMPTY where the model "sets its own length". The Nemesis
 * models are empty on both `durations` and `ratios` whatever the catalog says:
 * `NemesisInput` has neither field ("the result keeps the clip's length and
 * shape"), and the range their rows carry is the length of the clip they take.
 */
function lowerVideoParams(model: MediaModel, vocab: Vocabularies): string[] {
  const o = model.options;
  const nemesis = NEMESIS_IDS.includes(model.id);
  const fields: string[] = [];
  if (nemesis || o.durations === undefined) fields.push("durations: []");
  else if (Array.isArray(o.durations)) fields.push(`durations: ${vocab.name("D", o.durations)}`);
  fields.push(...tierFields(o.resolutions, VIDEO_TIERS, { tiers: "resolutions", wire: "resolutionWire" }, vocab));
  fields.push(...(nemesis ? ["ratios: []"] : ratioFields(o.aspect_ratios, vocab)));

  const extras: string[] = [];
  if (o.audio === true) extras.push("audio: EXTRA as boolean");
  if (o.guides) extras.push(`guide: EXTRA as (typeof ${vocab.name("G", o.guides)})[number]`);
  if (o.sounds) extras.push(`sound: EXTRA as (typeof ${vocab.name("S", o.sounds)})[number]`);
  if (o.roles) extras.push(`roles: EXTRA as readonly (typeof ${vocab.name("O", o.roles)})[number][]`);
  return [...fields, ...extrasField(extras, vocab)];
}

function lowerImageParams(model: MediaModel, vocab: Vocabularies): string[] {
  return [
    ...ratioFields(model.options.aspect_ratios, vocab),
    ...tierFields(model.options.resolutions, IMAGE_TIERS, { tiers: "tiers", wire: "tierWire" }, vocab),
    ...extrasField(qualityExtra(model, vocab), vocab),
  ];
}

/** An edit row has no tier: `unmodel/image-edit` has no `resolution` word. */
function lowerImageEditParams(model: MediaModel, vocab: Vocabularies): string[] {
  return [
    ...ratioFields(model.options.aspect_ratios, vocab),
    ...extrasField(qualityExtra(model, vocab), vocab),
  ];
}

/**
 * An upscale row: a still, and no multiplier.
 *
 * `sources` is `["image"]` although an upscaler's tasks take "input.image_url
 * or input.video_url": a canonical `{ url }` does not say which of the two it
 * is, Revana takes no inline bytes whose media type could, and so the unified
 * ref carries the still. A clip is addressed on `revana.upscale` by name.
 * `factors` is empty because `ModelInput` has no multiplier field.
 */
function lowerUpscaleParams(): string[] {
  return ['sources: ["image"]', "factors: []"];
}

/**
 * A lipsync or avatar row: what it animates, and the `prompt` neither
 * vocabulary has a word for. `ModelInput.prompt` exists on every model, so it
 * rides as an extra.
 */
function lowerPerformanceParams(source: "video" | "image", vocab: Vocabularies): string[] {
  return [`sources: [${quote(source)}]`, ...extrasField(["prompt: EXTRA as string"], vocab)];
}

/**
 * A speech row: the voice ids, the languages where the catalog lists any, and
 * no codec — the speech input has no format field.
 *
 * `languages` is emitted only for a non-empty list. `[]` ("picks the language
 * from the text") and absent (any code) both leave the canonical `language`
 * wide, and the wire rows are what tell those two apart.
 */
function lowerTtsParams(model: MediaModel, vocab: Vocabularies, overlays: Overlays): string[] {
  const o = model.options;
  const fields = ["codecs: []"];
  if (o.voices) fields.push(`voices: ${vocab.name("V", o.voices.map((voice) => voice.id))}`);
  if (o.languages !== undefined && o.languages.length > 0) {
    fields.push(`languages: ${vocab.name("L", o.languages)}`);
  }
  const takes = overlays.speechFields[model.id]?.fields ?? [];
  const extras = (["stability", "similarity_boost"] as const)
    .filter((field) => takes.includes(field))
    .map((field) => `${field}: EXTRA as number`);
  return [...fields, ...extrasField(extras, vocab)];
}

/** A music row: no codec, and the two fields a request needs one of. */
function lowerMusicParams(vocab: Vocabularies): string[] {
  return ["codecs: []", ...extrasField(["style: EXTRA as string", "lyrics: EXTRA as string"], vocab)];
}

interface ParamsSlice {
  /** The file stem and the pack: `image-edit` → `image-edit-params.gen.ts`, `unmodel/image-edit`. */
  readonly category: string;
  /** The address the pack's adapter finishes in. */
  readonly address: string;
  /** The row type the table `satisfies`, and the module it is imported from. */
  readonly rowType: string;
  readonly rowModule: string;
  readonly models: readonly MediaModel[];
  lower(model: MediaModel, vocab: Vocabularies): string[];
}

const KERNEL_ROWS = "../../../core/unified/vocabulary/model-params";
const PROVIDER_ROWS = "../param-types";

function renderParams(slice: ParamsSlice): string {
  const vocab = new Vocabularies();
  const rows = slice.models.map((model) => {
    const fields = slice.lower(model, vocab);
    return `  ${quote(model.id)}: ${fields.length === 0 ? "{}" : `{ ${fields.join(", ")} }`},`;
  });
  const constant = slice.category.toUpperCase().replaceAll("-", "_");
  const hoisted = vocab.render();
  const usesExtra = hoisted.includes("EXTRA as ");
  return [
    HEADER,
    `import type { ${slice.rowType} } from ${quote(slice.rowModule)};`,
    "",
    ...(usesExtra
      ? [
          "/**",
          " * The value half of an `extras` entry: `undefined` at run time, the cast's type",
          " * at compile time. Declared here rather than imported from",
          " * `core/unified/derive`: a generated module is data, and a value import from",
          " * the kernel would put it behind every `unmodel/revana/values` import.",
          " */",
          "const EXTRA: never = undefined as never;",
          "",
        ]
      : []),
    ...(hoisted === "" ? [] : [hoisted, ""]),
    `/** The ids \`unmodel/${slice.category}\` addresses as \`revana/<id>\` — each one finishes in \`${slice.address}\`. */`,
    `export const REVANA_${constant}_UNIFIED_MODELS = ${renderStringArray(slice.models.map((m) => m.id))} as const;`,
    "",
    "/**",
    ` * What each of those models narrows in \`unmodel/${slice.category}\`'s vocabulary — the`,
    " * catalog's `options`, lowered to canonical words. An EMPTY list is a fact (the",
    " * model has no such field) and an ABSENT key leaves the canonical field wide.",
    " */",
    `export const REVANA_${constant}_UNIFIED_PARAMS = {`,
    ...rows,
    `} as const satisfies Record<string, ${slice.rowType}>;`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

const HEADER = [
  "// Generated by scripts/codegen-revana.ts — DO NOT EDIT.",
  "// Source: https://api.revana.si/v1/models (keyless), snapshotted at data/revana/models.json.",
  "// Hand inputs: data/revana/curation.json, data/revana/overlays.json.",
  "// Regenerate with `bun run codegen:revana` (or `bun run codegen:revana:refresh` to re-fetch the snapshot).",
  "",
].join("\n");

interface IdList {
  /** `REVANA_<CONST>_MODELS` and `Revana<Type>ModelId`. */
  constant: string;
  type: string;
  doc: string;
  ids: readonly string[];
}

function renderIdList(list: IdList): string {
  return [
    `/** ${list.doc} */`,
    `export const REVANA_${list.constant}_MODELS = ${renderStringArray(list.ids)} as const;`,
    `export type Revana${list.type}ModelId = (typeof REVANA_${list.constant}_MODELS)[number];`,
  ].join("\n");
}

function renderCatalog(name: string, doc: string, rows: readonly string[]): string {
  return [
    HEADER,
    'import type { ModelInfo } from "../../../core/catalog-types";',
    "",
    `/** ${doc} */`,
    `export const ${name} = {`,
    ...rows,
    "} as const satisfies Record<string, ModelInfo>;",
    "",
  ].join("\n");
}

export function generate(input: GenerateInput): Map<string, string> {
  const catalog = catalogSchema.parse(input.catalog);
  const curation = curationSchema.parse(input.curation);
  const overlays = overlaysSchema.parse(input.overlays);

  const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const media = catalog.data.filter((m): m is MediaModel => m.kind !== "text").sort(byId);
  const chat = catalog.data.filter((m): m is ChatModel => m.kind === "text").sort(byId);
  const mediaIds = new Set(media.map((m) => m.id));

  const seen = new Set<string>();
  for (const model of catalog.data) {
    if (seen.has(model.id)) throw new Error(`duplicate model id in the catalog: ${model.id}`);
    seen.add(model.id);
  }

  // --- curation and overlays must name real models ---------------------------
  const lipsync = Object.keys(curation.views.lipsync).sort();
  const avatar = Object.keys(curation.views.avatar).sort();
  for (const id of [...lipsync, ...avatar]) {
    if (!mediaIds.has(id)) throw new Error(`curation.json names "${id}", which the catalog no longer lists`);
  }
  for (const id of lipsync) {
    if (avatar.includes(id)) throw new Error(`curation.json files "${id}" under both lipsync and avatar`);
  }
  for (const id of [...Object.keys(overlays.speechFields), ...overlays.negativePrompt.acceptedBy]) {
    if (!mediaIds.has(id)) throw new Error(`overlays.json names "${id}", which the catalog no longer lists`);
  }

  const isModelInput = (m: MediaModel): boolean => m.id !== SEEDANCE_25 && !NEMESIS_IDS.includes(m.id);
  for (const model of media) {
    if (
      model.kind === "video" &&
      isModelInput(model) &&
      model.capabilities.audio_input &&
      !lipsync.includes(model.id) &&
      !avatar.includes(model.id)
    ) {
      throw new Error(
        `${model.id}: a video model that takes \`audio_url\` and is filed under neither \`views.lipsync\` ` +
          "nor `views.avatar` in data/revana/curation.json — classify it (or record why it is neither).",
      );
    }
  }

  const of = (kind: MediaModel["kind"]): MediaModel[] => media.filter((m) => m.kind === kind);
  const withTask = (task: MediaTask): MediaModel[] => media.filter((m) => m.tasks.includes(task));
  const ids = (models: readonly { id: string }[]): string[] => models.map((m) => m.id);

  const lists: IdList[] = [
    { constant: "VIDEO", type: "Video", doc: "Every `kind: \"video\"` model — the ids `revana.video` types.", ids: ids(of("video")) },
    { constant: "IMAGE", type: "Image", doc: "Every `kind: \"image\"` model — the ids `revana.image` types.", ids: ids(of("image")) },
    { constant: "IMAGE_EDIT", type: "ImageEdit", doc: "The image models whose `tasks` include `image_to_image` — `revana.imageEdit`.", ids: ids(withTask("image_to_image")) },
    { constant: "UPSCALE", type: "Upscale", doc: "The models whose `tasks` include `upscale` — `revana.upscale`.", ids: ids(withTask("upscale")) },
    { constant: "LIPSYNC", type: "Lipsync", doc: "Curated (`views.lipsync`): a clip re-voiced to a sound — `revana.lipsync`.", ids: lipsync },
    { constant: "AVATAR", type: "Avatar", doc: "Curated (`views.avatar`): a still animated to a sound — `revana.avatar`.", ids: avatar },
    { constant: "TTS", type: "Tts", doc: "The models whose `tasks` include `text_to_speech` — `revana.tts`.", ids: ids(withTask("text_to_speech")) },
    { constant: "MUSIC", type: "Music", doc: "The models whose `tasks` include `text_to_music` — `revana.music`.", ids: ids(withTask("text_to_music")) },
    { constant: "CHAT", type: "Chat", doc: "Every `kind: \"text\"` model — `revana.chat`, on `/v1/chat/completions`.", ids: ids(chat) },
  ];
  for (const model of of("audio")) {
    const speech = model.tasks.includes("text_to_speech");
    const music = model.tasks.includes("text_to_music");
    if (speech === music) throw new Error(`${model.id}: an audio model that is not exactly one of speech or music`);
  }

  // Every voice, once, for pickers: the catalog repeats one list per model.
  const voices = new Map<string, { id: string; name: string; description?: string }>();
  for (const model of media) for (const voice of model.options.voices ?? []) voices.set(voice.id, voice);
  const voiceRows = [...voices.values()]
    .sort(byId)
    .map(
      (v) =>
        `  { id: ${quote(v.id)}, name: ${quote(v.name)}${v.description === undefined ? "" : `, description: ${quote(v.description)}`} },`,
    );

  const files = new Map<string, string>();

  // One shape table and one price table PER WIDE ADDRESS, so that an address —
  // and the unified pack that reaches it — carries its own rows and no other's:
  // `unmodel/video` has no use for forty-nine picture models' aspect ratios.
  // Speech and music share a catalog `kind` and nothing else, so they split.
  const slices = [
    { name: "video", label: 'kind: "video"', models: of("video") },
    { name: "image", label: 'kind: "image"', models: of("image") },
    { name: "tts", label: "speech", models: withTask("text_to_speech") },
    { name: "music", label: "music", models: withTask("text_to_music") },
  ] as const;
  for (const { name: kind, label, models: sliceModels } of slices) {
    const vocab = new Vocabularies();
    const rows = sliceModels.map((model) => lowerShape(model, vocab, overlays));
    const constant = `REVANA_${kind.toUpperCase()}_SHAPES`;
    files.set(
      `shapes-${kind}.gen.ts`,
      [
        HEADER,
        'import type { RevanaModelShape } from "../shape-types";',
        "",
        "// Vocabularies, hoisted and named by content: the same list is shared by",
        "// many models, and a content-derived name means a new model renumbers nothing.",
        vocab.render(),
        "",
        "/**",
        ` * What each ${label} model takes — the catalog's \`tasks\`, \`options\``,
        " * and `capabilities`, lowered to the table the check battery and the",
        " * per-model types read.",
        " *",
        " * An ABSENT key is a fact, not a gap: no `resolutions` means the model \"takes",
        " * no input.resolution\", no `durations` that it \"sets its own length\". See",
        " * `../shape-types.ts` for what each one means on the wire.",
        " */",
        `export const ${constant} = {`,
        ...rows,
        "} as const satisfies Record<string, RevanaModelShape>;",
        "",
      ].join("\n"),
    );
    files.set(
      `prices-${kind}.gen.ts`,
      [
        HEADER,
        'import type { RevanaListedPrice } from "../shape-types";',
        "",
        "/**",
        ` * The LISTED price of each ${label} model — the first route's, which`,
        " * is what a quote answers as `quoted_usd`. Keys are Revana's own",
        " * (`\"720p+audio\"`, `\"1:1-high\"`); `../pricing.ts` resolves a request to one.",
        " */",
        `export const REVANA_${kind.toUpperCase()}_PRICES = {`,
        ...sliceModels.map(lowerPrice),
        "} as const satisfies Record<string, RevanaListedPrice>;",
        "",
      ].join("\n"),
    );
  }

  // One unified table PER CATEGORY PACK. The video roster leaves out the two
  // curated views: a lip-sync or talking-avatar model needs `audio_url`, which
  // `unmodel/video` has no word for, and its own pack addresses it. The image
  // roster is the models that can start from a prompt alone, which is what
  // `unmodel/image` asks of one.
  const viewed = new Set([...lipsync, ...avatar]);
  const pictures = (task: MediaTask): MediaModel[] => of("image").filter((m) => m.tasks.includes(task));
  const params: ParamsSlice[] = [
    {
      category: "video",
      address: "revana.video",
      rowType: "RevanaVideoParamRow",
      rowModule: PROVIDER_ROWS,
      models: of("video").filter((m) => !viewed.has(m.id)),
      lower: lowerVideoParams,
    },
    {
      category: "image",
      address: "revana.image",
      rowType: "RevanaImageParamRow",
      rowModule: PROVIDER_ROWS,
      models: pictures("text_to_image"),
      lower: lowerImageParams,
    },
    {
      category: "image-edit",
      address: "revana.imageEdit",
      rowType: "ModelParams",
      rowModule: KERNEL_ROWS,
      models: pictures("image_to_image"),
      lower: lowerImageEditParams,
    },
    {
      category: "upscale",
      address: "revana.upscale",
      rowType: "UpscaleModelParams",
      rowModule: KERNEL_ROWS,
      models: withTask("upscale"),
      lower: lowerUpscaleParams,
    },
    {
      category: "lipsync",
      address: "revana.lipsync",
      rowType: "LipsyncModelParams",
      rowModule: KERNEL_ROWS,
      models: media.filter((m) => lipsync.includes(m.id)),
      lower: (_model, vocab) => lowerPerformanceParams("video", vocab),
    },
    {
      category: "avatar",
      address: "revana.avatar",
      rowType: "AvatarModelParams",
      rowModule: KERNEL_ROWS,
      models: media.filter((m) => avatar.includes(m.id)),
      lower: (_model, vocab) => lowerPerformanceParams("image", vocab),
    },
    {
      category: "tts",
      address: "revana.tts",
      rowType: "TtsModelParams",
      rowModule: KERNEL_ROWS,
      models: withTask("text_to_speech"),
      lower: (model, vocab) => lowerTtsParams(model, vocab, overlays),
    },
    {
      category: "music",
      address: "revana.music",
      rowType: "MusicModelParams",
      rowModule: KERNEL_ROWS,
      models: withTask("text_to_music"),
      lower: (_model, vocab) => lowerMusicParams(vocab),
    },
  ];
  for (const slice of params) files.set(`${slice.category}-params.gen.ts`, renderParams(slice));

  files.set(
    "ids.gen.ts",
    [
      HEADER,
      "// Import-free: the id lists every address, picker and type reads.",
      "",
      ...lists.map(renderIdList).flatMap((block) => [block, ""]),
    ].join("\n"),
  );

  files.set(
    "voices.gen.ts",
    [
      HEADER,
      "/** Every voice any speech model lists, deduplicated by id — for pickers. */",
      "export const REVANA_VOICES = [",
      ...voiceRows,
      "] as const;",
      "",
    ].join("\n"),
  );

  files.set(
    "models-video.gen.ts",
    renderCatalog("videoModels", "The `kind: \"video\"` rows.", of("video").map(lowerMediaRow)),
  );
  files.set(
    "models-image.gen.ts",
    renderCatalog("imageModels", "The `kind: \"image\"` rows.", of("image").map(lowerMediaRow)),
  );
  files.set(
    "models-tts.gen.ts",
    renderCatalog("ttsModels", "The speech rows.", withTask("text_to_speech").map(lowerMediaRow)),
  );
  files.set(
    "models-music.gen.ts",
    renderCatalog("musicModels", "The music rows.", withTask("text_to_music").map(lowerMediaRow)),
  );
  files.set(
    "models-chat.gen.ts",
    renderCatalog(
      "chatModels",
      [
        "The `kind: \"text\"` rows, served on `/v1/chat/completions`.",
        " *",
        " * `attachment`, `reasoning` and `toolCall` are `true` on EVERY row, and that",
        " * is not a per-model claim: Revana's catalog publishes no capability flags",
        " * for language models, and the endpoint documents one envelope for all of",
        " * them (\"text and image_url pictures … function tools\"). A `false` here",
        " * would make `revana.chat` refuse a request on a guess, so the flags state",
        " * the envelope and the upstream model decides the rest.",
        " *",
        " * `limit.context: 0` (38 rows) means Revana lists no context size — the",
        " * pipeline skips the window check — not that the model has none.",
      ].join("\n"),
      chat.map(lowerChatRow),
    ),
  );

  return files;
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await Bun.file(path).text());
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} answered ${response.status}`);
  return response.json();
}

/** The catalog with its rows sorted by id and its keys sorted, so a refresh diffs on content. */
function normalizeCatalog(raw: unknown): unknown {
  const parsed = z.looseObject({ data: z.array(z.looseObject({ id: z.string() })) }).parse(raw);
  const data = [...parsed.data].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sortKeysDeep({ ...parsed, data });
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function fetchSnapshots(): Promise<{ models: string; openapi: string }> {
  return {
    models: serialize(normalizeCatalog(await fetchJson(MODELS_URL))),
    openapi: serialize(sortKeysDeep(await fetchJson(OPENAPI_URL))),
  };
}

async function refresh(): Promise<void> {
  const { models, openapi } = await fetchSnapshots();
  await Bun.write(MODELS_PATH, models);
  await Bun.write(OPENAPI_PATH, openapi);
  console.log("Refreshed data/revana/models.json and data/revana/openapi.json");
}

async function check(): Promise<void> {
  const { models, openapi } = await fetchSnapshots();
  const drifted: string[] = [];
  if (models !== (await Bun.file(MODELS_PATH).text())) drifted.push("data/revana/models.json");
  if (openapi !== (await Bun.file(OPENAPI_PATH).text())) drifted.push("data/revana/openapi.json");
  if (drifted.length === 0) {
    console.log("Revana's catalog and OpenAPI document match the committed snapshots.");
    return;
  }
  console.error(`Drifted from the live API: ${drifted.join(", ")}`);
  console.error(
    "Run `bun run codegen:revana:refresh` and review the diff. A changed openapi.json means " +
      "src/providers/revana/generation-wire.ts was transcribed from a document that has since moved.",
  );
  process.exitCode = 1;
}

async function main(): Promise<void> {
  if (process.argv.includes("--check")) return check();
  if (process.argv.includes("--refresh")) await refresh();

  const files = generate({
    catalog: await readJson(MODELS_PATH),
    curation: await readJson(CURATION_PATH),
    overlays: await readJson(OVERLAYS_PATH),
  });

  const { mkdir, readdir, rm } = await import("node:fs/promises");
  await mkdir(GEN_DIR, { recursive: true });
  // Stale sweep, scoped to this provider's `gen/` and nothing else.
  for (const existing of await readdir(GEN_DIR)) {
    if (existing.endsWith(".gen.ts") && !files.has(existing)) {
      await rm(`${GEN_DIR}${existing}`);
      console.log(`Removed stale ${existing}`);
    }
  }
  for (const [name, content] of files) await Bun.write(`${GEN_DIR}${name}`, content);
  console.log(`Generated ${files.size} files into src/providers/revana/gen/`);
}

if (import.meta.main) {
  await main();
}
