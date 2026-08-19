import { describe, expect, test } from "bun:test";
import { createAmazonBedrock, converseUrl, resolveBedrockModelInfo } from "./chat";
import type { ConverseParams, BedrockMessage } from "./chat";

// Real catalog ids used throughout:
//   amazon.nova-lite-v1:0    — text+image+video input, toolCall, 8192 output, $0.06/$0.24 per M
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
      modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
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
      inferenceConfig: { maxTokens: 10_000 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("over_output_limit");
      expect(result.errors[0]?.path).toEqual(["inferenceConfig", "maxTokens"]);
      expect(result.errors[0]?.meta).toEqual({ requested: 10_000, limit: 8192 });
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
