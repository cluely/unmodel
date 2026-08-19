/**
 * Type-level tests for the recraft provider. NOT run by `bun test` — this file
 * is only type-checked (`bun run check` / tsc --noEmit). Recraft rides the
 * OpenAI SDK shape and has no enum-typed client of its own, so these tests pin
 * the `RecraftSize` autocomplete surface: `size` used to be a bare `string` on
 * both the generations route and the outpaint route, so junk compiled and the
 * documented per-model size tables were invisible.
 */
import { image, outpaint } from "../../src/providers/recraft";
import { expectAssignable } from "./helpers";

declare const imageBlob: Blob;

function generationsSizeTypeTests(): void {
  // Aspect ratios — the same 14 apply to every model.
  const v = image({ prompt: "a lighthouse", model: "recraftv3", size: "16:9" });
  expectAssignable<"16:9">(v.size);
  image({ prompt: "hi", model: "recraftv2_vector", size: "6:10" });

  // Explicit WxH — the appendix's per-model tables, per model group.
  image({ prompt: "hi", model: "recraftv4_1", size: "1344x768" });
  image({ prompt: "hi", model: "recraftv4_1_pro", size: "2048x2048" });
  image({ prompt: "hi", model: "recraftv3", size: "1820x1024" });
  // The transpose the appendix attributes to no model; passed through.
  image({ prompt: "hi", model: "recraftv3", size: "1707x1024" });

  // The free-form tail stays, narrowed to the two documented wire shapes: the
  // vector models are listed with aspect ratios only and checkSize passes
  // unattributed WxH values through, so closing the union would reject sizes
  // the API accepts.
  image({ prompt: "hi", model: "recraftv3_vector", size: "1234x777" });
  image({ prompt: "hi", model: "recraftv3", size: "7:5" });

  // @ts-expect-error — junk no longer compiles (`size` was a bare `string`)
  image({ prompt: "hi", size: "banana" });
  // @ts-expect-error — the empty string is not a size
  image({ prompt: "hi", size: "" });

  // null still means "let Recraft pick from the prompt".
  image({ prompt: "hi", size: null });
}

function outpaintSizeTypeTests(): void {
  // The outpaint route shares the RecraftSize vocabulary; it is
  // recraftv3 / recraftv3_vector only, so the V2/V3 table and the shared
  // aspect ratios are the meaningful presets.
  outpaint({ image: imageBlob, prompt: "wider", size: "1024x1024" });
  outpaint({ image: imageBlob, prompt: "wider", size: "3:2" });

  // @ts-expect-error — junk no longer compiles (`size` was a bare `string`)
  outpaint({ image: imageBlob, prompt: "wider", size: "banana" });
  // @ts-expect-error — the empty string is not a size
  outpaint({ image: imageBlob, prompt: "wider", size: "" });
}

export { generationsSizeTypeTests, outpaintSizeTypeTests };
