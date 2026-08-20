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
  "anthropic.chat": () => import("./providers/anthropic").then((m) => asCli(m.chat)),
  "google.chat": () => import("./providers/google").then((m) => asCli(m.chat)),
  "cohere.chat": () => import("./providers/cohere").then((m) => asCli(m.chat)),

  // Image generation. Every provider addresses its text-to-image route as
  // `image` (the address-vs-wire law): the wire spellings differ wildly
  // (/v1/images/generations, :predict, /v1/ideogram-v3/generate,
  // /v1/text_to_image, /ent/v2/reference2image), and the URL constants and
  // wire types keep them — but the endpoint id a caller types is uniform. A
  // provider with more than one generation route qualifies the extra ones
  // (`imageCore`, `imageV4`, `imageFlux1`), never the primary one.
  "openai.image": () => import("./providers/openai").then((m) => asCli(m.image)),
  "google.image": () => import("./providers/google").then((m) => asCli(m.image)),
  "black-forest-labs.imageFlux1": () =>
    import("./providers/black-forest-labs").then((m) => asCli(m.imageFlux1)),
  "black-forest-labs.image": () =>
    import("./providers/black-forest-labs").then((m) => asCli(m.image)),
  "black-forest-labs.imageEdit": () =>
    import("./providers/black-forest-labs").then((m) => asCli(m.imageEdit)),
  "ideogram.image": () => import("./providers/ideogram").then((m) => asCli(m.image)),
  "ideogram.imageV4": () => import("./providers/ideogram").then((m) => asCli(m.imageV4)),
  "recraft.image": () => import("./providers/recraft").then((m) => asCli(m.image)),
  "stability.image": () => import("./providers/stability").then((m) => asCli(m.image)),
  "stability.imageCore": () => import("./providers/stability").then((m) => asCli(m.imageCore)),
  "stability.imageSd3": () => import("./providers/stability").then((m) => asCli(m.imageSd3)),
  "luma.image": () => import("./providers/luma").then((m) => asCli(m.image)),
  "runway.image": () => import("./providers/runway").then((m) => asCli(m.image)),
  "bria.image": () => import("./providers/bria").then((m) => asCli(m.image)),
  "bria.imageLite": () => import("./providers/bria").then((m) => asCli(m.imageLite)),
  "bytedance.image": () => import("./providers/bytedance").then((m) => asCli(m.image)),
  "kling.image": () => import("./providers/kling").then((m) => asCli(m.image)),
  "kling.imageOmni": () => import("./providers/kling").then((m) => asCli(m.imageOmni)),
  "krea.image": () => import("./providers/krea").then((m) => asCli(m.image)),
  "leonardo.image": () => import("./providers/leonardo").then((m) => asCli(m.image)),
  "reve.image": () => import("./providers/reve").then((m) => asCli(m.image)),
  "reve.imageV2": () => import("./providers/reve").then((m) => asCli(m.imageV2)),
  "vidu.imageFromReference": () =>
    import("./providers/vidu").then((m) => asCli(m.imageFromReference)),

  // Image editing (URL/base64 image inputs — the multipart-only editors are
  // listed under MULTIPART_ONLY below)
  "black-forest-labs.imageEditFill": () =>
    import("./providers/black-forest-labs").then((m) => asCli(m.imageEditFill)),
  "black-forest-labs.imageEditExpand": () =>
    import("./providers/black-forest-labs").then((m) => asCli(m.imageEditExpand)),
  "black-forest-labs.imageEditOutpainting": () =>
    import("./providers/black-forest-labs").then((m) => asCli(m.imageEditOutpainting)),
  "black-forest-labs.imageEditErase": () =>
    import("./providers/black-forest-labs").then((m) => asCli(m.imageEditErase)),
  "black-forest-labs.imageEditDeblur": () =>
    import("./providers/black-forest-labs").then((m) => asCli(m.imageEditDeblur)),
  "black-forest-labs.imageEditVto": () =>
    import("./providers/black-forest-labs").then((m) => asCli(m.imageEditVto)),
  "recraft.imageEdit": () => import("./providers/recraft").then((m) => asCli(m.imageEdit)),
  "recraft.imageEditInpaint": () =>
    import("./providers/recraft").then((m) => asCli(m.imageEditInpaint)),
  "recraft.imageEditOutpaint": () =>
    import("./providers/recraft").then((m) => asCli(m.imageEditOutpaint)),
  "recraft.imageEditGenerateBackground": () =>
    import("./providers/recraft").then((m) => asCli(m.imageEditGenerateBackground)),
  "recraft.imageEditReplaceBackground": () =>
    import("./providers/recraft").then((m) => asCli(m.imageEditReplaceBackground)),
  "luma.imageEditReframe": () => import("./providers/luma").then((m) => asCli(m.imageEditReframe)),
  "bria.imageEdit": () => import("./providers/bria").then((m) => asCli(m.imageEdit)),
  "reve.imageEdit": () => import("./providers/reve").then((m) => asCli(m.imageEdit)),
  "reve.imageEditRemix": () => import("./providers/reve").then((m) => asCli(m.imageEditRemix)),

  // Video generation and post-production
  "openai.video": () => import("./providers/openai").then((m) => asCli(m.video)),
  "google.video": () =>
    import("./providers/google").then((m) => asCli(m.video)),
  "runway.video": () => import("./providers/runway").then((m) => asCli(m.video)),
  "runway.videoFromImage": () => import("./providers/runway").then((m) => asCli(m.videoFromImage)),
  "runway.videoFromVideo": () => import("./providers/runway").then((m) => asCli(m.videoFromVideo)),
  "luma.video": () => import("./providers/luma").then((m) => asCli(m.video)),
  "luma.videoModify": () => import("./providers/luma").then((m) => asCli(m.videoModify)),
  "luma.videoReframe": () => import("./providers/luma").then((m) => asCli(m.videoReframe)),
  "luma.videoUpscale": () => import("./providers/luma").then((m) => asCli(m.videoUpscale)),
  "luma.videoAddAudio": () => import("./providers/luma").then((m) => asCli(m.videoAddAudio)),
  "bytedance.video": () =>
    import("./providers/bytedance").then((m) => asCli(m.video)),
  "kling.video": () => import("./providers/kling").then((m) => asCli(m.video)),
  "kling.videoFromImage": () => import("./providers/kling").then((m) => asCli(m.videoFromImage)),
  // EXPERIMENTAL path-addressed family — uncorroborated routes, see
  // src/providers/kling/models.ts.
  "kling.videoV3": () => import("./providers/kling").then((m) => asCli(m.videoV3)),
  "kling.videoV3FromImage": () => import("./providers/kling").then((m) => asCli(m.videoV3FromImage)),
  "kling.videoOmni": () => import("./providers/kling").then((m) => asCli(m.videoOmni)),
  "lightricks.video": () =>
    import("./providers/lightricks").then((m) => asCli(m.video)),
  "lightricks.videoFromImage": () =>
    import("./providers/lightricks").then((m) => asCli(m.videoFromImage)),
  "lightricks.videoFromAudio": () =>
    import("./providers/lightricks").then((m) => asCli(m.videoFromAudio)),
  "minimax.video": () =>
    import("./providers/minimax").then((m) => asCli(m.video)),
  "minimax.videoV2": () =>
    import("./providers/minimax").then((m) => asCli(m.videoV2)),
  "pixverse.video": () => import("./providers/pixverse").then((m) => asCli(m.video)),
  "pixverse.videoFromImage": () => import("./providers/pixverse").then((m) => asCli(m.videoFromImage)),
  "vidu.video": () => import("./providers/vidu").then((m) => asCli(m.video)),
  "vidu.videoFromImage": () => import("./providers/vidu").then((m) => asCli(m.videoFromImage)),
  "vidu.videoFromReference": () => import("./providers/vidu").then((m) => asCli(m.videoFromReference)),

  // Music generation. Both providers address their text-to-music route as
  // `music`; Stability's two audio-conditioned routes qualify by what they are
  // made from (`musicFromAudio`) and what they do to a finished track
  // (`musicInpaint`), and both are multipart-only.
  "elevenlabs.music": () => import("./providers/elevenlabs").then((m) => asCli(m.music)),
  "stability.music": () => import("./providers/stability").then((m) => asCli(m.music)),

  // Speech — TTS. Every provider addresses its synthesis route as `speech`
  // (the address-vs-wire law): the wire spellings differ wildly
  // (/v1/text-to-speech/{voice_id}, /tts/bytes, /v1/speak, /v1/t2a_v2,
  // /synthesize), and the URL constants and wire types keep them — but the
  // endpoint id a caller types is uniform.
  "openai.speech": () => import("./providers/openai").then((m) => asCli(m.speech)),
  "elevenlabs.speech": () => import("./providers/elevenlabs").then((m) => asCli(m.speech)),
  "cartesia.speech": () => import("./providers/cartesia").then((m) => asCli(m.speech)),
  "inworld.speech": () => import("./providers/inworld").then((m) => asCli(m.speech)),
  "deepgram.speech": () => import("./providers/deepgram").then((m) => asCli(m.speech)),
  "fish-audio.speech": () => import("./providers/fish-audio").then((m) => asCli(m.speech)),
  "hume.speech": () => import("./providers/hume").then((m) => asCli(m.speech)),
  "lmnt.speech": () => import("./providers/lmnt").then((m) => asCli(m.speech)),
  "lmnt.speechDetailed": () => import("./providers/lmnt").then((m) => asCli(m.speechDetailed)),
  "minimax.speech": () => import("./providers/minimax").then((m) => asCli(m.speech)),
  "murf.speech": () => import("./providers/murf").then((m) => asCli(m.speech)),
  "murf.speechStream": () => import("./providers/murf").then((m) => asCli(m.speechStream)),
  "resemble.speech": () => import("./providers/resemble").then((m) => asCli(m.speech)),
  "resemble.speechStream": () =>
    import("./providers/resemble").then((m) => asCli(m.speechStream)),
  "rime.speech": () => import("./providers/rime").then((m) => asCli(m.speech)),
  "smallest-ai.speech": () => import("./providers/smallest-ai").then((m) => asCli(m.speech)),
  "speechify.speech": () => import("./providers/speechify").then((m) => asCli(m.speech)),
  "speechify.speechStream": () =>
    import("./providers/speechify").then((m) => asCli(m.speechStream)),

  // Speech to text. Every provider addresses its transcription route as
  // `transcribe` (the address-vs-wire law): the wire spellings differ wildly
  // (/v1/audio/transcriptions, /v1/speech-to-text, /v1/listen, /v2/transcript,
  // /v2/pre-recorded, /speechtotext/v1/jobs, /v2/jobs, /stt), and the URL
  // constants and wire types keep them — but the endpoint id a caller types is
  // uniform. Listed here are the routes whose audio a JSON document can
  // express; the file-upload-only ones are under MULTIPART_ONLY below.
  "elevenlabs.transcribe": () =>
    import("./providers/elevenlabs").then((m) => asCli(m.transcribe)),
  "soniox.transcribe": () =>
    import("./providers/soniox").then((m) => asCli(m.transcribe)),
  "deepgram.transcribe": () => import("./providers/deepgram").then((m) => asCli(m.transcribe)),
  // Inline base64 audio, so JSON params can express it — not multipart.
  "inworld.transcribe": () => import("./providers/inworld").then((m) => asCli(m.transcribe)),
  "assemblyai.transcribe": () =>
    import("./providers/assemblyai").then((m) => asCli(m.transcribe)),
  "gladia.transcribe": () => import("./providers/gladia").then((m) => asCli(m.transcribe)),
  "mistral.transcribe": () =>
    import("./providers/mistral").then((m) => asCli(m.transcribe)),
  "revai.transcribe": () => import("./providers/revai").then((m) => asCli(m.transcribe)),
  "speechmatics.transcribe": () => import("./providers/speechmatics").then((m) => asCli(m.transcribe)),

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
 * The unified media surfaces, addressed as `unified.<category>`.
 *
 * A separate map because they are a different *kind* of target: the params are
 * the canonical vocabulary rather than any provider's wire body, and the
 * `model` field is a `"provider/model"` ref that decides which validator
 * actually runs. Folding them into REGISTRY would make the drift guard in
 * `cli.test.ts` — which asserts REGISTRY names exactly the module-level
 * provider validators — either wrong or full of exceptions.
 *
 * All six are here — every category now ships a ready-made pack. The key after
 * the dot is the **category id** (`imageEdit`), camelCase like every other
 * endpoint id the CLI takes, not the kebab-case package subpath: `unmodel
 * validate` addresses endpoints, and `unmodel/image-edit` is an import.
 *
 * `unified.transcribe` and `unified.image-edit` are registered even though some
 * of their providers take their media as a `Blob`: the canonical `audio` is
 * `{ url }` or `{ fileId }` at seven of eleven transcribe providers and the
 * canonical `image` is `{ url }` or `{ data }` at two of four editing ones, all
 * of which a JSON document expresses — so both surfaces are genuinely
 * CLI-usable, and a ref pointed at a multipart route is refused by that
 * provider's own adapter with a message naming the shapes it does take, which is
 * a better answer than hiding the whole category.
 */
