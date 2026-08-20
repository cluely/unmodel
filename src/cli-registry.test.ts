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
  "assemblyai.transcribe",
  "baseten.chat",
  "black-forest-labs.image",
  "black-forest-labs.imageEdit",
  "black-forest-labs.imageEditDeblur",
  "black-forest-labs.imageEditErase",
  "black-forest-labs.imageEditExpand",
  "black-forest-labs.imageEditFill",
  "black-forest-labs.imageEditOutpainting",
  "black-forest-labs.imageEditVto",
  "black-forest-labs.imageFlux1",
  "bria.image",
  "bria.imageEdit",
  "bria.imageLite",
  "bytedance.image",
  "bytedance.video",
  "cartesia.speech",
  "cartesia.sttWebsocket",
  "cartesia.transcribe",
  "cartesia.ttsWebsocket",
  "cerebras.chat",
  "cohere.chat",
  "deepgram.fluxConfigure",
  "deepgram.listenFlux",
  "deepgram.listenLive",
  "deepgram.speakLive",
  "deepgram.speech",
  "deepgram.transcribe",
  "deepinfra.chat",
  "deepseek.chat",
  "elevenlabs.music",
  "elevenlabs.speech",
  "elevenlabs.speechToTextRealtime",
  "elevenlabs.textToSpeechStreamInput",
  "elevenlabs.transcribe",
  "fireworks-ai.chat",
  "fish-audio.speech",
  "friendli.chat",
  "gladia.transcribe",
  "google.chat",
  "google.image",
  "google.video",
  "groq.chat",
  "huggingface.chat",
  "hume.speech",
  "ideogram.image",
  "ideogram.imageEdit",
  "ideogram.imageEditReframe",
  "ideogram.imageEditRemix",
  "ideogram.imageEditReplaceBackground",
  "ideogram.imageV4",
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
  "luma.imageEditReframe",
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
  "mistral.transcribe",
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
  "openai.transcribe",
  "openai.video",
  "openrouter.chat",
  "perplexity.chat",
  "pixverse.video",
  "pixverse.videoFromImage",
  "recraft.image",
  "recraft.imageEdit",
  "recraft.imageEditGenerateBackground",
  "recraft.imageEditInpaint",
  "recraft.imageEditOutpaint",
  "recraft.imageEditReplaceBackground",
  "resemble.speech",
  "resemble.speechStream",
  "revai.transcribe",
  "reve.image",
  "reve.imageEdit",
  "reve.imageEditRemix",
  "reve.imageV2",
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
  "soniox.transcribe",
  "speechify.speech",
  "speechify.speechStream",
  "speechmatics.transcribe",
  "stability.image",
  "stability.imageCore",
  "stability.imageEditErase",
  "stability.imageEditInpaint",
  "stability.imageEditOutpaint",
  "stability.imageEditRemoveBackground",
  "stability.imageEditSearchAndRecolor",
  "stability.imageEditSearchAndReplace",
  "stability.imageSd3",
  "stability.music",
  "stability.musicFromAudio",
  "stability.musicInpaint",
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
 * does not carry its category, and `luma.imageEditReframe` reframes a *still*
 * rather than a clip — so it belongs to the `imageEdit` list below, next to
 * `luma.videoReframe`'s near-namesake, and not here.
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

/**
 * The speech-to-text half of the law, and the one where the wire spellings
 * disagreed the most: eleven providers spelled the same operation
 * `transcription`, `transcriptions`, `transcript`, `speechToText`, `listen`,
 * `preRecorded`, `jobs` and `stt`. All eleven now address it as `transcribe`,
 * which is also what makes `unmodel/transcribe`'s ref union readable — the
 * category entry and the provider entry are the same word.
 *
 * Written out rather than derived because an id does not carry its category,
 * and because the point of the list is that a rename has to be typed here.
 */
const TRANSCRIBE_IDS: readonly string[] = [
  "assemblyai.transcribe",
  "cartesia.transcribe",
  "deepgram.transcribe",
  "elevenlabs.transcribe",
  "gladia.transcribe",
  "inworld.transcribe",
  "mistral.transcribe",
  "openai.transcribe",
  "revai.transcribe",
  "soniox.transcribe",
  "speechmatics.transcribe",
];

