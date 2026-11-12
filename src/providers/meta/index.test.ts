import { describe, expect, test } from "bun:test";
import { chat, chatModels, checkChat, CHAT_COMPLETIONS_URL, models } from "./index";

describe("unmodel/meta", () => {
  test("chat URL is the documented OpenAI-compatible endpoint", () => {
    expect(CHAT_COMPLETIONS_URL).toBe("https://api.meta.ai/v1/chat/completions");
  });

  test("a catalog model validates ok and the result is wire-pure", () => {
    const params = {
      model: "muse-spark-1.2" as const,
      messages: [{ role: "user" as const, content: "hi" }],
    };
    const r = chat.safe(params);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(Object.keys(r.params)).toEqual(["model", "messages"]);
      expect(JSON.parse(JSON.stringify(r.params))).toEqual(params);
      expect(r.params.request.url).toBe(CHAT_COMPLETIONS_URL);
      expect(r.params.request.method).toBe("POST");
    }
  });

  test("unknown model warns and names the meta catalog", () => {
    const r = chat.safe({
      model: "muse-nova-9",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
      expect(r.warnings[0]?.message).toContain("meta");
    }
  });

  test("checkChat maps usage from a minimal response", () => {
    const report = checkChat({
      model: "muse-spark-1.2",
      choices: [{ finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(report.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(report.finishReason).toBe("stop");
    expect(report.warnings).toEqual([]);
  });
});

// Rates per 1M tokens (input / output), https://dev.meta.ai/docs/pricing-rate-limits
// (checked 2026-11-12): Muse Spark "Standard mode" $1.25 / $4.25 and "Contributor
// mode" $0.10 / $0.20; Muse Ember "Up to 200K input tokens" $0.10 / $0.50; Muse
// Wonder "Standard mode" $4.00 / $20.00.
describe("meta.chat — Muse Spark 1.3, Muse Ember and Muse Wonder", () => {
  const rates = [
    ["muse-spark-1.3", 1.25, 4.25],
    ["muse-spark-1.3-contributor", 0.1, 0.2],
    ["muse-ember-1.0", 0.1, 0.5],
    ["muse-wonder-1.0", 4, 20],
  ] as const;

  for (const [model, input, output] of rates) {
    test(`${model} validates clean and prices at its published rates`, () => {
      // "hello world!" = 3 heuristic tokens + 4 message overhead = 7.
      const r = chat.safe({
        model,
        messages: [{ role: "user", content: "hello world!" }],
        max_completion_tokens: 100,
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.warnings).toEqual([]);
        expect(r.estimate.inputTokens).toBe(7);
        expect(r.estimate.costUSD).toBeCloseTo((7 * input + 100 * output) / 1e6, 12);
      }
    });
  }

  test("muse-ember-1.0 takes its documented 524,288-token output budget", () => {
    // "Max output: 524,288 tokens" — https://dev.meta.ai/docs/muse-ember
    const model = "muse-ember-1.0";
    expect(chat.safe({ model, messages: hi, max_completion_tokens: 524_288 }).ok).toBe(true);
    const over = chat.safe({ model, messages: hi, max_completion_tokens: 524_289 });
    expect(codes(over)).toEqual(["over_output_limit"]);
  });
});

describe("meta.chat — endpoint-wide HTTP 400s", () => {
  const model = "muse-spark-1.3";

  test('reasoning_effort "max" passes; "none" is refused (every Muse model reasons)', () => {
    const ember = chat.safe({ model: "muse-ember-1.0", messages: hi, reasoning_effort: "max" });
    expect(ember.ok).toBe(true);
    expect(chat.safe({ model, messages: hi, reasoning_effort: "xhigh" }).ok).toBe(true);
    const r = chat.safe({ model, messages: hi, reasoning_effort: "none" });
    expect(codes(r)).toEqual(["invalid_enum_value"]);
    expect(firstError(r)?.path).toEqual(["reasoning_effort"]);
  });

  test('tool_choice accepts only "auto"', () => {
    const tools = [fn("get_weather")];
    expect(chat.safe({ model, messages: hi, tools, tool_choice: "auto" }).ok).toBe(true);
    const required = chat.safe({ model, messages: hi, tools, tool_choice: "required" });
    expect(codes(required)).toEqual(["invalid_enum_value"]);
    const named = chat.safe({
      model,
      messages: hi,
      tools,
      tool_choice: { type: "function", function: { name: "get_weather" } },
    });
    expect(codes(named)).toEqual(["invalid_enum_value"]);
  });

  test("n accepts only 1", () => {
    expect(chat.safe({ model, messages: hi, n: 1 }).ok).toBe(true);
    expect(codes(chat.safe({ model, messages: hi, n: 2 }))).toEqual(["invalid_enum_value"]);
  });

  test("the protocol page's unsupported-parameter table is refused; null stays unset", () => {
    const denied = {
      stop: ["END"],
      logit_bias: { "1234": -100 },
      prediction: { type: "content", content: "x" },
      verbosity: "low",
      web_search_options: {},
      modalities: ["text"],
      audio: { voice: "alloy", format: "mp3" },
      max_output_tokens: 1024,
    };
    for (const [param, value] of Object.entries(denied)) {
      // Half of these are outside the shared dialect's type: built untyped on purpose.
      const r = chat.safe({ model, messages: hi, [param]: value } as never);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors.map((e) => [e.code, e.path])).toEqual([["unsupported_param", [param]]]);
        expect(r.errors[0]?.meta?.source).toContain("dev.meta.ai/docs/protocols/chat-completions");
      }
    }
    expect(chat.safe({ model, messages: hi, stop: null }).ok).toBe(true);
  });

  test("logprobs: false passes; logprobs: true is refused", () => {
    expect(chat.safe({ model, messages: hi, logprobs: false }).ok).toBe(true);
    const r = chat.safe({ model, messages: hi, logprobs: true });
    expect(codes(r)).toEqual(["unsupported_param"]);
    expect(firstError(r)?.path).toEqual(["logprobs"]);
  });

  test("text.format (a Responses API param) is refused; other text keys only warn", () => {
    const r = chat.safe({ model, messages: hi, text: { format: { type: "text" } } } as never);
    expect(codes(r)).toEqual(["unsupported_param"]);
    expect(firstError(r)?.path).toEqual(["text", "format"]);
    const other = chat.safe({ model, messages: hi, text: {} } as never);
    expect(other.ok).toBe(true);
    if (other.ok) expect(other.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });

  test("custom tools are refused; function tools pass", () => {
    expect(chat.safe({ model, messages: hi, tools: [fn("lookup")] }).ok).toBe(true);
    const r = chat.safe({
      model,
      messages: hi,
      tools: [{ type: "custom", custom: { name: "patch" } }],
    });
    expect(codes(r)).toEqual(["unsupported_param"]);
    expect(firstError(r)?.path).toEqual(["tools", 0]);
  });

  test("function names allow one dot; two dots or other characters are refused", () => {
    expect(chat.safe({ model, messages: hi, tools: [fn("crm.lookup-v2_x")] }).ok).toBe(true);
    for (const name of ["crm.users.lookup", "get weather"]) {
      const r = chat.safe({ model, messages: hi, tools: [fn(name)] });
      expect(codes(r)).toEqual(["invalid_shape"]);
      expect(firstError(r)?.path).toEqual(["tools", 0, "function", "name"]);
    }
  });

  test("temperature must be within 0–2 and top_p within (0, 1]", () => {
    expect(chat.safe({ model, messages: hi, temperature: 2, top_p: 1 }).ok).toBe(true);
    expect(chat.safe({ model, messages: hi, temperature: 0 }).ok).toBe(true);
    expect(codes(chat.safe({ model, messages: hi, temperature: 2.1 }))).toEqual(["invalid_shape"]);
    const r = chat.safe({ model, messages: hi, top_p: 0 });
    expect(codes(r)).toEqual(["invalid_shape"]);
    expect(firstError(r)?.path).toEqual(["top_p"]);
  });

  test("50 images pass; a 51st is refused", () => {
    expect(chat.safe({ model, messages: images(50) }).ok).toBe(true);
    const r = chat.safe({ model, messages: images(51) });
    expect(codes(r)).toEqual(["invalid_shape"]);
    expect(firstError(r)?.meta?.limit).toBe(50);
  });
});

// "All take text, image, video, audio, and PDF input, return text, and have a
// 1,048,576-token context window." — https://dev.meta.ai/docs/muse-spark
// (checked 2026-11-12), said of every Spark version, 1.1 included.
describe("meta.chat — muse-spark-1.1 audio input", () => {
  test("an input_audio part validates on muse-spark-1.1", () => {
    const r = chat.safe({
      model: "muse-spark-1.1",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe this." },
            { type: "input_audio", input_audio: { data: "UklGRiQAAABXQVZF", format: "wav" } },
          ],
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test("chatModels states the correction; models stays the generated row", () => {
    expect(chatModels["muse-spark-1.1"].modalities.input).toContain("audio");
    // Fails once models.dev lists audio for 1.1 — then delete the correction in ./index.ts.
    expect(models["muse-spark-1.1"].modalities.input).not.toContain("audio");
    expect(chatModels["muse-spark-1.2"]).toBe(models["muse-spark-1.2"]);
  });
});

const hi = [{ role: "user" as const, content: "hi" }];

function fn(name: string) {
  return { type: "function" as const, function: { name, parameters: { type: "object" } } };
}

function images(count: number) {
  const content = Array.from({ length: count }, (_, i) => ({
    type: "image_url" as const,
    image_url: { url: `https://example.com/${i}.png` },
  }));
  return [{ role: "user" as const, content }];
}

function codes(r: ReturnType<typeof chat.safe>): string[] {
  return r.ok ? [] : r.errors.map((e) => e.code);
}

function firstError(r: ReturnType<typeof chat.safe>) {
  return r.ok ? undefined : r.errors[0];
}
