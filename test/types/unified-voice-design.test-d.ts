/**
 * Type-level tests for `unmodel/voice-design`'s ready-made pack. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc --noEmit).
 *
 * The load-bearing claim here is the per-model EXTRAS gate: ElevenLabs' two
 * text-to-voice models share one wire but genuinely diverge on two fields
 * ("only supported when using the eleven_ttv_v3 model"), and the table is
 * what turns that doc sentence into a red squiggle.
 */
import { voiceDesign, createVoiceDesign } from "../../src/unified/voice-design";
import { voiceDesign as elevenlabsDesign } from "../../src/providers/elevenlabs/unified-voice-design";
import { voiceDesign as minimaxDesign } from "../../src/providers/minimax/unified-voice-design";
import { expectAssignable } from "./helpers";

const PROMPT = "An elderly British gentleman with a warm, gravelly storytelling tone";

// ---------------------------------------------------------------------------
// 1 · the v3-only extras gate per model
// ---------------------------------------------------------------------------

function extrasGateTests(): void {
  voiceDesign({
    model: "elevenlabs/eleven_ttv_v3",
    operation: "design",
    prompt: PROMPT,
    prompt_strength: 0.5,
    reference_audio_base64: "AAAA",
  });
  voiceDesign({
    model: "elevenlabs/eleven_multilingual_ttv_v2",
    operation: "design",
    prompt: PROMPT,
    loudness: 0.5,
    // @ts-expect-error — "only supported when using the eleven_ttv_v3 model".
    prompt_strength: 0.5,
  });
}

// ---------------------------------------------------------------------------
// 2 · the discriminant and the words
// ---------------------------------------------------------------------------

function vocabularyTests(): void {
  // @ts-expect-error — the design surface serves exactly operation: "design".
  voiceDesign({ model: "minimax/voice-design", operation: "clone", prompt: PROMPT, previewText: "hi." });
  // @ts-expect-error — `description` is voice-clone's metadata word; the generative word here is `prompt`.
  voiceDesign({ model: "minimax/voice-design", operation: "design", description: PROMPT });
  // @ts-expect-error — `samples` belongs to voice-clone; design has no media input.
  voiceDesign({ model: "minimax/voice-design", operation: "design", prompt: PROMPT, samples: [] });
}

// ---------------------------------------------------------------------------
// 3 · the ref union and custom packs
// ---------------------------------------------------------------------------

type PackRef = Parameters<typeof voiceDesign>[0]["model"];
expectAssignable<PackRef>("fish-audio/voice-design-1");
expectAssignable<PackRef>("elevenlabs/eleven_ttv_v3");

const two = createVoiceDesign([elevenlabsDesign, minimaxDesign]);
function customPackTests(): void {
  two({ model: "minimax/voice-design", operation: "design", prompt: PROMPT, previewText: "hi." });
  // A ref outside the pack still COMPILES — the `(string & {})` tail is the
  // library-wide law that a model list completes and never gates — and is
  // refused structurally at runtime (TranslationUnavailableError).
  two({ model: "fish-audio/voice-design-1", operation: "design", prompt: PROMPT });
}

void extrasGateTests;
void vocabularyTests;
void customPackTests;
