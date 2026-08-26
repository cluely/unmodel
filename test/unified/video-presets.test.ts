/**
 * Every value the video tables autocomplete, compiled and validated.
 *
 * ## Why this file exists
 *
 * `video({ model: "openai/sora-2", duration: … })` offers that model's own five
 * lengths, and a suggestion is only worth having if it is one the provider
 * accepts. So the promise is checked exhaustively rather than sampled: for
 * every model on all ten video adapters, **every** `duration`, **every**
 * `resolution` and **every** `aspectRatio` the table declares is compiled
 * through the unified surface and run through the provider's own validator.
 *
 * This is `test/unified/image-presets.test.ts` for the category whose
 * per-model facts are the least uniform, plus the half that file does not
 * need: a **negative** sweep. A closed `durations` enum makes a claim in both
 * directions — these and no others — so one off-enum length per model is
 * asserted to fail, at `duration`, on every route the model serves. Without it
 * a table that listed every integer from 1 to 30 would pass the positive sweep
 * and describe nothing.
 *
 * ## Why a cell may try more than one route
 *
 * Video is the category where "which endpoint" is derived from the *inputs*,
 * and half these models are not on the text route at all — `kling-v2-1` is
 * image-to-video only, `runway/aleph2` video-to-video only, `vidu/viduq3` has
 * only a reference arm. A declared value is therefore asserted **reachable**:
 * it must compile cleanly on at least one of the four route shapes. That is
 * the honest statement a per-model row can make about a provider whose fields
 * differ per route, and it is exactly how the tables were derived.
 *
 * `resolution` gets the same weaker bar it gets in the image sweep — `ok`, with
 * warnings allowed — because at four providers the canonical tier is genuinely
 * approximate (MiniMax's `768P` is 768 lines, not 720) and demanding silence
 * would mean deleting either true rows or honest warnings. `duration` and
 * `aspectRatio` are held to zero *added* warnings, because they are what an
 * editor puts in front of the caller.
 */
import { describe, expect, test } from "bun:test";
import type { VideoModelParams } from "../../src/core/unified/vocabulary/model-params";
import type { VideoParams } from "../../src/core/unified/vocabulary/video";
import { video } from "../../src/unified/video";
import { video as atlascloud } from "../../src/providers/atlascloud/unified-video";
import { videoShapeRules } from "../../src/providers/atlascloud/constraints";
import { video as bytedance } from "../../src/providers/bytedance/unified-video";
import { video as fal } from "../../src/providers/fal/unified-video";
import { FAL_REQUIRED_PROBES } from "../../src/providers/fal/gen/endpoints.gen";
import { video as google } from "../../src/providers/google/unified-video";
import { video as kling } from "../../src/providers/kling/unified-video";
import { video as lightricks } from "../../src/providers/lightricks/unified";
import { video as luma } from "../../src/providers/luma/unified-video";
import { video as minimax } from "../../src/providers/minimax/unified-video";
import { video as openai } from "../../src/providers/openai/unified-video";
import { video as pixverse } from "../../src/providers/pixverse/unified";
import { video as runway } from "../../src/providers/runway/unified-video";
import { video as vidu } from "../../src/providers/vidu/unified-video";

interface Adapter {
  readonly provider: string;
  readonly models: readonly string[];
  readonly modelParams?: Readonly<Record<string, VideoModelParams>>;
}

const ADAPTERS: readonly Adapter[] = [
  openai,
  google,
  runway,
  kling,
  luma,
  minimax,
  vidu,
  pixverse,
  bytedance,
  lightricks,
  fal,
  atlascloud,
];

const IMAGE_URL = "https://example.com/frame.png";
const CLIP_URL = "https://example.com/clip.mp4";
/** google is the one provider with no URL form anywhere on the route. */
const BYTES =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * A route's own required params — the ones with no server default, which a
 * sweep would otherwise be measuring instead of the preset.
 *
 * Runway's `ratio` is required by several arms; PixVerse marks four fields
 * required and documents no default for three of them; LTX's schema requires
 * `duration` and `resolution`; MiniMax's v2 route requires both and bills by
 * them. Each entry is dropped for the field currently under test, so the probe
 * is always the caller's value and never the placeholder.
 */
