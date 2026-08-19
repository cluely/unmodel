import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { UnmodelValidationError } from "../issues";
import { JSON_HEADERS, toValidated, type RequestMeta } from "../request";
import type { AvailabilityMap } from "./availability-types";
import { createToApi, TranslationUnavailableError, type RetargetSpec } from "./retarget";
import { availability as groqAvailability } from "../../catalog/availability/groq.gen";

// ---------------------------------------------------------------------------
// A hand-built fixture: one source model on three targets, exercising the bare
// string form, the `narrows` form and the explicit `endpoint` form.
// ---------------------------------------------------------------------------

const AVAILABILITY = {
  "gpt-oss-120b": {
    openrouter: "openai/gpt-oss-120b",
    cerebras: { id: "gpt-oss-120b", narrows: { context: 64000, drops: ["image"] } },
    // Vertex serves this model on its OpenAI-compatible MaaS surface, not on
    // generateContent — the availability data says so explicitly.
    "google-vertex": { id: "openai/gpt-oss-120b-maas", endpoint: "google-vertex.chat" },
    anthropic: "claude-nonsense",
  },
} as const satisfies AvailabilityMap;

interface ChatBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  logprobs?: boolean;
  temperature?: number;
}

const BODY: ChatBody = {
  model: "gpt-oss-120b",
  messages: [{ role: "user", content: "hi" }],
};

const SOURCE_REQUEST: RequestMeta = {
  url: "https://api.groq.com/openai/v1/chat/completions",
  method: "POST",
  headers: { ...JSON_HEADERS },
};

function baseSpec(overrides: Partial<RetargetSpec<ChatBody>> = {}): RetargetSpec<ChatBody> {
  return {
    from: "openai-chat",
    endpoint: "groq.chat",
    modelId: (body) => body.model,
    availability: AVAILABILITY,
    ...overrides,
  };
}

/** Wires a spec through `toValidated` so `.toApi` / `.toApiSafe` are exercised. */
function validate(
  body: ChatBody,
  overrides: Partial<RetargetSpec<ChatBody>> = {},
): {
  toApi(target: string): Record<string, unknown>;
  toApiSafe(target: string): {
    ok: boolean;
    errors?: Array<{ code: string; path: unknown[]; message: string }>;
  };
} {
  return toValidated({ ...body }, SOURCE_REQUEST, {
    sdk: { openai: () => body },
    api: createToApi(baseSpec(overrides))(body),
  }) as never;
}

// ---------------------------------------------------------------------------

describe("same-dialect retarget (the 92.2% path)", () => {
  test("respells the model id and swaps the URL", () => {
    const out = validate(BODY).toApi("openrouter");

    expect(out.model).toBe("openai/gpt-oss-120b");
    expect((out as { request: RequestMeta }).request.url).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    expect((out as { request: RequestMeta }).request.method).toBe("POST");
  });

  test("leaves the rest of the body untouched — no IR round trip", () => {
    const source: ChatBody = { ...BODY, temperature: 0.4 };
    const out = validate(source).toApi("openrouter");

    expect(out).toEqual({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.4,
    });
  });

  test("does not mutate the source body", () => {
    const source: ChatBody = { ...BODY };
    validate(source).toApi("openrouter");

    expect(source.model).toBe("gpt-oss-120b");
  });

  test("headers come from the target endpoint and are copied, not shared", () => {
    const out = validate(BODY).toApi("openrouter") as unknown as { request: RequestMeta };
    out.request.headers["authorization"] = "Bearer secret";

    const again = validate(BODY).toApi("openrouter") as unknown as { request: RequestMeta };
    expect(again.request.headers["authorization"]).toBeUndefined();
    expect(again.request.headers["content-type"]).toBe("application/json");
  });

  test("honours an explicit non-default endpoint from the availability entry", () => {
    // google-vertex's default surface is gemini; this model's entry points at
    // its OpenAI-compatible MaaS surface instead. Resolving the *endpoint*
    // rather than the provider is what makes that possible — and vertex being
    // factory-configured is what makes it unavailable to a one-arg call.
    expect(() => validate(BODY).toApi("google-vertex")).toThrow(
      /google-vertex\.chat is not available through one-argument/,
    );
  });
});

