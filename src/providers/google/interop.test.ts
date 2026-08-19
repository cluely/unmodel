import { describe, expect, test } from "bun:test";

import type { ChatIR, DecodeContext } from "../../core/translate/ir";
import type { TranslationWarning } from "../../core/translate/warnings";
import { createWarningSink } from "../../core/translate/warnings";
import { SYNTHESIZED_ID_PREFIX, decodeGemini, encodeGemini } from "./interop";
import type { GenerateContentBody } from "./wire";

/**
 * The Gemini-only surface, and above all the synthesized tool-call ids: the
 * one place where a codec invents data the wire did not carry, so its
 * determinism and its round-trip behaviour are pinned here.
 */

function encode(body: GenerateContentBody): { ir: ChatIR; warnings: TranslationWarning[] } {
  const sink = createWarningSink("google.chat", "x");
  return { ir: encodeGemini(body, sink.warn), warnings: sink.warnings };
}

function decode(ir: ChatIR, ctx?: DecodeContext): {
  body: Omit<GenerateContentBody, "model">;
  warnings: TranslationWarning[];
} {
  const sink = createWarningSink("x", "google.chat");
  return { body: decodeGemini(ir, sink.warn, ctx), warnings: sink.warnings };
}

const HI: GenerateContentBody = {
  model: "gemini-2.5-flash",
  contents: [{ role: "user", parts: [{ text: "hi" }] }],
};

describe("tool-call ids", () => {
  const twoCalls: GenerateContentBody = {
    ...HI,
    contents: [
      { role: "user", parts: [{ text: "weather?" }] },
      {
        role: "model",
        parts: [
          { functionCall: { name: "w", args: { city: "Paris" } } },
          { functionCall: { name: "w", args: { city: "Rome" } } },
        ],
      },
      {
        role: "user",
        parts: [
          { functionResponse: { name: "w", response: { result: "18C" } } },
          { functionResponse: { name: "w", response: { result: "24C" } } },
        ],
      },
    ],
  };

  test("are synthesized deterministically from the message and part index", () => {
    const first = encode(twoCalls).ir;
    const second = encode(twoCalls).ir;

    expect(first.messages[1]?.content.map((p) => (p as { id: string }).id)).toEqual([
      `${SYNTHESIZED_ID_PREFIX}1_0`,
      `${SYNTHESIZED_ID_PREFIX}1_1`,
    ]);
    expect(second).toEqual(first);
  });

  test("pair each response to its call by name and order", () => {
    const { ir } = encode(twoCalls);

    expect(ir.messages[2]?.content).toEqual([
      { type: "tool-result", id: `${SYNTHESIZED_ID_PREFIX}1_0`, name: "w", output: { kind: "text", text: "18C" } },
      { type: "tool-result", id: `${SYNTHESIZED_ID_PREFIX}1_1`, name: "w", output: { kind: "text", text: "24C" } },
    ]);
  });

  test("are reported once per call, because the id is invented data", () => {
    const { warnings } = encode(twoCalls);

    expect(warnings.map((w) => ({ code: w.code, path: w.path }))).toEqual([
      { code: "synthesized_tool_call_id", path: ["contents", 1, "parts", 0] },
      { code: "synthesized_tool_call_id", path: ["contents", 1, "parts", 1] },
    ]);
  });

  test("never leak back onto the Gemini wire, while a real id is written through", () => {
    const synthesized = decode(encode(twoCalls).ir);
    expect(synthesized.body.contents[1]?.parts[0]?.functionCall).toEqual({
      name: "w",
      args: { city: "Paris" },
    });

    const fromAnthropic = decode({
      source: "anthropic-messages",
      model: "claude-opus-5",
      messages: [
        { role: "assistant", content: [{ type: "tool-call", id: "toolu_1", name: "w", input: {} }] },
      ],
      settings: {},
    });
    expect(fromAnthropic.body.contents[0]?.parts[0]?.functionCall).toEqual({
      id: "toolu_1",
      name: "w",
      args: {},
    });
  });
});

