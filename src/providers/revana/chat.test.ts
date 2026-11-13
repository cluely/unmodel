import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHAT_COMPLETIONS_URL, chat, checkChat, chatModels } from "./chat";
import { REVANA_CHAT_MODELS } from "./gen/ids.gen";
import type { ValidateResult } from "../../core/result";

const safe = chat.safe as unknown as (params: unknown) => ValidateResult<Record<string, unknown>>;
const codes = (result: ValidateResult<Record<string, unknown>>): string[] =>
  result.ok ? [] : result.errors.map((issue) => `${issue.code}@${issue.path.join(".")}`);

const MESSAGES = [{ role: "user", content: "Say ok" }];
const MODEL = "gpt-6-luna";

function fixture(name: string): { status: number; body: Record<string, unknown> } {
  return JSON.parse(readFileSync(join(import.meta.dir, "../../../test/fixtures/revana", name), "utf8"));
}

describe("revana.chat", () => {
  test("posts the OpenAI body to Revana's chat completions URL", () => {
    const params = chat({ model: "gpt-6-luna", messages: [{ role: "user", content: "Say ok" }], max_tokens: 5 });
    expect(CHAT_COMPLETIONS_URL).toBe("https://api.revana.si/v1/chat/completions");
    expect(params.request).toEqual({
      url: CHAT_COMPLETIONS_URL,
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(JSON.stringify(params))).toEqual({ model: MODEL, messages: MESSAGES, max_tokens: 5 });
  });

  test("its catalog is exactly the `kind: \"text\"` ids", () => {
    expect(Object.keys(chatModels).sort()).toEqual([...REVANA_CHAT_MODELS].sort());
  });

  test("function tools, JSON output and a reasoning effort all pass", () => {
    const result = safe({
      model: MODEL,
      messages: MESSAGES,
      tools: [{ type: "function", function: { name: "f", parameters: { type: "object", properties: {} } } }],
      response_format: { type: "json_object" },
      reasoning_effort: "low",
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(codes(result)).toEqual([]);
  });

  test("the three params the endpoint names and refuses", () => {
    expect(codes(safe({ model: MODEL, messages: MESSAGES, web_search_options: {} }))).toEqual(["unsupported_param@web_search_options"]);
    expect(codes(safe({ model: MODEL, messages: MESSAGES, prediction: { type: "content", content: "ok" } }))).toEqual([
      "unsupported_param@prediction",
    ]);
    expect(codes(safe({ model: MODEL, messages: MESSAGES, audio: { voice: "alloy", format: "wav" } }))).toEqual([
      "unsupported_param@audio",
    ]);
  });

  test("the refusal quotes the API's own sentence — the one recorded from it", () => {
    const recorded = fixture("chat.error.unsupported_parameter.json");
    const sentence = (recorded.body["error"] as { message: string }).message;
    const result = safe({ model: MODEL, messages: MESSAGES, web_search_options: {} });
    expect(recorded.status).toBe(400);
    expect(result.ok ? "" : result.errors[0]?.message).toContain(sentence);
  });

  test("only text output, and only function tools", () => {
    expect(codes(safe({ model: MODEL, messages: MESSAGES, modalities: ["text"] }))).toEqual([]);
    expect(codes(safe({ model: MODEL, messages: MESSAGES, modalities: ["text", "audio"] }))).toEqual(["unsupported_param@modalities"]);
    expect(codes(safe({ model: MODEL, messages: MESSAGES, tools: [{ type: "custom", custom: { name: "x" } }] }))).toEqual([
      "unsupported_param@tools.0.type",
    ]);
  });

  test("text and image parts are offered; audio and file parts are not", () => {
    const part = (content: unknown) => ({ model: MODEL, messages: [{ role: "user", content }] });
    expect(
      codes(safe(part([{ type: "text", text: "what is this" }, { type: "image_url", image_url: { url: "https://example.com/a.png" } }]))),
    ).toEqual([]);
    expect(safe(part([{ type: "input_audio", input_audio: { data: "AAAA", format: "wav" } }])).ok).toBe(false);
    expect(safe(part([{ type: "file", file: { file_id: "file-1" } }])).ok).toBe(false);
  });

  test("an unknown model is a warning: Revana adds language models weekly", () => {
    const result = safe({ model: "gpt-9", messages: MESSAGES });
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("unknown_model");
  });
});

describe("revana.checkChat", () => {
  const recorded = fixture("chat.completion.json").body;

  test("reads the recorded completion: finish reason and token usage", () => {
    const report = checkChat(recorded);
    expect(report.finishReason).toBe("stop");
    expect(report.usage.inputTokens).toBe(8);
    expect(report.usage.outputTokens).toBe(4);
    expect(report.warnings).toEqual([]);
  });

  test("`costUSD` is the charge the response states, not the catalog's base-rate estimate", () => {
    // gpt-6-luna lists $0.10 / $0.50 per million: 8 in + 4 out is $0.0000028
    // at those rates. Revana charged $0.000006, and says so on the response.
    expect(checkChat(recorded).costUSD).toBe(0.000006);
  });

  test("a response with no stated cost falls back to the catalog rates", () => {
    const { cost_usd: _, ...usage } = recorded["usage"] as Record<string, unknown>;
    expect(checkChat({ ...recorded, usage }).costUSD).toBeCloseTo(0.0000028, 10);
  });
});
