import { describe, expect, test } from "bun:test";
import {
  GENERATE_IMAGES_BASE_URL,
  IMAGEN_DEFAULT_SAMPLE_COUNT,
  generateImages,
  generateImagesUrl,
} from "./generate-images";
import { imagenModels } from "./imagen-models";
import { IMAGEN_ASPECT_RATIOS, IMAGEN_DOCS_URL } from "./constraints";
import type { Issue } from "../../core/issues";
import type { ValidateResult } from "../../core/result";

function expectError(result: ValidateResult<unknown>, code: Issue["code"]): Issue {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected validation failure");
  const issue = result.errors.find((e) => e.code === code);
  expect(issue).toBeDefined();
  return issue!;
}

function expectOk<V>(result: ValidateResult<V>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected ok, got: ${JSON.stringify(result.errors)}`);
  return result;
}

describe("wire purity", () => {
  test("model is stripped from the body; the URL carries it", () => {
    const validated = generateImages({
      model: "imagen-4.0-generate-001",
      instances: [{ prompt: "Robot holding a red skateboard" }],
      parameters: { sampleCount: 2 },
    });
    expect(Object.keys(validated)).toEqual(["instances", "parameters"]);
    expect(JSON.parse(JSON.stringify(validated))).toEqual({
      instances: [{ prompt: "Robot holding a red skateboard" }],
      parameters: { sampleCount: 2 },
    });
    expect(validated.request.url).toBe(
      `${GENERATE_IMAGES_BASE_URL}/imagen-4.0-generate-001:predict`,
    );
    expect(validated.request.method).toBe("POST");
    expect(validated.request.headers["content-type"]).toBe("application/json");
  });

  test("generateImagesUrl accepts both the bare and models/-prefixed id", () => {
    expect(generateImagesUrl("models/imagen-4.0-fast-generate-001")).toBe(
      generateImagesUrl("imagen-4.0-fast-generate-001"),
    );
  });
});

describe("toSdk mapping (predict wire names -> @google/genai config names)", () => {
  test("instances[0].prompt becomes prompt; parameters become config", () => {
    const sdk = generateImages({
      model: "imagen-4.0-ultra-generate-001",
      instances: [{ prompt: "a lighthouse" }],
      parameters: {
        sampleCount: 3,
        aspectRatio: "16:9",
        sampleImageSize: "2K",
        outputOptions: { mimeType: "image/jpeg", compressionQuality: 80 },
      },
    }).toSdk("google");
    expect(sdk).toEqual({
      model: "imagen-4.0-ultra-generate-001",
      prompt: "a lighthouse",
      config: {
        numberOfImages: 3,
        aspectRatio: "16:9",
        // sampleImageSize is the wire name; imageSize is the SDK name.
        imageSize: "2K",
        outputMimeType: "image/jpeg",
        outputCompressionQuality: 80,
      },
    });
  });

  test("config is omitted when no parameters are passed", () => {
    const sdk = generateImages({
      model: "imagen-4.0-generate-001",
      instances: [{ prompt: "a lighthouse" }],
    }).toSdk("google") as Record<string, unknown>;
    expect("config" in sdk).toBe(false);
  });
});

describe("shape checks", () => {
  test("more than one instance fails", () => {
    const result = generateImages.safe({
      model: "imagen-4.0-generate-001",
      instances: [{ prompt: "a" }, { prompt: "b" }],
    });
    expectError(result, "invalid_shape");
  });

  test("unknown model warns but validates", () => {
    const result = expectOk(
      generateImages.safe({ model: "imagen-9.9-imaginary", instances: [{ prompt: "hi" }] }),
    );
    expect(result.warnings.some((w) => w.code === "unknown_model")).toBe(true);
  });

  test("unknown top-level keys warn as unknown_param", () => {
    const result = expectOk(
      generateImages.safe({
        model: "imagen-4.0-generate-001",
        instances: [{ prompt: "hi" }],
        // @ts-expect-error deliberately unknown wire key
        extras: { nope: true },
      }),
    );
    expect(result.warnings.some((w) => w.code === "unknown_param")).toBe(true);
  });
});

describe("catalog", () => {
  test("all three documented Imagen 4 ids are cataloged and deprecated", () => {
    expect(Object.keys(imagenModels).sort()).toEqual([
      "imagen-4.0-fast-generate-001",
      "imagen-4.0-generate-001",
      "imagen-4.0-ultra-generate-001",
    ]);
    for (const info of Object.values(imagenModels)) {
      expect(info.status).toBe("deprecated");
      // limit.context 0: Imagen is not a token-context model.
      expect(info.limit.context).toBe(0);
      expect(info.limit.input).toBe(480);
    }
  });

  test("the announced shutdown surfaces as a deprecated_model warning", () => {
    const result = expectOk(
      generateImages.safe({ model: "imagen-4.0-generate-001", instances: [{ prompt: "hi" }] }),
    );
    expect(result.warnings.some((w) => w.code === "deprecated_model")).toBe(true);
  });
});

describe("parameter constraints (nested under `parameters`)", () => {
  test("aspectRatio outside Imagen's five documented values fails", () => {
    const issue = expectError(
      generateImages.safe({
        model: "imagen-4.0-generate-001",
        instances: [{ prompt: "hi" }],
        // 21:9 is a Nano Banana ratio, not an Imagen one.
        parameters: { aspectRatio: "21:9" as never },
      }),
      "invalid_enum_value",
    );
    expect(issue.path).toEqual(["parameters", "aspectRatio"]);
    expect(issue.meta?.["allowed"]).toEqual([...IMAGEN_ASPECT_RATIOS]);
  });

  test("every documented aspect ratio passes", () => {
    for (const aspectRatio of IMAGEN_ASPECT_RATIOS) {
      expectOk(
        generateImages.safe({
          model: "imagen-4.0-generate-001",
          instances: [{ prompt: "hi" }],
          parameters: { aspectRatio },
        }),
      );
    }
  });

  test("sampleCount above 4 fails", () => {
    const issue = expectError(
      generateImages.safe({
        model: "imagen-4.0-generate-001",
        instances: [{ prompt: "hi" }],
        parameters: { sampleCount: 5 },
      }),
      "invalid_enum_value",
    );
    expect(issue.path).toEqual(["parameters", "sampleCount"]);
  });

  test("personGeneration accepts both the doc and SDK spellings", () => {
    for (const personGeneration of ["allow_adult", "ALLOW_ADULT"] as const) {
      expectOk(
        generateImages.safe({
          model: "imagen-4.0-generate-001",
          instances: [{ prompt: "hi" }],
          parameters: { personGeneration },
        }),
      );
    }
  });

  test("sampleImageSize is Standard/Ultra only — denied on Fast", () => {
    const issue = expectError(
      generateImages.safe({
        model: "imagen-4.0-fast-generate-001",
        instances: [{ prompt: "hi" }],
        parameters: { sampleImageSize: "2K" as never },
      }),
      "unsupported_param",
    );
    expect(issue.path).toEqual(["parameters", "sampleImageSize"]);
    expect(issue.meta?.["source"]).toBe(IMAGEN_DOCS_URL);
  });

  test("sampleImageSize passes on Standard and Ultra, and 4K is rejected", () => {
    expectOk(
      generateImages.safe({
        model: "imagen-4.0-ultra-generate-001",
        instances: [{ prompt: "hi" }],
        parameters: { sampleImageSize: "2K" },
      }),
    );
    expectError(
      generateImages.safe({
        model: "imagen-4.0-generate-001",
        instances: [{ prompt: "hi" }],
        parameters: { sampleImageSize: "4K" as never },
      }),
      "invalid_enum_value",
    );
  });

  test.each(["negativePrompt", "seed", "addWatermark", "enhancePrompt", "storageUri"] as const)(
    "Vertex-only parameter %s is denied on the Gemini API",
    (param) => {
      const issue = expectError(
        generateImages.safe({
          model: "imagen-4.0-generate-001",
          instances: [{ prompt: "hi" }],
          parameters: { [param]: param === "seed" ? 1 : "x" } as never,
        }),
        "unsupported_param",
      );
      expect(issue.path).toEqual(["parameters", param]);
    },
  );
});

describe("prompt length", () => {
  test("a prompt beyond the documented 480-token cap reports over_context", () => {
    const issue = expectError(
      generateImages.safe({
        model: "imagen-4.0-generate-001",
        instances: [{ prompt: "word ".repeat(4000) }],
      }),
      "over_context",
    );
    expect(issue.path).toEqual(["instances", 0, "prompt"]);
    expect(issue.meta?.["limit"]).toBe(480);
  });
});

describe("cost estimation", () => {
  test("flat per-image rate times sampleCount", () => {
    const result = expectOk(
      generateImages.safe({
        model: "imagen-4.0-ultra-generate-001",
        instances: [{ prompt: "hi" }],
        parameters: { sampleCount: 2 },
      }),
    );
    expect(result.estimate.costUSD).toBeCloseTo(0.12, 10);
  });

  test("the worst case when sampleCount is omitted is the documented default of 4", () => {
    const result = expectOk(
      generateImages.safe({
        model: "imagen-4.0-fast-generate-001",
        instances: [{ prompt: "hi" }],
      }),
    );
    expect(IMAGEN_DEFAULT_SAMPLE_COUNT).toBe(4);
    expect(result.estimate.costUSD).toBeCloseTo(0.08, 10);
  });
});