test("the transcription endpoints all use the uniform `transcribe` verb", () => {
  for (const id of TRANSCRIBE_IDS) {
    expect(EXPECTED_IDS).toContain(id);
    // Bare `transcribe` everywhere: no provider ships a second batch route, so
    // unlike image and video there is nothing to qualify.
    expect(id.split(".")[1] ?? "").toBe("transcribe");
  }
  const providers = [...new Set(TRANSCRIBE_IDS.map((id) => id.split(".")[0] as string))].sort();
  expect(providers).toHaveLength(11);

  // The realtime surfaces keep their own names — a socket config is a
  // different endpoint from a batch POST, and collapsing the two would make
  // `transcribe` mean two transports.
  for (const id of [
    "deepgram.listenLive",
    "deepgram.listenFlux",
    "deepgram.fluxConfigure",
    "elevenlabs.speechToTextRealtime",
    "soniox.realtimeTranscription",
    "cartesia.sttWebsocket",
    "inworld.realtimeTranscribeConfig",
  ]) {
    expect(EXPECTED_IDS).toContain(id);
  }

  const retired = [
    "assemblyai.transcript",
    "cartesia.stt",
    "deepgram.listen",
    "elevenlabs.speechToText",
    "gladia.preRecorded",
    "mistral.transcription",
    "openai.transcription",
    "revai.jobs",
    "soniox.transcriptions",
    "speechmatics.jobs",
  ];
  for (const id of retired) expect(EXPECTED_IDS).not.toContain(id);
});

/**
 * The music half. Two providers, three routes: the text-to-music route is bare
 * `music` at both, and Stability's two audio-conditioned routes qualify by
 * what they are made from and what they do to a finished track.
 */
const MUSIC_IDS: readonly string[] = [
  "elevenlabs.music",
  "stability.music",
  "stability.musicFromAudio",
  "stability.musicInpaint",
];

test("the music-category endpoints all use the uniform `music` verb", () => {
  for (const id of MUSIC_IDS) {
    expect(EXPECTED_IDS).toContain(id);
    expect(id.split(".")[1] ?? "").toMatch(/^music([A-Z]|$)/);
  }
  const providers = [...new Set(MUSIC_IDS.map((id) => id.split(".")[0] as string))].sort();
  for (const provider of providers) expect(MUSIC_IDS).toContain(`${provider}.music`);
  expect(providers).toEqual(["elevenlabs", "stability"]);

  const retired = [
    "stability.stableAudioTextToAudio",
    "stability.stableAudioAudioToAudio",
    "stability.stableAudioInpaint",
  ];
  for (const id of retired) expect(EXPECTED_IDS).not.toContain(id);
});

/**
 * The image-edit half, and the last one the law had left to apply: eight
 * providers, twenty-six routes, and previously eight unrelated vocabularies for
 * "change this picture" — a product family (`fluxKontext`, `fluxFill`,
 * `fluxVto`), a wire path (`imageToImage`, `stableImageSearchAndReplace`), a
 * bare verb (`edit`, `remix`, `reframe`) and a noun phrase
 * (`replaceBackground`, `generateBackground`).
 *
 * All twenty-six now address the category as `imageEdit`, with each extra route
 * qualified by *what it does to the picture* (`imageEditInpaint`,
 * `imageEditOutpaint`, `imageEditErase`, `imageEditDeblur`,
 * `imageEditReframe`, `imageEditVto`, `imageEditSearchAndReplace`) — never by
 * the wire spelling or the vendor's product name, both of which survive on the
 * URL constants and the `*Params` types where they belong.
 *
 * A provider's primary "prompt + one image" route is bare `imageEdit`
 * everywhere it has one. The three that do not — Stability, Luma and the
 * FLUX-tools family — are genuinely mask- or geometry-driven at every route
 * they serve, which is exactly what the qualifier says.
 */
