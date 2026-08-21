/**
 * Type-level tests for unmodel/google. Not executed by `bun test` —
 * type-checked by `bun run check` (tsc --noEmit).
 */
import type {
  GenerateContentParameters,
  GenerateImagesParameters,
  GenerateVideosParameters,
} from "@google/genai";
import { chat, image, video, type GenerateImagesBody } from "../../src/providers/google";
import { checkChat as googleCheckChat } from "../../src/providers/google";
import type { GoogleFinishReason } from "../../src/providers/google";
import type { ResponseReport } from "../../src/core/report";
import type { GoogleTextModelId } from "../../src/catalog/google.gen";
import { GEMINI_IMAGE_MODEL_RULES } from "../../src/providers/google/constraints";
import { chatModels } from "../../src/providers/google/tts-models";
import type { GeminiTtsVoiceName } from "../../src/providers/google/wire";
import type {
  VeoParameterModelId,
  VeoParametersArm,
  VEO_PARAMETER_SPACE,
} from "../../src/providers/google/video";
import { video as googleVideoAdapter } from "../../src/providers/google/unified-video";
import { expectAssignable, expectTrue, type HasLiteralMember, type IsNever } from "./helpers";

const validated = chat({
  model: "gemini-2.5-flash",
  contents: [{ role: "user", parts: [{ text: "hi" }] }],
  systemInstruction: { parts: [{ text: "be brief" }] },
  generationConfig: {
    temperature: 0.5,
    maxOutputTokens: 256,
    responseMimeType: "application/json",
    thinkingConfig: { thinkingBudget: 128, includeThoughts: true },
  },
  cachedContent: "cachedContents/abc123",
});

// The SDK re-shape is directly usable as ai.models.generateContent(...) input.
expectAssignable<GenerateContentParameters>(validated.toSdk("google"));

// A bare request (no config-feeding keys) is assignable too.
expectAssignable<GenerateContentParameters>(
  chat({
    model: "gemini-2.5-flash",
    contents: [{ parts: [{ text: "hi" }] }],
  }).toSdk("google"),
);

// Enum-valued config leaves: @google/genai declares TS string enums
// (HarmCategory, HarmBlockThreshold, MediaResolution, ThinkingLevel, …).
// Wire string literals are runtime-identical but nominally incompatible, so
// toSdk("google") output carrying such fields needs the documented cast at the SDK
// call site (see the SDK-view comment in chat.ts).
const withSafety = chat({
  model: "gemini-2.5-flash",
  contents: [{ role: "user", parts: [{ text: "hi" }] }],
  safetySettings: [
    { category: "HARM_CATEGORY_JAILBREAK", threshold: "BLOCK_LOW_AND_ABOVE" },
  ],
});
// @ts-expect-error wire HarmCategory literals are not assignable to the SDK's TS enum without a cast
expectAssignable<GenerateContentParameters>(withSafety.toSdk("google"));
// The documented escape hatch typechecks.
expectAssignable<GenerateContentParameters>(
  withSafety.toSdk("google") as unknown as GenerateContentParameters,
);

// serviceTier is a first-class wire field and lands under config in the SDK
// view; store is wire-only (dropped by toSdk("google")).
const withTier = chat({
  model: "gemini-2.5-flash",
  contents: [{ role: "user", parts: [{ text: "hi" }] }],
  serviceTier: "flex",
  store: true,
});
expectAssignable<{ config?: { serviceTier: "flex" } }>(withTier.toSdk("google"));

// Typo'd top-level keys are a compile error (ExactKeys guard), not a silent
// runtime warning.
chat({
  model: "gemini-2.5-flash",
  contents: [{ role: "user", parts: [{ text: "hi" }] }],
  // @ts-expect-error excess (typo'd) top-level key
  generationconfig: { temperature: 0.5 },
});

// The validated wire body has no `model` — it lives only in .request.url.
// @ts-expect-error model is stripped from the validated body
validated.model;

