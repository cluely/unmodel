/**
 * Type-level tests for the black-forest-labs provider. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc
 * --noEmit). BFL has no official JS SDK, so these tests exercise the Tier-A
 * per-route arms and the ExactKeys typo guard.
 */
import {
  imageFlux1,
  image,
  imageEdit,
  imageEditFill,
  type Flux1Body,
  type Flux2Body,
  type FluxFillParams,
} from "../../src/providers/black-forest-labs";
import { expectAssignable } from "./helpers";

function flux2TypeTests(): void {
  // pro/max arm: disable_pup + up to 8 input images.
  const pro = image({
    model: "flux-2-pro",
    prompt: "a tiny cabin",
    disable_pup: true,
    input_image: "data:image/png;base64,xxxx",
    input_image_8: "https://example.com/ref.png",
    width: 1024,
    height: 768,
    safety_tolerance: 2,
    output_format: "png",
    webhook_url: "https://example.com/hook",
  });
  // model is stripped from the wire body.
  expectAssignable<{ prompt: string }>(pro);
  expectAssignable<string>(JSON.stringify(pro));
  expectAssignable<string>(pro.request.url);

  // flex arm: guidance/steps/prompt_upsampling/input_image_blob_path.
  image({
    model: "flux-2-flex",
    prompt: "hi",
    prompt_upsampling: false,
    guidance: 7.5,
    steps: 28,
    input_image_blob_path: "blobs/a.png",
  });

  // klein arm: bare surface, 4 input images.
  image({ model: "flux-2-klein-4b", prompt: "hi", input_image_4: "x" });

  // Unknown models fall back to the loose escape-hatch arm.
  image({ model: "flux-9-mega", prompt: "hi", some_new_param: 1 });

  // @ts-expect-error steps is flex-only — compile error on pro
  image({ model: "flux-2-pro", prompt: "hi", steps: 30 });
  // @ts-expect-error — aliasing cannot route flux-2-pro through the loose arm
  const aliasedInvalid: Flux2Body = { model: "flux-2-pro", prompt: "hi", steps: 30 };
  void aliasedInvalid;
  const future: Flux2Body<"flux-9-mega"> = {
    model: "flux-9-mega",
    prompt: "hi",
    future_sampler: "new",
  };
  image(future);
  // @ts-expect-error guidance is flex-only — compile error on max
  image({ model: "flux-2-max", prompt: "hi", guidance: 5 });
  // @ts-expect-error pro/max use disable_pup, not prompt_upsampling
  image({ model: "flux-2-pro", prompt: "hi", prompt_upsampling: true });
  // @ts-expect-error flex uses prompt_upsampling, not disable_pup
  image({ model: "flux-2-flex", prompt: "hi", disable_pup: true });
  // @ts-expect-error klein routes accept at most 4 input images
  image({ model: "flux-2-klein-9b", prompt: "hi", input_image_5: "x" });
  // @ts-expect-error klein routes have no steps control
  image({ model: "flux-2-klein-4b", prompt: "hi", steps: 20 });
  // @ts-expect-error ExactKeys rejects typo'd keys on known models
  image({ model: "flux-2-pro", prompt: "hi", promt_upsampling: true });
}

function kontextTypeTests(): void {
  const v = imageEdit({
    model: "flux-kontext-pro",
    prompt: "replace the sky",
    input_image: "data:image/png;base64,xxxx",
    aspect_ratio: "16:9",
    prompt_upsampling: true,
    safety_tolerance: 6,
    output_format: "png",
  });
  expectAssignable<{ prompt: string }>(v);
  expectAssignable<string>(JSON.stringify(v));

  // @ts-expect-error kontext sizes via aspect_ratio, not width
  imageEdit({ model: "flux-kontext-pro", prompt: "hi", width: 1024 });
  // @ts-expect-error ExactKeys rejects typo'd keys
  imageEdit({ model: "flux-kontext-max", prompt: "hi", aspectratio: "16:9" });

  // The preset union autocompletes the documented 21:9 … 9:21 rule space.
  imageEdit({ model: "flux-kontext-pro", prompt: "hi", aspect_ratio: "21:9" });
  imageEdit({ model: "flux-kontext-pro", prompt: "hi", aspect_ratio: "9:21" });
  // Ratios BFL never enumerated stay legal — the space is free-form "W:H".
  imageEdit({ model: "flux-kontext-pro", prompt: "hi", aspect_ratio: "7:3" });
  // @ts-expect-error non-ratio strings are compile errors (was a bare `string`)
  imageEdit({ model: "flux-kontext-pro", prompt: "hi", aspect_ratio: "" });
  // @ts-expect-error "WIDTHxHEIGHT" is the wrong wire shape for a ratio field
  imageEdit({ model: "flux-kontext-pro", prompt: "hi", aspect_ratio: "16x9" });
}

function flux1TypeTests(): void {
  // The ultra route sizes by aspect_ratio; the presets cover the rule space.
  imageFlux1({ model: "flux-pro-1.1-ultra", prompt: "hi", aspect_ratio: "16:9" });
  imageFlux1({ model: "flux-pro-1.1-ultra", prompt: "hi", aspect_ratio: "1:2" });
  imageFlux1({ model: "flux-pro-1.1-ultra", prompt: "hi", aspect_ratio: "7:3" });
  // @ts-expect-error banana is not a ratio (was a bare `string`)
  imageFlux1({ model: "flux-pro-1.1-ultra", prompt: "hi", aspect_ratio: "banana" });
  // @ts-expect-error the width/height routes do not take aspect_ratio at all
  imageFlux1({ model: "flux-dev", prompt: "hi", aspect_ratio: "16:9" });

  // @ts-expect-error — aliasing cannot route flux-dev through the loose arm
  const aliasedInvalid: Flux1Body = {
    model: "flux-dev",
    prompt: "hi",
    aspect_ratio: "16:9",
  };
  void aliasedInvalid;
  const future: Flux1Body<"flux-pro-2"> = {
    model: "flux-pro-2",
    future_sampler: "new",
  };
  imageFlux1(future);
}

function fluxFillBodyAliasTypeTests(): void {
  // @ts-expect-error — the base fill route has no finetune id
  const aliasedInvalid: FluxFillParams = {
    model: "flux-pro-1.0-fill",
    image: "base64",
    finetune_id: "my-lora",
  };
  void aliasedInvalid;
  const future: FluxFillParams<"flux-pro-2-fill"> = {
    model: "flux-pro-2-fill",
    image: "base64",
    future_mask_mode: "semantic",
  };
  imageEditFill(future);
}

export { flux2TypeTests, kontextTypeTests, flux1TypeTests, fluxFillBodyAliasTypeTests };
