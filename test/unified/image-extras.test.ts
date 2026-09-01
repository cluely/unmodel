/**
 * Per-model extras: the identity contract, the refusal, and the precedence.
 *
 * An **extra** is a param a model takes that the canonical vocabulary has no
 * word for — `background`, `style_preset`, `safety_tolerance`. They are
 * declared per model on each adapter's `modelParams` table, which is the same
 * table `unmodel/image` narrows the caller's types from, and they are the one
 * part of the compile step with no translation in it at all:
 *
 * 1. **Identity.** The key goes on the wire under the name the caller wrote,
 *    because that name *is* the provider's. Anything else would be a rename
 *    with nothing to gain by it.
 * 2. **Per model, not per provider.** An extra a model does not take is an
 *    `unsupported_param` naming the models that do — never a silent
 *    pass-through to a schema that would reject it under a name the caller
 *    does not recognise.
 * 3. **Still validated.** The value is checked by the provider's own schema and
 *    deny tables afterwards, which is what makes the type narrowing a fast path
 *    rather than the only path: a JavaScript caller who passes
 *    `background: "transparent"` to `gpt-image-2` gets the recorded 400's rule
 *    quoted back at them.
 * 4. **`providerOptions` still wins.** Extras are compiled *before* the merge,
 *    so the escape hatch overrides them exactly as it overrides everything else.
 */
import { describe, expect, test } from "bun:test";
import { image } from "../../src/unified/image";
import { imageEdit } from "../../src/unified/image-edit";

const PROMPT = "a lighthouse in fog";

interface Case {
  ref: string;
  /** Canonical params the route requires before anything can be probed. */
  base?: Record<string, unknown>;
  /** The extras to send. */
  extras: Record<string, unknown>;
  /** Where they must appear, as a path into the wire body. */
  at?: readonly string[];
}

/**
 * One case per image provider that has any extra at all — `vidu` is the only
 * adapter with none, and the sweep below asserts that too rather than leaving
 * it implicit.
 */
const CASES: readonly Case[] = [
  { ref: "openai/gpt-image-2", extras: { background: "auto", quality: "high", user: "u-1" } },
  {
    ref: "google/imagen-4.0-generate-001",
    extras: { personGeneration: "allow_adult", guidanceScale: 12 },
    at: ["parameters"],
  },
  { ref: "black-forest-labs/flux-2-flex", extras: { guidance: 5, steps: 20 } },
  {
    // fal's extras are the only GENERATED ones in this list: they are every
    // parameter the endpoint's own OpenAPI declares that the canonical
    // vocabulary has no word for, typed from that endpoint's wire interface.
    // So this case is really asking whether the generator's `extras` block and
    // `applyExtras` agree about what a key is — which is the same identity
    // promise, one derivation further back.
    ref: "fal/fal-ai/flux/dev",
    extras: { num_inference_steps: 20, guidance_scale: 4.5, acceleration: "high" },
  },
  { ref: "ideogram/ideogram-3.0-quality", extras: { magic_prompt: "AUTO", style_type: "DESIGN" } },
  { ref: "xai/grok-imagine-image-2.0", extras: { user: "u-1" } },
  { ref: "recraft/recraftv3", extras: { style: "Photorealism", block_nsfw: true } },
  { ref: "stability/sd3.5-large", extras: { style_preset: "anime", cfg_scale: 4 } },
  {
    ref: "luma/photon-1",
    extras: { modify_image_ref: { url: "https://example.com/s.png", weight: 0.4 } },
  },
  {
    ref: "bytedance/dola-seedream-5-0-pro-260628",
    extras: { watermark: true, optimize_prompt_options: { mode: "fast" } },
  },
  {
    ref: "runway/gen4_image",
    // `ratio` is required by every text_to_image arm, and a request without a
    // shape warns that one was chosen — which would drown the assertion below.
    base: { aspectRatio: "1:1" },
    extras: { contentModeration: { publicFigureThreshold: "low" } },
  },
  { ref: "kling/kling-v3", extras: { image_fidelity: 0.5, image_reference: "face" } },
  { ref: "bria/FIBO", extras: { steps_num: 40, ip_signal: true } },
  { ref: "leonardo/lucid-origin", extras: { prompt_enhance: "ON" }, at: ["parameters"] },
  {
    ref: "krea/krea-2/medium",
    base: { aspectRatio: "1:1" },
    extras: { creativity: "high", intensity: 20 },
  },
  { ref: "reve/reve-v2-create", extras: { postprocessing: [{ process: "remove_background" }] } },
];