// The wire body itself is spreadable/serializable with contents intact.
expectAssignable<{ contents: unknown }>(validated);

// Model id union sanity: catalog ids autocomplete, foreign ids are rejected.
expectAssignable<GoogleTextModelId>("gemini-2.5-flash");
// @ts-expect-error not a Google model id
expectAssignable<GoogleTextModelId>("gpt-4o");

// Roles are only "user" | "model" on the wire.
chat({
  model: "gemini-2.5-flash",
  contents: [
    {
      // @ts-expect-error role must be "user" | "model"
      role: "assistant",
      parts: [{ text: "hi" }],
    },
  ],
});

// ---------------------------------------------------------------------------
// video (Veo) — toSdk("google") targets ai.models.generateVideos().
// ---------------------------------------------------------------------------

const veo = video({
  model: "veo-3.1-generate-preview",
  instances: [
    {
      prompt: "a hummingbird in slow motion",
      image: { bytesBase64Encoded: "aGk=", mimeType: "image/png" },
      lastFrame: { bytesBase64Encoded: "aGk=", mimeType: "image/png" },
    },
  ],
  parameters: {
    aspectRatio: "16:9",
    durationSeconds: 8,
    resolution: "1080p",
    personGeneration: "allow_adult",
    negativePrompt: "rain",
    sampleCount: 1,
  },
});

// The SDK re-shape is directly usable as ai.models.video(...) input
// (GenerateVideosConfig's leaves are plain string/number-typed).
expectAssignable<GenerateVideosParameters>(veo.toSdk("google"));

// referenceType is the one enum-typed leaf (VideoGenerationReferenceType) —
// the wire literal needs the documented cast at the SDK call site, exactly
// like the generateContent safety enums above.
const veoWithReferences = video({
  model: "veo-3.1-generate-preview",
  instances: [
    {
      prompt: "in this style",
      referenceImages: [{ image: { bytesBase64Encoded: "aGk=" }, referenceType: "asset" }],
    },
  ],
});
// @ts-expect-error wire referenceType literals are not assignable to the SDK's TS enum without a cast
expectAssignable<GenerateVideosParameters>(veoWithReferences.toSdk("google"));
// The documented escape hatch typechecks.
expectAssignable<GenerateVideosParameters>(
  veoWithReferences.toSdk("google") as unknown as GenerateVideosParameters,
);

// Typo'd top-level keys are a compile error (ExactKeys guard).
video({
  model: "veo-3.1-generate-preview",
  instances: [{ prompt: "hi" }],
  // @ts-expect-error excess (typo'd) top-level key
  parametrs: { aspectRatio: "16:9" },
});

// The validated wire body has no `model` — it lives only in .request.url.
// @ts-expect-error model is stripped from the validated body
veo.model;

// The wire body itself is spreadable/serializable with instances intact.
expectAssignable<{ instances: unknown }>(veo);

// ---------------------------------------------------------------------------
// generateImages (Imagen) — toSdk("google") targets ai.models.generateImages().
// ---------------------------------------------------------------------------

const imagen = image({
  model: "imagen-4.0-generate-001",
  instances: [{ prompt: "Robot holding a red skateboard" }],
  parameters: { sampleCount: 4, aspectRatio: "16:9", sampleImageSize: "2K" },
});

// The SDK re-shape is directly usable as ai.models.generateImages(...) input.
expectAssignable<GenerateImagesParameters>(imagen.toSdk("google"));

// Vertex-only knobs have no Gemini API wire form: `never` makes them compile errors.
image({
  model: "imagen-4.0-generate-001",
  instances: [{ prompt: "hi" }],
  // @ts-expect-error negativePrompt is Vertex AI-only
  parameters: { negativePrompt: "blurry" },
});
image({
  model: "imagen-4.0-generate-001",
  instances: [{ prompt: "hi" }],
  // @ts-expect-error seed is Vertex AI-only
  parameters: { seed: 7 },
});

