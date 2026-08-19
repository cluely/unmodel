import { describe, expect, test } from "bun:test";
import { formatIssuePath, formatIssues, UnmodelValidationError } from "./issues";
import type { Issue } from "./issues";

describe("formatIssuePath", () => {
  test("empty path renders as (root)", () => {
    expect(formatIssuePath([])).toBe("(root)");
  });

  test("single string segment", () => {
    expect(formatIssuePath(["model"])).toBe("model");
  });

  test("mixed string and number segments", () => {
    expect(formatIssuePath(["messages", 3, "content", 0])).toBe("messages[3].content[0]");
  });

  test("leading number segment", () => {
    expect(formatIssuePath([0, "parts", 1])).toBe("[0].parts[1]");
  });

  test("consecutive number segments", () => {
    expect(formatIssuePath(["grid", 2, 5])).toBe("grid[2][5]");
  });
});

describe("formatIssues", () => {
  test("renders one bullet per issue with code, path, and message", () => {
    const issues: Issue[] = [
      {
        severity: "error",
        code: "unsupported_param",
        path: ["messages", 1, "name"],
        message: "not supported.",
      },
      { severity: "error", code: "invalid_shape", path: [], message: "bad root." },
    ];
    expect(formatIssues(issues)).toBe(
      "  - [unsupported_param] messages[1].name: not supported.\n" +
        "  - [invalid_shape] (root): bad root.",
    );
  });

  test("empty list renders as empty string", () => {
    expect(formatIssues([])).toBe("");
  });
});

describe("UnmodelValidationError.isInstance", () => {
  test("accepts a real instance", () => {
    const error = new UnmodelValidationError("test.endpoint", []);
    expect(UnmodelValidationError.isInstance(error)).toBe(true);
  });

  test("accepts a cross-realm-shaped plain object", () => {
    const foreign = { name: "UnmodelValidationError", issues: [], warnings: [] };
    expect(UnmodelValidationError.isInstance(foreign)).toBe(true);
  });

  test("rejects other errors and near-misses", () => {
    expect(UnmodelValidationError.isInstance(new Error("nope"))).toBe(false);
    expect(UnmodelValidationError.isInstance(null)).toBe(false);
    expect(UnmodelValidationError.isInstance(undefined)).toBe(false);
    expect(UnmodelValidationError.isInstance("UnmodelValidationError")).toBe(false);
    expect(
      UnmodelValidationError.isInstance({ name: "UnmodelValidationError", issues: "not-array" }),
    ).toBe(false);
    expect(UnmodelValidationError.isInstance({ name: "OtherError", issues: [] })).toBe(false);
  });
});
