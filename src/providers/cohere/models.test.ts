import { expect, test } from "bun:test";
import { chatModels } from "./models";
import { models } from "../../catalog/cohere.gen";

/**
 * The overlay is the generated catalog plus the corrections `./models.ts`
 * documents, and nothing else. Each correction is asserted together with the
 * generated value that makes it one: when models.dev is fixed upstream, the
 * pair stops holding and this file is where that shows up.
 */

test("north-small-translate: Cohere's id and 16K context replace models.dev's", () => {
  const generated = models["north-small-translate-09-2026"];
  expect(generated.limit.context).toBe(32768);
  expect(Object.hasOwn(models, "north-small-translate-1.0")).toBe(false);

  expect(Object.hasOwn(chatModels, "north-small-translate-09-2026")).toBe(false);
  expect(chatModels["north-small-translate-1.0"]).toEqual({
    ...generated,
    id: "north-small-translate-1.0",
    limit: { context: 16000, output: 16000 },
  });
});

test("north-mini-code: Cohere's id, with structured outputs restated as supported", () => {
  const generated = models["north-mini-code-1-0"];
  expect(generated.structuredOutput).toBe(false);
  expect(Object.hasOwn(models, "north-mini-code-1.0")).toBe(false);

  expect(Object.hasOwn(chatModels, "north-mini-code-1-0")).toBe(false);
  expect(chatModels["north-mini-code-1.0"]).toEqual({
    ...generated,
    id: "north-mini-code-1.0",
    structuredOutput: true,
  });
});

const UNPRICED = [
  "command-a-plus-05-2026",
  "command-a-reasoning-08-2025",
  "command-a-translate-08-2025",
  "command-a-vision-07-2025",
] as const;

test("command a+/reasoning/translate/vision: the contradicted $2.50/$10 rate is dropped", () => {
  for (const id of UNPRICED) {
    const { cost, ...rest } = models[id];
    expect(cost, id).toEqual({ input: 2.5, output: 10 });
    expect(chatModels[id], id).toEqual(rest);
  }
});

test("every other row is the generated row, unchanged", () => {
  const corrected = new Set<string>(["north-small-translate-1.0", "north-mini-code-1.0", ...UNPRICED]);
  const dropped = new Set(["north-small-translate-09-2026", "north-mini-code-1-0"]);
  const rows: Record<string, unknown> = chatModels;
  for (const [id, info] of Object.entries(models)) {
    if (corrected.has(id) || dropped.has(id)) continue;
    expect(rows[id], id).toEqual(info);
  }
  expect(Object.keys(chatModels).sort()).toEqual(
    [
      ...Object.keys(models).filter((id) => !dropped.has(id)),
      "north-small-translate-1.0",
      "north-mini-code-1.0",
    ].sort(),
  );
});