// GROUND TRUTH: `sampleImageSize` (SDK imageSize) is Standard/Ultra only —
// the SDK's own config type allows it for every Imagen model.
image({
  model: "imagen-4.0-fast-generate-001",
  instances: [{ prompt: "hi" }],
  // @ts-expect-error sampleImageSize is not supported by the Fast model
  parameters: { sampleImageSize: "1K" },
});

// The exported body alias keeps the same per-model narrowing.
// @ts-expect-error — aliasing cannot route Imagen Fast through the loose arm
const aliasedInvalidImagen: GenerateImagesBody = {
  model: "imagen-4.0-fast-generate-001",
  instances: [{ prompt: "hi" }],
  parameters: { sampleImageSize: "1K" },
};
void aliasedInvalidImagen;
const futureImagen: GenerateImagesBody<"imagen-9.9-imaginary"> = {
  model: "imagen-9.9-imaginary",
  instances: [{ prompt: "hi" }],
  parameters: { futureControl: true },
};
image(futureImagen);

// Imagen's aspect ratios are the narrow five, not Nano Banana's fourteen.
image({
  model: "imagen-4.0-generate-001",
  instances: [{ prompt: "hi" }],
  // @ts-expect-error 21:9 is a Nano Banana ratio; Imagen documents five
  parameters: { aspectRatio: "21:9" },
});

// personGeneration is one of the SDK's TS-enum leaves, so a request carrying
// it needs the documented cast at the SDK call site.
const imagenWithPerson = image({
  model: "imagen-4.0-generate-001",
  instances: [{ prompt: "a crowd" }],
  parameters: { personGeneration: "allow_adult" },
});
// @ts-expect-error wire personGeneration literals are not assignable to the SDK's TS enum without a cast
expectAssignable<GenerateImagesParameters>(imagenWithPerson.toSdk("google"));
expectAssignable<GenerateImagesParameters>(
  imagenWithPerson.toSdk("google") as unknown as GenerateImagesParameters,
);

// Typo'd top-level keys are a compile error (ExactKeys guard).
image({
  model: "imagen-4.0-generate-001",
  instances: [{ prompt: "hi" }],
  // @ts-expect-error excess (typo'd) top-level key
  parametrs: { sampleCount: 1 },
});

// The validated wire body has no `model` — it lives only in .request.url.
// @ts-expect-error model is stripped from the validated body
imagen.model;

// ---------------------------------------------------------------------------
// generateContent: the image/speech generation configs.
// ---------------------------------------------------------------------------

const nanoBanana = chat({
  model: "gemini-3.1-flash-image",
  contents: [{ role: "user", parts: [{ text: "a nano banana dish" }] }],
  generationConfig: {
    responseModalities: ["TEXT", "IMAGE"],
    // The flat spelling …
    imageConfig: { aspectRatio: "21:9", imageSize: "4K" },
  },
});
expectAssignable<GenerateContentParameters>(nanoBanana.toSdk("google"));

