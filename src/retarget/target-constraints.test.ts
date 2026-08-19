import { describe, expect, test } from "bun:test";

import { createToApi } from "../core/translate/retarget";
import { resolveEndpoint } from "../core/translate/endpoints";
import type { AvailabilityMap } from "../core/translate/availability-types";
import { TARGET_CONSTRAINT_ENDPOINTS, targetValidationFor } from "./target-constraints";

/**
 * The target-side deny/enum tables, tested against synthetic availability data
 * so the assertions do not depend on which models the generated catalog
 * happens to carry today.
 */

interface ChatBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  logprobs?: boolean;
  n?: number;
  reasoning_effort?: string;
}

function retargetTo(target: string, targetModelId: string, body: Partial<ChatBody>) {
  const availability = {
    source: { [target]: targetModelId },
  } as unknown as AvailabilityMap;
  const retarget = createToApi<ChatBody>({
    from: "openai-chat",
    endpoint: "test.chat",
    modelId: () => "source",
    availability,
    targetValidation: targetValidationFor,
  })({ model: "source", messages: [{ role: "user", content: "hi" }], ...body });
  return retarget(target);
}

describe("the table", () => {
  test("every endpoint it names exists in the endpoint table", () => {
    for (const id of TARGET_CONSTRAINT_ENDPOINTS) {
      const provider = id.split(".")[0] as string;
      expect(resolveEndpoint(provider, id), id).toBeDefined();
    }
  });

  test("a target with no tables yields undefined, so the check is skipped entirely", () => {
    const endpoint = resolveEndpoint("openrouter");
    expect(endpoint).toBeDefined();
    expect(targetValidationFor(endpoint!)).toBeUndefined();
  });

  test("a target with tables yields its constraints", () => {
    const endpoint = resolveEndpoint("groq");
    expect(targetValidationFor(endpoint!)?.constraints?.length).toBeGreaterThan(0);
  });
});

describe("groq — endpoint-wide denies", () => {
  test("a denied param is an error naming the target's model id", () => {
    const { result } = retargetTo("groq", "llama-4-70b", { logprobs: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("unsupported_param");
    expect(result.errors[0]?.model).toBe("llama-4-70b");
  });

  test("the enum table pins n to 1", () => {
    expect(retargetTo("groq", "llama-4-70b", { n: 3 }).result.ok).toBe(false);
    expect(retargetTo("groq", "llama-4-70b", { n: 1 }).result.ok).toBe(true);
  });

  test("an unset param is not denied — `undefined` means the caller never sent it", () => {
    expect(retargetTo("groq", "llama-4-70b", {}).result.ok).toBe(true);
  });
});

/**
 * `FamilyRule.match` narrows a table to the models it applies to. The retarget
 * engine only ever knows the target's model **id**, so a family whose match is
 * a pure string predicate is honoured and one that would need the target's
 * `ModelInfo` (xai's `reasoning` flag) is deliberately not in the table at all.
 */
describe("upstage — family-scoped denies", () => {
  test("fires on a model the family matches", () => {
    const { result } = retargetTo("upstage", "solar-mini", { reasoning_effort: "low" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.path).toEqual(["reasoning_effort"]);
  });

  test("fires on a dated snapshot of that family too", () => {
    expect(
      retargetTo("upstage", "solar-mini-250422", { reasoning_effort: "low" }).result.ok,
    ).toBe(false);
  });

  test("does NOT fire on a model outside the family", () => {
    expect(retargetTo("upstage", "solar-pro4", { reasoning_effort: "low" }).result.ok).toBe(true);
  });
});
