/**
 * The CLI's hand-maintained validator registry, in its own module so tests can
 * import it: `src/cli.ts` calls `runMain()` at module scope, so importing THAT
 * file would run the CLI against the test runner's argv.
 *
 * `src/cli.test.ts` asserts these two maps together name every module-level
 * validator in `src/providers/*`, so a new endpoint that nobody registers
 * fails the build instead of being silently CLI-invisible.
 */
import type { ValidateOptions } from "./core/options";
import type { ValidateResult } from "./core/result";

// ---------------------------------------------------------------------------
// Validator registry — hand-maintained map of "<provider>.<endpoint>" to a
// lazy loader for that endpoint's validator. Every loader uses a literal
// import specifier so bundlers can code-split (or inline) each provider.
// ---------------------------------------------------------------------------

/** The shape the CLI needs from any endpoint validator: its `.safe()` mode. */
export interface CliValidator {
  safe(params: unknown, options?: ValidateOptions): ValidateResult<Record<string, unknown>>;
}

const asCli = (validator: unknown): CliValidator => validator as CliValidator;

export const REGISTRY: Record<string, () => Promise<CliValidator>> = {
  // Core chat endpoints (native wire formats)
  "openai.chat": () => import("./providers/openai").then((m) => asCli(m.chat)),
  "anthropic.messages": () => import("./providers/anthropic").then((m) => asCli(m.messages)),
  "google.generateContent": () =>
    import("./providers/google").then((m) => asCli(m.generateContent)),
  "cohere.chat": () => import("./providers/cohere").then((m) => asCli(m.chat)),

  // Image generation
  "openai.images": () => import("./providers/openai").then((m) => asCli(m.images)),
  "google.generateImages": () =>
    import("./providers/google").then((m) => asCli(m.generateImages)),
  "black-forest-labs.flux1": () =>
    import("./providers/black-forest-labs").then((m) => asCli(m.flux1)),
  "black-forest-labs.flux2": () =>
    import("./providers/black-forest-labs").then((m) => asCli(m.flux2)),
  "black-forest-labs.fluxKontext": () =>
    import("./providers/black-forest-labs").then((m) => asCli(m.fluxKontext)),
  "ideogram.generate": () => import("./providers/ideogram").then((m) => asCli(m.generate)),
  "ideogram.generateV4": () => import("./providers/ideogram").then((m) => asCli(m.generateV4)),
  "recraft.generations": () => import("./providers/recraft").then((m) => asCli(m.generations)),
  "stability.stableImageUltra": () =>
    import("./providers/stability").then((m) => asCli(m.stableImageUltra)),
  "stability.stableImageCore": () =>
    import("./providers/stability").then((m) => asCli(m.stableImageCore)),
  "stability.stableImageSd3": () =>
    import("./providers/stability").then((m) => asCli(m.stableImageSd3)),
  "luma.imageGenerations": () => import("./providers/luma").then((m) => asCli(m.imageGenerations)),
  "runway.textToImage": () => import("./providers/runway").then((m) => asCli(m.textToImage)),
  "bria.imageGenerate": () => import("./providers/bria").then((m) => asCli(m.imageGenerate)),
  "bria.imageGenerateLite": () =>
    import("./providers/bria").then((m) => asCli(m.imageGenerateLite)),
  "bytedance.imageGenerations": () =>
    import("./providers/bytedance").then((m) => asCli(m.imageGenerations)),
  "kling.imageGenerations": () =>
    import("./providers/kling").then((m) => asCli(m.imageGenerations)),
  "kling.omniImage": () => import("./providers/kling").then((m) => asCli(m.omniImage)),
  "krea.krea2": () => import("./providers/krea").then((m) => asCli(m.krea2)),
  "leonardo.generations": () => import("./providers/leonardo").then((m) => asCli(m.generations)),
  "reve.create": () => import("./providers/reve").then((m) => asCli(m.create)),
  "reve.createV2": () => import("./providers/reve").then((m) => asCli(m.createV2)),
  "vidu.reference2image": () => import("./providers/vidu").then((m) => asCli(m.reference2image)),

  // Image editing (URL/base64 image inputs — the multipart-only editors are
  // listed under MULTIPART_ONLY below)
  "black-forest-labs.fluxFill": () =>
    import("./providers/black-forest-labs").then((m) => asCli(m.fluxFill)),
  "black-forest-labs.fluxExpand": () =>
    import("./providers/black-forest-labs").then((m) => asCli(m.fluxExpand)),
  "black-forest-labs.fluxOutpainting": () =>
    import("./providers/black-forest-labs").then((m) => asCli(m.fluxOutpainting)),
  "black-forest-labs.fluxErase": () =>
    import("./providers/black-forest-labs").then((m) => asCli(m.fluxErase)),
  "black-forest-labs.fluxDeblur": () =>
    import("./providers/black-forest-labs").then((m) => asCli(m.fluxDeblur)),
  "black-forest-labs.fluxVto": () =>
    import("./providers/black-forest-labs").then((m) => asCli(m.fluxVto)),
  "recraft.imageToImage": () => import("./providers/recraft").then((m) => asCli(m.imageToImage)),
  "recraft.inpaint": () => import("./providers/recraft").then((m) => asCli(m.inpaint)),
  "recraft.outpaint": () => import("./providers/recraft").then((m) => asCli(m.outpaint)),
  "recraft.generateBackground": () =>
    import("./providers/recraft").then((m) => asCli(m.generateBackground)),
  "recraft.replaceBackground": () =>
    import("./providers/recraft").then((m) => asCli(m.replaceBackground)),
  "luma.reframeImage": () => import("./providers/luma").then((m) => asCli(m.reframeImage)),
  "bria.imageEdit": () => import("./providers/bria").then((m) => asCli(m.imageEdit)),
  "reve.edit": () => import("./providers/reve").then((m) => asCli(m.edit)),
  "reve.remix": () => import("./providers/reve").then((m) => asCli(m.remix)),

  // Video generation and post-production
  "openai.videos": () => import("./providers/openai").then((m) => asCli(m.videos)),
  "google.generateVideos": () =>
    import("./providers/google").then((m) => asCli(m.generateVideos)),
  "runway.textToVideo": () => import("./providers/runway").then((m) => asCli(m.textToVideo)),
  "runway.imageToVideo": () => import("./providers/runway").then((m) => asCli(m.imageToVideo)),
  "runway.videoToVideo": () => import("./providers/runway").then((m) => asCli(m.videoToVideo)),
  "luma.generations": () => import("./providers/luma").then((m) => asCli(m.generations)),
  "luma.modifyVideo": () => import("./providers/luma").then((m) => asCli(m.modifyVideo)),
  "luma.reframeVideo": () => import("./providers/luma").then((m) => asCli(m.reframeVideo)),
  "luma.upscale": () => import("./providers/luma").then((m) => asCli(m.upscale)),
  "luma.addAudio": () => import("./providers/luma").then((m) => asCli(m.addAudio)),
  "bytedance.contentGenerationTasks": () =>
    import("./providers/bytedance").then((m) => asCli(m.contentGenerationTasks)),
  "kling.textToVideo": () => import("./providers/kling").then((m) => asCli(m.textToVideo)),
  "kling.imageToVideo": () => import("./providers/kling").then((m) => asCli(m.imageToVideo)),
  // EXPERIMENTAL path-addressed family — uncorroborated routes, see
  // src/providers/kling/models.ts.
  "kling.textToVideoV3": () => import("./providers/kling").then((m) => asCli(m.textToVideoV3)),
  "kling.imageToVideoV3": () => import("./providers/kling").then((m) => asCli(m.imageToVideoV3)),
  "kling.omniVideo": () => import("./providers/kling").then((m) => asCli(m.omniVideo)),
  "lightricks.textToVideo": () =>
    import("./providers/lightricks").then((m) => asCli(m.textToVideo)),
  "lightricks.imageToVideo": () =>
    import("./providers/lightricks").then((m) => asCli(m.imageToVideo)),
  "lightricks.audioToVideo": () =>
    import("./providers/lightricks").then((m) => asCli(m.audioToVideo)),
  "minimax.videoGeneration": () =>
    import("./providers/minimax").then((m) => asCli(m.videoGeneration)),
  "minimax.videoGenerationV2": () =>
    import("./providers/minimax").then((m) => asCli(m.videoGenerationV2)),
  "pixverse.textToVideo": () => import("./providers/pixverse").then((m) => asCli(m.textToVideo)),
  "pixverse.imageToVideo": () => import("./providers/pixverse").then((m) => asCli(m.imageToVideo)),
  "vidu.text2video": () => import("./providers/vidu").then((m) => asCli(m.text2video)),
  "vidu.img2video": () => import("./providers/vidu").then((m) => asCli(m.img2video)),
  "vidu.reference2video": () => import("./providers/vidu").then((m) => asCli(m.reference2video)),

  // Music / audio generation
  "elevenlabs.music": () => import("./providers/elevenlabs").then((m) => asCli(m.music)),
  "stability.stableAudioTextToAudio": () =>
    import("./providers/stability").then((m) => asCli(m.stableAudioTextToAudio)),

  // Speech — TTS
  "openai.speech": () => import("./providers/openai").then((m) => asCli(m.speech)),
  "elevenlabs.textToSpeech": () =>
    import("./providers/elevenlabs").then((m) => asCli(m.textToSpeech)),
  "cartesia.tts": () => import("./providers/cartesia").then((m) => asCli(m.tts)),
  "inworld.tts": () => import("./providers/inworld").then((m) => asCli(m.tts)),
  "deepgram.speak": () => import("./providers/deepgram").then((m) => asCli(m.speak)),
  "fish-audio.tts": () => import("./providers/fish-audio").then((m) => asCli(m.tts)),
  "hume.tts": () => import("./providers/hume").then((m) => asCli(m.tts)),
  "lmnt.speech": () => import("./providers/lmnt").then((m) => asCli(m.speech)),
  "lmnt.speechDetailed": () => import("./providers/lmnt").then((m) => asCli(m.speechDetailed)),
  "minimax.t2a": () => import("./providers/minimax").then((m) => asCli(m.t2a)),
  "murf.speechGenerate": () => import("./providers/murf").then((m) => asCli(m.speechGenerate)),
  "murf.speechStream": () => import("./providers/murf").then((m) => asCli(m.speechStream)),
  "resemble.synthesize": () => import("./providers/resemble").then((m) => asCli(m.synthesize)),
  "resemble.synthesizeStream": () =>
    import("./providers/resemble").then((m) => asCli(m.synthesizeStream)),
  "rime.tts": () => import("./providers/rime").then((m) => asCli(m.tts)),
  "smallest-ai.tts": () => import("./providers/smallest-ai").then((m) => asCli(m.tts)),
  "speechify.speech": () => import("./providers/speechify").then((m) => asCli(m.speech)),
  "speechify.stream": () => import("./providers/speechify").then((m) => asCli(m.stream)),

  // Speech — STT (URL-referenced audio; file-upload variants are multipart-only)
  "elevenlabs.speechToText": () =>
    import("./providers/elevenlabs").then((m) => asCli(m.speechToText)),
  "soniox.transcriptions": () =>
    import("./providers/soniox").then((m) => asCli(m.transcriptions)),
  "deepgram.listen": () => import("./providers/deepgram").then((m) => asCli(m.listen)),
  // Inline base64 audio, so JSON params can express it — not multipart.
  "inworld.transcribe": () => import("./providers/inworld").then((m) => asCli(m.transcribe)),
  "assemblyai.transcript": () =>
    import("./providers/assemblyai").then((m) => asCli(m.transcript)),
  "gladia.preRecorded": () => import("./providers/gladia").then((m) => asCli(m.preRecorded)),
  "mistral.transcription": () =>
    import("./providers/mistral").then((m) => asCli(m.transcription)),
  "revai.jobs": () => import("./providers/revai").then((m) => asCli(m.jobs)),
  "speechmatics.jobs": () => import("./providers/speechmatics").then((m) => asCli(m.jobs)),

  // Realtime session configs — the JSON config object a socket surface takes
  // (a connection-URL query set, a first configuration message, or a per-chunk
  // generation message), never the socket lifecycle. These validate from the
  // CLI like any other endpoint; what they do NOT have is a POST `.request`,
  // so the CLI prints no request line for them.
  "openai.realtimeSession": () =>
    import("./providers/openai").then((m) => asCli(m.realtimeSession)),
  "inworld.realtimeTranscribeConfig": () =>
    import("./providers/inworld").then((m) => asCli(m.realtimeTranscribeConfig)),
  "inworld.realtimeVoiceContext": () =>
    import("./providers/inworld").then((m) => asCli(m.realtimeVoiceContext)),
  "elevenlabs.textToSpeechStreamInput": () =>
    import("./providers/elevenlabs").then((m) => asCli(m.textToSpeechStreamInput)),
  "elevenlabs.speechToTextRealtime": () =>
    import("./providers/elevenlabs").then((m) => asCli(m.speechToTextRealtime)),
  "cartesia.ttsWebsocket": () =>
    import("./providers/cartesia").then((m) => asCli(m.ttsWebsocket)),
  "cartesia.sttWebsocket": () =>
    import("./providers/cartesia").then((m) => asCli(m.sttWebsocket)),
  "deepgram.listenLive": () => import("./providers/deepgram").then((m) => asCli(m.listenLive)),
  "deepgram.listenFlux": () => import("./providers/deepgram").then((m) => asCli(m.listenFlux)),
  "deepgram.fluxConfigure": () =>
    import("./providers/deepgram").then((m) => asCli(m.fluxConfigure)),
  "deepgram.speakLive": () => import("./providers/deepgram").then((m) => asCli(m.speakLive)),
  "soniox.realtimeTranscription": () =>
    import("./providers/soniox").then((m) => asCli(m.realtimeTranscription)),

  // OpenAI-compatible fleet overlays (chat completions dialect)
  "alibaba.chat": () => import("./providers/alibaba").then((m) => asCli(m.chat)),
  "baseten.chat": () => import("./providers/baseten").then((m) => asCli(m.chat)),
  "cerebras.chat": () => import("./providers/cerebras").then((m) => asCli(m.chat)),
  "deepinfra.chat": () => import("./providers/deepinfra").then((m) => asCli(m.chat)),
  "deepseek.chat": () => import("./providers/deepseek").then((m) => asCli(m.chat)),
  "fireworks-ai.chat": () => import("./providers/fireworks-ai").then((m) => asCli(m.chat)),
  "friendli.chat": () => import("./providers/friendli").then((m) => asCli(m.chat)),
  "groq.chat": () => import("./providers/groq").then((m) => asCli(m.chat)),
  "huggingface.chat": () => import("./providers/huggingface").then((m) => asCli(m.chat)),
  "inception.chat": () => import("./providers/inception").then((m) => asCli(m.chat)),
  "longcat.chat": () => import("./providers/longcat").then((m) => asCli(m.chat)),
  "meta.chat": () => import("./providers/meta").then((m) => asCli(m.chat)),
  "minimax.chat": () => import("./providers/minimax").then((m) => asCli(m.chat)),
  "mistral.chat": () => import("./providers/mistral").then((m) => asCli(m.chat)),
  "moonshotai.chat": () => import("./providers/moonshotai").then((m) => asCli(m.chat)),
  "nebius.chat": () => import("./providers/nebius").then((m) => asCli(m.chat)),
  "novita-ai.chat": () => import("./providers/novita-ai").then((m) => asCli(m.chat)),
  "nvidia.chat": () => import("./providers/nvidia").then((m) => asCli(m.chat)),
  "openrouter.chat": () => import("./providers/openrouter").then((m) => asCli(m.chat)),
  "perplexity.chat": () => import("./providers/perplexity").then((m) => asCli(m.chat)),
  "sarvam.chat": () => import("./providers/sarvam").then((m) => asCli(m.chat)),
  "scaleway.chat": () => import("./providers/scaleway").then((m) => asCli(m.chat)),
  "siliconflow.chat": () => import("./providers/siliconflow").then((m) => asCli(m.chat)),
  "stepfun.chat": () => import("./providers/stepfun").then((m) => asCli(m.chat)),
  "togetherai.chat": () => import("./providers/togetherai").then((m) => asCli(m.chat)),
  "upstage.chat": () => import("./providers/upstage").then((m) => asCli(m.chat)),
  "vercel.chat": () => import("./providers/vercel").then((m) => asCli(m.chat)),
  "xai.chat": () => import("./providers/xai").then((m) => asCli(m.chat)),
  "zhipuai.chat": () => import("./providers/zhipuai").then((m) => asCli(m.chat)),
};

