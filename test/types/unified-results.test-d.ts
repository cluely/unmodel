/**
 * Regression coverage for every exported unified media result alias.
 *
 * A bare `ReturnType<typeof validator>` can collapse to `any` when the
 * provider endpoint is a generic call signature. `any` then makes every
 * downstream result assertion vacuously true, so each alias is checked
 * directly before the category-level tests rely on it.
 */
import type { AssemblyaiSttResult } from "../../src/providers/assemblyai/unified";
import type { BflImageEditResult } from "../../src/providers/black-forest-labs/unified-image-edit";
import type {
  BflImageFlux1Result,
  BflImageResult,
} from "../../src/providers/black-forest-labs/unified-image";
import type { BriaImageResult } from "../../src/providers/bria/unified";
import type { BytedanceImageResult } from "../../src/providers/bytedance/unified-image";
import type { BytedanceVideoResult } from "../../src/providers/bytedance/unified-video";
import type { CartesiaTtsResult } from "../../src/providers/cartesia/unified-tts";
import type { CartesiaSttResult } from "../../src/providers/cartesia/unified-stt";
import type { DeepgramTtsResult } from "../../src/providers/deepgram/unified-tts";
import type { DeepgramSttResult } from "../../src/providers/deepgram/unified-stt";
import type { ElevenlabsMusicResult } from "../../src/providers/elevenlabs/unified-music";
import type { ElevenlabsTtsResult } from "../../src/providers/elevenlabs/unified-tts";
import type { ElevenlabsSttResult } from "../../src/providers/elevenlabs/unified-stt";
import type { FishAudioTtsResult } from "../../src/providers/fish-audio/unified";
import type { GladiaSttResult } from "../../src/providers/gladia/unified";
import type { GoogleImageResult } from "../../src/providers/google/unified-image";
import type { GoogleVideoResult } from "../../src/providers/google/unified-video";
import type { HumeTtsResult } from "../../src/providers/hume/unified";
import type { IdeogramImageEditResult } from "../../src/providers/ideogram/unified-image-edit";
import type {
  IdeogramGenerateResult,
  IdeogramImageResult,
  IdeogramImageV4Result,
} from "../../src/providers/ideogram/unified-image";
import type { InworldTtsResult } from "../../src/providers/inworld/unified-tts";
import type { InworldSttResult } from "../../src/providers/inworld/unified-stt";
import type { KlingImageResult } from "../../src/providers/kling/unified-image";
import type { KlingVideoResult } from "../../src/providers/kling/unified-video";
import type { KreaImageResult } from "../../src/providers/krea/unified";
import type { LeonardoImageResult } from "../../src/providers/leonardo/unified";
import type { LightricksVideoResult } from "../../src/providers/lightricks/unified";
import type { LmntTtsResult } from "../../src/providers/lmnt/unified";
import type { LumaImageResult } from "../../src/providers/luma/unified-image";
import type { LumaVideoResult } from "../../src/providers/luma/unified-video";
import type { MinimaxTtsResult } from "../../src/providers/minimax/unified-tts";
import type { MinimaxVideoResult } from "../../src/providers/minimax/unified-video";
import type { MistralSttResult } from "../../src/providers/mistral/unified";
import type { MurfTtsResult } from "../../src/providers/murf/unified";
import type { OpenaiImageEditResult } from "../../src/providers/openai/unified-image-edit";
import type { OpenaiImageResult } from "../../src/providers/openai/unified-image";
import type { OpenaiTtsResult } from "../../src/providers/openai/unified-tts";
import type { OpenaiSttResult } from "../../src/providers/openai/unified-stt";
import type { OpenaiVideoResult } from "../../src/providers/openai/unified-video";
import type { PixverseVideoResult } from "../../src/providers/pixverse/unified";
import type { RecraftImageEditResult } from "../../src/providers/recraft/unified-image-edit";
import type { RecraftImageResult } from "../../src/providers/recraft/unified-image";
import type { ResembleTtsResult } from "../../src/providers/resemble/unified";
import type { RevaiSttResult } from "../../src/providers/revai/unified";
import type { ReveImageResult } from "../../src/providers/reve/unified";
import type { RimeTtsResult } from "../../src/providers/rime/unified";
import type { RunwayImageResult } from "../../src/providers/runway/unified-image";
import type { RunwayVideoResult } from "../../src/providers/runway/unified-video";
import type { SmallestTtsResult } from "../../src/providers/smallest-ai/unified";
import type { SonioxSttResult } from "../../src/providers/soniox/unified";
import type { SpeechifyTtsResult } from "../../src/providers/speechify/unified";
import type { SpeechmaticsSttResult } from "../../src/providers/speechmatics/unified";
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
expectNotAny<CartesiaTtsResult>();
expectNotAny<DeepgramTtsResult>();
expectNotAny<ElevenlabsTtsResult>();
expectNotAny<FishAudioTtsResult>();
expectNotAny<HumeTtsResult>();
expectNotAny<InworldTtsResult>();
expectNotAny<LmntTtsResult>();
expectNotAny<MinimaxTtsResult>();
expectNotAny<MurfTtsResult>();
expectNotAny<OpenaiTtsResult>();
expectNotAny<ResembleTtsResult>();
expectNotAny<RimeTtsResult>();
expectNotAny<SmallestTtsResult>();
expectNotAny<SpeechifyTtsResult>();

// Transcription.
expectNotAny<AssemblyaiSttResult>();
expectNotAny<CartesiaSttResult>();
expectNotAny<DeepgramSttResult>();
expectNotAny<ElevenlabsSttResult>();
expectNotAny<GladiaSttResult>();
expectNotAny<InworldSttResult>();
expectNotAny<MistralSttResult>();
expectNotAny<OpenaiSttResult>();
expectNotAny<RevaiSttResult>();
expectNotAny<SonioxSttResult>();
expectNotAny<SpeechmaticsSttResult>();

// Music.
expectNotAny<ElevenlabsMusicResult>();
expectNotAny<StabilityMusicResult>();

// These twelve aliases previously resolved to `any`. The negative assignments
// ensure they remain concrete object results even if the helper itself changes.
declare const bflImageEdit: BflImageEditResult;
declare const bflImage: BflImageResult;
declare const elevenlabsTts: ElevenlabsTtsResult;
declare const elevenlabsStt: ElevenlabsSttResult;
declare const fishAudioTts: FishAudioTtsResult;
declare const googleImage: GoogleImageResult;
declare const googleVideo: GoogleVideoResult;
declare const klingVideo: KlingVideoResult;
declare const kreaImage: KreaImageResult;
declare const lightricksVideo: LightricksVideoResult;
declare const rimeTts: RimeTtsResult;
declare const smallestTts: SmallestTtsResult;

// @ts-expect-error — a provider result is an object, never a number.
const impossibleBflImageEdit: number = bflImageEdit;
// @ts-expect-error — a provider result is an object, never a number.
const impossibleBflImage: number = bflImage;
// @ts-expect-error — a provider result is an object, never a number.
const impossibleElevenlabsTts: number = elevenlabsTts;
// @ts-expect-error — a provider result is an object, never a number.
const impossibleElevenlabsStt: number = elevenlabsStt;
// @ts-expect-error — a provider result is an object, never a number.
const impossibleFishAudioTts: number = fishAudioTts;
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
const impossibleRimeTts: number = rimeTts;
// @ts-expect-error — a provider result is an object, never a number.
const impossibleSmallestTts: number = smallestTts;
