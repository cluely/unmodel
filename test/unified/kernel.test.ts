/**
 * The unified kernel, against a **fake** adapter.
 *
 * Fake on purpose, and it is the point rather than a shortcut: every claim
 * below is about the kernel — ref splitting, the unknown-model bargain,
 * `providerOptions` merge order, path provenance, how warnings ride on the
 * result — and none of them is about any provider. A test that reached for a
 * real one would be asserting the kernel *and* that provider's catalog at the
 * same time, and would start failing for the wrong reasons the first time a
 * model id changed.
 *
 * The fake stands in for exactly two things a real adapter supplies: a
 * `compile` that produces wire params, and a `validate` that is the provider's
 * own `.safe`. Everything else is the kernel.
 */
import { describe, expect, test } from "bun:test";
import type { Issue } from "../../src/core/issues";
import { UnmodelValidationError } from "../../src/core/issues";
import type { ValidateOptions } from "../../src/core/options";
import type { ValidateResult } from "../../src/core/result";
import { TranslationUnavailableError } from "../../src/core/translate/errors";
import { canonicalPath, createUnified, deepMerge, endpointLabel } from "../../src/core/unified/kernel";
import type { CompileContext, CompiledCall, UnifiedAdapter } from "../../src/core/unified/types";

// ---------------------------------------------------------------------------
// The fake provider
// ---------------------------------------------------------------------------

/** A tiny canonical vocabulary, standing in for `ImageParams` and friends. */
interface FakeParams {
  model: string;
  prompt: string;
  aspectRatio?: string;
  n?: number;
  seed?: number;
  providerOptions?: Record<string, Record<string, unknown>>;
}

/** The fake provider's wire body: snake_case, with a different word for size. */
interface FakeBody {
  model: string;
  prompt: string;
  size?: string;
  count?: number;
  [key: string]: unknown;
}

/** What the fake provider's validator hands back. Fresh object every call. */
function fakeValidated(body: FakeBody): FakeBody & { request: { url: string } } {
  const out = { ...body };
  Object.defineProperty(out, "request", {
    value: { url: "https://fake.example/v1/images", method: "POST", headers: {} },
    enumerable: false,
  });
  return out as FakeBody & { request: { url: string } };
}

interface FakeValidatorOptions {
  /** Issues the fake provider validator reports, at wire paths. */
  issues?: Issue[];
  /** Records what the validator was handed, for the merge-order assertions. */
  seen?: { params?: FakeBody; options?: ValidateOptions };
}

function fakeValidate(config: FakeValidatorOptions = {}) {
  return (params: FakeBody, options?: ValidateOptions): ValidateResult<FakeBody> => {
    if (config.seen !== undefined) {
      config.seen.params = params;
      config.seen.options = options;
    }
    const raw = config.issues ?? [];
    // A real validator resolves severity through the sink before returning; the
    // fake mimics only the part that matters here — `"off"` drops the issue.
    const issues = raw
      .map((issue) => ({ ...issue, severity: options?.severity?.[issue.code] ?? issue.severity }))
      .filter((issue) => issue.severity !== "off") as Issue[];
    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");
    if (errors.length > 0) return { ok: false, errors, warnings };
    return {
      ok: true,
      params: fakeValidated(params),
      warnings,
      estimate: { costUSD: 0.04 },
    };
  };
}

interface FakeAdapterOptions extends FakeValidatorOptions {
  provider?: string;
  models?: readonly string[];
  unsupported?: Readonly<Partial<Record<keyof FakeParams & string, string>>>;
  /** Replaces the default compile — for the fail() and throw cases. */
  compile?: UnifiedAdapter<FakeParams, FakeBody>["compile"];
}

function fakeAdapter(config: FakeAdapterOptions = {}): UnifiedAdapter<FakeParams, FakeBody> {
  return {
    category: "image",
    provider: config.provider ?? "fake",
    models: config.models ?? ["fake-1", "fake-2"],
    ...(config.unsupported !== undefined && { unsupported: config.unsupported }),
    compile:
      config.compile ??
      ((input, ctx): CompiledCall<FakeBody> => {
        const body: FakeBody = { model: ctx.model, prompt: input.prompt };
        if (input.aspectRatio !== undefined) {
          body.size = input.aspectRatio === "16:9" ? "1344x768" : "1024x1024";
          ctx.from(["size"], "aspectRatio");
        }
        if (input.n !== undefined) {
          body.count = input.n;
          ctx.from(["count"], "n");
        }
        return { params: body, validate: fakeValidate(config) };
      }),
  };
}