/**
 * Module-level validators deliberately absent from REGISTRY: their params
 * require a `Blob`/`File` field that a JSON document cannot express, so a CLI
 * invocation could never produce valid params. They are fully usable from the
 * library API (`import { imageEdit } from "unmodel/openai"`), and the CLI says
 * so instead of failing with a confusing "expected Blob".
 */
export const MULTIPART_ONLY: Record<string, string> = {
  "openai.imageEdit": "unmodel/openai",
  "openai.transcription": "unmodel/openai",
  "cartesia.stt": "unmodel/cartesia",
  "ideogram.edit": "unmodel/ideogram",
  "ideogram.remix": "unmodel/ideogram",
  "ideogram.reframe": "unmodel/ideogram",
  "ideogram.replaceBackground": "unmodel/ideogram",
  "stability.stableImageErase": "unmodel/stability",
  "stability.stableImageInpaint": "unmodel/stability",
  "stability.stableImageOutpaint": "unmodel/stability",
  "stability.stableImageSearchAndReplace": "unmodel/stability",
  "stability.stableImageSearchAndRecolor": "unmodel/stability",
  "stability.stableImageRemoveBackground": "unmodel/stability",
  "stability.stableAudioAudioToAudio": "unmodel/stability",
  "stability.stableAudioInpaint": "unmodel/stability",
};
