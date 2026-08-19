import { describe, expect, test } from "bun:test";
import { findMediaDeclaration, reportMediaIssues } from "./check";
import type { MediaCheckInput } from "./check";
import type { MediaDeclaration } from "../options";
import type { IssueInput, PipelineContext } from "../pipeline";
import type { SniffedImage } from "./image";

function stubCtx(): { ctx: PipelineContext; issues: IssueInput[] } {
  const issues: IssueInput[] = [];
  const ctx: PipelineContext = {
    endpoint: "test.endpoint",
    options: {},
    tokenizer: { count: () => 0 },
    report(input) {
      issues.push(input);
    },
  };
  return { ctx, issues };
}

function run(input: MediaCheckInput): IssueInput[] {
  const { ctx, issues } = stubCtx();
  reportMediaIssues(ctx, input);
  return issues;
}

const PATH = ["messages", 0, "content", 1];
const sniffedPng: SniffedImage = { format: "png", width: 800, height: 600, bytes: 5000 };

describe("findMediaDeclaration", () => {
  const declarations: MediaDeclaration[] = [
    { path: ["contents", 0, "parts", 1], durationSeconds: 30 },
    { path: ["contents", 1, "parts", 0], bytes: 1234 },
  ];

  test("matches by deep path equality including number segments", () => {
    expect(findMediaDeclaration(declarations, ["contents", 1, "parts", 0])?.bytes).toBe(1234);
    expect(
      findMediaDeclaration(declarations, ["contents", 0, "parts", 1])?.durationSeconds,
    ).toBe(30);
  });

  test("no match on differing segments or length", () => {
    expect(findMediaDeclaration(declarations, ["contents", 0, "parts", 2])).toBeUndefined();
    expect(findMediaDeclaration(declarations, ["contents", 0, "parts"])).toBeUndefined();
    expect(findMediaDeclaration(declarations, ["contents", "0", "parts", 1])).toBeUndefined();
  });

  test("undefined media list yields undefined", () => {
    expect(findMediaDeclaration(undefined, ["a"])).toBeUndefined();
  });
});

