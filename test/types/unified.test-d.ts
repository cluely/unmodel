/**
 * Type-level tests for the six unified media surfaces. Not executed by
 * `bun test` (no `*.test.*` in the filename); type-checked by `bun run check`.
 *
 * Three claims are being tested, and all three are compile-time-only, which is
 * why they are here rather than in `test/unified/`:
 *
 *  1. **The vocabularies say what they mean.** In particular the XOR:
 *     `{ aspectRatio, dimensions }` together must be a compile error, because
 *     a request that supplies both has not decided what size it wants and no
 *     runtime message arrives early enough to help.
 *  2. **The ref union comes from the adapters.** `createImage([a, b])` must
 *     autocomplete exactly the refs `a` and `b` declare, derived from their
 *     `as const` model arrays — and must *still accept* an unregistered ref,
 *     because a model released after the adapter was written has to stay
 *     callable.
 *  3. **The result type is the ref'd provider's own.** Two adapters with
 *     different wire bodies must produce different return types from the same
 *     `image()`, selected by the string literal in `model`.
 */
import type { ValidateResult } from "../../src/core/result";
import { createImage } from "../../src/unified/image";
import { createImageEdit } from "../../src/unified/image-edit";
import { createMusic } from "../../src/unified/music";
import { createSpeech } from "../../src/unified/speech";
import { createTranscribe } from "../../src/unified/transcribe";
import { createVideo } from "../../src/unified/video";
import type {
  CompileContext,
  CompiledCall,
  RefModel,
  RefProvider,
  UnifiedAdapter,
  UnifiedRef,
} from "../../src/core/unified/types";
import type { ImageParams } from "../../src/core/unified/vocabulary/image";
import type { ImageEditParams } from "../../src/core/unified/vocabulary/image-edit";
import type { MusicParams } from "../../src/core/unified/vocabulary/music";
import type { SpeechParams } from "../../src/core/unified/vocabulary/speech";
import type {
  AudioInputFor,
  TranscribeParams,
  TranscribeParamsFor,
} from "../../src/core/unified/vocabulary/transcribe";
import type { VideoParams } from "../../src/core/unified/vocabulary/video";
import { expectAssignable, expectTrue, type IsNever, type KeyIn } from "./helpers";

// ---------------------------------------------------------------------------
// 1 · The vocabularies
// ---------------------------------------------------------------------------

expectAssignable<ImageParams>({ model: "openai/gpt-image-1", prompt: "a lighthouse" });
expectAssignable<ImageParams>({
  model: "openai/gpt-image-1",
  prompt: "a lighthouse",
  aspectRatio: "16:9",
  resolution: "1k",
  n: 2,
  seed: 7,
  negativePrompt: "text",
  outputFormat: "webp",
  outputDelivery: "base64",
  providerOptions: { openai: { style: "vivid" } },
});
expectAssignable<ImageParams>({
  model: "openai/gpt-image-1",
  prompt: "x",
  dimensions: { width: 1024, height: 768 },
});

// The presets are suggestions, not limits — a provider may serve 5:4.
expectAssignable<ImageParams>({ model: "a/b", prompt: "x", aspectRatio: "5:4" });
// @ts-expect-error — but a ratio is still `W:H`, not prose.
expectAssignable<ImageParams>({ model: "a/b", prompt: "x", aspectRatio: "widescreen" });

// THE XOR. Two spellings of one decision; supplying both is not a request.
// @ts-expect-error — `dimensions` is `never` on the `aspectRatio` arm.
expectAssignable<ImageParams>({
  model: "a/b",
  prompt: "x",
  aspectRatio: "16:9",
  dimensions: { width: 1024, height: 768 },
});

// @ts-expect-error — `prompt` is not optional; there is nothing to generate.
expectAssignable<ImageParams>({ model: "a/b" });
// @ts-expect-error — a typo is caught by the excess-property check on the union.
expectAssignable<ImageParams>({ model: "a/b", prompt: "x", aspecRatio: "16:9" });

expectAssignable<ImageEditParams>({
  operation: "edit",
  model: "openai/gpt-image-1",
  prompt: "make it winter",
  image: { url: "https://example.com/a.png" },
  strength: 0.6,
});
expectAssignable<ImageEditParams>({
  operation: "edit",
  model: "a/b",
  prompt: "x",
  image: { data: "iVBORw0KGgo=" },
});
// @ts-expect-error — the XOR holds here too.
expectAssignable<ImageEditParams>({
  operation: "edit",
  model: "a/b",
  prompt: "x",
  image: { url: "u" },
  aspectRatio: "1:1",
  dimensions: { width: 8, height: 8 },
});
expectAssignable<ImageEditParams>({
  // @ts-expect-error — `operation` is the discriminant, and `"edit"` is the only arm today.
  operation: "inpaint",
  model: "a/b",
  prompt: "x",
  image: { url: "u" },
});

