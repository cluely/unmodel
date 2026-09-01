/**
 * Type-level tests for `unmodel/sfx`'s ready-made pack. NOT run by `bun test` —
 * this file is only type-checked (`bun run check` / tsc --noEmit).
 *
 * The four properties every category entry has are here, and then the one that
 * is this category's own: a canonical field whose **requiredness** is a
 * per-model fact. Three arms:
 *
 * | row | `durationSeconds` | witness |
 * |---|---|---|
 * | `durationRequired: true` | REQUIRED | `fal/cassetteai/sound-effects-generator` |
 * | catalogued, no flag | optional | every other ref in the pack |
 * | uncatalogued / dynamic ref | optional (wide) | `fal/sonilo/v2/…` |
 *
 * That is the avatar three-arm requiredness precedent pointed at a number
 * instead of a picture, and — like avatar's — it cannot be expressed by
 * intersection, which is why `SfxParamsBase` declares neither
 * `durationSeconds` nor `outputFormat` (the replacement-arm law in
 * `vocabulary/model-params.ts`).
 */
import { createSfx, sfx } from "../../src/unified/sfx";
import { sfx as elevenlabsSfx } from "../../src/providers/elevenlabs/unified-sfx";
import { sfx as falSfx } from "../../src/providers/fal/unified-sfx";
import type { UnifiedRef } from "../../src/core/unified/types";
import type { MusicParams } from "../../src/core/unified/vocabulary/music";
import type { SfxParams } from "../../src/core/unified/vocabulary/sfx";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

type PackRefs = UnifiedRef<typeof elevenlabsSfx | typeof falSfx>;

expectAssignable<PackRefs>("elevenlabs/eleven_text_to_sound_v2");
expectAssignable<PackRefs>("fal/fal-ai/elevenlabs/sound-effects/v2");
expectAssignable<PackRefs>("fal/sonilo/v1.1/text-to-sound-effects");
expectAssignable<PackRefs>("fal/cassetteai/sound-effects-generator");
expectAssignable<PackRefs>("fal/mirelo-ai/sfx1.6/text-to-audio");
expectAssignable<PackRefs>("fal/fal-ai/stable-audio-3/small/sfx/text-to-audio");
expectAssignable<PackRefs>("fal/fal-ai/stable-audio-3/small/sfx/base/text-to-audio");
// @ts-expect-error — a MUSIC id. The two wires are disjoint at this vendor.
expectAssignable<PackRefs>("elevenlabs/music_v2");
// @ts-expect-error — Stable Audio's music arm, which is `unmodel/music`'s.
expectAssignable<PackRefs>("fal/fal-ai/stable-audio-3/medium/text-to-audio");
// @ts-expect-error — the vendor's own id spelling, not the one fal publishes.
expectAssignable<PackRefs>("fal/sonilo/sfx/v1.1");

const PROMPT = "a heavy oak door creaking open in a stone hall";

function refUnionTests(): void {
  sfx({ model: "elevenlabs/eleven_text_to_sound_v2", prompt: PROMPT });
  sfx({ model: "fal/sonilo/v1.1/text-to-sound-effects", prompt: PROMPT });
  // A model newer than this snapshot still works, with a runtime warning.
  sfx({ model: "fal/sonilo/v2/text-to-sound-effects", prompt: PROMPT });
  // A provider with no adapter is a runtime structural error, not a type error.
  sfx({ model: "stability/stable-audio-2", prompt: PROMPT });

  // @ts-expect-error — a typo'd canonical field is caught by ExactKeys.
  sfx({ model: "elevenlabs/eleven_text_to_sound_v2", promt: PROMPT });
  // @ts-expect-error — `prompt` is the one word this category cannot do without.
  sfx({ model: "elevenlabs/eleven_text_to_sound_v2" });
  // @ts-expect-error — a word from the neighbouring music vocabulary.
  sfx({ model: "elevenlabs/eleven_text_to_sound_v2", prompt: PROMPT, instrumental: true });
  // @ts-expect-error — …and its seed, which has no witness here either.
  sfx({ model: "fal/sonilo/v1.1/text-to-sound-effects", prompt: PROMPT, seed: 7 });
  // @ts-expect-error — a sizing word: sound has no frame.
  sfx({ model: "elevenlabs/eleven_text_to_sound_v2", prompt: PROMPT, aspectRatio: "16:9" });
}

/**
 * The requiredness narrowing — the property this category exists to make
 * expressible.
 */
function durationArmTests(): void {
  // CassetteAI REQUIRES a length. An intersection could not have made an
  // optional property required, which is why the base declares neither field.
  sfx({ model: "fal/cassetteai/sound-effects-generator", prompt: PROMPT, durationSeconds: 3 });
  // @ts-expect-error — …and omitting it is a 422 on the wire, so it is an error here.
  sfx({ model: "fal/cassetteai/sound-effects-generator", prompt: PROMPT });

  // Every other catalogued ref leaves it optional, because absence there means
  // that provider's own default (or, at ElevenLabs, a prompt-read guess).
  sfx({ model: "elevenlabs/eleven_text_to_sound_v2", prompt: PROMPT });
  sfx({ model: "fal/sonilo/v1.1/text-to-sound-effects", prompt: PROMPT });
  sfx({ model: "fal/fal-ai/stable-audio-3/small/sfx/text-to-audio", prompt: PROMPT });

  // A ref this build cannot read restates the wide optional arm, so a model
  // released after this snapshot stays callable.
  sfx({ model: "fal/cassetteai/sound-effects-generator-v2", prompt: PROMPT });

  // The length is always a plain `number` — the ranges here span 0.1 to 180
  // seconds across six routes, which is the "a range genuinely cannot be a
  // union" case rather than an enum.
  sfx({ model: "fal/mirelo-ai/sfx1.6/text-to-audio", prompt: PROMPT, durationSeconds: 0.5 });
  sfx({ model: "fal/sonilo/v1.1/text-to-sound-effects", prompt: PROMPT, durationSeconds: 180 });
  // @ts-expect-error — but it is a number, not a string, and never `"auto"`.
  sfx({ model: "fal/sonilo/v1.1/text-to-sound-effects", prompt: PROMPT, durationSeconds: "auto" });
}

