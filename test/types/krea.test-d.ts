/**
 * Type-level tests for the krea provider. NOT run by `bun test` — this file is
 * only type-checked (`bun run check` / tsc --noEmit). Krea 2's request schema
 * is `additionalProperties: false` with COMPLETE enums
 * (https://api.krea.ai/openapi.json), so `aspect_ratio`, `resolution` and
 * `creativity` carry no `(string & {})` escape hatch: a non-member is a
 * certain 400, and these tests pin that it is a compile error instead.
 */
import { image } from "../../src/providers/krea";
import { expectAssignable } from "./helpers";

function krea2EnumTypeTests(): void {
  const v = image({
    model: "krea-2/medium",
    prompt: "a cinematic glass cabin beside a frozen lake at sunrise",
    aspect_ratio: "16:9",
    resolution: "1K",
    creativity: "medium",
  });
  expectAssignable<"16:9">(v.aspect_ratio);
  expectAssignable<"1K">(v.resolution);
  expectAssignable<"medium">(v.creativity);

  // Other arms of the closed spaces.
  image({ model: "krea-2/large", prompt: "hi", aspect_ratio: "2.35:1", resolution: "1K" });
  image({ model: "krea-2/medium-turbo", prompt: "hi", aspect_ratio: "9:16", resolution: "1K", creativity: "raw" });

  // @ts-expect-error aspect_ratio is a CLOSED enum — 21:9 is not a Krea 2 ratio
  image({ model: "krea-2/medium", prompt: "hi", aspect_ratio: "21:9", resolution: "1K" });
  // @ts-expect-error the empty string never validated either
  image({ model: "krea-2/medium", prompt: "hi", aspect_ratio: "", resolution: "1K" });
  // @ts-expect-error resolution is a CLOSED enum — Krea 2 only ships 1K today
  image({ model: "krea-2/medium", prompt: "hi", aspect_ratio: "1:1", resolution: "2K" });
  // @ts-expect-error the empty string is not a resolution scale
  image({ model: "krea-2/medium", prompt: "hi", aspect_ratio: "1:1", resolution: "" });
  // @ts-expect-error creativity is a CLOSED enum — raw | low | medium | high
  image({ model: "krea-2/medium", prompt: "hi", aspect_ratio: "1:1", resolution: "1K", creativity: "banana" });
  // @ts-expect-error the empty string is not a creativity mode
  image({ model: "krea-2/medium", prompt: "hi", aspect_ratio: "1:1", resolution: "1K", creativity: "" });

  // Model ids keep their escape hatch — a newer route still compiles.
  image({ model: "krea-3/medium", prompt: "hi", aspect_ratio: "1:1", resolution: "1K" });
}

export { krea2EnumTypeTests };
