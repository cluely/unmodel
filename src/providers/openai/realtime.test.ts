import { describe, expect, test } from "bun:test";
import { realtimeSession, REALTIME_CLIENT_SECRETS_URL } from "./realtime";
import { models } from "../../catalog/openai.gen";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

// Bypasses the compile-time surface so runtime enforcement can be exercised.
const safeUnchecked = realtimeSession.safe as unknown as (
  params: unknown,
  options?: ValidateOptions,
) => ValidateResult<Record<string, unknown>>;

describe("openai.realtimeSession happy path", () => {
  test("returns the wire-pure session object with hidden toSdk/request", () => {
    const params = {
      type: "realtime" as const,
      model: "gpt-realtime-2.1" as const,
      instructions: "You are a concise voice assistant.",
      output_modalities: ["audio" as const],
      audio: {
        input: {
          format: { type: "audio/pcm" as const, rate: 24000 as const },
          turn_detection: { type: "server_vad" as const, silence_duration_ms: 400 },
        },
        output: { voice: "marin" as const, speed: 1.1 },
      },
    };
    const v = realtimeSession(params);

    // Enumerable props are the session config object itself (NOT an HTTP
    // body): JSON.stringify({ session: v }) is the client_secrets payload.
    expect(Object.keys(v)).toEqual([
      "type",
      "model",
      "instructions",
      "output_modalities",
      "audio",
    ]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    expect(v.request.url).toBe(REALTIME_CLIENT_SECRETS_URL);
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
    // .toSdk("openai") wraps for client.realtime.clientSecrets.create({ session }).
    expect(v.toSdk("openai")).toEqual({ session: params });
  });

  test("gpt-realtime-2.1 is catalog-known: no warnings on a full config", () => {
    expect(models["gpt-realtime-2.1"]).toBeDefined();
    const r = realtimeSession.safe({
      type: "realtime",
      model: "gpt-realtime-2.1",
      max_output_tokens: "inf",
      tool_choice: "auto",
      tools: [
        { type: "function", name: "lookup", parameters: { type: "object" } },
        { type: "mcp", server_label: "docs", server_url: "https://mcp.example.com" },
      ],
      truncation: { type: "retention_ratio", retention_ratio: 0.8 },
      tracing: "auto",
      audio: {
        input: {
          noise_reduction: { type: "near_field" },
          transcription: { model: "gpt-4o-mini-transcribe", language: "en" },
          turn_detection: { type: "semantic_vad", eagerness: "low" },
        },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("explicit null means off for the nullable sub-configs", () => {
    const r = realtimeSession.safe({
      type: "realtime",
      audio: { input: { turn_detection: null, transcription: null, noise_reduction: null } },
      tracing: null,
      prompt: null,
    });
    expect(r.ok).toBe(true);
  });

  test("custom voices pass: unknown voice strings and { id } objects", () => {
    const asString = realtimeSession.safe({
      type: "realtime",
      audio: { output: { voice: "voice_1234" } },
    });
    expect(asString.ok).toBe(true);
    const asObject = realtimeSession.safe({
      type: "realtime",
      audio: { output: { voice: { id: "voice_1234" } } },
    });
    expect(asObject.ok).toBe(true);
  });

  test("documented ids missing from the catalog warn unknown_model", () => {
    const r = realtimeSession.safe({ type: "realtime", model: "gpt-realtime-mini" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("unknown top-level keys pass through with unknown_param", () => {
    const r = safeUnchecked({ type: "realtime", brand_new_param: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });
});

describe("openai.realtimeSession shape rules", () => {
  test('type must be the literal "realtime"', () => {
    const r = safeUnchecked({ type: "transcription" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("output speed outside 0.25-1.5 is invalid_shape", () => {
    const r = safeUnchecked({ type: "realtime", audio: { output: { speed: 2 } } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test('max_output_tokens takes 1-4096 or "inf"', () => {
    expect(realtimeSession.safe({ type: "realtime", max_output_tokens: 4096 }).ok).toBe(true);
    expect(realtimeSession.safe({ type: "realtime", max_output_tokens: "inf" }).ok).toBe(true);
    const over = safeUnchecked({ type: "realtime", max_output_tokens: 5000 });
    expect(over.ok).toBe(false);
  });

  test("unknown turn_detection type is invalid_shape", () => {
    const r = safeUnchecked({
      type: "realtime",
      audio: { input: { turn_detection: { type: "client_vad" } } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("semantic_vad eagerness enum is enforced by the schema", () => {
    const r = safeUnchecked({
      type: "realtime",
      audio: { input: { turn_detection: { type: "semantic_vad", eagerness: "max" } } },
    });
    expect(r.ok).toBe(false);
  });
});

describe("openai.realtimeSession pairing and capability checks", () => {
  test("output_modalities cannot request text and audio together", () => {
    const r = safeUnchecked({ type: "realtime", output_modalities: ["text", "audio"] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.code === "invalid_enum_value");
      expect(issue?.path).toEqual(["output_modalities"]);
      expect(issue?.message).toContain("cannot request both");
    }
  });

  test("single-modality arrays pass", () => {
    expect(realtimeSession.safe({ type: "realtime", output_modalities: ["text"] }).ok).toBe(true);
    expect(realtimeSession.safe({ type: "realtime", output_modalities: ["audio"] }).ok).toBe(true);
  });

  test("MCP tools require a server_url/connector_id/tunnel_id", () => {
    const r = realtimeSession.safe({
      type: "realtime",
      tools: [{ type: "mcp", server_label: "docs" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_shape");
      expect(r.errors[0]?.path).toEqual(["tools", 0]);
    }
  });

  test("MCP tools require a non-empty server_label", () => {
    const r = safeUnchecked({
      type: "realtime",
      tools: [{ type: "mcp", server_url: "https://mcp.example.com" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["tools", 0, "server_label"]);
  });

  test("connector_id satisfies the MCP location requirement", () => {
    const r = realtimeSession.safe({
      type: "realtime",
      tools: [{ type: "mcp", server_label: "gmail", connector_id: "connector_gmail" }],
    });
    expect(r.ok).toBe(true);
  });
});

describe("openai.realtimeSession estimation", () => {
  test("instructions and tool definitions drive inputTokens", () => {
    const r = realtimeSession.safe({
      type: "realtime",
      model: "gpt-realtime-2.1",
      instructions: "a".repeat(400),
      tools: [{ type: "function", name: "f", parameters: { type: "object" } }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 400 chars / 4 per token = 100, plus the tool definition estimate.
      expect(r.estimate.inputTokens).toBeGreaterThanOrEqual(100);
    }
  });

  test("instructions beyond the model context are over_context", () => {
    const context = models["gpt-realtime-2.1"].limit.context;
    expect(context).toBeGreaterThan(0);
    const r = realtimeSession.safe({
      type: "realtime",
      model: "gpt-realtime-2.1",
      // Heuristic ~4 chars/token; comfortably exceed the context window.
      instructions: "a".repeat(context * 5),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_context");
  });

  test("no cost estimate: audio usage is unknowable up front", () => {
    const r = realtimeSession.safe({
      type: "realtime",
      model: "gpt-realtime-2.1",
      instructions: "hi",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});