/** The wire node at a path, or `undefined`. */
function at(body: unknown, path: readonly string[]): Record<string, unknown> | undefined {
  let node: unknown = body;
  for (const segment of path) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === "object" && node !== null ? (node as Record<string, unknown>) : undefined;
}

describe("extras compile to identity", () => {
  test.each(CASES.map((entry) => [entry.ref, entry] as const))("%s", (_ref, entry) => {
    const result = image.safe({
      model: entry.ref,
      prompt: PROMPT,
      ...entry.base,
      ...entry.extras,
    } as never);
    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors)).toBe(true);
    if (!result.ok) return;

    const node = at(result.params, entry.at ?? []);
    expect(node, `${entry.ref} wrote nothing at ${(entry.at ?? []).join(".") || "the body root"}`)
      .toBeDefined();
    for (const [key, value] of Object.entries(entry.extras)) {
      // Deep equality on the value, and the key spelled exactly as written:
      // this IS the identity contract, and it is the reason an extra needs no
      // `approximated_param` — nothing was approximated.
      expect(node?.[key], `${entry.ref}.${key}`).toEqual(value);
    }
    // Identity is not lossy, so nothing may warn about it.
    expect((result.params as unknown as { warnings: readonly unknown[] }).warnings).toEqual([]);
  });

  test("the case list covers every image provider that has an extra", () => {
    const covered = new Set(CASES.map((entry) => entry.ref.slice(0, entry.ref.indexOf("/"))));
    // `vidu` is the one adapter whose route has no non-canonical param with a
    // canonical name to give it — see the note in its `compile`.
    expect([...covered, "vidu"].sort()).toEqual([...image.providers]);
  });
});

describe("an extra on a model that does not take it is refused", () => {
  test("naming the models that do", () => {
    const result = image.safe({
      model: "openai/gpt-image-2",
      prompt: PROMPT,
      style: "vivid",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      code: "unsupported_param",
      path: ["style"],
      meta: { models: ["dall-e-3"] },
    });
    expect(result.errors[0]!.message).toContain('"dall-e-3"');
  });

  test("across every provider whose models disagree about one", () => {
    const wrong: Array<[string, Record<string, unknown>, string]> = [
      ["stability/stable-image-ultra", { cfg_scale: 4 }, "sd3.5-large"],
      ["black-forest-labs/flux-2-pro", { guidance: 5 }, "flux-2-flex"],
      ["ideogram/ideogram-4.0-turbo", { style_preset: "BAUHAUS" }, "ideogram-3.0-flash"],
      ["recraft/recraftv4_1", { style: "Watercolor" }, "recraftv3"],
      ["kling/kling-v3", { result_type: "series" }, "kling-image-o1"],
      ["kling/kling-image-o1", { image_fidelity: 0.5 }, "kling-v3"],
      ["bytedance/seedream-4-0-250828", { background: "transparent" }, "dola-seedream-5-0-pro"],
      ["bria/FIBO-lite", { steps_num: 40 }, "FIBO"],
      ["leonardo/lucid-origin", { contrast: "HIGH" }, "phoenix-v1.0"],
      ["runway/gen4_image", { grounding: true }, "seedream5_pro"],
      ["reve/reve-v2-create", { test_time_scaling: 2 }, "reve-create@20250915"],
    ];
    for (const [ref, extra, taker] of wrong) {
      const result = image.safe({ model: ref, prompt: PROMPT, ...extra } as never);
      expect(result.ok, ref).toBe(false);
      if (result.ok) continue;
      const issue = result.errors.find((error) => error.code === "unsupported_param");
      expect(issue, ref).toBeDefined();
      expect(issue?.path, ref).toEqual([Object.keys(extra)[0] as string]);
      expect(issue?.message, ref).toContain(taker);
    }
  });

  test("an unknown model is not held to a table that does not describe it", () => {
    // The kernel has already said "model-dependent checks were skipped"; this
    // is one of them, and refusing an extra on the strength of a table that
    // says nothing about the model would turn a lagging catalog into a broken
    // request. The provider's own schema still sees the key.
    const result = image.safe({
      model: "openai/gpt-image-9",
      prompt: PROMPT,
      background: "transparent",
    } as never);
    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors)).toBe(true);
    if (!result.ok) return;
    expect(result.params).toMatchObject({ background: "transparent" });
    expect(result.warnings.some((issue) => issue.code === "unknown_model")).toBe(true);
  });
});