/**
 * fal's required sets, DERIVED rather than transcribed.
 *
 * `FAL_REQUIRED_PROBES` is generated from each endpoint's OpenAPI `required`
 * list minus everything fal supplies a default for — the same subtraction
 * `checkRequired` makes — so this map is fal's own answer to "what must a probe
 * carry", refreshed weekly with the snapshots. Thirty-five hand-written entries
 * would be thirty-five transcriptions to keep in step, and the first one to go
 * stale would turn a real regression into a passing sweep.
 *
 * Only the MEDIA requirements survive the translation: `prompt` is supplied by
 * the sweep already, and the canonical fields under test (`duration`,
 * `resolution`, `aspectRatio`) are exactly what a `REQUIRED` entry must not
 * pre-fill.
 */
const FAL_REQUIRED: Readonly<Record<string, Partial<VideoParams>>> = Object.fromEntries(
  Object.entries(FAL_REQUIRED_PROBES).flatMap(([id, names]) => {
    const need = names as readonly string[];
    const params: Partial<VideoParams> = {};
    if (need.some((name) => /(^|_)image_urls?$/.test(name) || /frame_url$/.test(name))) {
      // Three arms, one per wire spelling the roster actually requires: a
      // named pair of frames is `first` + `last`; a required `image_urls` LIST
      // is a `reference` row (veo3.1/reference-to-video is the first of them,
      // and a row whose roles are `["reference"]` refuses the default `first`);
      // a single frame is the opening one.
      const roles: VideoParams["image"] = need.some((name) => /^(last_frame_url|end_image_url)$/.test(name))
        ? [{ url: IMAGE_URL }, { url: IMAGE_URL, role: "last" }]
        : need.some((name) => /(^|_)image_urls$/.test(name))
          ? [{ url: IMAGE_URL, role: "reference" }]
          : { url: IMAGE_URL };
      (params as { image?: VideoParams["image"] }).image = roles;
    }
    if (need.includes("video_url")) (params as { video?: VideoParams["video"] }).video = { url: CLIP_URL };
    return Object.keys(params).length === 0 ? [] : [[`fal/${id}`, params] as const];
  }),
);

/**
 * Atlas's required sets, DERIVED for the same reason fal's are.
 *
 * `videoShapeRules[id].required` is each model's own OpenAPI `required` list,
 * transcribed once in `src/providers/atlascloud/constraints.ts` and read by
 * `checkRequired` — so this map is the provider's own answer to "what must a
 * probe carry", and twenty-three hand-written entries would be twenty-three
 * transcriptions to keep in step.
 *
 * Only the MEDIA requirements survive the translation, exactly as at fal:
 * `prompt` is supplied by the sweep already, and the canonical fields under
 * test (`duration`, `resolution`, `aspectRatio`) are never required by an
 * Atlas schema, so nothing here can pre-fill the field being measured.
 *
 * `images` is Veo 3.1's reference array and `image` is a first frame — the same
 * split `resolveImageSlots` reads, which is why the two map to different roles.
 */
const ATLASCLOUD_REQUIRED: Readonly<Record<string, Partial<VideoParams>>> = Object.fromEntries(
  Object.entries(videoShapeRules).flatMap(([id, rule]) => {
    const need = rule?.required ?? [];
    const params: Partial<VideoParams> = {};
    if (need.includes("images")) {
      (params as { image?: VideoParams["image"] }).image = [{ url: IMAGE_URL, role: "reference" }];
    } else if (need.includes("image")) {
      (params as { image?: VideoParams["image"] }).image = { url: IMAGE_URL };
    }
    return Object.keys(params).length === 0 ? [] : [[`atlascloud/${id}`, params] as const];
  }),
);

