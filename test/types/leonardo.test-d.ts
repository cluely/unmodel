/**
 * Type-level tests for unmodel/leonardo. Not executed by `bun test`; this file
 * is checked by `bun run check` / `tsc --noEmit`.
 */
import { image, type GenerationsBody } from "../../src/providers/leonardo";

function generationsBodyAliasTypeTests(): void {
  // Lucid models do not support Phoenix's negative_prompt. The exported body
  // union must retain that restriction after a request is aliased.
  // @ts-expect-error — a known discriminant cannot inhabit the loose arm
  const aliasedInvalid: GenerationsBody = {
    model: "lucid-origin",
    parameters: { prompt: "hi", negative_prompt: "blur" },
  };
  void aliasedInvalid;

  // Third-party and future models are a deliberate generic opt-in because the
  // Leonardo endpoint routes models with schemas unmodel cannot predict.
  const future: GenerationsBody<"flux-dev"> = {
    model: "flux-dev",
    parameters: { prompt: "hi", guidance: 3.5 },
  };
  image(future);

  // @ts-expect-error — naming a known model as "future" does not loosen it
  const knownAsFuture: GenerationsBody<"lucid-origin"> = {
    model: "lucid-origin",
    parameters: { prompt: "hi", negative_prompt: "blur" },
  };
  void knownAsFuture;
}

void generationsBodyAliasTypeTests;
