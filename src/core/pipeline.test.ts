import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createValidator } from "./pipeline";
import { UnmodelValidationError } from "./issues";
import type { ModelInfo } from "./catalog-types";

const catalog: Record<string, ModelInfo> = {
  "test-model": {
    id: "test-model",
    name: "Test Model",
    attachment: false,
    reasoning: false,
    toolCall: true,
    openWeights: false,
    modalities: { input: ["text"], output: ["text"] },
    limit: { context: 1000, output: 100 },
    cost: { input: 1, output: 2 },
  },
  "old-model": {
    id: "old-model",
    name: "Old Model",
    status: "deprecated",
    attachment: false,
    reasoning: false,
    toolCall: false,
    openWeights: false,
    modalities: { input: ["text"], output: ["text"] },
    limit: { context: 1000, output: 100 },
  },
  "fam-x": {
    id: "fam-x",
    name: "Family X",
    attachment: false,
    reasoning: true,
    toolCall: true,
    openWeights: false,
    modalities: { input: ["text"], output: ["text"] },
    limit: { context: 1000, output: 100 },
  },
};

interface TestParams {
  model: string;
  text?: string;
  size?: string | null;
  beta_flag?: string | null;
  ignored_flag?: string | null;
  temperature?: number;
  [key: string]: unknown;
}

const validate = createValidator<TestParams>({
  endpoint: "test.endpoint",
  schema: z.looseObject({
    model: z.string(),
    text: z.string().optional(),
    size: z.string().nullable().optional(),
    beta_flag: z.string().nullable().optional(),
    ignored_flag: z.string().nullable().optional(),
    temperature: z.number().optional(),
  }),
  modelId: (p) => p.model,
  catalog,
  constraints: {
    "test-model": {
      deny: {
        beta_flag: { reason: "the API rejects it", source: "test fixture" },
        ignored_flag: { reason: "the API drops it", source: "test fixture", ignored: true },
      },
      enums: { size: ["small", "large"] },
    },
  },
  familyRules: [
    {
      family: "fam models",
      match: (id) => id.startsWith("fam-"),
      deny: { temperature: { reason: "fam models reject sampling params", source: "docs" } },
    },
  ],
  estimate: (p, info, ctx) => {
    const inputTokens = p.text !== undefined ? ctx.tokenizer.count(p.text) : undefined;
    const costUSD =
      inputTokens !== undefined && info?.cost?.input !== undefined
        ? (inputTokens * info.cost.input) / 1_000_000
        : undefined;
    return { inputTokens, costUSD };
  },
});

