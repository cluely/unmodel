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
  "black-forest-labs.fluxDeblur",
  "black-forest-labs.fluxErase",
  "black-forest-labs.fluxExpand",
  "black-forest-labs.fluxFill",
  "black-forest-labs.fluxKontext",
  "black-forest-labs.fluxOutpainting",
  "black-forest-labs.fluxVto",
  "black-forest-labs.image",
  "black-forest-labs.imageFlux1",
  "bria.image",
  "bria.imageEdit",
  "bria.imageLite",
  "bytedance.image",
  "bytedance.video",
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
  "google.image",
  "google.video",
  "groq.chat",
  "huggingface.chat",
  "hume.speech",
  "ideogram.edit",
  "ideogram.image",
  "ideogram.imageV4",
  "ideogram.reframe",
  "ideogram.remix",
  "ideogram.replaceBackground",
  "inception.chat",
  "inworld.realtimeTranscribeConfig",
  "inworld.realtimeVoiceContext",
  "inworld.speech",
  "inworld.transcribe",
  "kling.image",
  "kling.imageOmni",
  "kling.video",
  "kling.videoFromImage",
  "kling.videoOmni",
  "kling.videoV3",
  "kling.videoV3FromImage",
  "krea.image",
  "leonardo.image",
  "lightricks.video",
  "lightricks.videoFromAudio",
  "lightricks.videoFromImage",
  "lmnt.speech",
  "lmnt.speechDetailed",
  "longcat.chat",
  "luma.image",
  "luma.reframeImage",
  "luma.video",
  "luma.videoAddAudio",
  "luma.videoModify",
  "luma.videoReframe",
  "luma.videoUpscale",
  "meta.chat",
  "minimax.chat",
  "minimax.speech",
  "minimax.video",
  "minimax.videoV2",
  "mistral.chat",
  "mistral.transcription",
  "moonshotai.chat",
  "murf.speech",
  "murf.speechStream",
  "nebius.chat",
  "novita-ai.chat",
  "nvidia.chat",
  "openai.chat",
  "openai.image",
  "openai.imageEdit",
  "openai.realtimeSession",
  "openai.speech",
  "openai.transcription",
  "openai.video",
  "openrouter.chat",
  "perplexity.chat",
  "pixverse.video",
  "pixverse.videoFromImage",
  "recraft.generateBackground",
  "recraft.image",
  "recraft.imageToImage",
  "recraft.inpaint",
  "recraft.outpaint",
  "recraft.replaceBackground",
  "resemble.speech",
  "resemble.speechStream",
  "revai.jobs",
  "reve.edit",
  "reve.image",
  "reve.imageV2",
  "reve.remix",
  "rime.speech",
  "runway.image",
  "runway.video",
  "runway.videoFromImage",
  "runway.videoFromVideo",
  "sarvam.chat",
  "scaleway.chat",
  "siliconflow.chat",
  "smallest-ai.speech",
  "soniox.realtimeTranscription",
  "soniox.transcriptions",
  "speechify.speech",
  "speechify.speechStream",
  "speechmatics.jobs",
  "stability.image",
  "stability.imageCore",
  "stability.imageSd3",
  "stability.stableAudioAudioToAudio",
  "stability.stableAudioInpaint",
  "stability.stableAudioTextToAudio",
  "stability.stableImageErase",
  "stability.stableImageInpaint",
  "stability.stableImageOutpaint",
  "stability.stableImageRemoveBackground",
  "stability.stableImageSearchAndRecolor",
  "stability.stableImageSearchAndReplace",
  "stepfun.chat",
  "togetherai.chat",
  "upstage.chat",
  "vercel.chat",
  "vidu.imageFromReference",
  "vidu.video",
  "vidu.videoFromImage",
  "vidu.videoFromReference",
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

/**
 * The image-generation half of the same law, written out because the category
 * cannot be derived from an id. This lists the text-to-image routes and
 * asserts both halves — the new names exist, and the old ones do not survive
 * anywhere the registry can see.
 */
const IMAGE_GENERATION_IDS: readonly string[] = [
  "black-forest-labs.image",
  "black-forest-labs.imageFlux1",
  "bria.image",
  "bria.imageLite",
  "bytedance.image",
  "google.image",
  "ideogram.image",
  "ideogram.imageV4",
  "kling.image",
  "kling.imageOmni",
  "krea.image",
  "leonardo.image",
  "luma.image",
  "openai.image",
  "recraft.image",
  "reve.image",
  "reve.imageV2",
  "runway.image",
  "stability.image",
  "stability.imageCore",
  "stability.imageSd3",
  "vidu.imageFromReference",
];