// … and the responseFormat spelling the current guide's REST samples use.
expectAssignable<GenerateContentParameters>(
  chat({
    model: "gemini-3.1-flash-image",
    contents: [{ parts: [{ text: "hi" }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      responseFormat: { image: { aspectRatio: "16:9", imageSize: "2K" } },
    },
  }).toSdk("google"),
);

// The REST reference types aspectRatio/imageSize as proto enums while the
// guide's samples pass "16:9"/"2K"; both spellings validate, so both compile.
chat({
  model: "gemini-3.1-flash-image",
  contents: [{ parts: [{ text: "hi" }] }],
  generationConfig: {
    imageConfig: {
      aspectRatio: "ASPECT_RATIO_SIXTEEN_BY_NINE",
      imageSize: "IMAGE_SIZE_TWO_K",
    },
  },
});
chat({
  model: "gemini-3.1-flash-image",
  contents: [{ parts: [{ text: "hi" }] }],
  generationConfig: {
    responseFormat: {
      image: { aspectRatio: "ASPECT_RATIO_TWENTY_ONE_BY_NINE", imageSize: "IMAGE_SIZE_FOUR_K" },
    },
  },
});

// Junk no longer slips through the old `(string & {})` tail.
chat({
  model: "gemini-3.1-flash-image",
  contents: [{ parts: [{ text: "hi" }] }],
  // @ts-expect-error banana is not an aspect ratio in either spelling
  generationConfig: { imageConfig: { aspectRatio: "banana" } },
});
chat({
  model: "gemini-3.1-flash-image",
  contents: [{ parts: [{ text: "hi" }] }],
  // @ts-expect-error the empty string used to compile through `(string & {})`
  generationConfig: { imageConfig: { imageSize: "" } },
});
chat({
  model: "gemini-3.1-flash-image",
  contents: [{ parts: [{ text: "hi" }] }],
  // @ts-expect-error responseFormat.image is narrowed identically to imageConfig
  generationConfig: { responseFormat: { image: { aspectRatio: "" } } },
});

// Vertex-only ImageConfig leaves are compile errors ("not supported in Gemini API").
chat({
  model: "gemini-3.1-flash-image",
  contents: [{ parts: [{ text: "hi" }] }],
  generationConfig: {
    // @ts-expect-error outputMimeType is a Vertex AI-only ImageConfig field
    imageConfig: { outputMimeType: "image/png" },
  },
});

// TTS rides generateContent: speechConfig is fully typed, single or multi-speaker.
expectAssignable<GenerateContentParameters>(
  chat({
    model: "gemini-3.1-flash-tts-preview",
    contents: [{ parts: [{ text: "Say cheerfully: have a wonderful day!" }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
    },
  }).toSdk("google"),
);
expectAssignable<GenerateContentParameters>(
  chat({
    model: "gemini-3.1-flash-tts-preview",
    contents: [{ parts: [{ text: "Joe: hi\nJane: hello" }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            { speaker: "Joe", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
            { speaker: "Jane", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
          ],
        },
      },
    },
  }).toSdk("google"),
);

// speakerVoiceConfigs entries require both documented fields.
chat({
  model: "gemini-3.1-flash-tts-preview",
  contents: [{ parts: [{ text: "hi" }] }],
  generationConfig: {
    responseModalities: ["AUDIO"],
    speechConfig: {
      multiSpeakerVoiceConfig: {
        // @ts-expect-error `speaker` is Required on SpeakerVoiceConfig
        speakerVoiceConfigs: [{ voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } }],
      },
    },
  },
});

// video: `seed` is a documented Veo 3 parameter (the SDK rejects it).
expectAssignable<{ instances: unknown }>(
  video({
    model: "veo-3.1-generate-preview",
    instances: [{ prompt: "a hummingbird" }],
    parameters: { seed: 42 },
  }),
);

// ---------------------------------------------------------------------------
// `.toSdk(target)` is parameterized; the zero-arg form is gone.
// ---------------------------------------------------------------------------

// @ts-expect-error — `.toSdk()` no longer exists; name the target.
validated.toSdk();
// @ts-expect-error — this endpoint declares "google", not the Vertex client.
validated.toSdk("google-vertex");

// ---------------------------------------------------------------------------
// `.toApi(provider)` — the union is the model's own availability, read from
// the FOURTH type param, because generateContent strips `model` into the URL.
// ---------------------------------------------------------------------------

// @ts-expect-error — `model` is stripped; it lives in `.request.url`.
validated.model;

// …yet the availability lookup still resolves.
const geminiRouted = validated.toApi("openrouter");
expectAssignable<"google/gemini-2.5-flash" | (string & {})>(geminiRouted.model);
expectAssignable<string>(geminiRouted.request.url);
validated.toApi("vercel");

// @ts-expect-error — anthropic does not serve Gemini.
validated.toApi("anthropic");
// @ts-expect-error — groq does not serve "gemini-2.5-flash".
validated.toApi("groq");
// @ts-expect-error — google-vertex needs project + location a one-arg call never had.
validated.toApi("google-vertex");
// @ts-expect-error — one hop only.
geminiRouted.toApi("vercel");

// ---------------------------------------------------------------------------
// Media endpoints declare NO api targets, so `.toApi` does not exist at all —
// that is how ~106 endpoints opt out at zero type cost (`Avail = never`).
// ---------------------------------------------------------------------------

const veoForApi = video({
  model: "veo-3.1-generate-preview",
  instances: [{ prompt: "a hummingbird" }],
});
// @ts-expect-error — video declares no `.toApi` targets.
veoForApi.toApi("vercel");
// @ts-expect-error — nor `.toApiSafe`.
veoForApi.toApiSafe("vercel");
// @ts-expect-error — and no "ai-sdk" target: experimental_generateVideo is not stable.
veoForApi.toSdk("ai-sdk");

const imagenForApi = image({
  model: "imagen-4.0-generate-001",
  instances: [{ prompt: "a robot" }],
});
// @ts-expect-error — image declares no `.toApi` targets either.
imagenForApi.toApi("vercel");

// ---------------------------------------------------------------------------
// Gemini TTS `voiceName` is the closed 30-voice preset list, not `string`.
//
// The runtime has always reported `invalid_enum_value` naming all 30 for
// anything off it (`checkVoiceName` in chat.ts); the type says the same thing
// now, which is what turns a round trip into a red squiggle.
// ---------------------------------------------------------------------------

/** Exactly the array's members — a hand-widened alias would fail this. */
expectTrue<Same<GeminiTtsVoiceName, (typeof import("../../src/providers/google"))["GEMINI_TTS_VOICES"][number]>>();

chat({
  model: "gemini-3.1-flash-tts-preview",
  contents: [{ parts: [{ text: "hi" }] }],
  generationConfig: {
    responseModalities: ["AUDIO"],
    // @ts-expect-error "Bartholomew" is not one of the 30 preset voices.
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Bartholomew" } } },
  },
});
chat({
  model: "gemini-3.1-flash-tts-preview",
  contents: [{ parts: [{ text: "hi" }] }],
  generationConfig: {
    responseModalities: ["AUDIO"],
    speechConfig: {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          // @ts-expect-error the multi-speaker path is the same closed union.
          { speaker: "Joe", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyrr" } } },
        ],
      },
    },
  },
});
// There is deliberately no `(string & {})` tail: a runtime-built voice needs
// the cast, which is correct — the validator would reject an unlisted one.
declare const runtimeVoice: string;
expectAssignable<GeminiTtsVoiceName>(runtimeVoice as GeminiTtsVoiceName);

// ---------------------------------------------------------------------------
// The two google tables keep their literals (`as const satisfies`, not `:`).
//
// An annotation type-checks the same rows and erases them, which is invisible
// to every other test in the repo: the narrowing built on such a table
// compiles green and completes nothing.
// ---------------------------------------------------------------------------

expectTrue<Same<(typeof GEMINI_IMAGE_MODEL_RULES)["gemini-3-pro-image"]["imageSizes"], readonly ["1K", "2K", "4K"]>>();
expectTrue<Same<(typeof GEMINI_IMAGE_MODEL_RULES)["gemini-3.1-flash-lite-image"]["imageSizes"], readonly ["512", "1K"]>>();
// `gemini-2.5-flash-image` carries no `imageSizes` at all — a single fixed
// resolution — and the row type says so rather than offering `string[]`.
expectTrue<IsNever<Extract<keyof (typeof GEMINI_IMAGE_MODEL_RULES)["gemini-2.5-flash-image"], "imageSizes">>>();
// @ts-expect-error the table's keys are closed now: an uncataloged id is a
// compile error, which is what the `Object.hasOwn` guard in chat.ts exists for.
GEMINI_IMAGE_MODEL_RULES["gemini-9.9-flash-image"];

// The catalog overlay keeps every generated row's flags…
expectTrue<Same<(typeof chatModels)["gemini-2.5-flash"]["reasoning"], true>>();
// …and states the overlay's own honest uncertainty for the three TTS ids: the
// doc-sourced 32k when models.dev still lists the id, the generated 8192 when
// the guard finds nothing to override.
expectTrue<Same<(typeof chatModels)["gemini-3.1-flash-tts-preview"]["limit"]["context"], 8192 | 32768>>();

// ---------------------------------------------------------------------------
// google.video: the wire arm is per model, and it AGREES with the unified table
//
// This is the drift test in type space. `google.video` accepted
// `resolution: "4k"` on Veo 2 while `unmodel/video` — the surface that
// compiles down to it — refused the same fact, because two tables in the same
// package described the same models and nothing compared them. They are one
// table now (`VEO_PARAMETER_SPACE`, read by `./unified-video`), and the
// assertions below fail in BOTH directions if that ever stops being true.
// ---------------------------------------------------------------------------

/** Mutual assignability: a widening on either side fails, not just a narrowing. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type UnifiedVideoRows = (typeof googleVideoAdapter)["modelParams"];

/** Neither table may carry a model the other does not. */
expectTrue<IsNever<Exclude<VeoParameterModelId, keyof UnifiedVideoRows>>>();
expectTrue<IsNever<Exclude<keyof UnifiedVideoRows, VeoParameterModelId>>>();

/** Per model, the wire field's value space vs the unified row's list. */
type Drifted<M extends VeoParameterModelId> =
  Same<NonNullable<VeoParametersArm<M>["resolution"]>, UnifiedVideoRows[M]["resolutions"][number]> extends true
    ? Same<NonNullable<VeoParametersArm<M>["durationSeconds"]>, UnifiedVideoRows[M]["durations"][number]> extends true
      ? Same<NonNullable<VeoParametersArm<M>["aspectRatio"]>, UnifiedVideoRows[M]["ratios"][number]> extends true
        ? never
        : M
      : M
    : M;

expectTrue<IsNever<{ [M in VeoParameterModelId]: Drifted<M> }[VeoParameterModelId]>>();

/**
 * `personGeneration` is the one field where the two sources genuinely differ,
 * and the difference is asserted rather than smoothed over: where Google
 * publishes a list, both surfaces carry it; where it publishes none (Omni),
 * the unified row says `string` — all a row can say — and the wire keeps the
 * documented three-value union instead of widening to match.
 */
type WithPublishedPersonGeneration = {
  [M in VeoParameterModelId]: (typeof VEO_PARAMETER_SPACE)[M] extends {
    personGeneration: readonly string[];
  }
    ? M
    : never;
}[VeoParameterModelId];

type PersonDrifted<M extends WithPublishedPersonGeneration> = Same<
  NonNullable<VeoParametersArm<M>["personGeneration"]>,
  UnifiedVideoRows[M]["extras"]["personGeneration"]
> extends true
  ? never
  : M;

expectTrue<
  IsNever<{ [M in WithPublishedPersonGeneration]: PersonDrifted<M> }[WithPublishedPersonGeneration]>
>();
expectTrue<Same<WithPublishedPersonGeneration, Exclude<VeoParameterModelId, "gemini-omni-flash-preview">>>();
expectTrue<Same<UnifiedVideoRows["gemini-omni-flash-preview"]["extras"]["personGeneration"], string>>();
expectTrue<
  Same<
    NonNullable<VeoParametersArm<"gemini-omni-flash-preview">["personGeneration"]>,
    "allow_all" | "allow_adult" | "dont_allow"
  >
>();

// The four calls the wire used to accept while the unified layer refused them.
video({
  model: "veo-2.0-generate-001",
  instances: [{ prompt: "a hummingbird" }],
  // @ts-expect-error Veo 2 has no `resolution` parameter at all.
  parameters: { resolution: "4k" },
});
video({
  model: "veo-3.1-generate-preview",
  instances: [{ prompt: "a hummingbird" }],
  // @ts-expect-error `dont_allow` is Veo 2-only.
  parameters: { personGeneration: "dont_allow" },
});
video({
  model: "veo-3.1-lite-generate-preview",
  instances: [{ prompt: "a hummingbird" }],
  // @ts-expect-error Lite stops at 1080p.
  parameters: { resolution: "4k" },
});
video({
  model: "gemini-omni-flash-preview",
  instances: [{ prompt: "a hummingbird" }],
  // @ts-expect-error Omni is 720p and 3-10s.
  parameters: { resolution: "1080p", durationSeconds: 20 },
});
// …and the same four facts, each on the model that DOES document them.
expectAssignable<{ instances: unknown }>(
  video({
    model: "veo-3.1-generate-preview",
    instances: [{ prompt: "a hummingbird" }],
    parameters: { resolution: "4k", durationSeconds: 8, personGeneration: "allow_adult" },
  }),
);
expectAssignable<{ instances: unknown }>(
  video({
    model: "veo-2.0-generate-001",
    instances: [{ prompt: "a hummingbird" }],
    parameters: { personGeneration: "dont_allow", durationSeconds: 5, sampleCount: 2 },
  }),
);
expectAssignable<{ instances: unknown }>(
  video({
    model: "gemini-omni-flash-preview",
    instances: [{ prompt: "a hummingbird" }],
    parameters: { resolution: "720p", durationSeconds: 3 },
  }),
);

/**
 * The degraded arm: a run-time model id has no row, so `parameters` keeps the
 * wide documented type — the same trade `unknown_model` makes at run time, and
 * the reason a model released after this snapshot stays callable.
 */
declare const runtimeVideoModel: string;
expectAssignable<{ instances: unknown }>(
  video({
    model: runtimeVideoModel,
    instances: [{ prompt: "a hummingbird" }],
    parameters: { resolution: "4k", durationSeconds: 12, personGeneration: "dont_allow" },
  }),
);

/**
 * `sampleCount` is deliberately NOT narrowed per model: `videoConstraints`
 * bounds it (1 on Veo 3.x, 1-2 on Veo 2) but no unified row carries it, so
 * there is no second table to keep it honest and the runtime enum owns it
 * alone. Pinned so that stops being an accident.
 */
expectTrue<Same<VeoParametersArm<"veo-3.1-generate-preview">["sampleCount"], number | undefined>>();

// ---------------------------------------------------------------------------
// `checkChat`'s report: `finishReason` carries Gemini's own vocabulary
// ---------------------------------------------------------------------------

function googleReportTypeTests(): void {
  const report = googleCheckChat({ candidates: [{ finishReason: "STOP" }] });

  // `HasLiteralMember`, not `Same`: a `(string & {})`-tailed union and bare
  // `string` are mutually assignable, so `Same` passes even against a fully
  // widened type (see the helper's doc).
  expectTrue<HasLiteralMember<typeof report.finishReason, "MAX_TOKENS">>();
  expectTrue<HasLiteralMember<typeof report.finishReason, "STOP">>();
  expectTrue<HasLiteralMember<GoogleFinishReason, "IMAGE_RECITATION">>();
  // The truncation branch's literal, the eight filtered ones, and the success
  // value the checker does not branch on but every caller compares against.
  if (report.finishReason === "MAX_TOKENS") void 0;
  if (report.finishReason === "IMAGE_PROHIBITED_CONTENT") void 0;
  if (report.finishReason === "STOP") void 0;

  // Backward compatible: still a `ResponseReport`, still a `string`.
  const wide: ResponseReport = report;
  void wide;
  const asString: string | undefined = report.finishReason;
  void asString;

  // Tail-open: `check.test.ts` pins that an UNRECOGNIZED finishReason is
  // passed through and not treated as filtering, so the type must be able to
  // hold one. The Gemini enum has grown four `IMAGE_*` members already.
  const shipped: GoogleFinishReason = "UNEXPECTED_TOOL_CALL";
  void shipped;
}

void googleReportTypeTests;
