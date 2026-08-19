/**
 * Type-level tests for unmodel/google. Not executed by `bun test` —
 * type-checked by `bun run check` (tsc --noEmit).
 */
import type {
  GenerateContentParameters,
  GenerateImagesParameters,
  GenerateVideosParameters,
} from "@google/genai";
import { chat, generateImages, generateVideos } from "../../src/providers/google";
import type { GoogleTextModelId } from "../../src/catalog/google.gen";
import { expectAssignable } from "./helpers";

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
// generateVideos (Veo) — toSdk("google") targets ai.models.generateVideos().
// ---------------------------------------------------------------------------

const veo = generateVideos({
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

// The SDK re-shape is directly usable as ai.models.generateVideos(...) input
// (GenerateVideosConfig's leaves are plain string/number-typed).
expectAssignable<GenerateVideosParameters>(veo.toSdk("google"));

// referenceType is the one enum-typed leaf (VideoGenerationReferenceType) —
// the wire literal needs the documented cast at the SDK call site, exactly
// like the generateContent safety enums above.
const veoWithReferences = generateVideos({
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
generateVideos({
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

const imagen = generateImages({
  model: "imagen-4.0-generate-001",
  instances: [{ prompt: "Robot holding a red skateboard" }],
  parameters: { sampleCount: 4, aspectRatio: "16:9", sampleImageSize: "2K" },
});

// The SDK re-shape is directly usable as ai.models.generateImages(...) input.
expectAssignable<GenerateImagesParameters>(imagen.toSdk("google"));

// Vertex-only knobs have no Gemini API wire form: `never` makes them compile errors.
generateImages({
  model: "imagen-4.0-generate-001",
  instances: [{ prompt: "hi" }],
  // @ts-expect-error negativePrompt is Vertex AI-only
  parameters: { negativePrompt: "blurry" },
});
generateImages({
  model: "imagen-4.0-generate-001",
  instances: [{ prompt: "hi" }],
  // @ts-expect-error seed is Vertex AI-only
  parameters: { seed: 7 },
});

// GROUND TRUTH: `sampleImageSize` (SDK imageSize) is Standard/Ultra only —
// the SDK's own config type allows it for every Imagen model.
generateImages({
  model: "imagen-4.0-fast-generate-001",
  instances: [{ prompt: "hi" }],
  // @ts-expect-error sampleImageSize is not supported by the Fast model
  parameters: { sampleImageSize: "1K" },
});

// Imagen's aspect ratios are the narrow five, not Nano Banana's fourteen.
generateImages({
  model: "imagen-4.0-generate-001",
  instances: [{ prompt: "hi" }],
  // @ts-expect-error 21:9 is a Nano Banana ratio; Imagen documents five
  parameters: { aspectRatio: "21:9" },
});

// personGeneration is one of the SDK's TS-enum leaves, so a request carrying
// it needs the documented cast at the SDK call site.
const imagenWithPerson = generateImages({
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
generateImages({
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

// generateVideos: `seed` is a documented Veo 3 parameter (the SDK rejects it).
expectAssignable<{ instances: unknown }>(
  generateVideos({
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

const veoForApi = generateVideos({
  model: "veo-3.1-generate-preview",
  instances: [{ prompt: "a hummingbird" }],
});
// @ts-expect-error — generateVideos declares no `.toApi` targets.
veoForApi.toApi("vercel");
// @ts-expect-error — nor `.toApiSafe`.
veoForApi.toApiSafe("vercel");
// @ts-expect-error — and no "ai-sdk" target: experimental_generateVideo is not stable.
veoForApi.toSdk("ai-sdk");

const imagenForApi = generateImages({
  model: "imagen-4.0-generate-001",
  instances: [{ prompt: "a robot" }],
});
// @ts-expect-error — generateImages declares no `.toApi` targets either.
imagenForApi.toApi("vercel");
