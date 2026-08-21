/**
 * Regression coverage for every exported unified media result alias.
 *
 * A bare `ReturnType<typeof validator>` can collapse to `any` when the
 * provider endpoint is a generic call signature. `any` then makes every
 * downstream result assertion vacuously true, so each alias is checked
 * directly before the category-level tests rely on it.
 */
import type { AssemblyaiTranscribeResult } from "../../src/providers/assemblyai/unified";
import type { BflImageEditResult } from "../../src/providers/black-forest-labs/unified-image-edit";
import type {
  BflImageFlux1Result,
  BflImageResult,
} from "../../src/providers/black-forest-labs/unified-image";
import type { BriaImageResult } from "../../src/providers/bria/unified";
import type { BytedanceImageResult } from "../../src/providers/bytedance/unified-image";
import type { BytedanceVideoResult } from "../../src/providers/bytedance/unified-video";
import type { CartesiaSpeechResult } from "../../src/providers/cartesia/unified-speech";
import type { CartesiaTranscribeResult } from "../../src/providers/cartesia/unified-transcribe";
import type { DeepgramSpeechResult } from "../../src/providers/deepgram/unified-speech";
import type { DeepgramTranscribeResult } from "../../src/providers/deepgram/unified-transcribe";
import type { ElevenlabsMusicResult } from "../../src/providers/elevenlabs/unified-music";
import type { ElevenlabsSpeechResult } from "../../src/providers/elevenlabs/unified-speech";
import type { ElevenlabsTranscribeResult } from "../../src/providers/elevenlabs/unified-transcribe";
import type { FishAudioSpeechResult } from "../../src/providers/fish-audio/unified";
import type { GladiaTranscribeResult } from "../../src/providers/gladia/unified";
import type { GoogleImageResult } from "../../src/providers/google/unified-image";
import type { GoogleVideoResult } from "../../src/providers/google/unified-video";
import type { HumeSpeechResult } from "../../src/providers/hume/unified";
import type { IdeogramImageEditResult } from "../../src/providers/ideogram/unified-image-edit";
import type {
  IdeogramGenerateResult,
  IdeogramImageResult,
  IdeogramImageV4Result,
} from "../../src/providers/ideogram/unified-image";
import type { InworldSpeechResult } from "../../src/providers/inworld/unified-speech";
import type { InworldTranscribeResult } from "../../src/providers/inworld/unified-transcribe";
import type { KlingImageResult } from "../../src/providers/kling/unified-image";
import type { KlingVideoResult } from "../../src/providers/kling/unified-video";
import type { KreaImageResult } from "../../src/providers/krea/unified";
import type { LeonardoImageResult } from "../../src/providers/leonardo/unified";
import type { LightricksVideoResult } from "../../src/providers/lightricks/unified";
import type { LmntSpeechResult } from "../../src/providers/lmnt/unified";
import type { LumaImageResult } from "../../src/providers/luma/unified-image";
import type { LumaVideoResult } from "../../src/providers/luma/unified-video";
import type { MinimaxSpeechResult } from "../../src/providers/minimax/unified-speech";
import type { MinimaxVideoResult } from "../../src/providers/minimax/unified-video";
import type { MistralTranscribeResult } from "../../src/providers/mistral/unified";
import type { MurfSpeechResult } from "../../src/providers/murf/unified";
import type { OpenaiImageEditResult } from "../../src/providers/openai/unified-image-edit";
import type { OpenaiImageResult } from "../../src/providers/openai/unified-image";
import type { OpenaiSpeechResult } from "../../src/providers/openai/unified-speech";
import type { OpenaiTranscribeResult } from "../../src/providers/openai/unified-transcribe";
import type { OpenaiVideoResult } from "../../src/providers/openai/unified-video";
import type { PixverseVideoResult } from "../../src/providers/pixverse/unified";
import type { RecraftImageEditResult } from "../../src/providers/recraft/unified-image-edit";
import type { RecraftImageResult } from "../../src/providers/recraft/unified-image";
import type { ResembleSpeechResult } from "../../src/providers/resemble/unified";
import type { RevaiTranscribeResult } from "../../src/providers/revai/unified";
import type { ReveImageResult } from "../../src/providers/reve/unified";
import type { RimeSpeechResult } from "../../src/providers/rime/unified";
import type { RunwayImageResult } from "../../src/providers/runway/unified-image";
import type { RunwayVideoResult } from "../../src/providers/runway/unified-video";
import type { SmallestSpeechResult } from "../../src/providers/smallest-ai/unified";
import type { SonioxTranscribeResult } from "../../src/providers/soniox/unified";
import type { SpeechifySpeechResult } from "../../src/providers/speechify/unified";
import type { SpeechmaticsTranscribeResult } from "../../src/providers/speechmatics/unified";
import type { StabilityImageResult } from "../../src/providers/stability/unified-image";
import type { StabilityMusicResult } from "../../src/providers/stability/unified-music";
import type { ViduImageResult } from "../../src/providers/vidu/unified-image";
import type { ViduVideoResult } from "../../src/providers/vidu/unified-video";
import { expectNotAny } from "./helpers";

expectNotAny<unknown>();
expectNotAny<object>();
// @ts-expect-error — the helper must reject `any` itself.
expectNotAny<any>();
// @ts-expect-error — a union containing `any` is poisoned to `any` too.
expectNotAny<{ ok: true } | any>();

