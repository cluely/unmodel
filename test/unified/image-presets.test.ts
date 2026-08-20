/**
 * Every value the per-model tables autocomplete, compiled and validated.
 *
 * ## Why this file exists
 *
 * `image({ model: "openai/gpt-image-2", size: … })` offers that model's own
 * presets, and a suggestion is only worth having if it is one the provider
 * accepts. So the promise is checked exhaustively rather than sampled: for
 * every model on every image and image-edit adapter, **every** `size` preset,
 * **every** `aspectRatio` and **every** `resolution` tier the table declares is
 * compiled through the unified surface and run through the provider's own
 * validator.
 *
 * The bar is `ok: true` with **zero errors**, and for `size` and `aspectRatio`
 * — the two an editor actually suggests — **zero warnings** as well. Warnings
 * are part of that assertion and not an afterthought: `warnings.length === 0`
 * is the library's definition of "the request mapped exactly", and a preset
 * that compiles with an `approximated_param` is a suggestion that quietly
 * costs the caller something. `resolution` is held to the weaker bar for the
 * reason spelled out on {@link run}.
 *
 * This is the `GptImage2Size` pattern — `src/providers/openai/image.ts`'s
 * presets have always been checked against `checkGptImage2Size` — generalised
 * to all nineteen adapters at once.
 *
 * ## The two no-drop sweeps
 *
 * A `size` at a model whose API has no size field, and an extra at any model
 * that declares one, are the two shapes that can look exactly like a silent
 * drop — the type says `never` or the key is unknown, the adapter has nothing
 * to write it to, and the easy implementation falls through. Both are therefore
 * asked the same question over every model on every adapter: does it **change**
 * the request or **refuse** it? Silence is the only wrong answer, and it caught
 * two real ones on the way in (FLUX Kontext's edit route and Recraft's
 * `imageToImage`, which now convert and refuse respectively).
 *
 * ## What a `BASE` entry is
 *
 * A route can require something with no canonical word at all: BFL's
 * `-finetuned` route requires a LoRA id, Runway's turbo arm requires reference
 * images, Vidu's route requires them too. Those are supplied through
 * `providerOptions`, which is exactly what it is for — and their presence here
 * is a feature: the sweep would otherwise be measuring the missing param
 * rather than the preset.
 */
import { describe, expect, test } from "bun:test";
import type { ModelParams } from "../../src/core/unified/vocabulary/model-params";
import { image } from "../../src/unified/image";
import { imageEdit } from "../../src/unified/image-edit";
import { image as blackForestLabs } from "../../src/providers/black-forest-labs/unified-image";
import { image as bria } from "../../src/providers/bria/unified";
import { image as bytedance } from "../../src/providers/bytedance/unified-image";
import { image as google } from "../../src/providers/google/unified-image";
import { image as ideogram } from "../../src/providers/ideogram/unified-image";
import { image as kling } from "../../src/providers/kling/unified-image";
import { image as krea } from "../../src/providers/krea/unified";
import { image as leonardo } from "../../src/providers/leonardo/unified";
import { image as luma } from "../../src/providers/luma/unified-image";
import { image as openai } from "../../src/providers/openai/unified-image";
import { image as recraft } from "../../src/providers/recraft/unified-image";
import { image as reve } from "../../src/providers/reve/unified";
import { image as runway } from "../../src/providers/runway/unified-image";
import { image as stability } from "../../src/providers/stability/unified-image";
import { image as vidu } from "../../src/providers/vidu/unified-image";
import { imageEdit as blackForestLabsEdit } from "../../src/providers/black-forest-labs/unified-image-edit";
import { imageEdit as ideogramEdit } from "../../src/providers/ideogram/unified-image-edit";
import { imageEdit as openaiEdit } from "../../src/providers/openai/unified-image-edit";
import { imageEdit as recraftEdit } from "../../src/providers/recraft/unified-image-edit";

interface Adapter {
  readonly provider: string;
  readonly models: readonly string[];
  readonly modelParams?: Readonly<Record<string, ModelParams>>;
}

const IMAGE_ADAPTERS: readonly Adapter[] = [
  openai,
  google,
  blackForestLabs,
  ideogram,
  recraft,
  stability,
  luma,
  bytedance,
  runway,
  kling,
  vidu,
  bria,
  leonardo,
  krea,
  reve,
];

const EDIT_ADAPTERS: readonly (Adapter & { readonly imageInputs: readonly string[] })[] = [
  openaiEdit,
  blackForestLabsEdit,
  ideogramEdit,
  recraftEdit,
];

