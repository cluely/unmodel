import { expect, test } from "bun:test";
import { MULTIPART_ONLY, REGISTRY } from "./cli-registry";

// ---------------------------------------------------------------------------
// The endpoint-id rename map, made executable.
//
// Every endpoint id is public API twice over: it is what `unmodel validate
// <id>` takes on the command line, and it is the string the availability data
// and `.toApi` warnings name. Renaming one is therefore a breaking change,
// and the whole point of this list is that a rename cannot happen quietly —
// it has to be typed out here, in the diff, next to the code that caused it.
//
// The drift guard in cli.test.ts asserts the maps stay in sync with the
// provider exports; this asserts the *names themselves* are the intended ones.
// Media-endpoint renames will extend this list.
// ---------------------------------------------------------------------------

const EXPECTED_IDS: readonly string[] = [
  "alibaba.chat",
  "anthropic.chat",
  "assemblyai.transcript",
  "baseten.chat",
  "black-forest-labs.flux1",
  "black-forest-labs.flux2",
  "black-forest-labs.fluxDeblur",
  "black-forest-labs.fluxErase",
  "black-forest-labs.fluxExpand",
  "black-forest-labs.fluxFill",
  "black-forest-labs.fluxKontext",
  "black-forest-labs.fluxOutpainting",
  "black-forest-labs.fluxVto",
  "bria.imageEdit",
  "bria.imageGenerate",
  "bria.imageGenerateLite",
  "bytedance.contentGenerationTasks",
  "bytedance.imageGenerations",
  "cartesia.speech",
  "cartesia.stt",
  "cartesia.sttWebsocket",
  "cartesia.ttsWebsocket",
  "cerebras.chat",
  "cohere.chat",
  "deepgram.fluxConfigure",
  "deepgram.listen",
  "deepgram.listenFlux",
  "deepgram.listenLive",
  "deepgram.speakLive",
  "deepgram.speech",
  "deepinfra.chat",
  "deepseek.chat",
  "elevenlabs.music",
  "elevenlabs.speech",
  "elevenlabs.speechToText",
  "elevenlabs.speechToTextRealtime",
  "elevenlabs.textToSpeechStreamInput",
  "fireworks-ai.chat",
  "fish-audio.speech",
  "friendli.chat",
  "gladia.preRecorded",
  "google.chat",
  "google.generateImages",
  "google.generateVideos",
  "groq.chat",
  "huggingface.chat",
  "hume.speech",
  "ideogram.edit",
  "ideogram.generate",
  "ideogram.generateV4",
  "ideogram.reframe",
  "ideogram.remix",
  "ideogram.replaceBackground",
  "inception.chat",
  "inworld.realtimeTranscribeConfig",
  "inworld.realtimeVoiceContext",
  "inworld.speech",
  "inworld.transcribe",
  "kling.imageGenerations",
  "kling.imageToVideo",
  "kling.imageToVideoV3",
  "kling.omniImage",
  "kling.omniVideo",
  "kling.textToVideo",
  "kling.textToVideoV3",
  "krea.krea2",
  "leonardo.generations",
  "lightricks.audioToVideo",
  "lightricks.imageToVideo",
  "lightricks.textToVideo",
  "lmnt.speech",
  "lmnt.speechDetailed",
  "longcat.chat",
  "luma.addAudio",
  "luma.generations",
  "luma.imageGenerations",
  "luma.modifyVideo",
  "luma.reframeImage",
  "luma.reframeVideo",
  "luma.upscale",
  "meta.chat",
  "minimax.chat",
  "minimax.speech",
  "minimax.videoGeneration",
  "minimax.videoGenerationV2",
  "mistral.chat",
  "mistral.transcription",
  "moonshotai.chat",
  "murf.speech",
  "murf.speechStream",
  "nebius.chat",
  "novita-ai.chat",
  "nvidia.chat",
  "openai.chat",
  "openai.imageEdit",
  "openai.images",
  "openai.realtimeSession",
  "openai.speech",
  "openai.transcription",
  "openai.videos",
  "openrouter.chat",
  "perplexity.chat",
  "pixverse.imageToVideo",
  "pixverse.textToVideo",
  "recraft.generateBackground",
  "recraft.generations",
  "recraft.imageToImage",
  "recraft.inpaint",
  "recraft.outpaint",
  "recraft.replaceBackground",
  "resemble.speech",
  "resemble.speechStream",
  "revai.jobs",
  "reve.create",
  "reve.createV2",
  "reve.edit",
  "reve.remix",
  "rime.speech",
  "runway.imageToVideo",
  "runway.textToImage",
  "runway.textToVideo",
  "runway.videoToVideo",
  "sarvam.chat",
  "scaleway.chat",
  "siliconflow.chat",
  "smallest-ai.speech",
  "soniox.realtimeTranscription",
  "soniox.transcriptions",
  "speechify.speech",
  "speechify.speechStream",
  "speechmatics.jobs",
  "stability.stableAudioAudioToAudio",
  "stability.stableAudioInpaint",
  "stability.stableAudioTextToAudio",
  "stability.stableImageCore",
  "stability.stableImageErase",
  "stability.stableImageInpaint",
  "stability.stableImageOutpaint",
  "stability.stableImageRemoveBackground",
  "stability.stableImageSd3",
  "stability.stableImageSearchAndRecolor",
  "stability.stableImageSearchAndReplace",
  "stability.stableImageUltra",
  "stepfun.chat",
  "togetherai.chat",
  "upstage.chat",
  "vercel.chat",
  "vidu.img2video",
  "vidu.reference2image",
  "vidu.reference2video",
  "vidu.text2video",
  "xai.chat",
  "zhipuai.chat",
];

test("the CLI registry names exactly the expected endpoint ids", () => {
  const actual = [...Object.keys(REGISTRY), ...Object.keys(MULTIPART_ONLY)].sort();
  expect(actual).toEqual([...EXPECTED_IDS]);
});

test("the expected id list is sorted, unique, and fully qualified", () => {
  expect([...EXPECTED_IDS].sort()).toEqual([...EXPECTED_IDS]);
  expect(new Set(EXPECTED_IDS).size).toBe(EXPECTED_IDS.length);
  for (const id of EXPECTED_IDS) expect(id).toMatch(/^[a-z0-9-]+\.[a-zA-Z0-9]+$/);
});

test("the chat-category endpoints all use the uniform `chat` verb", () => {
  // The address-vs-wire naming law: an endpoint ADDRESS is uniform across
  // providers even where the wire spelling is not (`/v1/messages`,
  // `:generateContent`, `/converse` all address `<provider>.chat`).
  for (const id of ["anthropic.chat", "google.chat", "openai.chat", "cohere.chat"]) {
    expect(EXPECTED_IDS).toContain(id);
  }
  // No chat-category provider addresses its endpoint by that provider's wire
  // spelling. Derived rather than written out, so the dead ids do not survive
  // as literals anywhere in the tree.
  const wireVerbs = ["messages", "generateContent", "converse"];
  const revived = EXPECTED_IDS.filter((id) => wireVerbs.includes(id.split(".")[1] ?? ""));
  expect(revived).toEqual([]);
});