describe("the retargeted result", () => {
  test("is a full Validated: spreadable wire body plus non-enumerable extras", () => {
    const out = validate(BODY).toApi("openrouter");

    expect(Object.keys(out)).toEqual(["model", "messages"]);
    expect(JSON.parse(JSON.stringify(out))).toEqual({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: "hi" }],
    });
    for (const key of ["request", "toSdk", "warnings", "target"]) {
      expect(Object.getOwnPropertyDescriptor(out, key)?.enumerable, key).toBe(false);
    }
  });

  test("carries the target provider id", () => {
    expect(validate(BODY).toApi("openrouter")["target"]).toBe("openrouter");
  });

  test("offers only its own dialect's SDK targets", () => {
    const out = validate(BODY).toApi("openrouter") as unknown as {
      toSdk(target: string): unknown;
    };

    expect(out.toSdk("openai")).toEqual({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(() => out.toSdk("anthropic")).toThrow(TypeError);
  });

  test("has no .toApi — one hop only", () => {
    const out = validate(BODY).toApi("openrouter");

    expect("toApi" in out).toBe(false);
    expect("toApiSafe" in out).toBe(false);
  });
});

describe("translation warnings", () => {
  test("records the model-id respelling as an audit trail", () => {
    const out = validate(BODY).toApi("openrouter") as unknown as {
      warnings: Array<{ code: string; from: string; to: string; message: string }>;
    };

    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]?.code).toBe("id_respelled");
    expect(out.warnings[0]?.from).toBe("groq.chat");
    expect(out.warnings[0]?.to).toBe("openrouter.chat");
    expect(out.warnings[0]?.message).toContain("openai/gpt-oss-120b");
  });

  test("turns generated `narrows` metadata into capability warnings", () => {
    const out = validate(BODY).toApi("cerebras") as unknown as {
      warnings: Array<{ code: string; message: string; meta?: Record<string, unknown> }>;
    };
    const narrowed = out.warnings.filter((w) => w.code === "capability_narrowed");

    expect(narrowed).toHaveLength(2);
    expect(narrowed[0]?.message).toContain("64000-token context window");
    expect(narrowed[1]?.message).toContain("image");
    // No target catalog was imported to learn either of those facts.
    expect(narrowed[0]?.meta).toEqual({ context: 64000 });
  });
});

describe("availability guard", () => {
  test("a target that does not serve the model fails, listing the ones that do", () => {
    const result = validate(BODY).toApiSafe("groq");

    expect(result.ok).toBe(false);
    const error = result.errors?.[0] as { code: string; message: string };
    expect(error.code).toBe("unsupported_capability");
    expect(error.message).toContain("is not served by groq");
    expect(error.message).toContain("openrouter");
  });

  test("toApi throws the same failure, labelled with the route", () => {
    try {
      validate(BODY).toApi("groq");
      throw new Error("expected toApi to throw");
    } catch (error) {
      expect(UnmodelValidationError.isInstance(error)).toBe(true);
      expect((error as UnmodelValidationError).message).toContain("groq.chat → groq.chat");
    }
  });

  test("an unknown source model degrades to a runtime error, not a compile-time ban", () => {
    const result = validate({ ...BODY, model: "gpt-oss-future-99" }).toApiSafe("openrouter");

    expect(result.ok).toBe(false);
    expect((result.errors?.[0] as { message: string }).message).toContain(
      "catalog data may lag behind",
    );
  });

  test("an unknown target provider is a TypeError-grade wiring mistake", () => {
    expect(() => validate(BODY).toApi("not-a-provider")).toThrow(TranslationUnavailableError);
  });
});

/**
 * **The home provider is always a valid target.**
 *
 * `groq.chat` serves groq's models by definition, so `.toApi("groq")` is the
 * identity retarget: same body, same URL, nothing lost. Codegen puts an
 * identity entry on every generated row, and the engine additionally falls
 * back to it for models the table has never heard of — a release newer than
 * the committed snapshot must not be told its own provider does not serve it.
 */