/** The `outputFormat` narrowing — both spellings, per model. */
function formatArmTests(): void {
  sfx({ model: "elevenlabs/eleven_text_to_sound_v2", prompt: PROMPT, outputFormat: "mp3" });
  sfx({
    model: "elevenlabs/eleven_text_to_sound_v2",
    prompt: PROMPT,
    outputFormat: { format: "opus", sampleRate: 48000 },
  });
  // @ts-expect-error — ElevenLabs' composite has no FLAC arm, in either spelling.
  sfx({ model: "elevenlabs/eleven_text_to_sound_v2", prompt: PROMPT, outputFormat: "flac" });
  sfx({
    model: "elevenlabs/eleven_text_to_sound_v2",
    prompt: PROMPT,
    // @ts-expect-error — …and the object form is narrowed too, which is the half
    // a caller reaches for precisely when they care about the encoding.
    outputFormat: { format: "flac" },
  });

  // Sonilo's bare enum has FLAC and no Opus; Stable Audio has both.
  sfx({ model: "fal/sonilo/v1.1/text-to-sound-effects", prompt: PROMPT, outputFormat: "flac" });
  // @ts-expect-error — Sonilo publishes wav/mp3/aac/flac and nothing else.
  sfx({ model: "fal/sonilo/v1.1/text-to-sound-effects", prompt: PROMPT, outputFormat: "opus" });
  sfx({
    model: "fal/fal-ai/stable-audio-3/small/sfx/text-to-audio",
    prompt: PROMPT,
    outputFormat: "opus",
  });

  // CassetteAI has no encoding field at all, so the whole word is `never`.
  sfx({
    model: "fal/cassetteai/sound-effects-generator",
    prompt: PROMPT,
    durationSeconds: 3,
    // @ts-expect-error — this route answers a fixed encoding.
    outputFormat: "mp3",
  });
}

/** The per-model extras — wire-verbatim, and refused where the model has none. */
function extraTests(): void {
  // `loop` is the word the two-witness rule kept out of the vocabulary. It is
  // still fully typed and fully reachable — as this vendor's own extra.
  sfx({ model: "elevenlabs/eleven_text_to_sound_v2", prompt: PROMPT, loop: true });
  sfx({ model: "fal/fal-ai/elevenlabs/sound-effects/v2", prompt: PROMPT, loop: true });
  // @ts-expect-error — and nowhere else: Sonilo publishes no loop switch.
  sfx({ model: "fal/sonilo/v1.1/text-to-sound-effects", prompt: PROMPT, loop: true });

  sfx({ model: "fal/mirelo-ai/sfx1.6/text-to-audio", prompt: PROMPT, ambience: true });
  // @ts-expect-error — Mirelo's `ambience` is Mirelo's, not the category's.
  sfx({ model: "elevenlabs/eleven_text_to_sound_v2", prompt: PROMPT, ambience: true });

  sfx({
    model: "fal/fal-ai/stable-audio-3/small/sfx/text-to-audio",
    prompt: PROMPT,
    negative_prompt: "music",
    guidance_scale: 3,
    seed: 7,
  });
  // @ts-expect-error — an extra takes its wire type, not `unknown`.
  sfx({ model: "elevenlabs/eleven_text_to_sound_v2", prompt: PROMPT, prompt_influence: "high" });
}

/** `providerOptions` — the escape hatch, typed by provider id. */
function providerOptionsTests(): void {
  sfx({
    model: "elevenlabs/eleven_text_to_sound_v2",
    prompt: PROMPT,
    providerOptions: { elevenlabs: { prompt_influence: 0.9 } },
  });
  sfx({
    model: "fal/sonilo/v1.1/text-to-sound-effects",
    prompt: PROMPT,
    providerOptions: { fal: { audio_format: "wav" } },
  });
}

/** The factory, and the narrowing surviving a one-adapter pack. */
function factoryTests(): void {
  const elevenlabsOnly = createSfx([elevenlabsSfx]);
  elevenlabsOnly({ model: "elevenlabs/eleven_text_to_sound_v2", prompt: PROMPT, loop: true });

  const falOnly = createSfx([falSfx]);
  falOnly({ model: "fal/cassetteai/sound-effects-generator", prompt: PROMPT, durationSeconds: 3 });
  // @ts-expect-error — the required arm survives a one-adapter pack.
  falOnly({ model: "fal/cassetteai/sound-effects-generator", prompt: PROMPT });
}

/**
 * The vocabulary is closed, and it is the smallest in the library. Four words,
 * and every one of them is also a `music` word — which is the shape of two
 * categories that split on the wire rather than on taste.
 */
type SfxWord = "model" | "prompt" | "durationSeconds" | "outputFormat" | "providerOptions";

expectTrue<IsNever<Exclude<SfxWord, KeyIn<SfxParams, SfxWord>>>>();
expectTrue<IsNever<Exclude<keyof SfxParams, SfxWord>>>();
// …and every one of the five is also a `music` word.
expectTrue<IsNever<Exclude<SfxWord, keyof MusicParams>>>();

export { refUnionTests, durationArmTests, formatArmTests, extraTests, providerOptionsTests, factoryTests };