// Image (including route-specific aliases exposed by multi-route adapters).
expectNotAny<BflImageResult>();
expectNotAny<BflImageFlux1Result>();
expectNotAny<BriaImageResult>();
expectNotAny<BytedanceImageResult>();
expectNotAny<GoogleImageResult>();
expectNotAny<IdeogramImageResult>();
expectNotAny<IdeogramImageV4Result>();
expectNotAny<IdeogramGenerateResult>();
expectNotAny<KlingImageResult>();
expectNotAny<KreaImageResult>();
expectNotAny<LeonardoImageResult>();
expectNotAny<LumaImageResult>();
expectNotAny<OpenaiImageResult>();
expectNotAny<RecraftImageResult>();
expectNotAny<ReveImageResult>();
expectNotAny<RunwayImageResult>();
expectNotAny<StabilityImageResult>();
expectNotAny<ViduImageResult>();

// Image edit.
expectNotAny<BflImageEditResult>();
expectNotAny<IdeogramImageEditResult>();
expectNotAny<OpenaiImageEditResult>();
expectNotAny<RecraftImageEditResult>();

// Video.
expectNotAny<BytedanceVideoResult>();
expectNotAny<GoogleVideoResult>();
expectNotAny<KlingVideoResult>();
expectNotAny<LightricksVideoResult>();
expectNotAny<LumaVideoResult>();
expectNotAny<MinimaxVideoResult>();
expectNotAny<OpenaiVideoResult>();
expectNotAny<PixverseVideoResult>();
expectNotAny<RunwayVideoResult>();
expectNotAny<ViduVideoResult>();

// Speech.
expectNotAny<CartesiaSpeechResult>();
expectNotAny<DeepgramSpeechResult>();
expectNotAny<ElevenlabsSpeechResult>();
expectNotAny<FishAudioSpeechResult>();
expectNotAny<HumeSpeechResult>();
expectNotAny<InworldSpeechResult>();
expectNotAny<LmntSpeechResult>();
expectNotAny<MinimaxSpeechResult>();
expectNotAny<MurfSpeechResult>();
expectNotAny<OpenaiSpeechResult>();
expectNotAny<ResembleSpeechResult>();
expectNotAny<RimeSpeechResult>();
expectNotAny<SmallestSpeechResult>();
expectNotAny<SpeechifySpeechResult>();

// Transcription.
expectNotAny<AssemblyaiTranscribeResult>();
expectNotAny<CartesiaTranscribeResult>();
expectNotAny<DeepgramTranscribeResult>();
expectNotAny<ElevenlabsTranscribeResult>();
expectNotAny<GladiaTranscribeResult>();
expectNotAny<InworldTranscribeResult>();
expectNotAny<MistralTranscribeResult>();
expectNotAny<OpenaiTranscribeResult>();
expectNotAny<RevaiTranscribeResult>();
expectNotAny<SonioxTranscribeResult>();
expectNotAny<SpeechmaticsTranscribeResult>();

// Music.
expectNotAny<ElevenlabsMusicResult>();
expectNotAny<StabilityMusicResult>();

// These twelve aliases previously resolved to `any`. The negative assignments
// ensure they remain concrete object results even if the helper itself changes.
declare const bflImageEdit: BflImageEditResult;
declare const bflImage: BflImageResult;
declare const elevenlabsSpeech: ElevenlabsSpeechResult;
declare const elevenlabsTranscribe: ElevenlabsTranscribeResult;
declare const fishAudioSpeech: FishAudioSpeechResult;
declare const googleImage: GoogleImageResult;
declare const googleVideo: GoogleVideoResult;
declare const klingVideo: KlingVideoResult;
declare const kreaImage: KreaImageResult;
declare const lightricksVideo: LightricksVideoResult;
declare const rimeSpeech: RimeSpeechResult;
declare const smallestSpeech: SmallestSpeechResult;

// @ts-expect-error — a provider result is an object, never a number.
const impossibleBflImageEdit: number = bflImageEdit;
// @ts-expect-error — a provider result is an object, never a number.
const impossibleBflImage: number = bflImage;
// @ts-expect-error — a provider result is an object, never a number.
const impossibleElevenlabsSpeech: number = elevenlabsSpeech;
// @ts-expect-error — a provider result is an object, never a number.
const impossibleElevenlabsTranscribe: number = elevenlabsTranscribe;
// @ts-expect-error — a provider result is an object, never a number.
const impossibleFishAudioSpeech: number = fishAudioSpeech;
// @ts-expect-error — a provider result is an object, never a number.
const impossibleGoogleImage: number = googleImage;
// @ts-expect-error — a provider result is an object, never a number.
const impossibleGoogleVideo: number = googleVideo;
// @ts-expect-error — a provider result is an object, never a number.
const impossibleKlingVideo: number = klingVideo;
// @ts-expect-error — a provider result is an object, never a number.
const impossibleKreaImage: number = kreaImage;
// @ts-expect-error — a provider result is an object, never a number.
const impossibleLightricksVideo: number = lightricksVideo;
// @ts-expect-error — a provider result is an object, never a number.
const impossibleRimeSpeech: number = rimeSpeech;
// @ts-expect-error — a provider result is an object, never a number.
const impossibleSmallestSpeech: number = smallestSpeech;
