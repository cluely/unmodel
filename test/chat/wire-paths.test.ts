/**
 * Wire → unified issue-path translation, and the map it depends on.
 *
 * The flat per-dialect tables are exercised end to end everywhere else in
 * `test/chat`. What is pinned here is the one thing a table cannot express:
 * **structural** drift. `contents[i]` is not `messages[i]` the moment a system
 * message is present, because the encoder folds `system` out of the message
 * list entirely (and folds `tool` messages into the following user turn). A
 * remap that assumes the identity does not merely lose precision — it hands
 * the caller a confident address for a location that does not exist, which is
 * strictly worse than saying nothing.
 *
 * So the correspondence is *recorded by the encoder while it does the fold*
 * and read back here, rather than re-derived from a second copy of the rules.
 */
import { describe, expect, test } from "bun:test";

import { encodeChat } from "../../src/chat/encode";
import { createWarningSink } from "../../src/core/translate/warnings";
import { PROVIDER_OPTIONS_SUFFIX, unifiedPath } from "../../src/chat/wire-paths";

function encode(messages: Parameters<typeof encodeChat>[0]["messages"]) {
  const sink = createWarningSink("test", "google.chat");
  return encodeChat({ model: "google/gemini-2.5-flash", messages }, "gemini", sink.warn);
}

describe("the encoder records where each compiled message came from", () => {
  test("a leading system message shifts every index after it", () => {
    const { ir, messageOrigin } = encode([
      { role: "system", content: "be nice" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    // Three canonical messages, two compiled ones: `system` left the list.
    expect(ir.messages.length).toBe(2);
    expect(messageOrigin).toEqual([1, 2]);
  });

  test("a tool turn folded into the next user message keeps that user's index", () => {
    const { ir, messageOrigin } = encode([
      { role: "user", content: "call it" },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "t", input: {} }] },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "c1", toolName: "t", output: { type: "text", value: "42" } },
        ],
      },
      { role: "user", content: "thanks" },
    ]);
    expect(ir.messages.length).toBe(3);
    expect(messageOrigin).toEqual([0, 1, 3]);
  });

  test("a trailing tool turn has no canonical origin at all", () => {
    // Flushed into a user turn of its own: it is synthesised, so there is no
    // single message it can be addressed back to, and the map says so rather
    // than guessing.
    const { messageOrigin } = encode([
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "t", input: {} }] },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "c1", toolName: "t", output: { type: "text", value: "42" } },
        ],
      },
    ]);
    expect(messageOrigin).toEqual([0, undefined]);
  });
});

describe("unifiedPath on Gemini's contents container", () => {
  test("a message-level path is re-indexed through the recorded map", () => {
    expect(unifiedPath("gemini", ["contents", 0, "role"], [1, 2])).toEqual({
      path: ["messages", 1, "role"],
      unmapped: false,
    });
  });

  test("no recorded origin means the wire path, marked as a passthrough", () => {
    expect(unifiedPath("gemini", ["contents", 1, "role"], [0, undefined])).toEqual({
      path: ["contents", 1, "role"],
      unmapped: true,
    });
    expect(unifiedPath("gemini", ["contents", 0, "role"])).toEqual({
      path: ["contents", 0, "role"],
      unmapped: true,
    });
  });

  test("part-level paths are never re-addressed", () => {
    // The parts array is built by the codec, which drops and merges parts, so
    // `parts[j]` is not `content[j]`. Media findings never reach this table —
    // `media-paths.ts` re-addresses them by payload fingerprint first — so a
    // surviving part-level path came in through `providerOptions`, where the
    // wire spelling is the address to go and fix.
    expect(unifiedPath("gemini", ["contents", 0, "parts", 0, "inlineData"], [0])).toEqual({
      path: ["contents", 0, "parts", 0, "inlineData"],
      unmapped: true,
    });
  });

  test("the bare container still maps by name", () => {
    expect(unifiedPath("gemini", ["contents"], [0])).toEqual({
      path: ["messages"],
      unmapped: false,
    });
  });
});

describe("the unmapped suffix is the documented escape hatch", () => {
  test("it names providerOptions", () => {
    expect(PROVIDER_OPTIONS_SUFFIX).toContain("providerOptions");
  });
});
