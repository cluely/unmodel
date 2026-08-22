/**
 * Type-level tests for `unmodel/voice-clone`'s ready-made pack. NOT run by
 * `bun test` — this file is only type-checked (`bun run check` / tsc --noEmit).
 *
 * The category's compile-time claim is stt's, one field over: every sample's
 * `audio` has three legal shapes, which is legal depends on the route, and a
 * `Blob` handed to MiniMax's upload-handle wire is a red squiggle rather than
 * a 400.
 *
 * | route | accepts | `{ file }` | `{ data }` | `{ fileId }` |
 * |---|---|---|---|---|
 * | elevenlabs, fish-audio, cartesia, lmnt | file | ok | error | error |
 * | inworld | data | error | ok | error |
 * | minimax | fileId | error | error | ok |
 */
import { voiceClone, createVoiceClone } from "../../src/unified/voice-clone";
import { voiceClone as cartesiaClone } from "../../src/providers/cartesia/unified-voice-clone";
import { voiceClone as elevenlabsClone } from "../../src/providers/elevenlabs/unified-voice-clone";
import type { VoiceSampleInputFor } from "../../src/core/unified/vocabulary/voice-clone";
import { expectAssignable, expectTrue, type IsNever } from "./helpers";

declare const file: Blob;
const data = "UklGRiQAAABXQVZF";

// ---------------------------------------------------------------------------
// 1 · `samples` narrows per model, at compile time
// ---------------------------------------------------------------------------

function sampleNarrowingTests(): void {
  // --- multipart routes -----------------------------------------------------
  voiceClone({ model: "elevenlabs/ivc", operation: "clone", name: "n", samples: [{ audio: { file } }] });
  // @ts-expect-error — POST /v1/voices/add takes multipart parts, not base64.
  voiceClone({ model: "elevenlabs/ivc", operation: "clone", name: "n", samples: [{ audio: { data } }] });

  voiceClone({
    model: "fish-audio/fast",
    operation: "clone",
    name: "n",
    visibility: "private",
    samples: [{ audio: { file }, transcript: "hello" }],
  });
  // @ts-expect-error — POST /model has no upload-handle field.
  voiceClone({ model: "fish-audio/fast", operation: "clone", name: "n", samples: [{ audio: { fileId: "1" } }] });

  voiceClone({
    model: "cartesia/voice-clone",
    operation: "clone",
    name: "n",
    language: "en",
    samples: [{ audio: { file } }],
  });
  voiceClone({ model: "lmnt/voice-clone", operation: "clone", name: "n", samples: [{ audio: { file } }] });

  // --- base64-in-JSON -------------------------------------------------------
  voiceClone({ model: "inworld/voice-clone", operation: "clone", name: "n", samples: [{ audio: { data } }] });
  // @ts-expect-error — voices:clone carries base64 in the body; compile is synchronous, a Blob cannot become it.
  voiceClone({ model: "inworld/voice-clone", operation: "clone", name: "n", samples: [{ audio: { file } }] });

  // --- upload-handle --------------------------------------------------------
  voiceClone({
    model: "minimax/voice-clone",
    operation: "clone",
    voiceId: "MyVoice01",
    samples: [{ audio: { fileId: "123456789" } }],
  });
  // @ts-expect-error — POST /v1/voice_clone takes a file_id from /v1/files/upload, never bytes.
  voiceClone({ model: "minimax/voice-clone", operation: "clone", voiceId: "MyVoice01", samples: [{ audio: { file } }] });
}

// The `InputFor` helper answers the same question standalone.
expectAssignable<VoiceSampleInputFor<"file">>({ file });
expectTrue<IsNever<Extract<VoiceSampleInputFor<"file">, { data: string }>>>();

// ---------------------------------------------------------------------------
// 2 · the discriminant and the vocabulary are closed
// ---------------------------------------------------------------------------

function vocabularyTests(): void {
  // @ts-expect-error — the clone surface serves exactly operation: "clone".
  voiceClone({ model: "elevenlabs/ivc", operation: "design", name: "n", samples: [{ audio: { file } }] });
  // @ts-expect-error — `prompt` is voice-design's word; here the metadata word is `description`.
  voiceClone({ model: "elevenlabs/ivc", operation: "clone", name: "n", samples: [{ audio: { file } }], prompt: "p" });
}

// ---------------------------------------------------------------------------
// 3 · per-model narrowing: language completes, extras gate
// ---------------------------------------------------------------------------

function narrowingTests(): void {
  // Cartesia's list completes without gating: an off-list BCP-47 tag compiles
  // (the wire's own enum check refuses it at runtime, at error severity).
  voiceClone({
    model: "cartesia/voice-clone",
    operation: "clone",
    name: "n",
    language: "pt-BR",
    samples: [{ audio: { file } }],
  });

  // An extra the model's table does not carry is a compile error.
  voiceClone({
    model: "lmnt/voice-clone",
    operation: "clone",
    name: "n",
    samples: [{ audio: { file } }],
    // @ts-expect-error — `tagline` is Cartesia's extra, not LMNT's.
    tagline: "warm",
  });
}

// ---------------------------------------------------------------------------
// 4 · the ref union and custom packs
// ---------------------------------------------------------------------------

type PackRef = Parameters<typeof voiceClone>[0]["model"];
expectAssignable<PackRef>("elevenlabs/ivc");
expectAssignable<PackRef>("minimax/voice-clone");

const two = createVoiceClone([elevenlabsClone, cartesiaClone]);
function customPackTests(): void {
  two({ model: "elevenlabs/ivc", operation: "clone", name: "n", samples: [{ audio: { file } }] });
  // @ts-expect-error — inworld is not in this two-provider pack.
  two({ model: "inworld/voice-clone", operation: "clone", name: "n", samples: [{ audio: { data } }] });
}

void sampleNarrowingTests;
void vocabularyTests;
void narrowingTests;
void customPackTests;