describe("reportMediaIssues", () => {
  test("no rule limits, no issues", () => {
    expect(run({ kind: "image", rule: {}, path: PATH, sniffed: sniffedPng })).toEqual([]);
  });

  test("format allowlist fires only when sniffing identified a format", () => {
    const rule = { formats: ["jpeg", "webp"] };
    const bad = run({ kind: "image", rule, path: PATH, model: "m-1", sniffed: sniffedPng });
    expect(bad).toHaveLength(1);
    expect(bad[0]?.code).toBe("media_unsupported_format");
    expect(bad[0]?.path).toEqual(PATH);
    expect(bad[0]?.model).toBe("m-1");
    expect(bad[0]?.message).toContain('"png"');
    expect(bad[0]?.message).toContain('"m-1"');
    expect(bad[0]?.message).toContain("jpeg, webp");
    expect(bad[0]?.meta).toEqual({ format: "png", allowed: ["jpeg", "webp"] });

    // Unknown format (no sniff) must not be rejected.
    expect(run({ kind: "image", rule, path: PATH, encodedBytes: 100 })).toEqual([]);
  });

  test("allowed sniffed format passes", () => {
    expect(
      run({ kind: "image", rule: { formats: ["png"] }, path: PATH, sniffed: sniffedPng }),
    ).toEqual([]);
  });

  test("maxBytes uses sniffed bytes first", () => {
    const issues = run({
      kind: "image",
      rule: { maxBytes: 4000 },
      path: PATH,
      model: "m-1",
      sniffed: sniffedPng,
      declaration: { path: PATH, bytes: 1 },
      encodedBytes: 1,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("media_too_large");
    expect(issues[0]?.message).toContain("5000 bytes");
    expect(issues[0]?.message).toContain("4000 bytes");
    expect(issues[0]?.meta).toEqual({ bytes: 5000, limit: 4000 });
  });

  test("maxBytes falls back to declaration.bytes then encodedBytes", () => {
    const fromDeclaration = run({
      kind: "video",
      rule: { maxBytes: 4000 },
      path: PATH,
      declaration: { path: PATH, bytes: 9000 },
      encodedBytes: 1,
    });
    expect(fromDeclaration.map((i) => i.code)).toEqual(["media_too_large"]);
    expect(fromDeclaration[0]?.meta?.["bytes"]).toBe(9000);

    const fromEncoded = run({
      kind: "image",
      rule: { maxBytes: 4000 },
      path: PATH,
      encodedBytes: 6000,
    });
    expect(fromEncoded.map((i) => i.code)).toEqual(["media_too_large"]);
    expect(fromEncoded[0]?.meta?.["bytes"]).toBe(6000);

    // No byte source at all → cannot enforce.
    expect(run({ kind: "image", rule: { maxBytes: 4000 }, path: PATH })).toEqual([]);
  });

  test("dimension limits use sniffed dimensions", () => {
    const issues = run({
      kind: "image",
      rule: { maxWidth: 500, maxHeight: 700 },
      path: PATH,
      model: "m-1",
      sniffed: sniffedPng,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("media_dimensions_exceeded");
    expect(issues[0]?.message).toContain("800x600");
    expect(issues[0]?.message).toContain("500x700");
    expect(issues[0]?.meta).toEqual({ width: 800, height: 600, maxWidth: 500, maxHeight: 700 });
  });

  test("dimension limits fall back to the declaration when nothing was sniffed", () => {
    const issues = run({
      kind: "image",
      rule: { maxHeight: 1000 },
      path: PATH,
      declaration: { path: PATH, width: 100, height: 2000 },
    });
    expect(issues.map((i) => i.code)).toEqual(["media_dimensions_exceeded"]);
    expect(issues[0]?.meta?.["height"]).toBe(2000);

    // Within limits → nothing.
    expect(
      run({
        kind: "image",
        rule: { maxWidth: 500, maxHeight: 700 },
        path: PATH,
        declaration: { path: PATH, width: 100, height: 100 },
      }),
    ).toEqual([]);
  });

  test("duration limit with a declared duration over the cap errors", () => {
    const issues = run({
      kind: "video",
      rule: { maxDurationSeconds: 60 },
      path: PATH,
      model: "m-1",
      declaration: { path: PATH, durationSeconds: 90 },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("media_duration_exceeded");
    expect(issues[0]?.message).toContain("90s");
    expect(issues[0]?.message).toContain("60s");
    expect(issues[0]?.meta).toEqual({ durationSeconds: 90, limit: 60 });
  });

  test("duration limit without a declaration warns media_duration_undeclared", () => {
    const issues = run({
      kind: "audio",
      rule: { maxDurationSeconds: 60 },
      path: PATH,
      model: "m-1",
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("media_duration_undeclared");
    expect(issues[0]?.message).toContain("options.media");
    expect(issues[0]?.message).toContain(JSON.stringify(PATH));
  });

  test("declared duration within the cap passes", () => {
    expect(
      run({
        kind: "video",
        rule: { maxDurationSeconds: 60 },
        path: PATH,
        declaration: { path: PATH, durationSeconds: 59 },
      }),
    ).toEqual([]);
  });

  test("source lands in meta.source on every issue kind", () => {
    const issues = run({
      kind: "image",
      rule: { formats: ["jpeg"], maxBytes: 1, maxWidth: 1, maxDurationSeconds: 1 },
      path: PATH,
      model: "m-1",
      sniffed: sniffedPng,
      source: "https://docs.example/vision",
    });
    expect(issues.map((i) => i.code)).toEqual([
      "media_unsupported_format",
      "media_too_large",
      "media_dimensions_exceeded",
      "media_duration_undeclared",
    ]);
    for (const issue of issues) {
      expect(issue.meta?.["source"]).toBe("https://docs.example/vision");
    }
  });

  test("without a model the endpoint names the target", () => {
    const issues = run({
      kind: "image",
      rule: { maxBytes: 1 },
      path: PATH,
      encodedBytes: 10,
    });
    expect(issues[0]?.model).toBeUndefined();
    expect(issues[0]?.message).toContain("test.endpoint");
  });
});