describe("the provider's own checks still run over an extra", () => {
  test('gpt-image-2 refuses `quality: "hd"`, quoting the documented ladder', () => {
    // The "the SDK's types are wrong" case, reached the way a JavaScript
    // caller reaches it — the type would have stopped a TS one: the SDK
    // offers `hd` on every image model, but only dall-e-3 accepts it.
    const result = image.safe({
      model: "openai/gpt-image-2",
      prompt: PROMPT,
      quality: "hd",
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({
      code: "invalid_enum_value",
      path: ["quality"],
    });
    expect(result.errors[0]!.message).toContain("high");
    // Identity means the wire name and the canonical name are the same word,
    // so there is no rename to explain and no "(compiled from …)" suffix.
    expect(result.errors[0]!.message).not.toContain("compiled from");
  });

  test("and gpt-image-1 accepts it, because that model does", () => {
    const result = image.safe({
      model: "openai/gpt-image-1",
      prompt: PROMPT,
      background: "transparent",
    } as never);
    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors)).toBe(true);
  });

  test("a value outside an extra's own range is the endpoint's error", () => {
    const result = image.safe({
      model: "openai/gpt-image-2",
      prompt: PROMPT,
      output_compression: 400,
    } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["output_compression"]);
  });
});

describe("providerOptions wins over an extra", () => {
  test("because extras are compiled before the merge", () => {
    const result = image.safe({
      model: "openai/gpt-image-2",
      prompt: PROMPT,
      background: "auto",
      providerOptions: { openai: { background: "opaque" } },
    } as never);
    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors)).toBe(true);
    if (!result.ok) return;
    expect(result.params).toMatchObject({ background: "opaque" });
  });

  test("and an explicit `undefined` there deletes one", () => {
    const result = image.safe({
      model: "openai/gpt-image-2",
      prompt: PROMPT,
      background: "auto",
      providerOptions: { openai: { background: undefined } },
    } as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.hasOwn(result.params as object, "background")).toBe(false);
  });
});

describe("unmodel/image-edit carries the same contract", () => {
  const file = (): Blob => new Blob([new Uint8Array(64)], { type: "image/png" });

  test("identity on the edits route", () => {
    const result = imageEdit.safe({
      operation: "edit",
      model: "openai/gpt-image-1.5",
      prompt: PROMPT,
      image: { file: file() },
      background: "transparent",
      input_fidelity: "high",
    } as never);
    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors)).toBe(true);
    if (!result.ok) return;
    expect(result.params).toMatchObject({ background: "transparent", input_fidelity: "high" });
  });

  test("`input_fidelity` is refused on the two models that reject it", () => {
    for (const ref of ["openai/gpt-image-1-mini", "openai/gpt-image-2"]) {
      const result = imageEdit.safe({
        operation: "edit",
        model: ref,
        prompt: PROMPT,
        image: { file: file() },
        input_fidelity: "high",
      } as never);
      expect(result.ok, ref).toBe(false);
      if (result.ok) continue;
      expect(result.errors[0], ref).toMatchObject({
        code: "unsupported_param",
        path: ["input_fidelity"],
      });
    }
  });

  test("black-forest-labs, ideogram and recraft each carry their own", () => {
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      [
        "black-forest-labs/flux-kontext-pro",
        { image: { url: "https://example.com/s.png" } },
        { safety_tolerance: 3 },
      ],
      ["ideogram/ideogram-3.0-turbo", { image: { file: file() } }, { magic_prompt: "OFF" }],
      ["recraft/recraftv3", { image: { file: file() }, strength: 0.4 }, { negative_prompt: "blur" }],
    ];
    for (const [ref, source, extras] of cases) {
      const result = imageEdit.safe({
        operation: "edit",
        model: ref,
        prompt: PROMPT,
        ...source,
        ...extras,
      } as never);
      expect(result.ok, `${ref}: ${result.ok ? "" : JSON.stringify(result.errors)}`).toBe(true);
      if (!result.ok) continue;
      expect(result.params, ref).toMatchObject(extras);
    }
  });
});
