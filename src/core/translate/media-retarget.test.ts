import { describe, expect, test } from "bun:test";

import { UnmodelValidationError } from "../issues";
import { JSON_HEADERS, toValidated, type RequestMeta } from "../request";
import type { ValidateResult } from "../result";
import { FAL_MEDIA_TARGET } from "./media-endpoints";
import {
  approximateParam,
  createMediaToApi,
  refuseParam,
  requireByteLength,
  withApiTarget,
  TranslationUnavailableError,
  type MediaMapContext,
  type MediaRetargetSpec,
} from "./media-retarget";

// ---------------------------------------------------------------------------
// A hand-built two-model fixture. `sparkler` is the plain case (one route, an
// exact mapping); `flare` exercises route selection off a non-model param, the
// approximation channel and the refusal channel.
// ---------------------------------------------------------------------------

interface Params {
  model: string;
  prompt: string;
  tier?: "fast" | "slow" | "gilded";
  seconds?: number;
  webhook?: string;
}

const OVERLAP = {
  sparkler: {
    endpoints: ["vendor/sparkler"],
    map: (params: Params) => ({ text: params.prompt }),
  },
  flare: {
    endpoints: ["vendor/flare/fast", "vendor/flare/slow"],
    route: (params: Params, ctx: MediaMapContext) => {
      switch (params.tier ?? "fast") {
        case "fast":
          return "vendor/flare/fast";
        case "slow":
          return "vendor/flare/slow";
        default:
          ctx.unsupported({ path: ["tier"], message: "no gilded route exists." });
          return undefined;
      }
    },
    map: (params: Params, ctx: MediaMapContext) => {
      if (params.webhook !== undefined) {
        refuseParam(ctx, ["webhook"], "vendor/flare", "carries no in-body callback");
      }
      if (params.seconds !== undefined && params.seconds !== 5) {
        approximateParam(ctx, ["seconds"], {
          requested: params.seconds,
          achieved: 5,
          message: "the target serves 5s only; the duration was snapped.",
        });
      }
      return { text: params.prompt, seconds: 5 };
    },
  },
} as const;

function spec(overrides: Partial<MediaRetargetSpec<Params>> = {}): MediaRetargetSpec<Params> {
  return {
    endpoint: "vendor.video",
    target: FAL_MEDIA_TARGET,
    modelId: (params) => params.model,
    overlap: OVERLAP,
    refusals: { antique: "the target retired this model in 2025." },
    ...overrides,
  };
}

const SOURCE_REQUEST: RequestMeta = {
  url: "https://api.vendor.example/v1/video",
  method: "POST",
  headers: { ...JSON_HEADERS },
};

/** Wires a spec through `toValidated` so `.toApi` / `.toApiSafe` are exercised. */
function validate(
  params: Params,
  overrides: Partial<MediaRetargetSpec<Params>> = {},
): {
  toApi(target: string): Record<string, unknown> & {
    request: RequestMeta;
    warnings: readonly { code: string; message: string; from: string; to: string }[];
    target: string;
    toSdk(t: string): unknown;
  };
  toApiSafe(target: string): ValidateResult<object>;
} {
  return toValidated({ ...params }, SOURCE_REQUEST, {
    sdk: {},
    api: createMediaToApi(spec(overrides))(params),
  }) as never;
}

