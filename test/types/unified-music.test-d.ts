/**
 * Type-level tests for `unmodel/music`'s ready-made pack. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc --noEmit).
 *
 * Small on purpose, like the category: two providers, one route each, and a
 * vocabulary of five words. What is worth pinning is that the four properties
 * every category entry has hold here too — the ref union comes from the
 * adapters, the result is the ref'd provider's own `Validated`,
 * `providerOptions` is keyed by the pack, and there is no `.toApi`.
 */
import { createMusic, music } from "../../src/unified/music";
import { music as elevenlabsMusic } from "../../src/providers/elevenlabs/unified-music";
import { music as stabilityMusic } from "../../src/providers/stability/unified-music";
import type { UnifiedRef } from "../../src/core/unified/types";
import type { MusicParams } from "../../src/core/unified/vocabulary/music";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

type PackRefs = UnifiedRef<typeof elevenlabsMusic | typeof stabilityMusic>;

expectAssignable<PackRefs>("elevenlabs/music_v1");
expectAssignable<PackRefs>("elevenlabs/music_v2");
expectAssignable<PackRefs>("stability/stable-audio-2");
expectAssignable<PackRefs>("stability/stable-audio-2.5");
// @ts-expect-error — stable-audio-3 is catalogued but served by the async routes.
expectAssignable<PackRefs>("stability/stable-audio-3");
// @ts-expect-error — and the sound-effects model is not a music model.
expectAssignable<PackRefs>("elevenlabs/eleven_text_to_sound_v2");

function refUnionTests(): void {
  music({ model: "elevenlabs/music_v1", prompt: "slow post-rock build" });
  music({ model: "stability/stable-audio-2", prompt: "rain on a tin roof", durationSeconds: 30 });
  // A model newer than this snapshot still works, with a runtime warning.
  music({ model: "elevenlabs/music_v3", prompt: "hi" });
  // A provider with no adapter is a runtime structural error, not a type error.
  music({ model: "suno/v5", prompt: "hi" });

  // @ts-expect-error — `prompt` is not optional; there is nothing to generate.
  music({ model: "elevenlabs/music_v1", durationSeconds: 30 });
  // @ts-expect-error — a typo'd canonical field is caught by ExactKeys.
  music({ model: "elevenlabs/music_v1", prompt: "hi", duration: 30 });
  // @ts-expect-error — the unit is in the name, and it is seconds.
  music({ model: "elevenlabs/music_v1", prompt: "hi", durationSeconds: "90s" });

  // A field the provider cannot express is a RUNTIME error (declared on the
  // adapter), never a compile error: the vocabulary is one shape for everyone.
  music({ model: "stability/stable-audio-2", prompt: "hi", instrumental: true });
}

function resultTypeTests(): void {
  const elevenlabs = music({ model: "elevenlabs/music_v1", prompt: "hi", durationSeconds: 90 });
  expectAssignable<number | null | undefined>(elevenlabs.music_length_ms);
  expectAssignable<string>(elevenlabs.request.url);
  elevenlabs.toSdk("elevenlabs");
  // @ts-expect-error — "stability" is not one of elevenlabs.music's SDK targets.
  elevenlabs.toSdk("stability");
  // `output_format` is a query param, stripped from the wire body.
  expectTrue<IsNever<KeyIn<typeof elevenlabs, "output_format">>>();

  const stability = music({ model: "stability/stable-audio-2", prompt: "hi", durationSeconds: 90 });
  expectAssignable<number | undefined>(stability.duration);
  expectAssignable<string>(stability.prompt);
  stability.toSdk("stability");

  expectAssignable<readonly { code: string }[]>(elevenlabs.warnings);
  expectAssignable<readonly { code: string }[]>(stability.warnings);
}

function providerOptionsTests(): void {
  music({
    model: "elevenlabs/music_v1",
    prompt: "hi",
    providerOptions: {
      elevenlabs: { use_phonetic_names: true },
      stability: { steps: 50 },
    },
  });
  // @ts-expect-error — but not for a provider this pack does not have.
  music({ model: "elevenlabs/music_v1", prompt: "hi", providerOptions: { suno: {} } });

  const one = createMusic([elevenlabsMusic]);
  one({ model: "elevenlabs/music_v1", prompt: "hi", providerOptions: { elevenlabs: {} } });
  // @ts-expect-error — stability is not in THIS pack, even though it is in the full one.
  one({ model: "elevenlabs/music_v1", prompt: "hi", providerOptions: { stability: {} } });
}

function noToApiTests(): void {
  const result = music({ model: "elevenlabs/music_v1", prompt: "hi" });
  expectTrue<IsNever<KeyIn<typeof result, "toApi">>>();
  expectTrue<IsNever<KeyIn<typeof result, "toApiSafe">>>();
  expectTrue<KeyIn<typeof result, "toSdk"> extends "toSdk" ? true : false>();
  expectTrue<KeyIn<typeof result, "request"> extends "request" ? true : false>();
}

expectAssignable<"music">(elevenlabsMusic.category);
expectAssignable<"elevenlabs">(elevenlabsMusic.provider);
expectAssignable<readonly string[]>(elevenlabsMusic.models);
expectAssignable<MusicParams["model"]>("elevenlabs/music_v1");

export { refUnionTests, resultTypeTests, providerOptionsTests, noToApiTests };