/** A route's own required params, none of which has a canonical word. */
const BASE: Readonly<Record<string, Record<string, unknown>>> = {
  "black-forest-labs/flux-pro-1.1-ultra-finetuned": {
    providerOptions: { "black-forest-labs": { finetune_id: "my-lora" } },
  },
  "runway/gen4_image_turbo": {
    providerOptions: { runway: { referenceImages: [{ uri: "https://example.com/a.png" }] } },
  },
  "vidu/viduq1": { providerOptions: { vidu: { images: ["https://example.com/a.png"] } } },
  "vidu/viduq2": { providerOptions: { vidu: { images: ["https://example.com/a.png"] } } },
};

/**
 * `ok`, plus the warnings, in one string an assertion message can print.
 *
 * `exact` is what separates the two halves of the bar. A `size` or an
 * `aspectRatio` the table declares must map **exactly** — zero warnings, the
 * library's definition of a request that mapped — because it is a value an
 * editor put in front of the caller. A bare `resolution` is a different claim:
 * it says the tier is *reachable*, and at a provider whose output size is
 * fixed (Stability core returns 1.5 MP whatever you ask) or whose shape is
 * required (Runway picks the squarest size at the tier and says so) reaching it
 * legitimately costs an `approximated_param`. Demanding silence there would
 * mean either deleting true rows from the tables or deleting honest warnings
 * from the adapters.
 */
function run(
  call: (params: Record<string, unknown>) => { ok: boolean; errors?: unknown[]; params?: unknown },
  params: Record<string, unknown>,
  exact = true,
): string {
  const result = call(params);
  if (!result.ok) {
    const errors = (result.errors ?? []) as Array<{ code: string; path: unknown[]; message: string }>;
    return errors.map((issue) => `${issue.code} @ ${issue.path.join(".")}: ${issue.message}`).join("; ");
  }
  if (!exact) return "";
  const warnings = (result.params as { warnings?: readonly { code: string; message: string }[] })
    .warnings;
  if (warnings !== undefined && warnings.length > 0) {
    return warnings.map((warning) => `WARNING ${warning.code}: ${warning.message}`).join("; ");
  }
  return "";
}

const png = (): Blob => new Blob([new Uint8Array(64)], { type: "image/png" });

/** The whole request as one string, for the "did anything change" comparison. */
function serialize(result: { ok: boolean; params?: unknown }): string {
  const params = result.params as { request?: { url?: string } };
  return JSON.stringify(
    [params, params?.request?.url],
    (_key, value: unknown) => (value instanceof Blob ? `blob:${value.size}` : value),
  );
}

