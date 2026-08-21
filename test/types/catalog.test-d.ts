/**
 * Type-level tests for `unmodel/catalog` and `unmodel/catalog/typed`. NOT run
 * by `bun test` — this file is only type-checked (`bun run check` / tsc
 * --noEmit).
 *
 * The two entries are the same 184-provider object with two declarations, and
 * what is pinned here is that each keeps its half of the bargain:
 *
 * - `unmodel/catalog` stays widened, because its declaration is ~4 KiB and is
 *   what a project resolves when it only wants `ProviderId`. Dropping the
 *   annotation would take it to ~3.6 MB (test/bundle-budget.test.ts pins it).
 * - `unmodel/catalog/typed` keeps the literals the `.gen` files already
 *   computed. 184 providers ship a catalog and 71 have a provider subpath, so
 *   for ~113 providers these are the ONLY typed access to their model ids.
 *
 * The honesty assertions matter as much as the payoff ones: a KNOWN pair
 * resolves to a non-optional row, and everything else keeps `| undefined`.
 */
import { catalog, getModel, getProvider } from "../../src/catalog/index";
import type { ProviderCatalog, ProviderId } from "../../src/catalog/index";
import { catalogTyped, getModelTyped, getProviderTyped } from "../../src/catalog/typed.gen";
import type { Catalog, ModelIdFor } from "../../src/catalog/typed.gen";
import type { ModelInfo } from "../../src/core/catalog-types";
import { expectAssignable } from "./helpers";

declare const runtimeProvider: string;
declare const runtimeModel: string;

function typedCatalogTypeTests(): void {
  // A known pair resolves to the row itself — no `?.`, and the limit is the
  // literal the `.gen` file computed.
  const opus = getModelTyped("anthropic", "claude-opus-5");
  const context: 1000000 = opus.limit.context;
  void context;
  expectAssignable<"claude-opus-5">(opus.id);

  const anthropic = getProviderTyped("anthropic");
  expectAssignable<"anthropic">(anthropic.provider.id);
  expectAssignable<"claude-opus-5">(catalogTyped.anthropic.models["claude-opus-5"].id);

  // A model id this provider does NOT serve falls to the loose overload rather
  // than erroring, and keeps `| undefined` — which is the honest answer, and
  // the reason the loose overload exists at all. An unregistered provider does
  // the same, through the `(string & {})` tail every generated union carries.
  const wrongPair: ModelInfo | undefined = getModelTyped("anthropic", "gpt-5.2");
  void wrongPair;
  const unknownProvider: ProviderCatalog | undefined = getProviderTyped("not-a-provider");
  void unknownProvider;
  // @ts-expect-error — and the degraded result is genuinely optional: reading
  // through it needs `?.`, exactly as it did before this entry existed.
  void getModelTyped("anthropic", "gpt-5.2").limit;

  // …and the model-id union is nameable, which is the whole point for the
  // providers that have no subpath of their own.
  const id: ModelIdFor<"anthropic"> = "claude-sonnet-5";
  void id;
  expectAssignable<Catalog["anthropic"]["provider"]["id"]>("anthropic");
}

/** The loose overload, exercised separately so its `| undefined` is visible. */
function typedCatalogHonestyTests(): void {
  // A provider known only at run time falls to the loose overload…
  const maybeProvider: ProviderCatalog | undefined = getProviderTyped(runtimeProvider);
  void maybeProvider;
  // …and so does a known provider with an unknown model id.
  const maybeModel: ModelInfo | undefined = getModelTyped("anthropic", runtimeModel);
  void maybeModel;

  // A union of provider ids distributes rather than collapsing to `never`.
  const branch = Math.random() > 0.5 ? ("anthropic" as const) : ("openai" as const);
  const either = getProviderTyped(branch);
  expectAssignable<ProviderCatalog>(either);
}

/** `unmodel/catalog` is unchanged, and that is deliberate — see the header. */
function looseCatalogTypeTests(): void {
  const row: ModelInfo | undefined = getModel("anthropic", "claude-opus-5");
  void row;
  const provider: ProviderCatalog | undefined = getProvider("anthropic");
  void provider;
  expectAssignable<Record<ProviderId, ProviderCatalog>>(catalog);
  // The open tail is still there: an id shipped after this snapshot compiles.
  getProvider("a-provider-from-2027");
  getModel("a-provider-from-2027", "some-model");
}

export { typedCatalogTypeTests, typedCatalogHonestyTests, looseCatalogTypeTests };
