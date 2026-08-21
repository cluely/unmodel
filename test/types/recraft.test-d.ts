/**
 * Type-level tests for the recraft provider. NOT run by `bun test` — this file
 * is only type-checked (`bun run check` / tsc --noEmit). Recraft rides the
 * OpenAI SDK shape and has no enum-typed client of its own, so these tests pin
 * two autocomplete surfaces:
 *
 * - `RecraftSize`: `size` used to be a bare `string` on both the generations
 *   route and the outpaint route, so junk compiled and the documented per-model
 *   size tables were invisible.
 * - `StyleFor<M>`: `style` used to pool all four curated lists into one
 *   `RecraftStyleName` union, so a name valid for a DIFFERENT model compiled
 *   with zero diagnostics and was then refused by `checkStyleForModel` with
 *   `invalid_enum_value`. The counts live in test/unified/completions.test.ts;
 *   what is pinned here is that the cross-model names are compile errors and
 *   that the degraded arms stay open.
 */
import {
  image,
  imageEdit,
  imageEditInpaint,
  imageEditOutpaint,
  imageEditReplaceBackground,
} from "../../src/providers/recraft";
import { expectAssignable } from "./helpers";

declare const imageBlob: Blob;
/** A model id only known at runtime — the degraded arm of `StyleFor<M>`. */
declare const runtimeModel: string;

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
  imageEditOutpaint({ image: imageBlob, prompt: "wider", size: "1024x1024" });
  imageEditOutpaint({ image: imageBlob, prompt: "wider", size: "3:2" });

  // @ts-expect-error — junk no longer compiles (`size` was a bare `string`)
  imageEditOutpaint({ image: imageBlob, prompt: "wider", size: "banana" });
  // @ts-expect-error — the empty string is not a size
  imageEditOutpaint({ image: imageBlob, prompt: "wider", size: "" });
}

function generationsStyleTypeTests(): void {
  // Each model's own curated list compiles, and `style` survives inference as
  // the literal (the per-model narrowing must not damage `Validated<T, …>`).
  const v3 = image({ prompt: "hi", model: "recraftv3", style: "Photorealism" });
  expectAssignable<"Photorealism">(v3.style);
  expectAssignable<"recraftv3">(v3.model);
  expectAssignable<{ prompt: string; model: "recraftv3"; style: "Photorealism" }>(
    v3.toSdk("recraft"),
  );

  image({ prompt: "hi", model: "recraftv3", style: "Recraft V3 Raw" });
  image({ prompt: "hi", model: "recraftv3_vector", style: "Vector art" });
  image({ prompt: "hi", model: "recraftv2", style: "3D render" });
  image({ prompt: "hi", model: "recraftv2_vector", style: "Icon" });

  // @ts-expect-error — "3D render" is V2-only; recraftv3 refuses it at runtime
  // (invalid_enum_value), and now at compile time too.
  image({ prompt: "hi", model: "recraftv3", style: "3D render" });
  // @ts-expect-error — "Noir" is V3-only, so recraftv2 does not accept it.
  image({ prompt: "hi", model: "recraftv2", style: "Noir" });
  // @ts-expect-error — vector styles belong to the *_vector models only.
  image({ prompt: "hi", model: "recraftv3", style: "Vector art" });
  // @ts-expect-error — "Icon" is a V2 Vector style; recraftv2 is raster.
  image({ prompt: "hi", model: "recraftv2", style: "Icon" });
  // @ts-expect-error — key order must not matter: `style` before `model`.
  image({ style: "3D render", model: "recraftv3", prompt: "hi" });

  // DEGRADED ARMS — `model` not a known literal, so `style` falls back to the
  // pooled union plus its open tail and every name stays callable. These mirror
  // ModelSizing's degraded arm: runtime-built model ids must stay usable.
  image({ prompt: "hi", style: "3D render" }); // model omitted
  image({ prompt: "hi", model: null, style: "Vector art" });
  image({ prompt: "hi", model: "recraftv4_1", style: "3D render" }); // no style table
  image({ prompt: "hi", model: "recraftv9-unreleased", style: "Kawaii" });
  image({ prompt: "hi", model: runtimeModel, style: "3D render" });

  // `substyle` stays globally open — no published style ↔ substyle pairing.
  image({ prompt: "hi", model: "recraftv3", substyle: "line_circuit" });

  // null still means "no style".
  image({ prompt: "hi", model: "recraftv3", style: null });
}

function editStyleTypeTests(): void {
  // The editing routes carry the same per-model `style`, so the asymmetry the
  // generations route had does not simply move here.
  const edited = imageEdit({
    image: imageBlob,
    prompt: "winter",
    strength: 0.2,
    model: "recraftv3",
    style: "Photorealism",
  });
  expectAssignable<"Photorealism">(edited.style);

  imageEditInpaint({ image: imageBlob, mask: imageBlob, prompt: "x", model: "recraftv3_vector", style: "Vector art" });
  imageEditReplaceBackground({ image: imageBlob, prompt: "x", model: "recraftv3", style: "Noir" });

  // @ts-expect-error — "3D render" is V2-only and imageToImage takes no V2 model.
  imageEdit({ image: imageBlob, prompt: "x", strength: 0.2, model: "recraftv3", style: "3D render" });
  // @ts-expect-error — a vector style on the raster V3 model.
  imageEditInpaint({ image: imageBlob, mask: imageBlob, prompt: "x", model: "recraftv3", style: "Vector art" });
  // @ts-expect-error — a raster style on the V3 Vector model.
  imageEditOutpaint({ image: imageBlob, prompt: "x", size: "3:2", model: "recraftv3_vector", style: "Photorealism" });

  // Degraded arm: `model` omitted defaults server-side, so the pooled union stays.
  imageEdit({ image: imageBlob, prompt: "x", strength: 0.2, style: "3D render" });
}

export {
  generationsSizeTypeTests,
  outpaintSizeTypeTests,
  generationsStyleTypeTests,
  editStyleTypeTests,
};
