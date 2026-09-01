import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  image,
  IMAGES_GENERATIONS_URL,
  type GptImage2Size,
} from "./image";
import {
  imageConstraints,
  imagesEditConstraints,
  ttsConstraints,
  transcriptionConstraints,
  chatConstraints,
} from "./constraints";
import { imagesModels } from "./images-models";
import { UnmodelValidationError } from "../../core/issues";
import { models } from "../../catalog/openai.gen";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";

// Bypasses the Tier-A compile-time surface so runtime enforcement of
// type-blocked params can be exercised.
const safeUnchecked = image.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("openai.image happy path", () => {
  test("returns a wire-pure body with hidden toSdk/request", () => {
    const params = {
      model: "gpt-image-1.5" as const,
      prompt: "a lighthouse at dusk",
      size: "1024x1536" as const,
      quality: "medium" as const,
    };
    const v = image(params);

    expect(Object.keys(v)).toEqual(["model", "prompt", "size", "quality"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(IMAGES_GENERATIONS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    expect(v.toSdk("openai")).toEqual(params);
  });

  test("\"openai\" is the endpoint's only SDK target", () => {
    const v = image({ model: "gpt-image-1.5", prompt: "x" });
    const toSdk = v.toSdk as (target: string) => unknown;
    // Image endpoints declare no "ai-sdk" target yet, and the zero-arg form
    // is gone — both are runtime errors as well as compile errors.
    expect(() => toSdk("ai-sdk")).toThrow(TypeError);
    expect(() => toSdk("openai")).not.toThrow();
  });

  test("gpt-image-2 accepts arbitrary WIDTHxHEIGHT sizes", () => {
    const r = image.safe({ model: "gpt-image-2", prompt: "x", size: "1536x864" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("explicit null on nullable enum params means provider default and passes", () => {
    // These params are typed `| null` and null means "use the default" on
    // the wire, so the enum layer must not reject it.
    const gpt = image.safe({
      model: "gpt-image-1",
      prompt: "x",
      size: null,
      quality: null,
      output_format: null,
      moderation: null,
      n: null,
    });
    expect(gpt.ok).toBe(true);

    const dalle = image.safe({
      model: "dall-e-3",
      prompt: "x",
      n: null,
      quality: null,
      size: null,
      style: null,
      response_format: null,
    });
    expect(dalle.ok).toBe(true);
  });

  test("unknown model falls back to the escape arm with a warning", () => {
    // Written inline, like its `video.test.ts` and `image-edit.test.ts`
    // siblings: an annotated alias would only exercise assignability to a
    // type the caller wrote down, and the escape arm's job is to accept the
    // literal a caller actually types.
    const r = image.safe({ model: "gpt-image-9", prompt: "x", brand_new_param: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const codes = r.warnings.map((w) => w.code);
      expect(codes).toContain("unknown_model");
      expect(codes).toContain("unknown_param");
    }
  });

  test("dall-e models validate against the hand-supplemented catalog", () => {
    const r = image.safe({
      model: "dall-e-3",
      prompt: "x",
      n: 1,
      style: "vivid",
      size: "1792x1024",
      response_format: "b64_json",
    });
    expect(r.ok).toBe(true);
    // models.dev no longer tracks dall-e, but images-models.ts supplements
    // the documented ids, so there is no unknown_model warning.
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("the catalog carries the documented per-model prompt caps", () => {
    expect(imagesModels["dall-e-2"]?.limit.characters).toBe(1000);
    expect(imagesModels["dall-e-3"]?.limit.characters).toBe(4000);
    expect(imagesModels["gpt-image-2"]?.limit.characters).toBe(32000);
  });

  test("a prompt over the documented cap is reported with character meta", () => {
    const r = image.safe({ model: "dall-e-2", prompt: "x".repeat(1001) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "over_output_limit");
      expect(issue?.path).toEqual(["prompt"]);
      expect(issue?.meta).toMatchObject({ limitCharacters: 1000, actualCharacters: 1001 });
    }
  });

  test("chatgpt-image-latest is rejected on generations (it is an edits-only model)", () => {
    // It IS in the shared images catalog (edits documents it), so unknown_model
    // cannot fire — the endpoint gate has to report it.
    expect(imagesModels["chatgpt-image-latest"]).toBeDefined();
    const r = safeUnchecked({
      model: "chatgpt-image-latest",
      prompt: "hi",
      size: "9999x1",
      style: "vivid",
      response_format: "url",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_capability");
      expect(issue?.path).toEqual(["model"]);
      expect(issue?.message).toContain("/v1/images/generations");
      expect(String(issue?.meta?.source)).toContain("images/create");
      expect(r.warnings.map((w) => w.code)).not.toContain("unknown_model");
    }
  });

  test("the generations models the create reference lists are not gated", () => {
    for (const model of ["dall-e-2", "gpt-image-1.5", "gpt-image-2"]) {
      const r = safeUnchecked({ model, prompt: "hi" });
      expect(
        r.ok ? [] : r.errors.filter((e) => e.code === "unsupported_capability"),
      ).toEqual([]);
    }
  });

  test("deprecated gpt-image-1 warns", () => {
    expect(models["gpt-image-1"].status).toBe("deprecated");
    const r = image.safe({ model: "gpt-image-1", prompt: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["deprecated_model"]);
  });
});

describe("openai.image gpt-image-2 background (ground truth)", () => {
  // "Transparent backgrounds are available for supported GPT Image models.
  // For `gpt-image-2` and `gpt-image-2-2026-04-21`, this support is in
  // preview." — images/create reference, checked 2026-08-31.
  test("every documented background value passes on both gpt-image-2 ids", () => {
    for (const model of ["gpt-image-2", "gpt-image-2-2026-04-21"] as const) {
      for (const background of ["transparent", "opaque", "auto"] as const) {
        const r = image.safe({ model, prompt: "x", background });
        expect(r.ok).toBe(true);
      }
    }
  });

  test('transparent with output_format "jpeg" is rejected — jpeg has no alpha channel', () => {
    const r = image.safe({
      model: "gpt-image-2",
      prompt: "x",
      background: "transparent",
      output_format: "jpeg",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["output_format"]);
      expect(issue?.message).toContain("png");
    }
  });

  test("transparent with png, webp, or the default format passes", () => {
    for (const output_format of ["png", "webp", undefined] as const) {
      const r = image.safe({
        model: "gpt-image-1",
        prompt: "x",
        background: "transparent",
        ...(output_format === undefined ? {} : { output_format }),
      });
      expect(r.ok).toBe(true);
    }
  });

  test("constraintsFor exposes the full background enum", () => {
    expect(image.constraintsFor("gpt-image-2")[0]?.enums?.background).toEqual([
      "transparent",
      "opaque",
      "auto",
    ]);
  });
});

describe("openai.image cross-model deny rules (documented applicability)", () => {
  test("response_format on a GPT image model is unsupported_param", () => {
    const r = safeUnchecked({ model: "gpt-image-1.5", prompt: "x", response_format: "url" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "unsupported_param");
      expect(issue?.path).toEqual(["response_format"]);
      expect(String(issue?.meta?.source)).toContain("api-reference/images/create");
    }
  });

  test("style outside dall-e-3 is unsupported_param", () => {
    const r = safeUnchecked({ model: "gpt-image-1", prompt: "x", style: "vivid" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["style"]);
  });

  test("GPT-image-only params on dall-e are unsupported_param", () => {
    const r = safeUnchecked({
      model: "dall-e-3",
      prompt: "x",
      output_format: "png",
      stream: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path[0]).sort()).toEqual(["output_format", "stream"]);
    }
  });
});

describe("openai.image gpt-image-2 free-form size rules", () => {
  test("every GptImage2Size preset passes the runtime rule it advertises", () => {
    // Keep in sync with the GptImage2Size union in image.ts — each named
    // preset must satisfy checkGptImage2Size (÷16, ratio ≤3:1, edge ≤3840,
    // pixel budget), or the autocomplete would advertise sizes the API rejects.
    const presets = [
      "auto",
      "1024x1024", "1536x1536", "2048x2048", "2880x2880",
      "1536x1024", "1024x1536",
      "2048x1536", "1536x2048",
      "1280x720", "2560x1440", "3840x2160",
      "720x1280", "1440x2560", "2160x3840",
      "2048x1024", "3840x1920", "1024x2048", "1920x3840",
      "3360x1440", "1440x3360",
      "3840x1280", "1280x3840",
    ] as const;
    for (const size of presets) {
      const r = image.safe({ model: "gpt-image-2", prompt: "x", size });
      expect(r.ok, `preset ${size} should validate`).toBe(true);
      if (r.ok) expect(r.warnings, `preset ${size} should be warning-free`).toEqual([]);
    }
  });

  test("a conforming free-form size passes", () => {
    const r = image.safe({ model: "gpt-image-2", prompt: "x", size: "1024x1024" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("dimensions not divisible by 16 are invalid_enum_value", () => {
    const r = image.safe({ model: "gpt-image-2", prompt: "x", size: "1000x1000" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["size"]);
      expect(issue?.message).toContain("divisible by 16");
      expect(issue?.meta?.violations).toEqual(["divisible_by_16"]);
    }
  });

  test("aspect ratio and max edge are both flagged", () => {
    const r = image.safe({ model: "gpt-image-2", prompt: "x", size: "4096x1024" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["size"]);
      expect(issue?.meta?.violations).toEqual(["aspect_ratio", "max_edge"]);
      expect(issue?.message).toContain("3:1");
      expect(issue?.message).toContain("3840px");
    }
  });

  test("total pixels below the documented floor are flagged", () => {
    // 640x640 = 409,600 px, under the documented 655,360 minimum.
    const r = image.safe({ model: "gpt-image-2", prompt: "x", size: "640x640" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.meta?.violations).toEqual(["min_pixels"]);
    }
  });

  test("total pixels above the documented ceiling are flagged", () => {
    // 3840x2400: max edge is fine, 9,216,000 px is over the 8,294,400 cap.
    const r = image.safe({ model: "gpt-image-2", prompt: "x", size: "3840x2400" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.violations).toEqual(["max_pixels"]);
  });

  test("a tall size within the documented pixel band passes", () => {
    // 3200x2560 = 8,192,000 px, max edge 3200, ratio 1.25 — all documented
    // bounds are satisfied. The old short-edge<=2160 rule false-positived it.
    const r = image.safe({ model: "gpt-image-2", prompt: "x", size: "3200x2560" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("the documented 3840x2160 and 2160x3840 sizes both pass", () => {
    for (const size of ["3840x2160", "2160x3840"] as const) {
      const r = image.safe({ model: "gpt-image-2", prompt: "x", size });
      expect(r.ok).toBe(true);
    }
  });

  test("the dated snapshot enforces the same rules", () => {
    const r = image.safe({ model: "gpt-image-2-2026-04-21", prompt: "x", size: "1000x1000" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
  });

  test("a non-WIDTHxHEIGHT string is rejected as a format violation", () => {
    // "big" is a compile error since GptImage2Size — the runtime path stays
    // covered for widened strings (e.g. sizes read from config files).
    const r = image.safe({ model: "gpt-image-2", prompt: "x", size: "big" as GptImage2Size });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.meta?.violations).toEqual(["format"]);
  });
});

describe("openai.image enum narrowing", () => {
  test("size outside the gpt-image-1 set is invalid_enum_value", () => {
    const r = safeUnchecked({ model: "gpt-image-1", prompt: "x", size: "1792x1024" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["size"]);
      expect(issue?.message).toContain('"1024x1024"');
    }
  });

  test("dall-e-3 rejects n > 1", () => {
    const r = safeUnchecked({ model: "dall-e-3", prompt: "x", n: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["n"]);
    }
  });

  test("dall-e-2 rejects hd quality", () => {
    const r = safeUnchecked({ model: "dall-e-2", prompt: "x", quality: "hd" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_enum_value");
  });

  test("invalid background value is an invalid_shape error from the schema", () => {
    const r = safeUnchecked({ model: "gpt-image-1", prompt: "x", background: "blue" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });
});

describe("openai constraint provenance", () => {
  const fixturesDir = join(import.meta.dir, "..", "..", "..", "test", "fixtures", "provider-errors", "openai");

  const tables: Array<[string, Partial<Record<string, EndpointConstraints>>]> = [
    ["image", imageConstraints],
    ["imageEdit", imagesEditConstraints],
    ["tts", ttsConstraints],
    ["transcription", transcriptionConstraints],
    ["chat", chatConstraints],
  ];

  test("every deny rule carries a reason and a doc URL or fixture source", () => {
    let denyRules = 0;
    for (const [, table] of tables) {
      for (const constraints of Object.values(table)) {
        for (const rule of Object.values(constraints?.deny ?? {})) {
          denyRules += 1;
          expect(rule.reason.length).toBeGreaterThan(0);
          expect(rule.source).toMatch(/^https:\/\/|fixture:/);
        }
      }
    }
    expect(denyRules).toBeGreaterThan(10);
  });

  test("every fixture-sourced deny rule is backed by that recorded fixture", () => {
    for (const [endpoint, table] of tables) {
      for (const [model, constraints] of Object.entries(table)) {
        for (const [param, rule] of Object.entries(constraints?.deny ?? {})) {
          if (!rule.source.includes("fixture:")) continue;
          const fixturePath = join(fixturesDir, `${endpoint}-${model}-${param}.json`);
          expect(existsSync(fixturePath)).toBe(true);

          const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
            request?: { body?: Record<string, unknown> };
            response?: { status?: number; body?: { error?: { param?: string } } };
            recorded?: string;
          };
          expect(fixture.response?.status).toBe(400);
          expect(fixture.response?.body?.error?.param).toBe(param);
          expect(fixture.request?.body?.model).toBe(model);
          expect(typeof fixture.recorded).toBe("string");
        }
      }
    }
  });
});