describe("createMediaToApi", () => {
  test("maps the body, addresses fal's queue and carries no auth header", () => {
    const out = validate({ model: "sparkler", prompt: "a kite" }).toApi("fal");
    expect({ ...out } as Record<string, unknown>).toEqual({ text: "a kite" });
    expect(out.request.url).toBe("https://queue.fal.run/vendor/sparkler");
    expect(out.request.method).toBe("POST");
    expect(out.request.headers).toEqual({ "content-type": "application/json" });
    expect(Object.keys(out.request.headers)).not.toContain("authorization");
    expect(out.target).toBe("fal");
  });

  test("the wire body is exactly the enumerable properties", () => {
    const out = validate({ model: "sparkler", prompt: "a kite" }).toApi("fal");
    // `request`, `warnings`, `target` and `toSdk` all ride non-enumerably, so
    // `JSON.stringify(result)` is still the fetch body.
    expect(JSON.parse(JSON.stringify(out))).toEqual({ text: "a kite" });
    expect(Object.keys(out)).toEqual(["text"]);
  });

  test("toSdk('fal') is the `{ input }` shape @fal-ai/client takes", () => {
    const out = validate({ model: "sparkler", prompt: "a kite" }).toApi("fal");
    expect(out.toSdk("fal")).toEqual({ input: { text: "a kite" } });
  });

  // -------------------------------------------------------------------------
  // The loss policy: exact ⇔ no warnings, approximations warn, the rest errors
  // -------------------------------------------------------------------------

  test("an exact mapping carries zero warnings — the contract, not a coincidence", () => {
    expect(validate({ model: "sparkler", prompt: "a kite" }).toApi("fal").warnings).toEqual([]);
    expect(validate({ model: "flare", prompt: "a kite", seconds: 5 }).toApi("fal").warnings).toEqual(
      [],
    );
  });

  test("an approximation is exactly one warning, routed and named", () => {
    const out = validate({ model: "flare", prompt: "a kite", seconds: 9 }).toApi("fal");
    expect(out.warnings).toHaveLength(1);
    const [warning] = out.warnings;
    expect(warning?.code).toBe("approximated_param");
    expect(warning?.from).toBe("vendor.video");
    // The warning names the RESOLVED endpoint, not the canonical one.
    expect(warning?.to).toBe("fal.vendor/flare/fast");
  });

  test("the resolved route is what the warning names, even off the default", () => {
    const out = validate({ model: "flare", prompt: "a kite", tier: "slow", seconds: 9 }).toApi(
      "fal",
    );
    expect(out.request.url).toBe("https://queue.fal.run/vendor/flare/slow");
    expect(out.warnings[0]?.to).toBe("fal.vendor/flare/slow");
  });

  test("an unsupported param is an error, never a dropped field", () => {
    const result = validate({ model: "flare", prompt: "a kite", webhook: "https://x" }).toApiSafe(
      "fal",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe("unsupported_param");
    expect(result.errors[0]?.path).toEqual(["webhook"]);
    expect(result.errors[0]?.message).toContain("refuses the retarget rather than dropping");
  });

  test("the throwing form throws UnmodelValidationError for a refused param", () => {
    const validated = validate({ model: "flare", prompt: "a kite", webhook: "https://x" });
    expect(() => validated.toApi("fal")).toThrow(UnmodelValidationError);
  });

  test("a route refusal reports the reason and never falls back to a route", () => {
    const result = validate({ model: "flare", prompt: "a kite", tier: "gilded" }).toApiSafe("fal");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toBe("no gilded route exists.");
  });

  // -------------------------------------------------------------------------
  // Structural failures
  // -------------------------------------------------------------------------

  test("an unknown target id throws TranslationUnavailableError", () => {
    const validated = validate({ model: "sparkler", prompt: "a kite" });
    expect(() => validated.toApi("openrouter")).toThrow(TranslationUnavailableError);
  });

  test("…and toApiSafe reports the identical message instead of throwing", () => {
    const result = validate({ model: "sparkler", prompt: "a kite" }).toApiSafe("openrouter");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.meta).toMatchObject({ structural: true, target: "openrouter" });
    expect(result.errors[0]?.message).toContain("Media retargeting ships one destination today");
  });

  test("a deliberately refused model names the recorded reason", () => {
    const validated = validate({ model: "antique", prompt: "a kite" });
    expect(() => validated.toApi("fal")).toThrow(TranslationUnavailableError);
    const result = validated.toApiSafe("fal");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain("the target retired this model in 2025");
  });

  test("a model with no row lists the ones that have one", () => {
    const result = validate({ model: "unheard-of", prompt: "a kite" }).toApiSafe("fal");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("unsupported_capability");
    expect(result.errors[0]?.message).toContain("Mapped models: sparkler, flare");
    expect(result.errors[0]?.meta).toMatchObject({ available: ["sparkler", "flare"] });
  });

  test("does not resolve inherited Object.prototype keys as mappings", () => {
    const result = validate({ model: "constructor", prompt: "a kite" }).toApiSafe("fal");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("unsupported_capability");
  });

  test("the source result is untouched by a retarget", () => {
    const validated = validate({ model: "sparkler", prompt: "a kite" });
    validated.toApi("fal");
    expect({ ...(validated as unknown as Record<string, unknown>) }).toEqual({
      model: "sparkler",
      prompt: "a kite",
    });
  });
});

