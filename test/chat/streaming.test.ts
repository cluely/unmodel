/**
 * `stream: true`, which is one flag in the vocabulary and two different things
 * on the wire.
 *
 * chat-completions and `/v1/messages` both stream by putting `stream: true` in
 * the body and posting to the same URL. Gemini does not have a streaming flag
 * at all — it has a *different method*, `:streamGenerateContent`, and sending
 * `stream` in a `generateContent` body is simply ignored.
 *
 * That asymmetry is handled in two halves, and this file exists because getting
 * either half wrong is silent: the encoder withholds `stream` from the IR when
 * the target is Gemini (so the decoder has nothing to drop and nothing to warn
 * about), and the compile step swaps in `endpoint.streamUrl`. A request that
 * carried the flag *and* got the streaming URL would still work; a request that
 * got a `dropped_param` warning for a flag it honoured perfectly would be a lie
 * in the audit trail, which is the contract `warnings` exists to keep.
 *
 * The `?alt=sse` suffix is load-bearing, not decoration: without it the method
 * returns a JSON array of chunks rather than an SSE stream.
 */
import { describe, expect, test } from "bun:test";

import { chat } from "../../src/chat/index";

const MESSAGES = [{ role: "user" as const, content: "Count to three." }];

describe("in-body streaming", () => {
  test("openai-chat carries `stream: true` and keeps its URL", () => {
    const plain = chat({ model: "openai/gpt-5.2", messages: MESSAGES });
    const streamed = chat({ model: "openai/gpt-5.2", messages: MESSAGES, stream: true });

    expect(streamed.stream).toBe(true);
    // `plain.stream` is no longer readable, and that is the assertion: the
    // result type carries the key if and only if the caller wrote it, which is
    // what the encoder has always done. Reading it through a cast keeps the
    // runtime half pinned — the body must not have grown a `stream: undefined`.
    expect("stream" in (plain as object)).toBe(false);
    expect((plain as { stream?: unknown }).stream).toBeUndefined();
    expect(streamed.request.url).toBe(plain.request.url);
    expect(streamed.request.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(streamed.warnings).toEqual([]);
  });

  test("anthropic-messages carries `stream: true` and keeps its URL", () => {
    const streamed = chat({
      model: "anthropic/claude-opus-5",
      messages: MESSAGES,
      maxOutputTokens: 64,
      stream: true,
    });
    expect(streamed.stream).toBe(true);
    expect(streamed.request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(streamed.warnings).toEqual([]);
  });

  test("`stream: false` is carried too — it is a request, not an absence", () => {
    const result = chat({ model: "groq/llama-3.1-8b-instant", messages: MESSAGES, stream: false });
    expect(result.stream).toBe(false);
    expect(result.warnings).toEqual([]);
  });
});

describe("gemini streams by method, not by flag", () => {
  test("the URL becomes :streamGenerateContent?alt=sse", () => {
    const result = chat({
      model: "google/gemini-2.5-flash",
      messages: MESSAGES,
      stream: true,
    });
    expect(result.request.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
    );
    expect(result.request.url.endsWith(":streamGenerateContent?alt=sse")).toBe(true);
  });

  test("the body carries no `stream` key at all", () => {
    const result = chat({
      model: "google/gemini-2.5-flash",
      messages: MESSAGES,
      stream: true,
    });
    const wire = { ...(result as object) } as Record<string, unknown>;
    expect(Object.keys(wire)).not.toContain("stream");
    expect(JSON.stringify(result)).not.toContain("stream");
    // Belt and braces: not nested inside generationConfig either.
    expect(wire["generationConfig"]).toBeUndefined();
  });

  test("and zero stream-related warnings — nothing was lost", () => {
    const result = chat({
      model: "google/gemini-2.5-flash",
      messages: MESSAGES,
      stream: true,
    });
    expect(result.warnings).toEqual([]);
  });

  test("without `stream` it is the plain :generateContent method", () => {
    const result = chat({ model: "google/gemini-2.5-flash", messages: MESSAGES });
    expect(result.request.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
  });

  test("`stream: false` also stays on the non-streaming method", () => {
    const result = chat({
      model: "google/gemini-2.5-flash",
      messages: MESSAGES,
      stream: false,
    });
    expect(result.request.url).toContain(":generateContent");
    expect(result.request.url).not.toContain("streamGenerateContent");
    expect(result.warnings).toEqual([]);
  });

  /**
   * There is exactly one authority on which model a request addresses: the
   * provider validator. `providerOptions.google.model` is a supported (if
   * warning-only) override, and re-deriving the streaming URL from the model
   * *ref* instead would validate against one model and send to another — with
   * no error, because both URLs are well-formed. So the streaming route is
   * built by rewriting the method segment of the URL the validator itself
   * produced.
   */
  test("the streaming URL is derived from the validator's URL, not re-derived from the ref", () => {
    const overridden = {
      model: "google/gemini-2.5-flash" as const,
      messages: MESSAGES,
      providerOptions: { google: { model: "models/gemini-2.0-flash" } },
    };
    const plain = chat.safe(overridden);
    const streamed = chat.safe({ ...overridden, stream: true });
    expect(plain.ok && streamed.ok).toBe(true);
    if (!plain.ok || !streamed.ok) return;

    expect(plain.params.request.url).toContain("models/gemini-2.0-flash:generateContent");
    expect(streamed.params.request.url).toBe(
      plain.params.request.url.replace(":generateContent", ":streamGenerateContent?alt=sse"),
    );
    // Both were checked against the same model, so both name it identically.
    expect(streamed.warnings.map((w) => w.code)).toEqual(plain.warnings.map((w) => w.code));
  });

  test("re-routing rebuilds the result rather than writing into the substrate's", () => {
    // `.request` is non-writable by construction. A compiler that reached in
    // and mutated it would work today and break the day the substrate freezes
    // its own result — and would be invisible to tsc either way, since the
    // write can only be spelled through a cast.
    const streamed = chat({ model: "google/gemini-2.5-flash", messages: MESSAGES, stream: true });
    const descriptor = Object.getOwnPropertyDescriptor(streamed, "request");
    expect(descriptor?.enumerable).toBe(false);
    expect(descriptor?.writable).toBe(false);
    expect(descriptor?.configurable).toBe(false);

    // The provider's own surface survives the rebuild intact.
    expect(typeof streamed.toSdk).toBe("function");
    expect(streamed.toSdk("google").model).toBe("gemini-2.5-flash");
    expect(streamed.modelId).toBe("gemini-2.5-flash");
    expect(streamed.target).toBe("google");
  });
});