describe("tool results", () => {
  test("the single-key `result` wrapper is the canonical text form", () => {
    const { ir } = encode({
      ...HI,
      contents: [
        { role: "user", parts: [{ functionResponse: { name: "w", response: { result: "18C" } } }] },
      ],
    });

    expect(ir.messages[0]?.content[0]).toMatchObject({ output: { kind: "text", text: "18C" } });
    expect(decode(ir).body.contents[0]?.parts[0]?.functionResponse?.response).toEqual({ result: "18C" });
  });

  test("a richer object stays JSON, untouched", () => {
    const response = { temp: 18, unit: "C" };
    const { ir } = encode({
      ...HI,
      contents: [{ role: "user", parts: [{ functionResponse: { name: "w", response } }] }],
    });

    expect(ir.messages[0]?.content[0]).toMatchObject({ output: { kind: "json", value: response } });
    expect(decode(ir).body.contents[0]?.parts[0]?.functionResponse?.response).toEqual(response);
  });

  test("a failed tool result becomes `{ error }`, and the approximation is named", () => {
    const { body, warnings } = decode({
      source: "anthropic-messages",
      model: "claude-opus-5",
      messages: [
        {
          role: "user",
          content: [
            { type: "tool-result", id: "t1", name: "w", output: { kind: "text", text: "503" }, isError: true },
          ],
        },
      ],
      settings: {},
    });

    expect(body.contents[0]?.parts[0]?.functionResponse?.response).toEqual({ error: "503" });
    expect(warnings.map((w) => w.code)).toEqual(["approximated_param"]);
  });
});

describe("content", () => {
  test("thought parts are reasoning, not text", () => {
    const { ir } = encode({
      ...HI,
      contents: [
        {
          role: "model",
          parts: [{ text: "step 1…", thought: true, thoughtSignature: "sig" }, { text: "42" }],
        },
      ],
    });

    expect(ir.messages[0]?.content).toEqual([
      { type: "reasoning", text: "step 1…", signature: "sig" },
      { type: "text", text: "42" },
    ]);
  });

  test("server-side tool-loop parts are dropped by kind", () => {
    const { ir, warnings } = encode({
      ...HI,
      contents: [{ role: "model", parts: [{ executableCode: { language: "python", code: "1+1" } }] }],
    });

    expect(ir.messages[0]?.content).toEqual([]);
    expect(warnings.map((w) => w.code)).toEqual(["dropped_content"]);
    expect(warnings[0]?.message).toContain("executableCode");
  });

  test("inline media without a MIME type is dropped rather than sent with an invented one", () => {
    const { body, warnings } = decode({
      source: "openai-chat",
      model: "x",
      messages: [{ role: "user", content: [{ type: "media", data: { kind: "base64", base64: "AAA" } }] }],
      settings: {},
    });

    expect(body.contents[0]?.parts).toEqual([]);
    expect(warnings.map((w) => w.code)).toEqual(["dropped_content"]);
  });

  test("a remote URL infers its MIME type, and says so when it cannot", () => {
    const inferred = decode({
      source: "openai-chat",
      model: "x",
      messages: [
        { role: "user", content: [{ type: "media", data: { kind: "url", url: "https://x.test/a.png" } }] },
      ],
      settings: {},
    });
    expect(inferred.body.contents[0]?.parts[0]?.fileData).toEqual({
      fileUri: "https://x.test/a.png",
      mimeType: "image/png",
    });
    // The MIME type was inferred, but the URL is still one Gemini cannot
    // fetch — see the un-fetchable-URL test below.
    expect(inferred.warnings.map((w) => w.code)).toEqual(["approximated_param"]);

    const bare = decode({
      source: "openai-chat",
      model: "x",
      messages: [
        { role: "user", content: [{ type: "media", data: { kind: "url", url: "https://x.test/asset" } }] },
      ],
      settings: {},
    });
    expect(bare.body.contents[0]?.parts[0]?.fileData).toEqual({ fileUri: "https://x.test/asset" });
    // Two independent costs: no MIME type, and an un-fetchable URL.
    expect(bare.warnings.map((w) => w.code)).toEqual(["approximated_param", "approximated_param"]);
  });
});

/**
 * `fileData.fileUri` is two things wearing one field name: a provider-scoped
 * Google handle (Files API / `gs://`), which the IR must model as
 * `kind: "file"` so foreign decoders drop it loudly, and a plain remote URL.
 * Getting this wrong leaks a credential-scoped URI into another provider's
 * body with `warnings.length === 0` — i.e. asserted lossless while broken.
 */