const REQUIRED: Readonly<Record<string, Partial<VideoParams>>> = {
  ...FAL_REQUIRED,
  ...ATLASCLOUD_REQUIRED,
  "runway/gen4.5": { aspectRatio: "16:9", duration: 5 },
  "runway/gen4_turbo": { aspectRatio: "16:9" },
  "runway/veo3.1": { aspectRatio: "16:9" },
  "runway/veo3.1_fast": { aspectRatio: "16:9" },
  "runway/happyhorse_1_0": { aspectRatio: "16:9" },
  "runway/hailuo3": { aspectRatio: "16:9" },
  "runway/seedance2": { aspectRatio: "16:9" },
  "runway/seedance2_fast": { aspectRatio: "16:9" },
  "runway/seedance2_mini": { aspectRatio: "16:9" },
  "runway/seedance2_5": { aspectRatio: "16:9" },
  "runway/grok_imagine_1_5": { aspectRatio: "16:9" },
  "runway/gemini_omni_flash": { aspectRatio: "16:9" },
  "minimax/MiniMax-H3": { duration: 6, resolution: "720p" },
  "lightricks/ltx-2-5-fast": { duration: 8, resolution: "1080p", aspectRatio: "16:9" },
  "lightricks/ltx-2-5-pro": { duration: 8, resolution: "1080p", aspectRatio: "16:9" },
  "lightricks/ltx-2-3-fast": { duration: 8, resolution: "1080p", aspectRatio: "16:9" },
  "lightricks/ltx-2-3-pro": { duration: 8, resolution: "1080p", aspectRatio: "16:9" },
  "lightricks/ltx-2-fast": { duration: 8, resolution: "1080p", aspectRatio: "16:9" },
  "lightricks/ltx-2-pro": { duration: 8, resolution: "1080p", aspectRatio: "16:9" },
  "pixverse/c1": { duration: 5, resolution: "720p", aspectRatio: "16:9" },
  "pixverse/v6": { duration: 5, resolution: "720p", aspectRatio: "16:9" },
  "pixverse/v5.6": { duration: 5, resolution: "720p", aspectRatio: "16:9" },
  "pixverse/v5.5": { duration: 5, resolution: "720p", aspectRatio: "16:9" },
  "pixverse/v5": { duration: 5, resolution: "720p", aspectRatio: "16:9" },
  "pixverse/v4.5": { duration: 5, resolution: "720p", aspectRatio: "16:9" },
  "pixverse/v4": { duration: 5, resolution: "720p", aspectRatio: "16:9" },
  "pixverse/v3.5": { duration: 5, resolution: "720p", aspectRatio: "16:9" },
};

/** The four input shapes the route derivation reads, one per endpoint family. */
function routeBases(provider: string): Array<Record<string, unknown>> {
  const image =
    provider === "google" ? { data: BYTES, mimeType: "image/png" } : { url: IMAGE_URL };
  const bases: Array<Record<string, unknown>> = [{ prompt: "A probe." }];
  // PixVerse's image route needs an `img_id` this vocabulary cannot mint, so
  // its only route is text — see `unsupported.image` on the adapter.
  if (provider === "pixverse") return bases;
  bases.push({ prompt: "A probe.", image });
  bases.push({ prompt: "A probe.", image: [{ ...image, role: "reference" }] });
  bases.push({ prompt: "A probe.", video: { url: CLIP_URL } });
  return bases;
}

interface Outcome {
  ok: boolean;
  warnings: number;
  errors: string[];
}

function run(ref: string, params: Record<string, unknown>): Outcome {
  const result = video.safe({ model: ref, ...params } as never) as {
    ok: boolean;
    errors?: Array<{ code: string; path: Array<string | number>; message: string }>;
    params?: { warnings?: readonly unknown[] };
  };
  if (!result.ok) {
    return {
      ok: false,
      warnings: -1,
      errors: (result.errors ?? []).map((i) => `${i.code}@${i.path.join(".")}: ${i.message}`),
    };
  }
  return { ok: true, warnings: (result.params?.warnings ?? []).length, errors: [] };
}