export const UNIFIED: Record<string, () => Promise<CliValidator>> = {
  "unified.image": () => import("./unified/image").then((m) => asCli(m.image)),
  "unified.imageEdit": () => import("./unified/image-edit").then((m) => asCli(m.imageEdit)),
  "unified.music": () => import("./unified/music").then((m) => asCli(m.music)),
  "unified.speech": () => import("./unified/speech").then((m) => asCli(m.speech)),
  "unified.transcribe": () => import("./unified/transcribe").then((m) => asCli(m.transcribe)),
  "unified.video": () => import("./unified/video").then((m) => asCli(m.video)),
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
  "openai.transcribe": "unmodel/openai",
  "cartesia.transcribe": "unmodel/cartesia",
  "ideogram.imageEdit": "unmodel/ideogram",
  "ideogram.imageEditRemix": "unmodel/ideogram",
  "ideogram.imageEditReframe": "unmodel/ideogram",
  "ideogram.imageEditReplaceBackground": "unmodel/ideogram",
  "stability.imageEditErase": "unmodel/stability",
  "stability.imageEditInpaint": "unmodel/stability",
  "stability.imageEditOutpaint": "unmodel/stability",
  "stability.imageEditSearchAndReplace": "unmodel/stability",
  "stability.imageEditSearchAndRecolor": "unmodel/stability",
  "stability.imageEditRemoveBackground": "unmodel/stability",
  "stability.musicFromAudio": "unmodel/stability",
  "stability.musicInpaint": "unmodel/stability",
};