describe("file handles vs remote URLs", () => {
  const withFileUri = (fileUri: string, mimeType?: string): GenerateContentBody => ({
    ...HI,
    contents: [
      {
        role: "user",
        parts: [{ fileData: { fileUri, ...(mimeType !== undefined && { mimeType }) } }],
      },
    ],
  });

  test.each([
    ["https://generativelanguage.googleapis.com/v1beta/files/abc123"],
    ["gs://my-bucket/cat.png"],
  ])("%s encodes to a gemini-scoped file handle, not a generic URL", (fileUri) => {
    const { ir, warnings } = encode(withFileUri(fileUri, "image/png"));

    expect(ir.messages[0]?.content[0]).toEqual({
      type: "media",
      mediaType: "image/png",
      data: { kind: "file", dialect: "gemini", ref: fileUri },
    });
    expect(warnings).toEqual([]);
  });

  test.each([["https://example.com/cat.png"], ["https://www.youtube.com/watch?v=abc"]])(
    "%s stays a plain remote URL",
    (fileUri) => {
      const { ir } = encode(withFileUri(fileUri, "image/png"));
      expect(ir.messages[0]?.content[0]).toMatchObject({
        data: { kind: "url", url: fileUri },
      });
    },
  );

  test("a gemini handle round-trips through the IR losslessly", () => {
    const body = withFileUri("https://generativelanguage.googleapis.com/v1beta/files/abc123", "video/mp4");
    const { ir } = encode(body);
    const { body: back, warnings } = decode(ir);

    const { model: _model, ...expected } = body;
    expect(back).toEqual(expected);
    expect(warnings).toEqual([]);
  });

  test("a foreign dialect's file handle is dropped with a named warning", () => {
    const { body, warnings } = decode({
      source: "anthropic-messages",
      model: "x",
      messages: [
        {
          role: "user",
          content: [
            { type: "media", data: { kind: "file", dialect: "anthropic-messages", ref: "file_abc" } },
          ],
        },
      ],
      settings: {},
    });

    expect(body.contents[0]?.parts).toEqual([]);
    expect(warnings.map((w) => w.code)).toEqual(["dropped_content"]);
    expect(warnings[0]?.meta).toEqual({ ref: "file_abc", dialect: "anthropic-messages" });
  });

  test.each([
    ["https://generativelanguage.googleapis.com/v1beta/files/abc123"],
    ["gs://my-bucket/cat.png"],
    ["https://youtu.be/abc"],
  ])("%s is written into fileData without a fetchability warning", (url) => {
    const { warnings } = decode({
      source: "openai-chat",
      model: "x",
      messages: [
        { role: "user", content: [{ type: "media", mediaType: "image/png", data: { kind: "url", url } }] },
      ],
      settings: {},
    });
    expect(warnings).toEqual([]);
  });

  test("a non-Google http(s) URL warns — Gemini cannot fetch it", () => {
    const { body, warnings } = decode({
      source: "openai-chat",
      model: "x",
      messages: [
        {
          role: "user",
          content: [
            { type: "media", mediaType: "image/png", data: { kind: "url", url: "https://example.com/cat.png" } },
          ],
        },
      ],
      settings: {},
    });

    expect(body.contents[0]?.parts[0]?.fileData).toEqual({
      fileUri: "https://example.com/cat.png",
      mimeType: "image/png",
    });
    expect(warnings.map((w) => w.code)).toEqual(["approximated_param"]);
    expect(warnings[0]?.message).toContain("Files API");
  });
});

describe("tool choice", () => {
  test("a single allowed function is a named choice", () => {
    const { ir, warnings } = encode({
      ...HI,
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["w"] } },
    });

    expect(ir.toolChoice).toEqual({ mode: "tool", name: "w" });
    expect(warnings).toEqual([]);
  });

  test("a subset wider than one is widened to `required`, and the widening is named", () => {
    const { ir, warnings } = encode({
      ...HI,
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["a", "b"] } },
    });

    expect(ir.toolChoice).toEqual({ mode: "required" });
    expect(warnings.map((w) => w.code)).toEqual(["approximated_param"]);
    expect(warnings[0]?.meta).toEqual({ allowed: ["a", "b"] });
  });
});

describe("settings", () => {
  test("streaming is a different URL on Gemini, not a body flag", () => {
    const { warnings } = decode({
      source: "openai-chat",
      model: "x",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      settings: { stream: true },
    });

    expect(warnings.map((w) => ({ code: w.code, path: w.path }))).toEqual([
      { code: "dropped_param", path: ["stream"] },
    ]);
    expect(warnings[0]?.message).toContain("streamGenerateContent");
  });

  test("a thinking budget of 0 is `off`, not a budget of zero tokens", () => {
    const { ir } = encode({ ...HI, generationConfig: { thinkingConfig: { thinkingBudget: 0 } } });
    expect(ir.settings.reasoning).toEqual({ mode: "off" });
    expect(decode(ir).body.generationConfig?.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  test("unmapped generationConfig fields ride in passthrough and come back", () => {
    const { ir } = encode({
      ...HI,
      generationConfig: { responseLogprobs: true, mediaResolution: "MEDIA_RESOLUTION_LOW" },
      safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }],
    });

    expect(decode(ir).body).toMatchObject({
      generationConfig: { responseLogprobs: true, mediaResolution: "MEDIA_RESOLUTION_LOW" },
      safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }],
    });
  });
});