describe("every declared preset is a value the provider accepts", () => {
  test("every image adapter declares a per-model table", () => {
    for (const adapter of IMAGE_ADAPTERS) {
      expect(adapter.modelParams, `${adapter.provider} has no modelParams`).toBeDefined();
    }
  });

  test("every table row names a model the adapter serves", () => {
    for (const adapter of [...IMAGE_ADAPTERS, ...EDIT_ADAPTERS]) {
      const rows = Object.keys(adapter.modelParams ?? {}).sort();
      // Not `toEqual(models)`: a model may legitimately have nothing
      // model-dependent to declare. The invariant is the other direction —
      // a row for a model no ref can name would narrow nothing.
      for (const row of rows) {
        expect(adapter.models, `${adapter.provider} table row "${row}"`).toContain(row);
      }
    }
  });

  const imageCells: Array<[string, string, string, Record<string, unknown>]> = [];
  for (const adapter of IMAGE_ADAPTERS) {
    for (const [model, row] of Object.entries(adapter.modelParams ?? {})) {
      const ref = `${adapter.provider}/${model}`;
      const base = { ...(BASE[ref] ?? {}), model: ref, prompt: "A lighthouse in fog." };
      for (const size of row.sizes ?? []) {
        imageCells.push([ref, "size", size, { ...base, size }]);
      }
      for (const ratio of row.ratios ?? []) {
        imageCells.push([ref, "aspectRatio", ratio, { ...base, aspectRatio: ratio }]);
      }
      for (const tier of row.tiers ?? []) {
        // A tier alone is ambiguous at a provider whose shapes are an enum
        // with no square in the bucket, so the model's first declared shape
        // comes along when it has one. What is under test is the tier.
        const shape = row.ratios?.[0];
        imageCells.push([
          ref,
          "resolution",
          tier,
          { ...base, resolution: tier, ...(shape !== undefined && { aspectRatio: shape }) },
        ]);
      }
    }
  }

  test("the sweep is not empty", () => {
    expect(imageCells.length).toBeGreaterThan(700);
  });

  test.each(imageCells)("image %s %s %s", (_ref, field, _value, params) => {
    expect(run(image.safe as never, params, field !== "resolution")).toBe("");
  });

  const editCells: Array<[string, string, string, Record<string, unknown>]> = [];
  for (const adapter of EDIT_ADAPTERS) {
    const source = adapter.imageInputs.includes("file")
      ? { file: png() }
      : adapter.imageInputs.includes("url")
        ? { url: "https://example.com/source.png" }
        : { data: "AAAA" };
    for (const [model, row] of Object.entries(adapter.modelParams ?? {})) {
      const ref = `${adapter.provider}/${model}`;
      const base = { operation: "edit", model: ref, prompt: "Make it night.", image: source };
      for (const size of row.sizes ?? []) {
        editCells.push([ref, "size", size, { ...base, size }]);
      }
      for (const ratio of row.ratios ?? []) {
        editCells.push([ref, "aspectRatio", ratio, { ...base, aspectRatio: ratio }]);
      }
    }
  }

  // -------------------------------------------------------------------------
  // No silent drop, for `size` specifically
  // -------------------------------------------------------------------------

  /**
   * A `size` at a model whose API has no size field is the one shape that can
   * look exactly like a drop: the type says `never`, the adapter has nothing to
   * write it to, and the easy implementation is to fall through. So every model
   * on every adapter is asked the same question — does a `size` **change** the
   * request, or **refuse** it? — and silence is the only wrong answer.
   *
   * The probe is `"1280x720"` rather than a square, because several routes
   * default to a square and a probe equal to the default would be
   * indistinguishable from a drop.
   */
  const dropCells: Array<[string, () => string]> = [];
  for (const adapter of IMAGE_ADAPTERS) {
    for (const model of adapter.models) {
      const ref = `${adapter.provider}/${model}`;
      const base = { ...(BASE[ref] ?? {}), model: ref, prompt: "A lighthouse in fog." };
      dropCells.push([
        ref,
        () => {
          const withSize = image.safe({ ...base, size: "1280x720" } as never);
          if (!withSize.ok) return "";
          const without = image.safe(base as never);
          return serialize(withSize) === serialize(without) ? "unchanged" : "";
        },
      ]);
    }
  }
  for (const adapter of EDIT_ADAPTERS) {
    const source = adapter.imageInputs.includes("file")
      ? { file: png() }
      : adapter.imageInputs.includes("url")
        ? { url: "https://example.com/source.png" }
        : { data: "AAAA" };
    for (const model of adapter.models) {
      const ref = `${adapter.provider}/${model}`;
      // Recraft's `strength` is required with no documented default, so a
      // request without one is refused before anything else can be observed.
      const base = {
        operation: "edit",
        model: ref,
        prompt: "Make it night.",
        image: source,
        ...(adapter.provider === "recraft" && { strength: 0.4 }),
      };
      dropCells.push([
        ref,
        () => {
          const withSize = imageEdit.safe({ ...base, size: "1280x720" } as never);
          if (!withSize.ok) return "";
          const without = imageEdit.safe(base as never);
          return serialize(withSize) === serialize(without) ? "unchanged" : "";
        },
      ]);
    }
  }

  test.each(dropCells)("a `size` at %s is expressed or refused, never dropped", (_ref, probe) => {
    expect(probe()).toBe("");
  });

  /**
   * The same question for every **extra**, on every model that declares one.
   *
   * The probe is a sentinel string rather than a legal value, and that is the
   * point: what is under test is whether the key *reaches the wire*, not
   * whether the value is any good. A schema that rejects `"__probe__"` gives
   * `ok: false`, which is a refusal and therefore fine; the only wrong answer
   * is a request that validates with the key nowhere in it.
   */
  const SENTINEL = "__unmodel_probe__";
  const extraCells: Array<[string, string, () => string]> = [];
  for (const adapter of IMAGE_ADAPTERS) {
    for (const [model, row] of Object.entries(adapter.modelParams ?? {})) {
      const ref = `${adapter.provider}/${model}`;
      const base = { ...(BASE[ref] ?? {}), model: ref, prompt: "A lighthouse in fog." };
      for (const key of Object.keys(row.extras ?? {})) {
        // A `BASE` entry that supplies the very key under probe would override
        // it — `providerOptions` is merged after the extras and wins, which is
        // its whole job — so it steps aside here rather than masking a drop.
        const options = (base as { providerOptions?: Record<string, Record<string, unknown>> })
          .providerOptions?.[adapter.provider];
        const probeBase =
          options !== undefined && Object.hasOwn(options, key)
            ? { ...base, providerOptions: undefined }
            : base;
        extraCells.push([
          ref,
          key,
          () => {
            const result = image.safe({ ...probeBase, [key]: SENTINEL } as never);
            if (!result.ok) return "";
            return JSON.stringify(result.params).includes(SENTINEL) ? "" : "dropped";
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

  test.each(editCells)("imageEdit %s %s %s", (_ref, _field, _value, params) => {
    expect(run(imageEdit.safe as never, params)).toBe("");
  });

  test("the edit sweep is not empty", () => {
    expect(editCells.length).toBeGreaterThan(150);
  });
});