describe("identity retarget to the home provider", () => {
  const WITH_SELF = {
    "gpt-oss-120b": {
      groq: "openai/gpt-oss-120b",
      openrouter: "openai/gpt-oss-120b",
    },
  } as const satisfies AvailabilityMap;

  const HOME_BODY: ChatBody = {
    model: "openai/gpt-oss-120b",
    messages: [{ role: "user", content: "hi" }],
    temperature: 0.4,
  };

  test("a row with an identity entry returns the body unchanged, at the home URL", () => {
    const out = validate({ ...HOME_BODY, model: "gpt-oss-120b" }, { availability: WITH_SELF }).toApi(
      "groq",
    );

    expect(out).toEqual({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.4,
    });
    expect((out as { request: RequestMeta }).request.url).toBe(
      "https://api.groq.com/openai/v1/chat/completions",
    );
    expect((out as unknown as { target: string }).target).toBe("groq");
  });

  test("an identical spelling emits no id_respelled warning", () => {
    // The row's identity entry spells the model exactly as the source does, so
    // there is nothing to audit — `warnings` is the inventory of what the
    // translation cost, and this one cost nothing.
    const out = validate(HOME_BODY, { availability: WITH_SELF }).toApi("groq") as unknown as {
      warnings: unknown[];
    };

    expect(out.warnings).toEqual([]);
  });

  test("a model absent from the table still retargets home, via the identity fallback", () => {
    // The catalog lags; the provider does not. This is the model the user just
    // validated against groq, so groq serves it whatever the table knows.
    const out = validate({ ...HOME_BODY, model: "gpt-oss-future-99" }).toApi(
      "groq",
    ) as unknown as {
      model: string;
      request: RequestMeta;
      warnings: unknown[];
      target: string;
    };

    expect(out.model).toBe("gpt-oss-future-99");
    expect(out.request.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(out.warnings).toEqual([]);
    expect(out.target).toBe("groq");
  });

  test("the fallback is home-only — another provider absent from the table still fails", () => {
    const result = validate({ ...HOME_BODY, model: "gpt-oss-future-99" }).toApiSafe("openrouter");

    expect(result.ok).toBe(false);
    expect((result.errors?.[0] as { message: string }).message).toContain("is not served by");
  });
});

/**
 * Structural failures — unknown provider, factory target, missing codec — are
 * `.toApi` throws and `.toApiSafe` **results**. They are reachable from typed,
 * compiling code (the availability union promises edges a given build may not
 * ship a codec for), so a `safe()` caller must not have to wrap the call in a
 * `try` to survive them.
 */
describe("structural failures reach toApiSafe as a result, not a throw", () => {
  const cases: ReadonlyArray<[string, string, RegExp]> = [
    ["unknown provider", "not-a-provider", /is not a known `\.toApi` target/],
    ["missing codec", "anthropic", /this build ships no codec/],
  ];

  test.each(cases)("%s: toApi throws", (_label, target) => {
    expect(() => validate(BODY).toApi(target)).toThrow(TranslationUnavailableError);
  });

  test.each(cases)("%s: toApiSafe returns ok:false", (_label, target, pattern) => {
    const result = validate(BODY).toApiSafe(target);

    expect(result.ok).toBe(false);
    const error = result.errors?.[0] as { code: string; message: string; meta?: unknown };
    expect(error.code).toBe("unsupported_capability");
    expect(error.message).toMatch(pattern);
    // `structural: true` is what lets a caller tell "this build cannot do it"
    // apart from "the target rejects this param".
    expect(error.meta).toMatchObject({ target, structural: true });
  });
});

describe("factory targets are excluded from the one-arg call", () => {
  const availability = {
    "claude-opus-5": { "amazon-bedrock": "anthropic.claude-opus-5" },
  } as const satisfies AvailabilityMap;
  const retarget = createToApi(
    baseSpec({ from: "anthropic-messages", endpoint: "anthropic.messages", availability }),
  )({ ...BODY, model: "claude-opus-5" });

  test("the failure names the config the call never supplied", () => {
    const { result, structural } = retarget("amazon-bedrock");

    expect(result.ok).toBe(false);
    expect(TranslationUnavailableError.isInstance(structural)).toBe(true);
    expect(structural?.message).toMatch(/needs region that this call never supplied/);
    expect(structural?.message).toMatch(/Use amazon-bedrock's own factory instead/);
    expect((result as { errors: Array<{ message: string }> }).errors[0]?.message).toBe(
      structural?.message,
    );
  });
});

describe("cross-dialect retarget", () => {
  test("without a codec, says so instead of producing a wrong body", () => {
    expect(() => validate(BODY).toApi("anthropic")).toThrow(TranslationUnavailableError);
    expect(() => validate(BODY).toApi("anthropic")).toThrow(
      /crosses wire dialects \(openai-chat → anthropic-messages\) and this build ships no codec/,
    );
  });

  test("with a codec, encodes to the IR and decodes into the target dialect", () => {
    interface IR {
      model: string;
      text: string;
    }
    const spec: RetargetSpec<ChatBody, IR> = {
      ...baseSpec(),
      encode: (body) => ({ model: body.model, text: body.messages[0]?.content ?? "" }),
      decoders: {
        "anthropic-messages": (ir, warn) => {
          warn({
            code: "dropped_param",
            path: ["temperature"],
            message: "demo codec drops temperature",
          });
          return {
            model: "claude-nonsense",
            max_tokens: 1024,
            messages: [{ role: "user", content: ir.text }],
          };
        },
      },
    };
    const out = toValidated({ ...BODY }, SOURCE_REQUEST, {
      sdk: { openai: () => BODY },
      api: createToApi(spec)(BODY),
    }) as unknown as { toApi(t: string): Record<string, unknown> };

    const retargeted = out.toApi("anthropic") as unknown as {
      messages: unknown;
      request: RequestMeta;
      warnings: Array<{ code: string }>;
      toSdk(t: string): unknown;
    };

    expect(retargeted.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(retargeted.request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(retargeted.request.headers["anthropic-version"]).toBe("2023-06-01");
    expect(retargeted.warnings.map((w) => w.code)).toEqual(["id_respelled", "dropped_param"]);
    // The target's dialect decides the SDK targets, not the source's.
    expect(retargeted.toSdk("anthropic")).toBeDefined();
    expect(() => retargeted.toSdk("openai")).toThrow(TypeError);
  });
});

describe("target re-validation (schema + constraint layers)", () => {
  const targetValidation = (): {
    schema: z.ZodType;
    constraints: Array<{ deny: Record<string, { reason: string; source: string }> }>;
  } => ({
    schema: z.looseObject({ model: z.string(), messages: z.array(z.looseObject({})).min(1) }),
    constraints: [
      {
        deny: {
          logprobs: {
            reason: "the target's OpenAI-compatible endpoint returns a 400 error for `logprobs`",
            source: "https://example.com/compat (checked 2026-08-13)",
          },
        },
      },
    ],
  });

  test("catches a param the target denies — the case the feature exists for", () => {
    const result = validate({ ...BODY, logprobs: true }, { targetValidation }).toApiSafe(
      "openrouter",
    );

    expect(result.ok).toBe(false);
    const error = result.errors?.[0] as { code: string; path: unknown[]; message: string };
    expect(error.code).toBe("unsupported_param");
    expect(error.path).toEqual(["logprobs"]);
    // Named against the TARGET's model id, and citing the target's doc.
    expect(error.message).toContain('"openai/gpt-oss-120b"');
    expect(error.message).toContain("returns a 400 error");
  });

  test("passes a body the target accepts", () => {
    const result = validate(BODY, { targetValidation }).toApiSafe("openrouter");

    expect(result.ok).toBe(true);
  });

  test("reports schema failures against the target dialect", () => {
    const result = validate({ ...BODY, messages: [] }, { targetValidation }).toApiSafe(
      "openrouter",
    );

    expect(result.ok).toBe(false);
    expect((result.errors?.[0] as { code: string }).code).toBe("invalid_shape");
  });

  test("skips the catalog layers by design — no target catalog is imported", () => {
    // A 10-million-token prompt is fine here: over_context needs the target's
    // ModelInfo, which is exactly the import this design refuses to make. The
    // documented escape hatch is to compose with the target's own validator.
    const huge: ChatBody = {
      ...BODY,
      messages: [{ role: "user", content: "x".repeat(10_000_000) }],
    };

    expect(validate(huge, { targetValidation }).toApiSafe("openrouter").ok).toBe(true);
  });
});

describe("withModelId", () => {
  test("lets a model-stripping endpoint place the id wherever it belongs", () => {
    const out = validate(BODY, {
      withModelId: (body, targetModelId) => ({
        ...body,
        model: undefined,
        modelOverride: targetModelId,
      }),
    }).toApi("openrouter");

    expect(out["modelOverride"]).toBe("openai/gpt-oss-120b");
  });
});

describe("against the real generated availability data", () => {
  const groqBody: ChatBody = {
    model: "openai/gpt-oss-120b",
    messages: [{ role: "user", content: "hi" }],
  };
  const toApi = createToApi({
    from: "openai-chat",
    endpoint: "groq.chat",
    modelId: (body: ChatBody) => body.model,
    availability: groqAvailability,
  })(groqBody);

  test("gpt-oss-120b respells per target", () => {
    const cases: Array<[string, string, string]> = [
      ["cerebras", "gpt-oss-120b", "https://api.cerebras.ai/v1/chat/completions"],
      [
        "fireworks-ai",
        "accounts/fireworks/models/gpt-oss-120b",
        "https://api.fireworks.ai/inference/v1/chat/completions",
      ],
      ["openrouter", "openai/gpt-oss-120b", "https://openrouter.ai/api/v1/chat/completions"],
    ];

    for (const [target, modelId, url] of cases) {
      const result = toApi(target).result;
      expect(result.ok, target).toBe(true);
      if (!result.ok) continue;
      const params = result.params as { model: string; request: RequestMeta };
      expect(params.model, target).toBe(modelId);
      expect(params.request.url, target).toBe(url);
    }
  });

  test("factory-configured targets in the data are still refused by the one-arg call", () => {
    for (const target of ["amazon-bedrock", "cloudflare-workers-ai", "google-vertex"]) {
      const { result, structural } = toApi(target);
      expect(result.ok, target).toBe(false);
      expect(TranslationUnavailableError.isInstance(structural), target).toBe(true);
    }
  });
});