test("the image-generation endpoints all use the uniform `image` verb", () => {
  for (const id of IMAGE_GENERATION_IDS) {
    expect(EXPECTED_IDS).toContain(id);
    // A provider with one generation route is bare `image`; extra routes
    // qualify (`imageCore`, `imageV4`), and no route is named for its wire
    // spelling.
    expect(id.split(".")[1] ?? "").toMatch(/^image([A-Z]|$)/);
  }
  const retired = [
    "black-forest-labs.flux1",
    "black-forest-labs.flux2",
    "bria.imageGenerate",
    "bria.imageGenerateLite",
    "bytedance.imageGenerations",
    "google.generateImages",
    "ideogram.generate",
    "ideogram.generateV4",
    "kling.imageGenerations",
    "kling.omniImage",
    "krea.krea2",
    "leonardo.generations",
    "luma.imageGenerations",
    "openai.images",
    "recraft.generations",
    "reve.create",
    "reve.createV2",
    "runway.textToImage",
    "stability.stableImageCore",
    "stability.stableImageSd3",
    "stability.stableImageUltra",
    "vidu.reference2image",
  ];
  for (const id of retired) expect(EXPECTED_IDS).not.toContain(id);
});

/**
 * The video half of the law, and the widest application of it: eleven wire
 * spellings (`videos`, `generateVideos`, `text2video`, `img2video`,
 * `contentGenerationTasks`, `generations`, `videoGeneration`, …) collapse onto
 * one verb, with every extra route qualified by what makes it different —
 * *what it is made from* (`videoFromImage`, `videoFromVideo`,
 * `videoFromReference`, `videoFromAudio`), *which route family serves it*
 * (`videoV3`, `videoV2`, `videoOmni`), or *what it does to a finished clip*
 * (`videoModify`, `videoReframe`, `videoUpscale`, `videoAddAudio`).
 *
 * Written out rather than derived for the same reason as the image list: an id
 * does not carry its category, and `luma.reframeImage` is an *edit* route that
 * must keep its name until that wave.
 */
const VIDEO_IDS: readonly string[] = [
  "bytedance.video",
  "google.video",
  "kling.video",
  "kling.videoFromImage",
  "kling.videoOmni",
  "kling.videoV3",
  "kling.videoV3FromImage",
  "lightricks.video",
  "lightricks.videoFromAudio",
  "lightricks.videoFromImage",
  "luma.video",
  "luma.videoAddAudio",
  "luma.videoModify",
  "luma.videoReframe",
  "luma.videoUpscale",
  "minimax.video",
  "minimax.videoV2",
  "openai.video",
  "pixverse.video",
  "pixverse.videoFromImage",
  "runway.video",
  "runway.videoFromImage",
  "runway.videoFromVideo",
  "vidu.video",
  "vidu.videoFromImage",
  "vidu.videoFromReference",
];

test("the video-category endpoints all use the uniform `video` verb", () => {
  for (const id of VIDEO_IDS) {
    expect(EXPECTED_IDS).toContain(id);
    // A provider's primary generation route is bare `video`; every other route
    // qualifies (`videoFromImage`, `videoV3`, `videoUpscale`), and no route is
    // named for its wire spelling.
    expect(id.split(".")[1] ?? "").toMatch(/^video([A-Z]|$)/);
  }
  // Every provider that ships a video route ships a bare `video` one, so the
  // ref a caller reaches for first is the same word everywhere.
  const providers = [...new Set(VIDEO_IDS.map((id) => id.split(".")[0] as string))].sort();
  for (const provider of providers) expect(VIDEO_IDS).toContain(`${provider}.video`);
  expect(providers).toHaveLength(10);

  const retired = [
    "bytedance.contentGenerationTasks",
    "google.generateVideos",
    "kling.imageToVideo",
    "kling.imageToVideoV3",
    "kling.omniVideo",
    "kling.textToVideo",
    "kling.textToVideoV3",
    "lightricks.audioToVideo",
    "lightricks.imageToVideo",
    "lightricks.textToVideo",
    "luma.addAudio",
    "luma.generations",
    "luma.modifyVideo",
    "luma.reframeVideo",
    "luma.upscale",
    "minimax.videoGeneration",
    "minimax.videoGenerationV2",
    "openai.videos",
    "pixverse.imageToVideo",
    "pixverse.textToVideo",
    "runway.imageToVideo",
    "runway.textToVideo",
    "runway.videoToVideo",
    "vidu.img2video",
    "vidu.reference2video",
    "vidu.text2video",
  ];
  for (const id of retired) expect(EXPECTED_IDS).not.toContain(id);
});