expectAssignable<VideoParams>({ model: "luma/ray-2", prompt: "a fjord", duration: 5 });
// Prompt-less image-to-video is a real request, so `prompt` is optional.
expectAssignable<VideoParams>({
  model: "a/b",
  image: { url: "https://example.com/first.png", role: "first" },
});
expectAssignable<VideoParams>({
  model: "a/b",
  image: [
    { url: "https://example.com/a.png", role: "first" },
    { data: "…", mimeType: "image/png", role: "last" },
  ],
  resolution: "1080p",
});
// @ts-expect-error — a `data` input must declare its media type.
expectAssignable<VideoParams>({ model: "a/b", image: { data: "…" } });
// @ts-expect-error — `"2k"` is an image tier; video resolutions are the marketed names.
expectAssignable<VideoParams>({ model: "a/b", prompt: "x", resolution: "2k" });

expectAssignable<SpeechParams>({ model: "openai/tts-1", text: "hello", voice: "alloy" });
expectAssignable<SpeechParams>({ model: "a/b", text: "hello", voice: { id: "v1" } });
expectAssignable<SpeechParams>({ model: "a/b", text: "hello", voice: { name: "Kore" } });
expectAssignable<SpeechParams>({ model: "a/b", text: "x", outputFormat: "mp3" });
expectAssignable<SpeechParams>({
  model: "a/b",
  text: "x",
  outputFormat: { format: "pcm_s16le", container: "raw", sampleRate: 24000, bitrate: 384000 },
  speed: 1.25,
  language: "pt-BR",
});
// @ts-expect-error — `"linear16"` is a provider's spelling; the vocabulary uses ffmpeg's.
expectAssignable<SpeechParams>({ model: "a/b", text: "x", outputFormat: "linear16" });

expectAssignable<TranscribeParams>({ model: "openai/whisper-1", audio: { url: "https://a/b.wav" } });
expectAssignable<TranscribeParams>({
  model: "a/b",
  audio: { fileId: "file_123" },
  diarization: { enabled: true, maxSpeakers: 3 },
  timestamps: "word",
  languages: ["en", "pt"],
});
// @ts-expect-error — diarization's switch is explicit; config alone is ambiguous.
expectAssignable<TranscribeParams>({ model: "a/b", audio: { url: "u" }, diarization: { maxSpeakers: 3 } });

expectAssignable<MusicParams>({ model: "a/b", prompt: "post-rock", durationSeconds: 45 });
expectAssignable<MusicParams>({ model: "a/b", prompt: "x", instrumental: true, outputFormat: "flac" });

// ---------------------------------------------------------------------------
// AudioInputFor — `audio` narrows per route, at compile time
// ---------------------------------------------------------------------------

type UrlOnly = AudioInputFor<"url">;
expectAssignable<UrlOnly>({ url: "https://a/b.wav" });
// @ts-expect-error — a batch route that only fetches URLs cannot take a Blob.
expectAssignable<UrlOnly>({ file: new Blob() });

type FileOrUrl = AudioInputFor<"file" | "url">;
expectAssignable<FileOrUrl>({ url: "https://a/b.wav" });
expectAssignable<FileOrUrl>({ file: new Blob() });
// @ts-expect-error — …but still not a provider file handle.
expectAssignable<FileOrUrl>({ fileId: "file_123" });

expectAssignable<TranscribeParamsFor<"url">>({ model: "a/b", audio: { url: "u" } });
// @ts-expect-error — the narrowing survives into the params type.
expectAssignable<TranscribeParamsFor<"url">>({ model: "a/b", audio: { fileId: "f" } });

// ---------------------------------------------------------------------------
// Ref splitting, at the type level — first slash, never last
// ---------------------------------------------------------------------------

expectTrue<RefProvider<"openai/gpt-image-1"> extends "openai" ? true : false>();
expectTrue<RefProvider<"hub/vendor/model-1"> extends "hub" ? true : false>();
expectTrue<RefModel<"openai/gpt-image-1"> extends "gpt-image-1" ? true : false>();
expectTrue<RefModel<"hub/vendor/model-1"> extends "vendor/model-1" ? true : false>();
// A non-literal ref selects nothing rather than guessing.
expectTrue<IsNever<RefProvider<string>>>();

// ---------------------------------------------------------------------------
// 2 · The ref union comes from the adapters' `as const` model arrays
// ---------------------------------------------------------------------------

/** Two fake wire bodies, distinct so the result type can be told apart. */
interface AlphaBody {
  alpha_prompt: string;
}
interface BravoBody {
  bravo_prompt: string;
}

declare function compileAlpha(
  input: ImageParams,
  ctx: CompileContext<ImageParams>,
): CompiledCall<AlphaBody, AlphaBody & { alphaOnly: true }>;
declare function compileBravo(
  input: ImageParams,
  ctx: CompileContext<ImageParams>,
): CompiledCall<BravoBody, BravoBody & { bravoOnly: true }>;

