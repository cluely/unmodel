/**
 * Type-level tests for `unmodel/azure`. NOT run by `bun test` — this file is
 * only type-checked (`bun run check` / tsc --noEmit).
 *
 * What is pinned here is `chatModels`, the overlay `azure.chat` validates
 * against: an overlaid row must state its correction at the type level as
 * exactly as the runtime row does, and keep every literal it did not correct.
 */
import { chatModels, models } from "../../src/providers/azure";
import { expectTrue } from "./helpers";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// The GPT-6 sampling correction reads as the literal `true`, not `boolean`…
expectTrue<Same<(typeof chatModels)["gpt-6-astra"]["temperature"], true>>();
expectTrue<Same<(typeof chatModels)["gpt-6.1-terra"]["temperature"], true>>();
// …while the rest of the row keeps the generated literals, cost included.
expectTrue<Same<(typeof chatModels)["gpt-6-astra"]["cost"], (typeof models)["gpt-6-astra"]["cost"]>>();
expectTrue<Same<(typeof chatModels)["gpt-6-astra"]["limit"], (typeof models)["gpt-6-astra"]["limit"]>>();
// The deepseek output correction keeps its literal too.
expectTrue<Same<(typeof chatModels)["deepseek-v4.1-flash"]["limit"]["output"], 384000>>();