describe("createValidator", () => {
  test("returns the original params object untouched on success", () => {
    const params = { model: "test-model", text: "hello" };
    expect(validate(params)).toBe(params);
  });

  test("safe() reports estimate", () => {
    const r = validate.safe({ model: "test-model", text: "abcdefgh" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.inputTokens).toBe(2);
  });

  test("shape violations are errors and stop the pipeline", () => {
    const r = validate.safe({ model: 42 } as unknown as TestParams);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["model"]);
    }
  });

  test("unknown top-level params are warnings, passed through", () => {
    const params = { model: "test-model", brand_new_param: true };
    const r = validate.safe(params);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
      expect(r.params).toBe(params);
    }
  });

  test("unknown model is a warning and skips constraint checks", () => {
    const r = validate.safe({ model: "brand-new-model", beta_flag: "on" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("deprecated model warns", () => {
    const r = validate.safe({ model: "old-model" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
  });

  test("denied param errors with the reason in the message", () => {
    const r = validate.safe({ model: "test-model", beta_flag: "on" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.message).toContain("the API rejects it");
      expect(r.errors[0]?.path).toEqual(["beta_flag"]);
    }
  });

  test("a deny rule flagged `ignored` warns instead of failing the request", () => {
    const r = validate.safe({ model: "test-model", ignored_flag: "on" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]?.code).toBe("unsupported_param");
      expect(r.warnings[0]?.path).toEqual(["ignored_flag"]);
      expect(r.warnings[0]?.message).toContain("silently ignored by the API");
      expect(r.warnings[0]?.message).toContain("the API drops it");
      expect(r.warnings[0]?.meta).toEqual({ source: "test fixture", ignored: true });
    }
    // The throwing form must accept it too — the API fulfils this request.
    expect(() => validate({ model: "test-model", ignored_flag: "on" })).not.toThrow();
  });

  test("severity overrides still apply to `ignored` deny rules", () => {
    const promoted = validate.safe(
      { model: "test-model", ignored_flag: "on" },
      { severity: { unsupported_param: "error" } },
    );
    expect(promoted.ok).toBe(false);

    const silenced = validate.safe(
      { model: "test-model", ignored_flag: "on" },
      { severity: { unsupported_param: "off" } },
    );
    expect(silenced.ok).toBe(true);
    if (silenced.ok) expect(silenced.warnings).toEqual([]);
  });

  test("enum narrowing errors on disallowed values", () => {
    const r = validate.safe({ model: "test-model", size: "medium" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.message).toContain('"small"');
    }
  });

  test("explicit null on an enum-narrowed param is treated as unset", () => {
    const r = validate.safe({ model: "test-model", size: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("explicit null on a denied param is treated as unset", () => {
    const r = validate.safe({ model: "test-model", beta_flag: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("family rules apply by pattern", () => {
    const r = validate.safe({ model: "fam-x", temperature: 0.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain("fam models reject sampling params");
  });

  test("over context window is an error, near it a warning", () => {
    const over = validate.safe({ model: "test-model", text: "x".repeat(4004) });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors[0]?.code).toBe("over_context");

    const near = validate.safe({ model: "test-model", text: "x".repeat(3800) });
    expect(near.ok).toBe(true);
    if (near.ok) expect(near.warnings.map((w) => w.code)).toEqual(["near_context"]);
  });

  test("budget guard", () => {
    const r = validate.safe({ model: "test-model", text: "x".repeat(400) }, { maxCostUSD: 0.00000001 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });

  test("severity overrides: silence and promote", () => {
    const silenced = validate.safe(
      { model: "test-model", beta_flag: "on" },
      { severity: { unsupported_param: "off" } },
    );
    expect(silenced.ok).toBe(true);

    const promoted = validate.safe(
      { model: "brand-new-model" },
      { severity: { unknown_model: "error" } },
    );
    expect(promoted.ok).toBe(false);
  });

  test("throwing form throws UnmodelValidationError with issues", () => {
    let caught: unknown;
    try {
      validate({ model: "test-model", beta_flag: "on" });
    } catch (error) {
      caught = error;
    }
    expect(UnmodelValidationError.isInstance(caught)).toBe(true);
    if (UnmodelValidationError.isInstance(caught)) {
      expect(caught.issues).toHaveLength(1);
      expect(caught.message).toContain("beta_flag");
    }
  });

  test("finalize produces a fetch-pure wire body with hidden toSdk/request", async () => {
    const { toValidated } = await import("./request");
    const withFinalize = createValidator<TestParams, ReturnType<typeof finalize>>({
      endpoint: "test.endpoint",
      schema: z.looseObject({ model: z.string() }),
      modelId: (p) => p.model,
      catalog,
      finalize,
    });
    function finalize(p: TestParams) {
      const { model, ...body } = p;
      return toValidated(
        body,
        { url: `https://api.test/v1/models/${model}:generate`, method: "POST", headers: {} },
        { sdk: { test: () => ({ model, config: body }) } },
      );
    }

    const v = withFinalize({ model: "test-model", text: "hi" });
    // Enumerable surface is exactly the wire body.
    expect(Object.keys(v)).toEqual(["text"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual({ text: "hi" });
    expect({ ...v }).toEqual({ text: "hi" } as typeof v);
    // Hidden helpers still work.
    expect(v.toSdk("test")).toEqual({ model: "test-model", config: { text: "hi" } });
    expect(v.request.url).toBe("https://api.test/v1/models/test-model:generate");
  });

  test("custom tokenizer is used for estimation", () => {
    const r = validate.safe(
      { model: "test-model", text: "hello" },
      { tokenizer: { count: () => 123 } },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.inputTokens).toBe(123);
  });

  test("a check that throws is reported, not thrown, and later checks still run", () => {
    const crashing = createValidator<TestParams>({
      endpoint: "test.endpoint",
      schema: z.looseObject({ model: z.string() }),
      modelId: (p) => p.model,
      catalog,
      checks: [
        () => {
          throw new TypeError("undefined is not an object (evaluating 'text.length')");
        },
        (_params, _info, ctx) => {
          ctx.report({ code: "unknown_param", path: ["later"], message: "later check ran" });
        },
      ],
    });

    const r = crashing.safe({ model: "test-model" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.message).toContain("could not safely inspect");
      expect(r.errors[0]?.message).toContain("text.length");
      expect(r.warnings.map((w) => w.message)).toEqual(["later check ran"]);
    }
  });

  test("an estimate that throws makes safe() return ok:false instead of throwing", () => {
    const crashing = createValidator<TestParams>({
      endpoint: "test.endpoint",
      schema: z.looseObject({ model: z.string() }),
      modelId: (p) => p.model,
      catalog,
      estimate: () => {
        throw new TypeError("boom");
      },
    });

    const r = crashing.safe({ model: "test-model" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.message).toContain("boom");
      expect(r.errors[0]?.message).toContain("file a bug");
    }
  });

  test("two validations never share a headers object identity", async () => {
    const { toValidated, JSON_HEADERS } = await import("./request");
    // Finalize passes the shared module-level headers object by reference,
    // exactly like the provider finalizers do.
    const withFinalize = createValidator<TestParams, ReturnType<typeof finalize>>({
      endpoint: "test.endpoint",
      schema: z.looseObject({ model: z.string() }),
      modelId: (p) => p.model,
      catalog,
      finalize,
    });
    function finalize(p: TestParams) {
      const body = { ...p };
      return toValidated(
        body,
        { url: "https://api.test/v1/generate", method: "POST", headers: JSON_HEADERS },
        { sdk: { test: () => body } },
      );
    }

    const first = withFinalize({ model: "test-model" });
    const second = withFinalize({ model: "test-model" });
    expect(first.request.headers).not.toBe(second.request.headers);
    expect(first.request).not.toBe(second.request);

    // Poisoning one result's headers must not leak anywhere else.
    first.request.headers["authorization"] = "Bearer sk-LEAKED";
    expect(second.request.headers["authorization"]).toBeUndefined();
    expect(JSON_HEADERS["authorization"]).toBeUndefined();
    expect(withFinalize({ model: "test-model" }).request.headers).toEqual({
      "content-type": "application/json",
    });
  });

  test("JSON_HEADERS is frozen so by-reference mutation fails loudly", async () => {
    const { JSON_HEADERS } = await import("./request");
    expect(Object.isFrozen(JSON_HEADERS)).toBe(true);
    // ES modules are strict mode, so writing to a frozen object throws.
    expect(() => {
      JSON_HEADERS["authorization"] = "Bearer sk-LEAKED";
    }).toThrow(TypeError);
    expect(JSON_HEADERS["authorization"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// `options.media` paths: the declaration that addressed nothing
// ---------------------------------------------------------------------------

describe("ValidateOptions.media: a path that names nothing is reported", () => {
  test("a typo'd path used to be a SILENT validation bypass", () => {
    // The failure this closes, verbatim: `findMediaDeclaration` matches by
    // deep-equal path, so one wrong segment means the declaration is never
    // found — the declared 999 MB is never checked and the caller is told the
    // request is fine.
    const r = validate.safe(
      { model: "test-model", text: "hi" },
      { media: [{ path: ["txet"], bytes: 999_999_999 }] },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const dropped = r.warnings.filter((w) => w.code === "media_declaration_dropped");
      expect(dropped).toHaveLength(1);
      expect(dropped[0]?.path).toEqual(["txet"]);
      expect(dropped[0]?.meta?.declaredPath).toEqual(["txet"]);
      expect(dropped[0]?.message).toContain("does not exist in these params");
    }
  });

  test("a path that resolves is silent, including into arrays and nested objects", () => {
    const params = { model: "test-model", parts: [{ blob: { url: "x" } }] };
    const r = validate.safe(params, {
      media: [
        { path: ["parts", 0, "blob"], bytes: 10 },
        { path: ["parts", 0, "blob", "url"], bytes: 10 },
        // The empty path is the params object itself — the coordinate the
        // socket endpoints use, where the media IS the stream.
        { path: [], durationSeconds: 60 },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.filter((w) => w.code === "media_declaration_dropped")).toEqual([]);
    }
  });

  test("a stale index is caught, which a spelling check alone would miss", () => {
    const r = validate.safe(
      { model: "test-model", parts: [{ blob: 1 }] },
      { media: [{ path: ["parts", 3, "blob"], durationSeconds: 30 }] },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("media_declaration_dropped");
  });

  test("a string index into an array does not resolve — it is not the same coordinate", () => {
    const r = validate.safe(
      { model: "test-model", parts: [{ blob: 1 }] },
      { media: [{ path: ["parts", "0", "blob"], durationSeconds: 30 }] },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("media_declaration_dropped");
  });

  test("prototype keys do not resolve", () => {
    const r = validate.safe(
      { model: "test-model" },
      { media: [{ path: ["constructor"], bytes: 1 }] },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("media_declaration_dropped");
  });

  test("it is appealable per code, like every other finding", () => {
    const r = validate.safe(
      { model: "test-model", text: "hi" },
      {
        media: [{ path: ["nope"], bytes: 1 }],
        severity: { media_declaration_dropped: "off" },
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).not.toContain("media_declaration_dropped");
  });

  test("an endpoint's declared out-of-body coordinates are honoured", () => {
    // The `data_file` / `media` case: the audio arrives as a form part, so the
    // coordinate is real even though it is not a key of the JSON body.
    const withUpload = createValidator<TestParams>({
      endpoint: "test.upload",
      schema: z.looseObject({ model: z.string() }),
      modelId: (p) => p.model,
      catalog,
      mediaPaths: [["data_file"]],
    });
    const r = withUpload.safe(
      { model: "test-model" },
      { media: [{ path: ["data_file"], durationSeconds: 60 }] },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).not.toContain("media_declaration_dropped");

    // …and only the coordinates it declared.
    const other = withUpload.safe(
      { model: "test-model" },
      { media: [{ path: ["data_fil"], durationSeconds: 60 }] },
    );
    expect(other.ok).toBe(true);
    if (other.ok) expect(other.warnings.map((w) => w.code)).toContain("media_declaration_dropped");
  });
});

describe("Standard Schema seam", () => {
  // A minimal hand-rolled Standard Schema validator — no zod anywhere. Proves
  // layer 1 consumes `~standard.validate` and nothing vendor-specific, so any
  // conforming validator can be plugged into a PipelineSpec.
  const handRolled = {
    "~standard": {
      version: 1 as const,
      vendor: "test",
      validate: (value: unknown) => {
        const params = value as Record<string, unknown>;
        if (typeof params.model !== "string") {
          return { issues: [{ message: "model must be a string", path: ["model"] }] };
        }
        if (params.text !== undefined && typeof params.text !== "string") {
          // Object path segments are part of the spec; exercise that form too.
          return { issues: [{ message: "text must be a string", path: [{ key: "text" }] }] };
        }
        return { value };
      },
    },
  };

  const validateStandard = createValidator<TestParams>({
    endpoint: "test.standard",
    schema: handRolled,
    modelId: (p) => p.model,
    catalog,
  });

  test("a non-zod validator passes valid params through", () => {
    const r = validateStandard.safe({ model: "test-model", text: "hi" });
    expect(r.ok).toBe(true);
  });

  test("failures map to invalid_shape with both path segment forms", () => {
    const bad = validateStandard.safe({ model: 42 } as unknown as TestParams);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors[0]?.code).toBe("invalid_shape");
      expect(bad.errors[0]?.path).toEqual(["model"]);
    }

    const badText = validateStandard.safe({ model: "test-model", text: 1 } as unknown as TestParams);
    expect(badText.ok).toBe(false);
    if (!badText.ok) expect(badText.errors[0]?.path).toEqual(["text"]);
  });

  test("an async validator is a config error, not a validation failure", () => {
    const asyncSchema = {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate: async (value: unknown) => ({ value }),
      },
    };
    const v = createValidator<TestParams>({
      endpoint: "test.async",
      schema: asyncSchema,
      modelId: (p) => p.model,
      catalog,
    });
    expect(() => v.safe({ model: "test-model" })).toThrow(/synchronous/);
  });

  test("unknown-key reporting degrades gracefully off zod (skipped, not thrown)", () => {
    const r = validateStandard.safe({ model: "test-model", tempratur: 1 } as TestParams);
    expect(r.ok).toBe(true);
    // A zod-backed spec would warn unknown_param here; a foreign validator has
    // no introspectable shape, so the check skips rather than guessing.
    if (r.ok) expect(r.warnings.map((w) => w.code)).not.toContain("unknown_param");
  });
});
