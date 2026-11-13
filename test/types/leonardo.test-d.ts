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

function elementsArmTypeTests(): void {
  // The Elements arm: Phoenix's keys plus transparency, the two Elements
  // arrays and four more guidance kinds.
  image({
    model: "kino-xl",
    parameters: {
      prompt: "hi",
      mode: "QUALITY",
      contrast: "LOW",
      transparency: true,
      user_elements: [{ akUUID: "element-id", weight: 0.5 }],
      guidances: { edge: [{ image: { id: "a" }, strength: "HIGH" }] },
    },
  });

  // @ts-expect-error — the Elements models have no ULTRA mode
  image({ model: "lightning-xl", parameters: { prompt: "hi", mode: "ULTRA" } });

  // @ts-expect-error — transparency is Elements-only
  image({ model: "phoenix-v1.0", parameters: { prompt: "hi", transparency: true } });

  // @ts-expect-error — edge guidance is Elements-only
  image({ model: "lucid-origin", parameters: { prompt: "hi", guidances: { edge: [] } } });
}

function guidanceScaleTypeTests(): void {
  // Content guidance takes ULTRA everywhere; image references can be a URL or
  // inline base64.
  image({
    model: "lucid-origin",
    parameters: {
      prompt: "hi",
      guidances: {
        content: [{ image: { type: "BASE64", data: "iVBORw0KGgo=" }, strength: "ULTRA" }],
        style: [{ image: { type: "URL", url: "https://example.com/a.png" }, strength: "MAX" }],
      },
    },
  });

  image({
    model: "phoenix-v1.0",
    parameters: {
      prompt: "hi",
      // @ts-expect-error — character guidance stops at HIGH
      guidances: { character: [{ image: { id: "a" }, strength: "ULTRA" }] },
    },
  });
}

void generationsBodyAliasTypeTests;
void elementsArmTypeTests;
void guidanceScaleTypeTests;