describe("requireByteLength", () => {
  test("counts UTF-8 bytes, not characters, and refuses rather than truncating", () => {
    const errors: string[] = [];
    const ctx: MediaMapContext = {
      warn: () => {},
      unsupported: ({ message }) => errors.push(message),
    };
    // Two 🌊 are 2 characters but 8 bytes — right at the cap.
    requireByteLength(ctx, ["prompt"], "🌊🌊", 8, "vendor/x");
    expect(errors).toHaveLength(0);
    // Three are 3 characters and 12 bytes — a visually short value over it.
    requireByteLength(ctx, ["prompt"], "🌊🌊🌊", 8, "vendor/x");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("12 UTF-8 bytes");
    expect(errors[0]).toContain("will not truncate");
  });
});

describe("withApiTarget", () => {
  interface Body {
    prompt: string;
  }

  /** A validator shaped like `createValidator`'s output, without the pipeline. */
  function baseValidator(): Parameters<typeof withApiTarget<Params, Body>>[0] {
    const safe = (params: Params): ValidateResult<Body> =>
      params.prompt === ""
        ? {
            ok: false,
            errors: [
              { severity: "error", code: "invalid_shape", path: ["prompt"], message: "empty" },
            ],
            warnings: [],
          }
        : {
            ok: true,
            params: toValidated({ prompt: params.prompt }, SOURCE_REQUEST, { sdk: {} }) as Body,
            warnings: [],
            estimate: {},
          };
    const validator = (params: Params): Body => {
      const result = safe(params);
      if (!result.ok) throw new UnmodelValidationError("vendor.video", result.errors, []);
      return result.params;
    };
    validator.safe = safe;
    validator.constraintsFor = () => [];
    return validator;
  }

  const wrapped = withApiTarget(baseValidator(), createMediaToApi(spec()));

  test("adds .toApi to the result without disturbing the wire body", () => {
    const result = wrapped({ model: "sparkler", prompt: "a kite" }) as Body & {
      toApi(t: string): object;
      request: RequestMeta;
    };
    expect({ ...result } as Record<string, unknown>).toEqual({ prompt: "a kite" });
    // `.request` still describes the SOURCE endpoint.
    expect(result.request.url).toBe(SOURCE_REQUEST.url);
    expect({ ...result.toApi("fal") }).toEqual({ text: "a kite" });
  });

  test(".toApi and .toApiSafe are non-enumerable", () => {
    const result = wrapped({ model: "sparkler", prompt: "a kite" });
    expect(Object.keys(result)).toEqual(["prompt"]);
    expect(Object.getOwnPropertyDescriptor(result, "toApi")?.enumerable).toBe(false);
    expect(Object.getOwnPropertyDescriptor(result, "toApiSafe")?.enumerable).toBe(false);
  });

  test("safe() carries the pair on a successful result and forwards a failed one", () => {
    const ok = wrapped.safe({ model: "sparkler", prompt: "a kite" });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(
      typeof (ok.params as Body & { toApi?: unknown }).toApi,
    ).toBe("function");

    const bad = wrapped.safe({ model: "sparkler", prompt: "" });
    expect(bad.ok).toBe(false);
  });

  test("forwards constraintsFor and the throwing contract untouched", () => {
    expect(wrapped.constraintsFor("sparkler")).toEqual([]);
    expect(() => wrapped({ model: "sparkler", prompt: "" })).toThrow(UnmodelValidationError);
  });
});
