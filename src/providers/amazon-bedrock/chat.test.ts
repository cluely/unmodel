import { describe, expect, test } from "bun:test";
import { createAmazonBedrock, converseUrl, resolveBedrockModelInfo } from "./chat";
import type { ConverseParams, BedrockMessage } from "./chat";

// Real catalog ids used throughout:
//   amazon.nova-lite-v1:0    — text+image+video input, toolCall, 10000 output, $0.06/$0.24 per M
//   amazon.nova-micro-v1:0   — text-only input
//   google.gemma-3-12b-it    — toolCall: false
//   anthropic.claude-opus-4-6-v1 — catalog id WITHOUT the ":0" version suffix

const bedrock = createAmazonBedrock({ region: "us-east-1" });

const HI: BedrockMessage[] = [{ role: "user", content: [{ text: "hi" }] }];

function invalid(params: unknown) {
  return bedrock.chat.safe(params as ConverseParams);
}

/** Builds base64 bytes with a valid PNG header claiming the given dimensions. */
function pngBase64(width: number, height: number): string {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes[11] = 13; // IHDR chunk length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return Buffer.from(bytes).toString("base64");
}

describe("amazon-bedrock.chat happy path", () => {
  test("enumerable output is the exact wire body without modelId", () => {
    const validated = bedrock.chat({
      modelId: "amazon.nova-lite-v1:0",
      messages: HI,
      inferenceConfig: { maxTokens: 512 },
    });
    expect(Object.keys(validated).sort()).toEqual(["inferenceConfig", "messages"]);
    expect(JSON.parse(JSON.stringify(validated))).toEqual({
      messages: [{ role: "user", content: [{ text: "hi" }] }],
      inferenceConfig: { maxTokens: 512 },
    });
  });

  test("request meta carries the regioned, model-scoped URL", () => {
    const validated = bedrock.chat({ modelId: "amazon.nova-lite-v1:0", messages: HI });
    expect(validated.request.url).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/amazon.nova-lite-v1%3A0/converse",
    );
    expect(validated.request.method).toBe("POST");
    expect(validated.request.headers["content-type"]).toBe("application/json");
    // No auth material — SigV4 is the caller's job.
    expect(Object.keys(validated.request.headers)).toEqual(["content-type"]);
  });

  test("converseUrl percent-encodes the model path segment", () => {
    expect(converseUrl("eu-central-1", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")).toBe(
      "https://bedrock-runtime.eu-central-1.amazonaws.com/model/us.anthropic.claude-sonnet-4-5-20250929-v1%3A0/converse",
    );
  });

  test('toSdk("amazon-bedrock") returns ConverseCommandInput shape: { modelId, ...body }', () => {
    const validated = bedrock.chat({
      modelId: "amazon.nova-lite-v1:0",
      messages: HI,
      inferenceConfig: { temperature: 0.5 },
    });
    expect(validated.toSdk("amazon-bedrock")).toEqual({
      modelId: "amazon.nova-lite-v1:0",
      messages: [{ role: "user", content: [{ text: "hi" }] }],
      inferenceConfig: { temperature: 0.5 },
    });
  });

  test("toSdk names the available targets when handed an unknown one", () => {
    const validated = bedrock.chat({ modelId: "amazon.nova-lite-v1:0", messages: HI });
    expect(() => (validated.toSdk as (t: string) => unknown)("anthropic")).toThrow(
      /"anthropic" is not an SDK target for this endpoint\. Available: amazon-bedrock\./,
    );
  });

  test("converse declares no .toApi targets in v1 (every edge crosses dialects)", () => {
    const validated = bedrock.chat({ modelId: "amazon.nova-lite-v1:0", messages: HI });
    // `Avail` stays `never`, so `.toApi` does not exist as a type OR at
    // runtime — a missing method beats one that throws on every target.
    expect("toApi" in validated).toBe(false);
    expect("toApiSafe" in validated).toBe(false);
  });

  test("safe() succeeds with an estimate priced from catalog rates", () => {
    const result = bedrock.chat.safe({
      modelId: "amazon.nova-lite-v1:0",
      messages: HI,
      inferenceConfig: { maxTokens: 1000 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toEqual([]);
      expect(result.estimate.inputTokens).toBeGreaterThan(0);
      // ~5 input tokens at $0.06/M + 1000 output tokens at $0.24/M ≈ $0.00024
      expect(result.estimate.costUSD).toBeGreaterThan(0.0002);
      expect(result.estimate.costUSD).toBeLessThan(0.0004);
    }
  });

  test("over_budget fires via options.maxCostUSD", () => {
    const result = bedrock.chat.safe(
      {
        modelId: "amazon.nova-lite-v1:0",
        messages: HI,
        inferenceConfig: { maxTokens: 8000 },
      },
      { maxCostUSD: 0.000001 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("over_budget");
  });
});

describe("amazon-bedrock model resolution", () => {
  test("regional inference-profile ids hit the catalog directly", () => {
    const result = bedrock.chat.safe({
      modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      messages: HI,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  test('a ":0" version suffix resolves to the versionless catalog id', () => {
    expect(resolveBedrockModelInfo("anthropic.claude-opus-4-6-v1:0")?.id).toBe(
      "anthropic.claude-opus-4-6-v1",
    );
  });

  test("foundation-model ARNs resolve to their trailing model id", () => {
    expect(
      resolveBedrockModelInfo(
        "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0",
      )?.id,
    ).toBe("amazon.nova-lite-v1:0");
  });

  test("unknown model warns and names the amazon-bedrock catalog", () => {
    const result = bedrock.chat.safe({ modelId: "acme.frontier-v9:0", messages: HI });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(result.warnings[0]?.message).toContain("amazon-bedrock");
    }
  });
});

describe("amazon-bedrock.chat shape", () => {
  test("temperature above 1 is invalid_shape", () => {
    const result = invalid({
      modelId: "amazon.nova-lite-v1:0",
      messages: HI,
      inferenceConfig: { temperature: 1.5 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("invalid_shape");
      expect(result.errors[0]?.path).toEqual(["inferenceConfig", "temperature"]);
    }
  });

  test("empty toolConfig.tools is invalid_shape (min 1 item)", () => {
    const result = invalid({
      modelId: "amazon.nova-lite-v1:0",
      messages: HI,
      toolConfig: { tools: [] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.path).toEqual(["toolConfig", "tools"]);
  });

  test("a content block with two union members is invalid_shape", () => {
    const result = invalid({
      modelId: "amazon.nova-lite-v1:0",
      messages: [{ role: "user", content: [{ text: "hi", toolUse: { toolUseId: "x", name: "t", input: {} } }] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("invalid_shape");
      expect(result.errors[0]?.path).toEqual(["messages", 0, "content", 0]);
      expect(result.errors[0]?.message).toContain("union");
    }
  });

  test("an empty content block is invalid_shape", () => {
    const result = invalid({
      modelId: "amazon.nova-lite-v1:0",
      messages: [{ role: "user", content: [{}] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("invalid_shape");
  });

  test("toolChoice with two union members is invalid_shape", () => {
    const result = invalid({
      modelId: "amazon.nova-lite-v1:0",
      messages: HI,
      toolConfig: {
        tools: [{ toolSpec: { name: "t", inputSchema: { json: {} } } }],
        toolChoice: { auto: {}, any: {} },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.path).toEqual(["toolConfig", "toolChoice"]);
  });

  test("more than 10 additionalModelResponseFieldPaths is invalid_shape", () => {
    const result = invalid({
      modelId: "amazon.nova-lite-v1:0",
      messages: HI,
      additionalModelResponseFieldPaths: Array.from({ length: 11 }, (_, i) => `/f${i}`),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("invalid_shape");
  });

  test("unknown top-level keys warn as unknown_param", () => {
    const result = invalid({ modelId: "amazon.nova-lite-v1:0", messages: HI, max_tokens: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.map((w) => w.code)).toContain("unknown_param");
    }
  });
});

describe("amazon-bedrock.chat capabilities", () => {
  test("toolConfig on a toolCall-less model is unsupported_capability", () => {
    const result = bedrock.chat.safe({
      modelId: "google.gemma-3-12b-it",
      messages: HI,
      toolConfig: { tools: [{ toolSpec: { name: "t", inputSchema: { json: {} } } }] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("unsupported_capability");
      expect(result.errors[0]?.path).toEqual(["toolConfig"]);
    }
  });

  test("maxTokens above the model's output limit is over_output_limit", () => {
    const result = bedrock.chat.safe({
      modelId: "amazon.nova-lite-v1:0",
      messages: HI,
      inferenceConfig: { maxTokens: 10_001 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("over_output_limit");
      expect(result.errors[0]?.path).toEqual(["inferenceConfig", "maxTokens"]);
      expect(result.errors[0]?.meta).toEqual({ requested: 10_001, limit: 10_000 });
    }
  });

  test("image blocks on a text-only model are unsupported_capability", () => {
    const result = bedrock.chat.safe({
      modelId: "amazon.nova-micro-v1:0",
      messages: [
        {
          role: "user",
          content: [
            { image: { format: "png", source: { bytes: pngBase64(8, 8) } } },
            { text: "describe" },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("unsupported_capability");
      expect(result.errors[0]?.path).toEqual(["messages", 0, "content", 0, "image"]);
    }
  });

  test("video blocks nested in toolResult content are modality-checked too", () => {
    const result = bedrock.chat.safe({
      modelId: "amazon.nova-micro-v1:0",
      messages: [
        { role: "user", content: [{ text: "run the tool" }] },
        {
          role: "assistant",
          content: [{ toolUse: { toolUseId: "t1", name: "clip", input: {} } }],
        },
        {
          role: "user",
          content: [
            {
              toolResult: {
                toolUseId: "t1",
                content: [{ video: { format: "mp4", source: { s3Location: { uri: "s3://bucket/v.mp4" } } } }],
              },
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("unsupported_capability");
      expect(result.errors[0]?.path).toEqual([
        "messages", 2, "content", 0, "toolResult", "content", 0, "video",
      ]);
    }
  });
});

describe("amazon-bedrock.chat 2026-11 models", () => {
  const TOOLS = [{ toolSpec: { name: "t", inputSchema: { json: {} } } }];

  // [catalog id, input $/M, output $/M] — the generated rates; geo profiles
  // carry the 10% regional premium over the global row.
  test.each([
    ["global.anthropic.claude-fable-5-2", 8, 40],
    ["us.anthropic.claude-opus-5-5", 4.4, 22],
    ["eu.anthropic.claude-sonnet-5-5", 2.2, 11],
    ["global.anthropic.claude-haiku-5-5", 0.1, 0.5],
    ["us.xai.grok-4.7", 2.2, 6.6],
    ["global.openai.gpt-6-sol", 2, 10],
  ] as const)("%s validates and prices from its catalog row", (modelId, input, output) => {
    const result = bedrock.chat.safe({ modelId, messages: HI, inferenceConfig: { maxTokens: 1000 } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toEqual([]);
      const expected = ((result.estimate.inputTokens ?? 0) * input + 1000 * output) / 1_000_000;
      expect(result.estimate.costUSD).toBeCloseTo(expected, 10);
    }
  });

  test("forced toolChoice `any` on Opus 5.5 is unsupported_param, sourced to its model card", () => {
    const result = bedrock.chat.safe({
      modelId: "us.anthropic.claude-opus-5-5",
      messages: HI,
      toolConfig: { tools: TOOLS, toolChoice: { any: {} } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("unsupported_param");
      expect(result.errors[0]?.path).toEqual(["toolConfig", "toolChoice"]);
      expect(result.errors[0]?.message).toContain("toolChoice: { auto: {} }");
      expect(result.errors[0]?.meta?.source).toContain("model-card-anthropic-claude-opus-5-5");
    }
  });

  test("forced toolChoice `tool` on Sonnet 5.5 is refused for the bare id and a profile ARN", () => {
    for (const modelId of [
      "anthropic.claude-sonnet-5-5",
      "arn:aws:bedrock:us-east-1:123456789012:inference-profile/global.anthropic.claude-sonnet-5-5",
    ]) {
      const result = bedrock.chat.safe({
        modelId,
        messages: HI,
        toolConfig: { tools: TOOLS, toolChoice: { tool: { name: "t" } } },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]?.code).toBe("unsupported_param");
        expect(result.errors[0]?.meta).toEqual({
          toolChoice: "tool",
          source: expect.stringContaining("model-card-anthropic-claude-sonnet-5-5"),
        });
      }
    }
  });

  test("automatic toolChoice on Opus 5.5, and forced choice on Opus 5, are accepted", () => {
    const auto = bedrock.chat.safe({
      modelId: "global.anthropic.claude-opus-5-5",
      messages: HI,
      toolConfig: { tools: TOOLS, toolChoice: { auto: {} } },
    });
    expect(auto.ok).toBe(true);
    const sibling = bedrock.chat.safe({
      modelId: "global.anthropic.claude-opus-5",
      messages: HI,
      toolConfig: { tools: TOOLS, toolChoice: { any: {} } },
    });
    expect(sibling.ok).toBe(true);
  });

  test("forced toolChoice on Fable 5.2 and 5.1 is refused, sourced to Bedrock's forced-tool-use section", () => {
    for (const [modelId, toolChoice] of [
      ["global.anthropic.claude-fable-5-2", { any: {} }],
      ["us.anthropic.claude-fable-5-1", { tool: { name: "t" } }],
    ] as const) {
      const result = bedrock.chat.safe({ modelId, messages: HI, toolConfig: { tools: TOOLS, toolChoice } });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]?.code).toBe("unsupported_param");
        expect(result.errors[0]?.path).toEqual(["toolConfig", "toolChoice"]);
        expect(result.errors[0]?.message).not.toContain("model card");
        expect(result.errors[0]?.meta?.source).toContain("model-parameters-anthropic-claude-messages-tool-use");
      }
    }
  });

  test("automatic toolChoice on Fable 5.2, and forced choice on Fable 5, are accepted", () => {
    const auto = bedrock.chat.safe({
      modelId: "anthropic.claude-fable-5-2",
      messages: HI,
      toolConfig: { tools: TOOLS, toolChoice: { auto: {} } },
    });
    expect(auto.ok).toBe(true);
    const sibling = bedrock.chat.safe({
      modelId: "anthropic.claude-fable-5",
      messages: HI,
      toolConfig: { tools: TOOLS, toolChoice: { any: {} } },
    });
    expect(sibling.ok).toBe(true);
  });

  test("Haiku 5.5's estimate is withheld above its 100,000-token prompt tier", () => {
    const long: BedrockMessage[] = [{ role: "user", content: [{ text: "word ".repeat(120_000) }] }];
    const haiku = bedrock.chat.safe({ modelId: "global.anthropic.claude-haiku-5-5", messages: long });
    expect(haiku.ok).toBe(true);
    if (haiku.ok) {
      expect(haiku.estimate.inputTokens).toBeGreaterThan(100_000);
      expect(haiku.estimate.costUSD).toBeUndefined();
    }
    // A flat-priced model with the same prompt still prices.
    const sonnet = bedrock.chat.safe({ modelId: "global.anthropic.claude-sonnet-5-5", messages: long });
    expect(sonnet.ok && sonnet.estimate.costUSD).toBeGreaterThan(0);
  });

  test("GPT-6 Sol's estimate is withheld above its 272,000-token prompt tier", () => {
    const words = (n: number): BedrockMessage[] => [{ role: "user", content: [{ text: "word ".repeat(n) }] }];
    const above = bedrock.chat.safe({ modelId: "global.openai.gpt-6-sol", messages: words(230_000) });
    expect(above.ok).toBe(true);
    if (above.ok) {
      expect(above.estimate.inputTokens).toBeGreaterThan(272_000);
      expect(above.estimate.costUSD).toBeUndefined();
    }
    const below = bedrock.chat.safe({ modelId: "global.openai.gpt-6-sol", messages: words(150_000) });
    expect(below.ok).toBe(true);
    if (below.ok) {
      expect(below.estimate.inputTokens).toBeLessThan(272_000);
      expect(below.estimate.costUSD).toBeGreaterThan(0);
    }
  });
});

describe("amazon-bedrock.chat Fable 5.2 / 5.1 fixed sampling (Bedrock model cards, 2026-11-12)", () => {
  const FIXED = ["anthropic.claude-fable-5-2", "global.anthropic.claude-fable-5-2", "us.anthropic.claude-fable-5-1"];

  test.each(FIXED)("%s accepts unset sampling, temperature 1 alone, and topP 0.99 alone", (modelId) => {
    for (const inferenceConfig of [{}, { temperature: 1 }, { topP: 0.99 }]) {
      const result = bedrock.chat.safe({ modelId, messages: HI, inferenceConfig });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.warnings).toEqual([]);
    }
  });

  test.each(FIXED)("%s refuses temperature 0.5 and topP 0.5, sourced to its model card", (modelId) => {
    const card = modelId.endsWith("fable-5-1") ? "model-card-anthropic-claude-fable-5-1" : "model-card-anthropic-claude-fable-5-2";
    for (const [field, inferenceConfig] of [
      ["temperature", { temperature: 0.5 }],
      ["topP", { topP: 0.5 }],
    ] as const) {
      const result = bedrock.chat.safe({ modelId, messages: HI, inferenceConfig });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.map((e) => [e.code, e.path])).toEqual([["unsupported_param", ["inferenceConfig", field]]]);
        expect(result.errors[0]?.meta?.source).toContain(card);
      }
    }
  });

  test("topP above 0.99, and temperature with topP, warn but still validate", () => {
    const high = bedrock.chat.safe({
      modelId: "global.anthropic.claude-fable-5-2",
      messages: HI,
      inferenceConfig: { topP: 1 },
    });
    expect(high.ok).toBe(true);
    if (high.ok) {
      expect(high.warnings.map((w) => [w.code, w.path])).toEqual([["unsupported_param", ["inferenceConfig", "topP"]]]);
      expect(high.warnings[0]?.meta?.source).toContain("model-card-anthropic-claude-fable-5-2");
    }
    const both = bedrock.chat.safe({
      modelId: "us.anthropic.claude-fable-5-1",
      messages: HI,
      inferenceConfig: { temperature: 1, topP: 0.99 },
    });
    expect(both.ok).toBe(true);
    if (both.ok) expect(both.warnings.map((w) => [w.code, w.path])).toEqual([["unsupported_param", ["inferenceConfig"]]]);
  });

  test("Opus 5.5, whose card carries no sampling line, still accepts temperature 0.5", () => {
    const result = bedrock.chat.safe({
      modelId: "us.anthropic.claude-opus-5-5",
      messages: HI,
      inferenceConfig: { temperature: 0.5 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });
});

describe("amazon-bedrock.chat Grok 4.7 limits (Bedrock model card, 2026-11-12)", () => {
  const words = (n: number): BedrockMessage[] => [{ role: "user", content: [{ text: "word ".repeat(n) }] }];

  test.each(["us.xai.grok-4.7", "global.xai.grok-4.7"])(
    "%s takes the card's 524,288-token window, not the catalog's 500,000",
    (modelId) => {
      // ~510k estimated tokens: past the catalog's 500,000, inside the card's window.
      const fits = bedrock.chat.safe({ modelId, messages: words(408_000) });
      expect(fits.ok).toBe(true);
      if (fits.ok) expect(fits.estimate.inputTokens).toBeGreaterThan(500_000);

      const over = bedrock.chat.safe({ modelId, messages: words(425_000) });
      expect(over.ok).toBe(false);
      if (!over.ok) {
        expect(over.errors[0]?.code).toBe("over_context");
        expect(over.errors[0]?.meta?.limit).toBe(524_288);
      }

      const maxOutput = bedrock.chat.safe({ modelId, messages: HI, inferenceConfig: { maxTokens: 524_288 } });
      expect(maxOutput.ok).toBe(true);
      const overOutput = bedrock.chat.safe({ modelId, messages: HI, inferenceConfig: { maxTokens: 524_289 } });
      expect(overOutput.ok).toBe(false);
      if (!overOutput.ok) {
        expect(overOutput.errors[0]?.code).toBe("over_output_limit");
        expect(overOutput.errors[0]?.meta).toEqual({ requested: 524_289, limit: 524_288 });
      }
    },
  );

  test("Grok 4.6, whose card says 500K, keeps the catalog's 500,000 output limit", () => {
    const result = bedrock.chat.safe({
      modelId: "us.xai.grok-4.6",
      messages: HI,
      inferenceConfig: { maxTokens: 500_001 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.meta).toEqual({ requested: 500_001, limit: 500_000 });
  });
});

describe("amazon-bedrock.chat GPT-6 Converse content blocks (Bedrock model cards, 2026-11-12)", () => {
  const PNG = { image: { format: "png" as const, source: { bytes: pngBase64(8, 8) } } };
  const DOC = { document: { name: "report", format: "txt" as const, source: { text: "quarterly numbers" } } };

  /** A tool round trip whose result carries `block`. */
  function toolResultWith(block: object): BedrockMessage[] {
    return [
      { role: "user", content: [{ text: "run the tool" }] },
      { role: "assistant", content: [{ toolUse: { toolUseId: "t1", name: "fetch", input: {} } }] },
      { role: "user", content: [{ toolResult: { toolUseId: "t1", content: [block] } }] },
    ] as BedrockMessage[];
  }

  test("a top-level document block is unsupported_capability", () => {
    const result = bedrock.chat.safe({
      modelId: "us.openai.gpt-6-sol",
      messages: [{ role: "user", content: [DOC, { text: "summarize" }] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => [e.code, e.path])).toEqual([
        ["unsupported_capability", ["messages", 0, "content", 0, "document"]],
      ]);
      expect(result.errors[0]?.message).toContain("input_file");
      expect(result.errors[0]?.meta).toEqual({
        kind: "document",
        source: expect.stringContaining("model-card-openai-gpt-6-sol"),
      });
    }
  });

  test("an image or a document inside a toolResult is unsupported_capability", () => {
    for (const [modelId, block, kind] of [
      ["global.openai.gpt-6.1-terra", PNG, "image"],
      ["global.openai.gpt-6-luna", DOC, "document"],
    ] as const) {
      const result = bedrock.chat.safe({ modelId, messages: toolResultWith(block) });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.map((e) => [e.code, e.path])).toEqual([
          ["unsupported_capability", ["messages", 2, "content", 0, "toolResult", "content", 0, kind]],
        ]);
        expect(result.errors[0]?.meta?.kind).toBe(kind);
      }
    }
  });

  test("a top-level image still validates on GPT-6 Sol", () => {
    const result = bedrock.chat.safe({
      modelId: "global.openai.gpt-6-sol",
      messages: [{ role: "user", content: [PNG, { text: "describe" }] }],
    });
    expect(result.ok).toBe(true);
  });

  test("the same documents and toolResult images still validate on Opus 5.5", () => {
    for (const messages of [
      [{ role: "user", content: [DOC, { text: "summarize" }] }] as BedrockMessage[],
      toolResultWith(PNG),
      toolResultWith(DOC),
    ]) {
      const result = bedrock.chat.safe({ modelId: "us.anthropic.claude-opus-5-5", messages });
      expect(result.ok).toBe(true);
    }
  });
});

describe("amazon-bedrock.chat message content rules", () => {
  test("images in an assistant message are rejected (user-only rule)", () => {
    const result = bedrock.chat.safe({
      modelId: "amazon.nova-lite-v1:0",
      messages: [
        { role: "user", content: [{ text: "hi" }] },
        {
          role: "assistant",
          content: [{ image: { format: "png", source: { bytes: pngBase64(8, 8) } } }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("invalid_shape");
      expect(result.errors[0]?.message).toContain('"user"');
    }
  });

  test("more than 20 images in one message is rejected", () => {
    const image = { image: { format: "png" as const, source: { bytes: pngBase64(8, 8) } } };
    const result = bedrock.chat.safe({
      modelId: "amazon.nova-lite-v1:0",
      messages: [{ role: "user", content: [...Array.from({ length: 21 }, () => image), { text: "hi" }] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.errors.find((e) => e.meta?.limit === 20);
      expect(issue?.code).toBe("invalid_shape");
      expect(issue?.meta?.images).toBe(21);
    }
  });

  test("an image wider than 8000px is media_dimensions_exceeded", () => {
    const result = bedrock.chat.safe({
      modelId: "amazon.nova-lite-v1:0",
      messages: [
        {
          role: "user",
          content: [
            { image: { format: "png", source: { bytes: pngBase64(9000, 100) } } },
            { text: "describe" },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("media_dimensions_exceeded");
      expect(result.errors[0]?.meta?.maxWidth).toBe(8000);
    }
  });

  test("a document block without a text block is rejected", () => {
    const result = bedrock.chat.safe({
      modelId: "amazon.nova-lite-v1:0",
      messages: [
        {
          role: "user",
          content: [
            { document: { name: "report", format: "txt", source: { text: "quarterly numbers" } } },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("invalid_shape");
      expect(result.errors[0]?.message).toContain("text block");
    }
  });

  test("s3-hosted image checked via options.media declaration", () => {
    const result = bedrock.chat.safe(
      {
        modelId: "amazon.nova-lite-v1:0",
        messages: [
          {
            role: "user",
            content: [
              { image: { format: "png", source: { s3Location: { uri: "s3://bucket/img.png" } } } },
              { text: "describe" },
            ],
          },
        ],
      },
      { media: [{ path: ["messages", 0, "content", 0, "image"], bytes: 5_000_000 }] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("media_too_large");
  });
});

describe("amazon-bedrock.chat prompt resources", () => {
  test("inferenceConfig/system/toolConfig are rejected with a prompt ARN", () => {
    const result = bedrock.chat.safe({
      modelId: "arn:aws:bedrock:us-west-2:123456789012:prompt/PROMPT12345:1",
      promptVariables: { genre: { text: "pop" } },
      inferenceConfig: { maxTokens: 100 },
      system: [{ text: "be brief" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.errors.filter((e) => e.code === "unsupported_param").map((e) => e.path[0]);
      expect(paths.sort()).toEqual(["inferenceConfig", "system"]);
    }
  });
});
