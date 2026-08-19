/**
 * Fleet-wide wiring guard.
 *
 * `createOpenAICompatible` centralizes `finalize` for the whole
 * OpenAI-compatible fleet, but each overlay still has to hand the factory its
 * own generated availability table — a per-file line that a mechanical
 * migration can silently miss on one provider out of thirty, with no type
 * error and no other test noticing (the endpoint keeps working; it just
 * quietly has no `.toApi`).
 *
 * So this asserts the property end to end for every overlay: an overlay whose
 * provider has a generated table retargets a real model from it, and an
 * overlay whose provider has none ships no `.toApi` at all.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { isFactoryEndpoint, resolveEndpoint } from "../../core/translate/endpoints";
import type { AvailabilityMap } from "../../core/translate/availability-types";
import { toAvailabilityTarget } from "../../core/translate/availability-types";

/**
 * Every overlay built on `createOpenAICompatible`, except the two
 * factory-configured ones that take per-instance config: `azure` (resource
 * endpoint) and `cloudflare-workers-ai` (account id), which are covered
 * separately below.
 */
const OVERLAYS = [
  "alibaba",
  "baseten",
  "cerebras",
  "deepinfra",
  "deepseek",
  "fireworks-ai",
  "friendli",
  "groq",
  "huggingface",
  "inception",
  "longcat",
  "meta",
  "minimax",
  "mistral",
  "moonshotai",
  "nebius",
  "novita-ai",
  "nvidia",
  "openrouter",
  "perplexity",
  "sarvam",
  "scaleway",
  "siliconflow",
  "stepfun",
  "togetherai",
  "upstage",
  "vercel",
  "xai",
  "zhipuai",
] as const;

const AVAILABILITY_DIR = join(import.meta.dir, "../../catalog/availability");

interface ChatLike {
  (params: { model: string; messages: Array<{ role: "user"; content: string }> }): Record<
    string,
    unknown
  > & {
    request: { url: string };
  };
}

function hasTable(provider: string): boolean {
  return existsSync(join(AVAILABILITY_DIR, `${provider}.gen.ts`));
}

async function tableOf(provider: string): Promise<AvailabilityMap> {
  const mod = (await import(join(AVAILABILITY_DIR, `${provider}.gen.ts`))) as {
    availability: AvailabilityMap;
  };
  return mod.availability;
}

/**
 * The first (source model, target) pair in a table that a one-argument
 * `.toApi` can actually complete: a same-dialect target with a static URL.
 * Factory targets and cross-dialect targets are in the data on purpose — they
 * are how the phase-3 overload and the codec phase land without a codegen
 * change — but they throw today, by design.
 */
function firstStaticFleetPair(
  table: AvailabilityMap,
): { model: string; target: string; targetModelId: string } | undefined {
  for (const [model, targets] of Object.entries(table)) {
    for (const [target, entry] of Object.entries(targets)) {
      const endpoint = resolveEndpoint(target, toAvailabilityTarget(entry).endpoint);
      if (endpoint === undefined || isFactoryEndpoint(endpoint)) continue;
      if (endpoint.dialect !== "openai-chat") continue;
      return { model, target, targetModelId: toAvailabilityTarget(entry).id };
    }
  }
  return undefined;
}

const MESSAGES = [{ role: "user" as const, content: "hi" }];

describe("every openai-compatible overlay wires its availability table", () => {
  for (const provider of OVERLAYS) test(provider, async () => {
    const mod = (await import(`../${provider}/index.ts`)) as { chat: ChatLike };
    const validated = mod.chat({ model: "unmodel-wiring-probe", messages: MESSAGES });

    if (!hasTable(provider)) {
      // No generated table → no `.toApi`, at runtime as well as in the type.
      expect("toApi" in validated).toBe(false);
      expect("toApiSafe" in validated).toBe(false);
      return;
    }

    expect("toApi" in validated).toBe(true);
    expect("toApiSafe" in validated).toBe(true);

    const pair = firstStaticFleetPair(await tableOf(provider));
    expect(pair, `${provider}'s table has no static same-dialect target`).toBeDefined();
    if (pair === undefined) return;

    const routed = (
      mod.chat({ model: pair.model, messages: MESSAGES }) as unknown as {
        toApi(target: string): { model: string; request: { url: string }; target: string };
      }
    ).toApi(pair.target);

    // The overlay's own table drove the lookup: the body carries the TARGET's
    // spelling of the id and the TARGET's URL.
    expect(routed.model).toBe(pair.targetModelId);
    expect(routed.target).toBe(pair.target);
    // Every openai-chat target in the endpoint table has a literal URL.
    expect(routed.request.url).toBe(resolveEndpoint(pair.target)?.url as string);
  });
});

describe("cloudflare-workers-ai", () => {
  test("the account-bound factory carries the availability table too", async () => {
    const mod = (await import("../cloudflare-workers-ai/index.ts")) as {
      createCloudflare(accountId: string): { chat: ChatLike };
    };
    const { chat } = mod.createCloudflare("023e105f4ecef8ad9ca31a8372d0c353");
    const validated = chat({ model: "unmodel-wiring-probe", messages: MESSAGES });

    expect("toApi" in validated).toBe(true);
    const pair = firstStaticFleetPair(await tableOf("cloudflare-workers-ai"));
    expect(pair).toBeDefined();
  });
});