const base = { model: "fake/fake-1", prompt: "a lighthouse" } satisfies FakeParams;

function image(config: FakeAdapterOptions = {}) {
  return createUnified<FakeParams, UnifiedAdapter<FakeParams, FakeBody>>("image", [
    fakeAdapter(config),
  ]);
}

// ---------------------------------------------------------------------------

describe("endpointLabel", () => {
  test("camelCase category → kebab subpath, which is what an export looks like", () => {
    expect(endpointLabel("image")).toBe("unmodel/image");
    expect(endpointLabel("imageEdit")).toBe("unmodel/image-edit");
    expect(endpointLabel("transcribe")).toBe("unmodel/transcribe");
  });
});

describe("ref splitting", () => {
  test("splits on the FIRST slash, never the last", () => {
    const seen: FakeValidatorOptions["seen"] = {};
    const validator = createUnified<FakeParams, UnifiedAdapter<FakeParams, FakeBody>>("image", [
      fakeAdapter({ provider: "hub", models: ["vendor/model-1"], seen }),
    ]);
    const result = validator.safe({ model: "hub/vendor/model-1", prompt: "x" });
    expect(result.ok).toBe(true);
    // The bare model id keeps its own slash; the provider is just "hub".
    expect(seen.params?.model).toBe("vendor/model-1");
  });

  test("a ref with no provider half is a shape problem, not a structural one", () => {
    const result = image().safe({ model: "fake-1", prompt: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("invalid_shape");
    expect(result.errors[0]!.path).toEqual(["model"]);
    expect(result.errors[0]!.meta?.["structural"]).toBeUndefined();
  });

  test("a non-string model is caught before anything else runs", () => {
    const result = image().safe({ prompt: "x" } as unknown as FakeParams);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("invalid_shape");
  });

  test.each(["fake/", "/fake-1", "/"])("%p is not a ref", (model) => {
    const result = image().safe({ model, prompt: "x" });
    expect(result.ok).toBe(false);
  });
});

describe("an unregistered provider is structural", () => {
  test("safe() reports it with meta.structural and does not throw", () => {
    const result = image().safe({ model: "nope/whatever", prompt: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe("unsupported_capability");
    expect(result.errors[0]!.meta).toMatchObject({ structural: true, provider: "nope" });
    // The message names what IS registered — the whole point of the branch.
    expect(result.errors[0]!.message).toContain("fake");
  });

  test("the throwing form throws TranslationUnavailableError, not a validation error", () => {
    const validator = image();
    expect(() => validator({ model: "nope/whatever", prompt: "x" })).toThrow(
      TranslationUnavailableError,
    );
    expect(() => validator({ model: "nope/whatever", prompt: "x" })).not.toThrow(
      UnmodelValidationError,
    );
  });

  test("severity cannot silence it — an ok:true with no body would be worse", () => {
    const result = image().safe(
      { model: "nope/whatever", prompt: "x" },
      { severity: { unsupported_capability: "off" } },
    );
    expect(result.ok).toBe(false);
  });
});

describe("an unknown model warns", () => {
  test("it still compiles, because a catalog is a snapshot", () => {
    const result = image().safe({ model: "fake/fake-99", prompt: "x" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.code).toBe("unknown_model");
    expect(result.warnings[0]!.path).toEqual(["model"]);
    expect(result.warnings[0]!.meta).toMatchObject({ models: ["fake-1", "fake-2"] });
    expect((result.params as unknown as FakeBody).model).toBe("fake-99");
  });

  test("a known model produces no issue at all", () => {
    const result = image().safe(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });
});

describe("declared unsupported fields", () => {
  test("are an error with one message, checked before compile", () => {
    const result = image({ unsupported: { seed: "the API exposes no seed." } }).safe({
      ...base,
      seed: 7,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("unsupported_param");
    expect(result.errors[0]!.path).toEqual(["seed"]);
    expect(result.errors[0]!.message).toBe(
      '`seed` is not supported by "fake/fake-1": the API exposes no seed.',
    );
  });

  test("an absent or null field is not a use of it", () => {
    const validator = image({ unsupported: { seed: "no seed here." } });
    expect(validator.safe(base).ok).toBe(true);
    expect(validator.safe({ ...base, seed: undefined }).ok).toBe(true);
  });
});

describe("compile", () => {
  test("fail() of error severity stops before the provider validator runs", () => {
    const seen: FakeValidatorOptions["seen"] = {};
    const result = image({
      seen,
      compile: (_input, ctx) => {
        ctx.fail({
          code: "invalid_enum_value",
          path: ["aspectRatio"],
          message: "`aspectRatio` must be one of 1:1.",
        });
        return { params: { model: ctx.model, prompt: "x" }, validate: fakeValidate({ seen }) };
      },
    }).safe({ ...base, aspectRatio: "21:9" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("invalid_enum_value");
    expect(result.errors[0]!.path).toEqual(["aspectRatio"]);
    expect(result.errors[0]!.model).toBe("fake/fake-1");
    // Never reached: validating a body compiled from params that could not be
    // compiled would produce a second round of findings about nothing.
    expect(seen.params).toBeUndefined();
  });

  test("a fail() of warning severity does not stop anything", () => {
    const result = image({
      compile: (_input, ctx) => {
        ctx.fail({ code: "unknown_param", path: ["style"], message: "`style` is unknown." });
        return { params: { model: ctx.model, prompt: "x" }, validate: fakeValidate() };
      },
    }).safe(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });

  test("ctx.take reports a Derived's issues and hands back its value", () => {
    const values: Array<number | undefined> = [];
    const result = image({
      compile: (_input, ctx) => {
        values.push(ctx.take({ value: 4, issues: [] }));
        values.push(
          ctx.take({
            issues: [{ code: "invalid_shape", path: ["n"], message: "`n` must be a number." }],
          }),
        );
        return { params: { model: ctx.model, prompt: "x" }, validate: fakeValidate() };
      },
    }).safe(base);
    expect(values).toEqual([4, undefined]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["n"]);
  });

  test("ctx.warn lands on the result, stamped with the route", () => {
    const result = image({
      compile: (_input, ctx) => {
        ctx.warn({
          code: "approximated_param",
          path: ["aspectRatio"],
          message: "snapped to the grid.",
        });
        return { params: { model: ctx.model, prompt: "x" }, validate: fakeValidate() };
      },
    }).safe(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { warnings } = result.params as unknown as {
      warnings: ReadonlyArray<Record<string, unknown>>;
    };
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: "approximated_param",
      from: "unified.image",
      to: "fake.image",
    });
  });

  test("an adapter that throws TranslationUnavailableError uses the structural channel", () => {
    const validator = image({
      compile: () => {
        throw new TranslationUnavailableError("unmodel: no codec for that in this build.");
      },
    });
    const result = validator.safe(base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.meta).toMatchObject({ structural: true });
    expect(() => validator(base)).toThrow(TranslationUnavailableError);
  });

  test("an adapter that crashes is reported, never propagated out of safe()", () => {
    const result = image({
      compile: () => {
        throw new TypeError("cannot read property of undefined");
      },
    }).safe(base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("invalid_shape");
    expect(result.errors[0]!.message).toContain("file a bug");
  });
});

describe("providerOptions", () => {
  test("are merged over the compiled body BEFORE validation, never after", () => {
    const seen: FakeValidatorOptions["seen"] = {};
    const result = image({ seen }).safe({
      ...base,
      aspectRatio: "16:9",
      providerOptions: { fake: { size: "512x512", style: "vivid" } },
    });
    expect(result.ok).toBe(true);
    // The override won over the compiled `size`, and the validator saw it.
    expect(seen.params).toMatchObject({ size: "512x512", style: "vivid", prompt: "a lighthouse" });
    expect((result as unknown as { params: FakeBody }).params.size).toBe("512x512");
  });

  test("only the ref'd provider's block is applied", () => {
    const seen: FakeValidatorOptions["seen"] = {};
    image({ seen }).safe({
      ...base,
      providerOptions: { other: { style: "vivid" }, fake: { quality: "high" } },
    });
    expect(seen.params).toMatchObject({ quality: "high" });
    expect(seen.params?.["style"]).toBeUndefined();
  });

  test("a block for nobody in the request is simply not applied", () => {
    const seen: FakeValidatorOptions["seen"] = {};
    image({ seen }).safe({ ...base, providerOptions: { other: { style: "vivid" } } });
    expect(seen.params?.["style"]).toBeUndefined();
  });

  test("an unmapped wire path from an overridden key says where it came from", () => {
    const result = image({
      issues: [
        {
          severity: "error",
          code: "unsupported_param",
          path: ["style"],
          message: "`style` is not supported by this model.",
        },
      ],
    }).safe({ ...base, providerOptions: { fake: { style: "vivid" } } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["style"]);
    expect(result.errors[0]!.message).toEndWith("(supplied via `providerOptions`)");
  });
});

describe("deepMerge", () => {
  /** `deepMerge` is typed for wire bodies; the tests speak in bare records. */
  const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> =>
    deepMerge(a, b);

  test("plain objects merge key-by-key", () => {
    expect(merge({ a: { x: 1, y: 2 }, b: 3 }, { a: { y: 9, z: 8 } })).toEqual({
      a: { x: 1, y: 9, z: 8 },
      b: 3,
    });
  });

  test("arrays and scalars replace — appending would be unknowable", () => {
    expect(merge({ tags: [1, 2, 3] }, { tags: [9] })).toEqual({ tags: [9] });
    expect(merge({ n: 1 }, { n: 2 })).toEqual({ n: 2 });
    expect(merge({ a: { x: 1 } }, { a: 5 })).toEqual({ a: 5 });
    expect(merge({ a: 5 }, { a: { x: 1 } })).toEqual({ a: { x: 1 } });
  });

  test("an explicit undefined deletes — the only way to unset what compile emitted", () => {
    const out = merge({ a: 1, b: 2 }, { a: undefined });
    expect(Object.hasOwn(out, "a")).toBe(false);
    expect(out).toEqual({ b: 2 });
  });

  test("does not mutate its inputs", () => {
    const base_ = { a: { x: 1 } };
    const over = { a: { y: 2 } };
    merge(base_, over);
    expect(base_).toEqual({ a: { x: 1 } });
    expect(over).toEqual({ a: { y: 2 } });
  });

  test("refuses the three keys that are not data", () => {
    const out = merge(
      { safe: true },
      JSON.parse(
        '{"__proto__":{"polluted":true},"constructor":{"x":1},"prototype":{"y":2}}',
      ) as Record<string, unknown>,
    );
    expect(out).toEqual({ safe: true });
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("path provenance", () => {
  test("a declared wire path is reported at the canonical name, with the wire one quoted", () => {
    const result = image({
      issues: [
        {
          severity: "error",
          code: "invalid_enum_value",
          path: ["size"],
          message: '`size` must be one of "1024x1024".',
        },
      ],
    }).safe({ ...base, aspectRatio: "16:9" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toEqual(["aspectRatio"]);
    expect(result.errors[0]!.message).toBe(
      '`size` must be one of "1024x1024". (compiled from `size`)',
    );
  });

  test("a nested finding keeps its position under the canonical head", () => {
    const provenance = new Map([["size", "aspectRatio"]]);
    expect(canonicalPath(provenance, ["size", 0, "width"])).toEqual({
      path: ["aspectRatio", 0, "width"],
      unmapped: false,
    });
  });

  test("the longest declared path wins over the head", () => {
    const provenance = new Map([
      ["parameters", "resolution"],
      ["parameters.aspectRatio", "aspectRatio"],
    ]);
    expect(canonicalPath(provenance, ["parameters", "aspectRatio"]).path).toEqual(["aspectRatio"]);
    expect(canonicalPath(provenance, ["parameters", "other"]).path).toEqual(["resolution", "other"]);
  });

  test("an undeclared path is left exactly as the provider reported it", () => {
    const result = image({
      issues: [
        {
          severity: "warning",
          code: "unknown_param",
          path: ["mystery"],
          message: "`mystery` is not a param unmodel knows.",
        },
      ],
    }).safe(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings[0]!.path).toEqual(["mystery"]);
    // No `providerOptions` suffix: nothing the caller wrote put it there.
    expect(result.warnings[0]!.message).toBe("`mystery` is not a param unmodel knows.");
  });

  test("an empty path stays empty", () => {
    expect(canonicalPath(new Map(), [])).toEqual({ path: [], unmapped: false });
  });
});

describe("the result", () => {
  test("is the provider's own validated object, with warnings riding on it", () => {
    const result = image({
      compile: (input, ctx) => {
        ctx.warn({ code: "approximated_param", path: ["n"], message: "rounded." });
        return {
          params: { model: ctx.model, prompt: input.prompt },
          validate: fakeValidate(),
        };
      },
    }).safe(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const params = result.params as unknown as FakeBody & {
      request: { url: string };
      warnings: readonly unknown[];
    };

    // The provider's own non-enumerable members survive untouched.
    expect(params.request.url).toBe("https://fake.example/v1/images");
    // Enumerable properties are still exactly the wire body.
    expect(JSON.parse(JSON.stringify(params))).toEqual({ model: "fake-1", prompt: "a lighthouse" });
    expect(Object.keys(params).sort()).toEqual(["model", "prompt"]);
  });

  test("warnings are non-enumerable and frozen", () => {
    const result = image().safe(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const descriptor = Object.getOwnPropertyDescriptor(result.params, "warnings");
    expect(descriptor?.enumerable).toBe(false);
    expect(descriptor?.writable).toBe(false);
    expect(
      Object.isFrozen((result.params as unknown as { warnings: unknown[] }).warnings),
    ).toBe(true);
  });

  test("zero warnings means the request mapped exactly", () => {
    const result = image().safe(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.params as unknown as { warnings: readonly unknown[] }).warnings).toEqual([]);
  });

  test("carries the provider's estimate through unchanged", () => {
    const result = image().safe(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.estimate).toEqual({ costUSD: 0.04 });
  });

  test("the throwing form throws UnmodelValidationError labelled with the category", () => {
    const validator = image({
      issues: [
        { severity: "error", code: "invalid_shape", path: ["prompt"], message: "`prompt` is empty." },
      ],
    });
    expect(() => validator(base)).toThrow(UnmodelValidationError);
    try {
      validator(base);
    } catch (error) {
      expect((error as Error).message).toContain("unmodel/image");
      expect((error as UnmodelValidationError).issues).toHaveLength(1);
    }
  });
});

describe("options.severity", () => {
  test("passes through to the provider's validator", () => {
    const seen: FakeValidatorOptions["seen"] = {};
    image({ seen }).safe(base, { severity: { unknown_param: "off" }, maxCostUSD: 1 });
    expect(seen.options).toMatchObject({ severity: { unknown_param: "off" }, maxCostUSD: 1 });
  });

  test("applies to the kernel's own canonical-space issues too", () => {
    const result = image().safe(
      { model: "fake/fake-99", prompt: "x" },
      { severity: { unknown_model: "off" } },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });

  test("can promote a warning into an error and fail the request", () => {
    const result = image().safe(
      { model: "fake/fake-99", prompt: "x" },
      { severity: { unknown_model: "error" } },
    );
    expect(result.ok).toBe(false);
  });

  test("an ignored deny rule's downgrade to a warning survives the remap", () => {
    const result = image({
      issues: [
        {
          severity: "warning",
          code: "unsupported_param",
          path: ["size"],
          message: "`size` is silently ignored by the API.",
        },
      ],
    }).safe({ ...base, aspectRatio: "16:9" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings[0]!.severity).toBe("warning");
    expect(result.warnings[0]!.path).toEqual(["aspectRatio"]);
  });
});

describe("registration", () => {
  test("exposes the providers it was built with, sorted", () => {
    const validator = createUnified<FakeParams, UnifiedAdapter<FakeParams, FakeBody>>("image", [
      fakeAdapter({ provider: "zed" }),
      fakeAdapter({ provider: "alpha" }),
    ]);
    expect(validator.providers).toEqual(["alpha", "zed"]);
  });

  test("two adapters claiming one provider id is a programming error", () => {
    expect(() =>
      createUnified<FakeParams, UnifiedAdapter<FakeParams, FakeBody>>("image", [
        fakeAdapter(),
        fakeAdapter(),
      ]),
    ).toThrow(TypeError);
  });

  test("an adapter registered on the wrong surface is a programming error", () => {
    const wrong = { ...fakeAdapter(), category: "video" as const };
    expect(() =>
      createUnified<FakeParams, UnifiedAdapter<FakeParams, FakeBody>>("image", [wrong]),
    ).toThrow(TypeError);
  });

  test("a validator with no adapters says so rather than pretending", () => {
    const empty = createUnified<FakeParams, UnifiedAdapter<FakeParams, FakeBody>>("image", []);
    const result = empty.safe(base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.meta).toMatchObject({ structural: true });
  });
});

describe("CompileContext", () => {
  test("hands the adapter the BARE model id, provider already stripped", () => {
    let seen: CompileContext<FakeParams>["model"] | undefined;
    image({
      compile: (input, ctx) => {
        seen = ctx.model;
        return { params: { model: ctx.model, prompt: input.prompt }, validate: fakeValidate() };
      },
    }).safe(base);
    expect(seen).toBe("fake-1");
  });
});