/**
 * One probe context: a route's inputs, the route's own required params minus
 * whichever field is under test, and a shape to try.
 *
 * The shape matters for `resolution` alone, and it is the whole reason this
 * takes a list: at the four Runway models whose `ratio` enum *is* a list of
 * pixel pairs, a tier is only reachable at the shapes that have an entry in it
 * — `gen4_turbo` renders 720p at `16:9` and 1080p at `1:1` and neither at the
 * other. `undefined` means "send no shape at all", which is the reachable
 * answer at a provider whose tier field stands alone.
 */
function context(
  ref: string,
  route: Record<string, unknown>,
  field: string,
  shape: string | undefined,
): Record<string, unknown> {
  const required = { ...(REQUIRED[ref] ?? {}) } as Record<string, unknown>;
  delete required[field];
  if (field === "resolution") delete required["aspectRatio"];
  return { ...route, ...required, ...(shape !== undefined && { aspectRatio: shape }) };
}

/** The same context with the route's placeholder value back, as the baseline. */
function baseline(ref: string, base: Record<string, unknown>, field: string): Record<string, unknown> {
  const placeholder = (REQUIRED[ref] ?? {}) as Record<string, unknown>;
  return Object.hasOwn(placeholder, field) ? { ...base, [field]: placeholder[field] } : base;
}

/** The shapes a cell is allowed to try — the model's own, plus none. */
function shapesFor(row: VideoModelParams, field: string): Array<string | undefined> {
  if (field !== "resolution") return [undefined];
  return [...(row.ratios ?? []), undefined];
}

/**
 * `""` when the value compiles on some (route, shape), otherwise every attempt's
 * errors.
 *
 * `exact` demands the probe adds no warning **of its own**, measured against
 * the same request carrying the route's placeholder instead — so a provider
 * that already warns about a *filled* required field (PixVerse fills three,
 * LTX two) is not scored for it, and an `approximated_param` the probe itself
 * causes still fails.
 */
function reachable(
  ref: string,
  provider: string,
  row: VideoModelParams,
  field: string,
  value: unknown,
  exact: boolean,
): string {
  const failures: string[] = [];
  for (const route of routeBases(provider)) {
    for (const shape of shapesFor(row, field)) {
      const base = context(ref, route, field, shape);
      const probed = run(ref, { ...base, [field]: value });
      if (!probed.ok) {
        failures.push(probed.errors.join("; "));
        continue;
      }
      if (!exact) return "";
      const bare = run(ref, baseline(ref, base, field));
      if (bare.ok && probed.warnings > bare.warnings) {
        failures.push(`added ${probed.warnings - bare.warnings} warning(s)`);
        continue;
      }
      if (!bare.ok && probed.warnings > 0) {
        failures.push(`${probed.warnings} warning(s), and the baseline does not compile`);
        continue;
      }
      return "";
    }
  }
  return failures.join(" | ") || "no route compiles";
}

/**
 * `""` when the value is refused on **every** route, otherwise the offender.
 *
 * The path is checked against the *sizing* pair rather than the field alone: at
 * the providers whose one wire field carries both halves of the size decision
 * (LTX's `resolution: "1920x1080"`, Sora's `size`), {@link toSizeEnum} reports
 * at whichever of the two the caller wrote — so an off-enum tier passed beside
 * a shape lands at `aspectRatio`, which is the honest place for it.
 */
const SIZING = ["resolution", "aspectRatio"];

function refusedEverywhere(
  ref: string,
  provider: string,
  row: VideoModelParams,
  field: string,
  value: unknown,
): string {
  for (const route of routeBases(provider)) {
    for (const shape of shapesFor(row, field)) {
      const base = context(ref, route, field, shape);
      if (!run(ref, baseline(ref, base, field)).ok) continue;
      const probed = run(ref, { ...base, [field]: value });
      if (probed.ok) return `accepted on ${JSON.stringify(Object.keys(route))}`;
      const paths = field === "duration" ? [field] : SIZING;
      if (!probed.errors.some((e) => paths.some((path) => e.includes(`@${path}`)))) {
        return `refused, but not at \`${field}\`: ${probed.errors.join("; ")}`;
      }
    }
  }
  return "";
}

