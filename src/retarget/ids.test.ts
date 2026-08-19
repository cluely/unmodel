import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { ENDPOINTS, isFactoryEndpoint, resolveEndpoint } from "../core/translate/endpoints";
import type { AvailabilityMap } from "../core/translate/availability-types";
import {
  API_TARGET_IDS,
  FACTORY_API_TARGET_IDS,
  SDK_TARGET_IDS,
  STATIC_API_TARGET_IDS,
  isApiTargetId,
  isStaticApiTargetId,
} from "./ids";

const AVAILABILITY_DIR = join(import.meta.dir, "../catalog/availability");
const PROVIDERS_DIR = join(import.meta.dir, "../providers");

/** Every target provider id the generated availability data actually names. */
async function targetsInGeneratedData(): Promise<string[]> {
  const files = readdirSync(AVAILABILITY_DIR).filter((name) => name.endsWith(".gen.ts"));
  // If this ever hits zero the assertions below become vacuous.
  expect(files.length).toBeGreaterThan(10);

  const targets = new Set<string>();
  for (const file of files) {
    const mod = (await import(join(AVAILABILITY_DIR, file))) as { availability: AvailabilityMap };
    for (const byTarget of Object.values(mod.availability)) {
      for (const target of Object.keys(byTarget)) targets.add(target);
    }
  }
  return [...targets].sort();
}

/** Provider directories that ship a module (the factory is not a provider). */
function providerDirectories(): string[] {
  return readdirSync(PROVIDERS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "openai-compatible")
    .map((entry) => entry.name)
    .sort();
}

describe("the id lists are well-formed", () => {
  test.each([
    ["API_TARGET_IDS", API_TARGET_IDS],
    ["FACTORY_API_TARGET_IDS", FACTORY_API_TARGET_IDS],
    ["SDK_TARGET_IDS", SDK_TARGET_IDS],
  ] as Array<[string, readonly string[]]>)("%s is sorted and duplicate-free", (_name, ids) => {
    expect([...ids]).toEqual([...new Set(ids)].sort());
  });

  test("factory ids are a subset of the api ids", () => {
    for (const id of FACTORY_API_TARGET_IDS) expect(API_TARGET_IDS).toContain(id);
  });

  test("static = api minus factory", () => {
    expect(([...STATIC_API_TARGET_IDS] as string[]).sort()).toEqual(
      API_TARGET_IDS.filter((id) => !(FACTORY_API_TARGET_IDS as readonly string[]).includes(id))
        .slice()
        .sort(),
    );
  });

  test("the guards agree with the lists", () => {
    for (const id of API_TARGET_IDS) expect(isApiTargetId(id)).toBe(true);
    for (const id of STATIC_API_TARGET_IDS) expect(isStaticApiTargetId(id)).toBe(true);
    for (const id of FACTORY_API_TARGET_IDS) expect(isStaticApiTargetId(id)).toBe(false);
    expect(isApiTargetId("not-a-provider")).toBe(false);
    expect(isApiTargetId("constructor")).toBe(false);
  });
});

describe("drift guard against the generated availability data", () => {
  // `ids.ts` is hand-written, so it is NOT covered by the codegen drift check.
  // This is what stands in for it: a models.dev refresh that introduces a new
  // retarget destination fails here, loudly, instead of shipping a `.toApi`
  // union that is missing a provider (a false compile error users will read as
  // an unmodel bug) or a runtime "unknown target".
  test("API_TARGET_IDS is exactly the set of targets the data names", async () => {
    expect([...API_TARGET_IDS] as string[]).toEqual(await targetsInGeneratedData());
  });

  test("every api target has an endpoint entry", () => {
    for (const id of API_TARGET_IDS) {
      expect(resolveEndpoint(id), `${id} has no endpoint`).toBeDefined();
    }
  });

  test("every static target has a fetchable URL, every factory target does not", () => {
    for (const id of STATIC_API_TARGET_IDS) {
      const endpoint = resolveEndpoint(id);
      expect(isFactoryEndpoint(endpoint as never), `${id} must not need config`).toBe(false);
      expect(typeof endpoint?.url === "string" || typeof endpoint?.url === "function").toBe(true);
    }
    for (const id of FACTORY_API_TARGET_IDS) {
      expect(isFactoryEndpoint(resolveEndpoint(id) as never), `${id} must need config`).toBe(true);
    }
  });

  test("every endpoint the availability data names explicitly exists", async () => {
    const files = readdirSync(AVAILABILITY_DIR).filter((name) => name.endsWith(".gen.ts"));
    for (const file of files) {
      const mod = (await import(join(AVAILABILITY_DIR, file))) as { availability: AvailabilityMap };
      for (const byTarget of Object.values(mod.availability)) {
        for (const entry of Object.values(byTarget)) {
          if (typeof entry === "string" || entry.endpoint === undefined) continue;
          expect(Object.hasOwn(ENDPOINTS, entry.endpoint), `${file}: ${entry.endpoint}`).toBe(true);
        }
      }
    }
  });
});

describe("SDK target vocabulary", () => {
  test('is one id per provider directory, plus the reserved "ai-sdk"', () => {
    expect([...SDK_TARGET_IDS] as string[]).toEqual(["ai-sdk", ...providerDirectories()].sort());
  });

  test('"ai-sdk" is the only non-catalog id', () => {
    const dirs = new Set(providerDirectories());
    const foreign = SDK_TARGET_IDS.filter((id) => !dirs.has(id));
    expect(foreign).toEqual(["ai-sdk"]);
  });

  // The collision worth documenting adjacently, asserted so it stays true:
  // "vercel" is the AI Gateway (an HTTP API you can retarget to), "ai-sdk" is
  // the npm package (an SDK shape you can format for). Same company.
  test('"vercel" is a retarget target and "ai-sdk" is not', () => {
    expect(API_TARGET_IDS).toContain("vercel");
    expect(API_TARGET_IDS).not.toContain("ai-sdk");
    expect(SDK_TARGET_IDS).toContain("ai-sdk");
    expect(resolveEndpoint("vercel")?.url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions");
  });
});