const IMAGE_EDIT_IDS: readonly string[] = [
  "black-forest-labs.imageEdit",
  "black-forest-labs.imageEditDeblur",
  "black-forest-labs.imageEditErase",
  "black-forest-labs.imageEditExpand",
  "black-forest-labs.imageEditFill",
  "black-forest-labs.imageEditOutpainting",
  "black-forest-labs.imageEditVto",
  "bria.imageEdit",
  "ideogram.imageEdit",
  "ideogram.imageEditReframe",
  "ideogram.imageEditRemix",
  "ideogram.imageEditReplaceBackground",
  "luma.imageEditReframe",
  "openai.imageEdit",
  "recraft.imageEdit",
  "recraft.imageEditGenerateBackground",
  "recraft.imageEditInpaint",
  "recraft.imageEditOutpaint",
  "recraft.imageEditReplaceBackground",
  "reve.imageEdit",
  "reve.imageEditRemix",
  "stability.imageEditErase",
  "stability.imageEditInpaint",
  "stability.imageEditOutpaint",
  "stability.imageEditRemoveBackground",
  "stability.imageEditSearchAndRecolor",
  "stability.imageEditSearchAndReplace",
];

test("the image-edit endpoints all use the uniform `imageEdit` verb", () => {
  for (const id of IMAGE_EDIT_IDS) {
    expect(EXPECTED_IDS).toContain(id);
    expect(id.split(".")[1] ?? "").toMatch(/^imageEdit([A-Z]|$)/);
  }
  const providers = [...new Set(IMAGE_EDIT_IDS.map((id) => id.split(".")[0] as string))].sort();
  expect(providers).toEqual([
    "black-forest-labs",
    "bria",
    "ideogram",
    "luma",
    "openai",
    "recraft",
    "reve",
    "stability",
  ]);
  // The five whose primary route is "prompt + one image, no mask" address it as
  // bare `imageEdit` — which is the ref `unmodel/image-edit` reaches for, and
  // therefore the half of the law with teeth.
  for (const provider of ["black-forest-labs", "bria", "ideogram", "openai", "recraft", "reve"]) {
    expect(IMAGE_EDIT_IDS).toContain(`${provider}.imageEdit`);
  }

  // …and no route is claimed by both halves of the image surface. `imageEdit`
  // is a prefix-extension of `image`, so the two lists are the only thing that
  // can tell a generation route from an editing one — a route in both would
  // make the unified `image` and `image-edit` packs disagree about what it is.
  expect(IMAGE_GENERATION_IDS.filter((id) => IMAGE_EDIT_IDS.includes(id))).toEqual([]);

  const retired = [
    "black-forest-labs.fluxKontext",
    "black-forest-labs.fluxFill",
    "black-forest-labs.fluxExpand",
    "black-forest-labs.fluxErase",
    "black-forest-labs.fluxDeblur",
    "black-forest-labs.fluxOutpainting",
    "black-forest-labs.fluxVto",
    "ideogram.edit",
    "ideogram.remix",
    "ideogram.reframe",
    "ideogram.replaceBackground",
    "luma.reframeImage",
    "recraft.imageToImage",
    "recraft.inpaint",
    "recraft.outpaint",
    "recraft.generateBackground",
    "recraft.replaceBackground",
    "reve.edit",
    "reve.remix",
    "stability.stableImageErase",
    "stability.stableImageInpaint",
    "stability.stableImageOutpaint",
    "stability.stableImageSearchAndReplace",
    "stability.stableImageSearchAndRecolor",
    "stability.stableImageRemoveBackground",
  ];
  for (const id of retired) expect(EXPECTED_IDS).not.toContain(id);
});

/**
 * The law, closed. Every endpoint in the six media categories now addresses its
 * category with the category's own verb — which is what makes the six unified
 * entries' ref unions readable, because the word a caller types at
 * `unmodel/<category>` and the word they type at `unmodel/<provider>` are the
 * same word.
 */
test("every media endpoint addresses its category with that category's verb", () => {
  const MEDIA = [
    ...IMAGE_GENERATION_IDS,
    ...IMAGE_EDIT_IDS,
    ...VIDEO_IDS,
    ...TRANSCRIBE_IDS,
    ...MUSIC_IDS,
  ];
  // No id belongs to two categories — `imageEdit` vs `image` is the pair where
  // a prefix test alone would say yes twice.
  expect(new Set(MEDIA).size).toBe(MEDIA.length);
  for (const id of MEDIA) expect(EXPECTED_IDS).toContain(id);
});
