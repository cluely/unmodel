import { describe, expect, test } from "bun:test";

import {
  attachWarnings,
  createWarningSink,
  formatTranslationWarnings,
  type TranslationWarning,
} from "./warnings";

describe("createWarningSink", () => {
  test("stamps the route onto every warning so codecs need not know it", () => {
    const sink = createWarningSink("anthropic.chat", "openrouter.chat");

    sink.push({ code: "dropped_param", path: ["thinking"], message: "no equivalent" });
    // A codec only ever supplies code/path/message — `Warn` does not accept
    // `from`/`to`, because the route is the engine's to know, not the codec's.
    sink.warn({
      code: "dropped_content",
      path: ["messages", 0, "content", 1],
      message: "file image sources do not cross providers",
    });

    expect(sink.warnings).toHaveLength(2);
    for (const warning of sink.warnings) {
      expect(warning.from).toBe("anthropic.chat");
      expect(warning.to).toBe("openrouter.chat");
    }
  });

  test("starts empty — no warnings means lossless, and that has to be reachable", () => {
    expect(createWarningSink("a.b", "c.d").warnings).toEqual([]);
  });
});

describe("attachWarnings", () => {
  const warnings: TranslationWarning[] = [
    {
      code: "id_respelled",
      path: ["model"],
      from: "anthropic.chat",
      to: "openrouter.chat",
      message: '"claude-opus-5" is spelled "anthropic/claude-opus-5" on openrouter.',
    },
  ];

  test("is non-enumerable: the wire body stays exactly the wire body", () => {
    const body = attachWarnings({ model: "anthropic/claude-opus-5", messages: [] }, warnings);

    expect(Object.keys(body)).toEqual(["model", "messages"]);
    expect(JSON.parse(JSON.stringify(body))).toEqual({
      model: "anthropic/claude-opus-5",
      messages: [],
    });
    expect({ ...body }).toEqual({ model: "anthropic/claude-opus-5", messages: [] } as never);
    expect(Object.getOwnPropertyDescriptor(body, "warnings")?.enumerable).toBe(false);
  });

  test("is readable and carries the warnings verbatim", () => {
    const body = attachWarnings({ model: "x" }, warnings);

    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]?.code).toBe("id_respelled");
  });

  test("is frozen — a warning list you can mutate is one nobody trusts", () => {
    const body = attachWarnings({ model: "x" }, warnings);

    expect(Object.isFrozen(body.warnings)).toBe(true);
    expect(() => (body.warnings as TranslationWarning[]).push(warnings[0] as TranslationWarning),
    ).toThrow();
  });

  test("copies the source array so later pushes do not leak into the result", () => {
    const live: TranslationWarning[] = [...warnings];
    const body = attachWarnings({ model: "x" }, live);

    live.push({ ...(warnings[0] as TranslationWarning), code: "dropped_param" });

    expect(body.warnings).toHaveLength(1);
  });
});

test("formatTranslationWarnings names the code and both endpoints", () => {
  expect(
    formatTranslationWarnings([
      {
        code: "dropped_param",
        path: ["thinking"],
        from: "anthropic.chat",
        to: "openrouter.chat",
        message: "`thinking` has no chat-completions equivalent.",
      },
    ]),
  ).toBe(
    "  - [dropped_param] anthropic.chat → openrouter.chat: `thinking` has no chat-completions equivalent.",
  );
});