const alphaImage = {
  category: "image",
  provider: "alpha",
  models: ["alpha-1", "alpha-2"],
  compile: compileAlpha,
} as const satisfies UnifiedAdapter<ImageParams, AlphaBody, AlphaBody & { alphaOnly: true }>;

const bravoImage = {
  category: "image",
  provider: "bravo",
  models: ["bravo-1"],
  unsupported: { negativePrompt: "the API has no negative prompt." },
  compile: compileBravo,
} as const satisfies UnifiedAdapter<ImageParams, BravoBody, BravoBody & { bravoOnly: true }>;

// The union is `${provider}/${model}` over both adapters, from nothing but the
// arrays the runtime check already reads.
type Refs = UnifiedRef<typeof alphaImage | typeof bravoImage>;
expectAssignable<Refs>("alpha/alpha-1");
expectAssignable<Refs>("alpha/alpha-2");
expectAssignable<Refs>("bravo/bravo-1");
// @ts-expect-error — not a ref either adapter declares.
expectAssignable<Refs>("alpha/alpha-3");
// @ts-expect-error — nor a provider either adapter is.
expectAssignable<Refs>("charlie/charlie-1");

const image = createImage([alphaImage, bravoImage]);

// The union drives autocomplete…
image({ model: "alpha/alpha-1", prompt: "x" });
image({ model: "bravo/bravo-1", prompt: "x" });
// …but does NOT gate the API: a model released after this adapter was written
// must stay callable, and is a `unknown_model` warning at runtime.
image({ model: "alpha/alpha-99", prompt: "x" });
image({ model: "charlie/anything", prompt: "x" });

// @ts-expect-error — the vocabulary is still enforced.
image({ model: "alpha/alpha-1" });
// @ts-expect-error — including the XOR, through the ref-substituted param type.
image({ model: "alpha/alpha-1", prompt: "x", aspectRatio: "1:1", dimensions: { width: 1, height: 1 } });
// @ts-expect-error — and typos.
image({ model: "alpha/alpha-1", prompt: "x", promt: "y" });

// ---------------------------------------------------------------------------
// 3 · The result type is the ref'd provider's own
// ---------------------------------------------------------------------------

const alphaResult = image({ model: "alpha/alpha-1", prompt: "x" });
expectTrue<KeyIn<typeof alphaResult, "alphaOnly"> extends "alphaOnly" ? true : false>();
expectTrue<IsNever<KeyIn<typeof alphaResult, "bravoOnly">>>();
expectAssignable<string>(alphaResult.alpha_prompt);

const bravoResult = image({ model: "bravo/bravo-1", prompt: "x" });
expectTrue<KeyIn<typeof bravoResult, "bravoOnly"> extends "bravoOnly" ? true : false>();
expectTrue<IsNever<KeyIn<typeof bravoResult, "alphaOnly">>>();

// Warnings ride on every result, whichever provider answered.
expectAssignable<readonly { code: string }[]>(alphaResult.warnings);
expectAssignable<readonly { code: string }[]>(bravoResult.warnings);

// An unresolvable ref degrades to the union of every registered result — not
// to `any`. The members every provider has stay typed.
const unknownRef = image({ model: "charlie/anything", prompt: "x" });
expectAssignable<readonly { code: string }[]>(unknownRef.warnings);

// `.safe` wraps the same type and never throws.
expectAssignable<ValidateResult<typeof alphaResult>>(
  image.safe({ model: "alpha/alpha-1", prompt: "x" }),
);
expectAssignable<readonly string[]>(image.providers);

// ---------------------------------------------------------------------------
// The other five factories take their own vocabulary and nobody else's
// ---------------------------------------------------------------------------

declare const videoAdapter: UnifiedAdapter<VideoParams> & { category: "video" };
declare const editAdapter: UnifiedAdapter<ImageEditParams> & { category: "imageEdit" };
declare const speechAdapter: UnifiedAdapter<SpeechParams> & { category: "speech" };
// The transcribe surface asks for one thing more than the other five: the
// audio shapes the route accepts, which is what drives the per-model `audio`
// narrowing in `test/types/unified-transcribe.test-d.ts`.
declare const transcribeAdapter: UnifiedAdapter<TranscribeParams> & {
  category: "transcribe";
  audioInputs: readonly ["url"];
};
declare const musicAdapter: UnifiedAdapter<MusicParams> & { category: "music" };

createVideo([videoAdapter]);
createImageEdit([editAdapter]);
createSpeech([speechAdapter]);
createTranscribe([transcribeAdapter]);
createMusic([musicAdapter]);

// @ts-expect-error — a video adapter on the image surface is a category error.
createImage([videoAdapter]);
// @ts-expect-error — and the reverse.
createVideo([alphaImage]);