describe("every declared video preset is a value the provider accepts", () => {
  test("every video adapter declares a per-model table", () => {
    for (const adapter of ADAPTERS) {
      expect(adapter.modelParams, `${adapter.provider} has no modelParams`).toBeDefined();
    }
  });

  test("every table row names a model the adapter serves, and every model has a row", () => {
    for (const adapter of ADAPTERS) {
      const rows = Object.keys(adapter.modelParams ?? {});
      for (const row of rows) {
        expect(adapter.models, `${adapter.provider} table row "${row}"`).toContain(row);
      }
      // Unlike the image tables, this one is total: every video model has at
      // least a resolution set worth narrowing, so a missing row is an
      // oversight rather than a model with nothing to declare.
      expect(rows.sort(), adapter.provider).toEqual([...adapter.models].sort());
    }
  });

  const cells: Array<[string, string, string, () => string]> = [];
  for (const adapter of ADAPTERS) {
    for (const [model, row] of Object.entries(adapter.modelParams ?? {})) {
      const ref = `${adapter.provider}/${model}`;
      for (const seconds of row.durations ?? []) {
        cells.push([ref, "duration", String(seconds), () =>
          reachable(ref, adapter.provider, row, "duration", seconds, true)]);
      }
      for (const ratio of row.ratios ?? []) {
        cells.push([ref, "aspectRatio", ratio, () =>
          reachable(ref, adapter.provider, row, "aspectRatio", ratio, true)]);
      }
      for (const tier of row.resolutions ?? []) {
        cells.push([ref, "resolution", tier, () =>
          reachable(ref, adapter.provider, row, "resolution", tier, false)]);
      }
    }
  }

  test("the sweep is not empty", () => {
    expect(cells.length).toBeGreaterThan(400);
  });

  test.each(cells)("video %s %s %s", (_ref, _field, _value, probe) => {
    expect(probe()).toBe("");
  });

  // -------------------------------------------------------------------------
  // The other direction: a closed enum says "and no others"
  // -------------------------------------------------------------------------

  /**
   * One off-enum value per closed list, refused at the canonical path on every
   * route the model serves.
   *
   * Empty lists are skipped, and deliberately: `resolutions: []` says the model
   * has no size field this vocabulary can fill, and what the *run time* does
   * with one then varies by provider — four refuse it, and Runway's `aleph2`
   * has no `resolution` wire field at all, so a tier passed beside a shape is
   * dropped rather than refused. The type is what holds that case (`never`),
   * and `test/types/unified-video.test-d.ts` is where it is asserted.
   */
  const negatives: Array<[string, string, string, () => string]> = [];
  const TIERS: ReadonlyArray<NonNullable<VideoParams["resolution"]>> = [
    "480p",
    "720p",
    "1080p",
    "1440p",
    "4k",
  ];
  for (const adapter of ADAPTERS) {
    for (const [model, row] of Object.entries(adapter.modelParams ?? {})) {
      const ref = `${adapter.provider}/${model}`;
      const durations = row.durations;
      if (durations !== undefined && durations.length > 0) {
        let miss = 1;
        while (durations.includes(miss)) miss += 1;
        const seconds = miss;
        negatives.push([ref, "duration", String(seconds), () =>
          refusedEverywhere(ref, adapter.provider, row, "duration", seconds)]);
      }
      const resolutions = row.resolutions;
      if (resolutions !== undefined && resolutions.length > 0) {
        const tier = TIERS.find((t) => !resolutions.includes(t));
        if (tier !== undefined) {
          negatives.push([ref, "resolution", tier, () =>
            refusedEverywhere(ref, adapter.provider, row, "resolution", tier)]);
        }
      }
    }
  }

  test("the negative sweep is not empty", () => {
    expect(negatives.length).toBeGreaterThan(80);
  });

  test.each(negatives)("video %s %s %s is refused", (_ref, _field, _value, probe) => {
    expect(probe()).toBe("");
  });

  // -------------------------------------------------------------------------
  // No silent drop, for every extra
  // -------------------------------------------------------------------------

  /**
   * The same question `image-presets` asks: does an extra **reach the wire** or
   * get **refused**? A request that validates with the key nowhere in it is the
   * only wrong answer.
   *
   * The probe is a sentinel string rather than a legal value, on purpose: what
   * is under test is whether the key travels, not whether the value is any
   * good. A schema that rejects `"__probe__"` answers `ok: false`, which is a
   * refusal and therefore fine.
   */
  const SENTINEL = "__unmodel_probe__";
  const extraCells: Array<[string, string, () => string]> = [];
  for (const adapter of ADAPTERS) {
    for (const [model, row] of Object.entries(adapter.modelParams ?? {})) {
      const ref = `${adapter.provider}/${model}`;
      for (const key of Object.keys(row.extras ?? {})) {
        extraCells.push([
          ref,
          key,
          () => {
            const seen: string[] = [];
            for (const route of routeBases(adapter.provider)) {
              const base = { ...route, ...(REQUIRED[ref] ?? {}) };
              const result = video.safe({ model: ref, ...base, [key]: SENTINEL } as never) as {
                ok: boolean;
                params?: unknown;
              };
              if (!result.ok) continue;
              if (JSON.stringify(result.params).includes(SENTINEL)) return "";
              seen.push("dropped");
            }
            return seen.length > 0 ? "dropped" : "";
          },
        ]);
      }
    }
  }

  test("the extras sweep is not empty", () => {
    expect(extraCells.length).toBeGreaterThan(100);
  });

  test.each(extraCells)(
    "the extra %s.%s reaches the wire or is refused, never dropped",
    (_ref, _key, probe) => {
      expect(probe()).toBe("");
    },
  );

  /**
   * And an extra a model does **not** declare is refused by name rather than
   * passed through to a schema that would reject it under a spelling the
   * caller does not recognise.
   */
  test("an extra belonging to a sibling model is refused, naming the models that take it", () => {
    const result = video.safe({
      model: "kling/kling-v3",
      prompt: "hi",
      cfg_scale: 0.5,
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ code: "unsupported_param", path: ["cfg_scale"] });
    expect(result.errors[0]!.message).toContain("kling-v1");
  });

  test("a nested extra lands under its own wire prefix", () => {
    // Kling is the provider that forced `applyExtras`'s per-key nesting:
    // `watermark_info` is a body-root field on `/v1/videos/*` and lives under
    // `options` on the path-addressed routes, from one table.
    const v1 = video({
      model: "kling/kling-v1",
      prompt: "hi",
      watermark_info: { enabled: true },
    } as never) as unknown as Record<string, unknown>;
    expect(v1["watermark_info"]).toEqual({ enabled: true });
    expect(v1["options"]).toBeUndefined();

    const v3 = video({
      model: "kling/kling-3.0",
      prompt: "hi",
      watermark_info: { enabled: true },
      audio: "native",
    } as never) as unknown as Record<string, unknown>;
    expect(v3["options"]).toEqual({ watermark_info: { enabled: true } });
    expect(v3["settings"]).toMatchObject({ audio: "native" });
    expect(v3["watermark_info"]).toBeUndefined();

    // Google's two extras nest under `parameters`, beside the compiled ones.
    const veo = video({
      model: "google/veo-3.1-generate-preview",
      prompt: "hi",
      resolution: "720p",
      enhancePrompt: false,
    } as never) as unknown as { parameters: Record<string, unknown> };
    expect(veo.parameters).toMatchObject({ resolution: "720p", enhancePrompt: false });
  });
});
