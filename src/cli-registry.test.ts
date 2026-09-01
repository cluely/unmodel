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
  "alibaba.tts",
  "alibaba.video",
  "anthropic.chat",
  "assemblyai.stt",
  "atlascloud.video",
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
  "breezeblue.tts",
  "bria.image",
  "bria.imageEdit",
  "bria.imageLite",
  "bytedance.image",
  "bytedance.video",
  "cartesia.stt",
  "cartesia.sttWebsocket",
  "cartesia.tts",
  "cartesia.ttsWebsocket",
  "cartesia.voiceClone",
  "cerebras.chat",
  "cohere.chat",
  "deepgram.fluxConfigure",
  "deepgram.listenFlux",
  "deepgram.listenLive",
  "deepgram.speakLive",
  "deepgram.stt",
  "deepgram.tts",
  "deepinfra.chat",
  "deepseek.chat",
  "elevenlabs.dub",
  "elevenlabs.dubLanguage",
  "elevenlabs.music",
  "elevenlabs.sfx",
  "elevenlabs.speechToTextRealtime",
  "elevenlabs.stt",
  "elevenlabs.textToSpeechStreamInput",
  "elevenlabs.tts",
  "elevenlabs.voiceClone",
  "elevenlabs.voiceDesign",
  "elevenlabs.voiceDesignSave",
  "fal.avatar",
  "fal.image",
  "fal.imageEdit",
  "fal.lipsync",
  "fal.music",
  "fal.sfx",
  "fal.stt",
  "fal.threeD",
  "fal.tts",
  "fal.upscale",
  "fal.video",
  "fireworks-ai.chat",
  "fish-audio.tts",
  "fish-audio.voiceClone",
  "fish-audio.voiceDesign",
  "friendli.chat",
  "gladia.stt",
  "google.chat",
  "google.image",
  "google.music",
  "google.stt",
  "google.tts",
  "google.video",
  "groq.chat",
  "heygen.avatar",
  "heygen.lipsync",
  "huggingface.chat",
  "hume.tts",
  "ideogram.image",
  "ideogram.imageEdit",
  "ideogram.imageEditReframe",
  "ideogram.imageEditRemix",
  "ideogram.imageEditReplaceBackground",
  "ideogram.imageV4",
  "inception.chat",
  "inworld.realtimeTranscribeConfig",
  "inworld.realtimeVoiceContext",
  "inworld.stt",
  "inworld.tts",
  "inworld.voiceClone",
  "inworld.voiceDesign",
  "inworld.voiceDesignPublish",
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
  "lmnt.tts",
  "lmnt.ttsDetailed",
  "lmnt.voiceClone",
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
  "minimax.tts",
  "minimax.video",
  "minimax.videoV2",
  "minimax.voiceClone",
  "minimax.voiceDesign",
  "mistral.chat",
  "mistral.stt",
  "moonshotai.chat",
  "mureka.instrumental",
  "mureka.music",
  "murf.tts",
  "murf.ttsStream",
  "nebius.chat",
  "novita-ai.chat",
  "nvidia.chat",
  "openai.chat",
  "openai.image",
  "openai.imageEdit",
  "openai.realtimeSession",
  "openai.stt",
  "openai.tts",
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
  "resemble.tts",
  "resemble.ttsStream",
  "revai.stt",
  "reve.image",
  "reve.imageEdit",
  "reve.imageEditRemix",
  "reve.imageV2",
  "rime.tts",
  "runway.image",
  "runway.video",
  "runway.videoFromImage",
  "runway.videoFromVideo",
  "sarvam.chat",
  "scaleway.chat",
  "siliconflow.chat",
  "smallest-ai.tts",
  "soniox.realtimeTranscription",
  "soniox.stt",
  "speechify.tts",
  "speechify.ttsStream",
  "speechify.voiceClone",
  "speechify.voiceConsentChallenge",
  "speechmatics.stt",
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
  "stepfun.tts",
  "sync.avatar",
  "sync.lipsync",
  "togetherai.chat",
  "topaz.upscale",
  "topaz.upscaleGenerative",
  "tripo3d.threeD",
  "tripo3d.threeDFromImage",
  "upstage.chat",
  "veed.avatar",
  "veed.lipsync",
  "vercel.chat",
  "vidu.imageFromReference",
  "vidu.video",
  "vidu.videoFromImage",
  "vidu.videoFromReference",
  "xai.chat",
  "xai.image",
  "xai.video",
  "xai.videoEdit",
  "xai.videoExtend",
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
  // ONE id for 28 endpoints. At fal the endpoint id IS the URL path, so
  // `fal.image` takes an `endpoint` param rather than forking into 28
  // addresses — the qualified ids in this list exist to name a second wire
  // ROUTE at one provider, and fal has one route with a variable path.
  "fal.image",
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
  // ONE id for 23 curated models and NO qualified sibling, for the opposite of
  // fal's reason. At fal the endpoint id is the URL path, so there is no second
  // route to name. At Atlas there is one URL for every video model and `model`
  // is a real body field that names the ROUTE as well as the model:
  // `bytedance/seedance-2.5/text-to-video` and `.../image-to-video` are two
  // model ids with two request schemas, not two endpoints. So an
  // `atlascloud.videoFromImage` would qualify a *model* choice — which is what
  // the ref already is — rather than a wire route, and the rule this list
  // encodes is that a qualified id names a second POST path.
  "atlascloud.video",
  "bytedance.video",
  // ONE id for 30 endpoints, and the one place in this list where the absence
  // of a `videoFromImage` sibling is a decision rather than a gap. Elsewhere a
  // qualified id names a second wire ROUTE — `runway.video` and
  // `runway.videoFromImage` are two POST paths with two bodies. At fal there is
  // no second route to name: `fal-ai/veo3.1` and `fal-ai/veo3.1/image-to-video`
  // are one URL shape and one body shape whose PATH is a parameter, and
  // `minimax/h3/image-to-video` settles it by making its `image_url` optional —
  // the same endpoint is text-to-video or image-to-video depending on the
  // request. A `fal.videoFromImage` would have to be defined by a list of
  // endpoint ids rather than by a rule, and the list would need editing every
  // week. Which arm an endpoint serves is a fact on its generated row that
  // `unified-video.ts` reads; see src/providers/fal/video.ts.
  "fal.video",
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
  expect(providers).toHaveLength(12);

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
 * `preRecorded` and `jobs`. All of them now address it as `stt`, which is also
 * what makes `unmodel/stt`'s ref union readable — the category entry and the
 * provider entry are the same word.
 *
 * Thirteen providers, and two of them are the sharpest cases the law has.
 * Gemini has no transcription ROUTE at all — audio in and text out is
 * `:generateContent`, the same wire path `google.chat` serves. fal has six
 * routes behind one address, because there the endpoint id is a PARAMETER
 * rather than a path unmodel picked. Both address it as the same word as
 * everyone else.
 *
 * Written out rather than derived because an id does not carry its category,
 * and because the point of the list is that a rename has to be typed here.
 */
const STT_IDS: readonly string[] = [
  "assemblyai.stt",
  "cartesia.stt",
  "deepgram.stt",
  "elevenlabs.stt",
  // Six fal endpoints — Wizper, fal's own ASR and its turbo arm, both
  // ElevenLabs Scribe generations, and Cohere — behind one address, because at
  // fal the route is a parameter. Same word all the same.
  "fal.stt",
  "gladia.stt",
  // Gemini has no dedicated transcription route: `google.stt` is an
  // audio-in/text-out view of `:generateContent`, and the address is uniform
  // all the same — which is precisely the law this list exists to pin.
  "google.stt",
  "inworld.stt",
  "mistral.stt",
  "openai.stt",
  "revai.stt",
  "soniox.stt",
  "speechmatics.stt",
];

test("the transcription endpoints all use the uniform `stt` verb", () => {
  for (const id of STT_IDS) {
    expect(EXPECTED_IDS).toContain(id);
    // Bare `stt` everywhere: no provider ships a second batch route, so
    // unlike image and video there is nothing to qualify.
    expect(id.split(".")[1] ?? "").toBe("stt");
  }
  const providers = [...new Set(STT_IDS.map((id) => id.split(".")[0] as string))].sort();
  expect(providers).toHaveLength(13);

  // The realtime surfaces keep their own names — a socket config is a
  // different endpoint from a batch POST, and collapsing the two would make
  // `stt` mean two transports.
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
 * The voice-creation half — two verbs, because creating a voice from
 * recordings and inventing one from a description are different operations
 * everywhere they both exist (different routes, disjoint required fields).
 * The wire spellings disagreed as usual (`/v1/voices/add`, `/model`,
 * `voices:clone`, `/v1/voice_clone`; `/v1/text-to-voice/design`,
 * `/v1/voice-design`, `voices:design`, `/v1/voice_design`) and every
 * provider now addresses them as `voiceClone` / `voiceDesign`. The two-phase
 * design flows qualify their save step by what it does (`voiceDesignSave`,
 * `voiceDesignPublish`), and Speechify's consent prerequisite by what it is.
 */
const VOICE_CLONE_IDS: readonly string[] = [
  "cartesia.voiceClone",
  "elevenlabs.voiceClone",
  "fish-audio.voiceClone",
  "inworld.voiceClone",
  "lmnt.voiceClone",
  "minimax.voiceClone",
  "speechify.voiceClone",
];

const VOICE_DESIGN_IDS: readonly string[] = [
  "elevenlabs.voiceDesign",
  "fish-audio.voiceDesign",
  "inworld.voiceDesign",
  "minimax.voiceDesign",
];

test("the voice-creation endpoints use the uniform verbs", () => {
  for (const id of VOICE_CLONE_IDS) {
    expect(EXPECTED_IDS).toContain(id);
    expect(id.split(".")[1] ?? "").toBe("voiceClone");
  }
  for (const id of VOICE_DESIGN_IDS) {
    expect(EXPECTED_IDS).toContain(id);
    expect(id.split(".")[1] ?? "").toBe("voiceDesign");
  }
  // The phase-2 saves and the consent prerequisite qualify, never rename.
  for (const id of [
    "elevenlabs.voiceDesignSave",
    "inworld.voiceDesignPublish",
    "speechify.voiceConsentChallenge",
  ]) {
    expect(EXPECTED_IDS).toContain(id);
  }

  // The wire spellings never became addresses.
  const retired = [
    "elevenlabs.voicesAdd",
    "elevenlabs.textToVoice",
    "fish-audio.createModel",
    "inworld.cloneVoice",
    "minimax.voiceCloning",
    "speechify.voices",
  ];
  for (const id of retired) expect(EXPECTED_IDS).not.toContain(id);
});

/**
 * The two audio-driven video halves — the pair that shows the law is about the
 * CATEGORY rather than the vendor, and now shows it twice.
 *
 * `fal-ai/sync-lipsync/v3` and `fal-ai/sync-lipsync/v3/image-to-video` are one
 * vendor's one model behind two routes, and they are addressed at
 * `fal.lipsync` and `fal.avatar` respectively — because the address names what
 * the endpoint DOES, and one redubs a performance while the other invents one.
 *
 * sync. is that same vendor natively, and it is the stronger case: `POST
 * /v2/generate` is ONE URL, `model: "sync-3"` is one id, and the only thing
 * separating `sync.lipsync` from `sync.avatar` is which fields the request may
 * carry — a still narrows the model to `sync-3` and forbids `segments` (no
 * timeline) and `dubParams` (no track to extract). Different required fields
 * behind one path is exactly what a qualified address names everywhere else in
 * this list; here the two verbs happen to be the two CATEGORY verbs, so neither
 * needs qualifying.
 *
 * Written out rather than derived for the same reason as every list here: an id
 * does not carry its category, and a rename has to be typed in the diff.
 */
const LIPSYNC_IDS: readonly string[] = [
  "fal.lipsync",
  "heygen.lipsync",
  "sync.lipsync",
  "veed.lipsync",
];

const AVATAR_IDS: readonly string[] = ["fal.avatar", "heygen.avatar", "sync.avatar", "veed.avatar"];

test("the lipsync and avatar endpoints use their categories' own verbs", () => {
  for (const id of LIPSYNC_IDS) {
    expect(EXPECTED_IDS).toContain(id);
    expect(id.split(".")[1] ?? "").toMatch(/^lipsync([A-Z]|$)/);
  }
  for (const id of AVATAR_IDS) {
    expect(EXPECTED_IDS).toContain(id);
    expect(id.split(".")[1] ?? "").toMatch(/^avatar([A-Z]|$)/);
  }
  // Both are bare, at every provider that serves them — which is what makes
  // `unmodel/lipsync`'s and `unmodel/avatar`'s ref unions read the same as the
  // provider surfaces they compile down to.
  for (const provider of [...new Set([...LIPSYNC_IDS, ...AVATAR_IDS].map((id) => id.split(".")[0] as string))]) {
    expect(LIPSYNC_IDS).toContain(`${provider}.lipsync`);
    expect(AVATAR_IDS).toContain(`${provider}.avatar`);
  }

  // The two categories are disjoint from each other and from video, which is
  // the whole content of the split: a clip in, a still in, or neither.
  expect(LIPSYNC_IDS.filter((id) => AVATAR_IDS.includes(id))).toEqual([]);
  expect([...LIPSYNC_IDS, ...AVATAR_IDS].filter((id) => VIDEO_IDS.includes(id))).toEqual([]);

  // The wire spellings never became addresses. fal files its lipsync routes
  // under `video-to-video` and `text-to-video` and its avatar routes under
  // `image-to-video` and `audio-to-video`; sync. files both under one path it
  // calls `generate`, and its own product name for the still arm is "sync-3
  // image input". None of those is an unmodel verb.
  const retired = [
    "fal.syncLipsync",
    "fal.videoToVideo",
    "fal.audioToVideo",
    "fal.talkingHead",
    "fal.aiAvatar",
    "sync.generate",
    "sync.generation",
    "sync.lipsyncFromImage",
    "sync.imageToVideo",
    // VEED files its two models under their product slugs and HeyGen under
    // `videos` and `lipsyncs`; neither vendor's word is an unmodel verb, and
    // neither route's INPUT kind gets to qualify an address that already names
    // what it does.
    "veed.fabric",
    "veed.lipsync20",
    "veed.talkingAvatar",
    "veed.backgroundRemoval",
    "heygen.video",
    "heygen.videos",
    "heygen.createVideo",
    "heygen.avatarFromImage",
    "heygen.lipsyncs",
    // HeyGen's TTS is a deliberate exclusion rather than a rename: see
    // src/providers/heygen/models.ts for why a row with no model id, no
    // published voice roster and no format control is not shipped.
    "heygen.tts",
    "heygen.speech",
  ];
  for (const id of retired) expect(EXPECTED_IDS).not.toContain(id);
});

/**
 * The music half. The text-to-music route is bare `music` at every provider
 * that has one, and Stability's two audio-conditioned routes qualify by what
 * they are made from and what they do to a finished track.
 *
 * fal is one address over ten endpoints, as it is in every other category here:
 * MiniMax, ElevenLabs, Lyria, Stable Audio, ACE-Step and DiffRhythm are all
 * reachable through `fal.music` with the endpoint id as a parameter.
 */
const MUSIC_IDS: readonly string[] = [
  "elevenlabs.music",
  "fal.music",
  "google.music",
  "mureka.music",
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
  expect(providers).toEqual(["elevenlabs", "fal", "google", "mureka", "stability"]);

  const retired = [
    "stability.stableAudioTextToAudio",
    "stability.stableAudioAudioToAudio",
    "stability.stableAudioInpaint",
  ];
  for (const id of retired) expect(EXPECTED_IDS).not.toContain(id);
});

/**
 * The sound-effects half, and the newest entry in the address law.
 *
 * `sfx` is the CATEGORY id, so `<provider>.sfx` is the uniform verb — the same
 * construction `tts` and `stt` already use, and for the same reason: all three
 * are the operation's own initialism rather than a wire path. Neither vendor
 * spells its URL anything like it (`/v1/sound-generation` at ElevenLabs, six
 * queue paths at fal), which is precisely the address-vs-wire law (decisions.md
 * §2) doing its job rather than an exception to it.
 *
 * `soundEffects` was the alternative and was rejected: the address follows the
 * category, and a category whose entry point is `unmodel/sfx` cannot have
 * `provider.soundEffects` as its address without breaking the one property this
 * test exists to keep — that the word you type at `unmodel/<category>` and the
 * word you type at `unmodel/<provider>` are the same word.
 */
const SFX_IDS: readonly string[] = ["elevenlabs.sfx", "fal.sfx"];

test("the sfx-category endpoints all use the uniform `sfx` verb", () => {
  for (const id of SFX_IDS) {
    expect(EXPECTED_IDS).toContain(id);
    expect(id.split(".")[1] ?? "").toMatch(/^sfx([A-Z]|$)/);
  }
  const providers = [...new Set(SFX_IDS.map((id) => id.split(".")[0] as string))].sort();
  for (const provider of providers) expect(SFX_IDS).toContain(`${provider}.sfx`);
  expect(providers).toEqual(["elevenlabs", "fal"]);

  // Sound effects are NOT music, at the one provider that serves both: the two
  // wires are disjoint and so are their model-id enums. A shared address would
  // have made `elevenlabs.music` accept `eleven_text_to_sound_v2`, which it
  // refuses by name.
  expect(SFX_IDS.filter((id) => MUSIC_IDS.includes(id))).toEqual([]);

  // The almost-chosen spelling. Recorded here rather than in prose alone, so a
  // future rename has to delete an assertion to happen.
  for (const id of ["elevenlabs.soundEffects", "fal.soundEffects"]) {
    expect(EXPECTED_IDS).not.toContain(id);
  }
});

/**
 * The upscale half — the category whose address had the most alternatives to
 * reject, and the one that now shows both answers to "should a second route
 * qualify".
 *
 * `fal.upscale` is bare, over ten endpoints and two media, and there is NO
 * `fal.upscaleVideo`: three of the ten take a clip and seven take a still, and
 * that is a difference in what goes IN rather than in the route's shape.
 * `fal-ai/seedvr/upscale/image` and `fal-ai/seedvr/upscale/video` are one
 * vendor's one product on two paths behind one URL shape; qualifying the
 * address would mean maintaining a LIST of which endpoint is which, where the
 * row's `sources` already states it as data.
 *
 * `topaz.upscaleGenerative` is the opposite case and therefore DOES qualify.
 * Topaz publishes two real URLs — `/image/v1/enhance/async` and
 * `/image/v1/enhance-gen/async` — with disjoint model enums and different
 * dials: `strength` and `fixCompression` on one, `creativity`, `texture`,
 * `detail` and `prompt` on the other. Two routes with different fields is the
 * same fork `stability.imageCore` and `ideogram.imageV4` name, and the primary
 * one stays bare.
 *
 * There is no `fal.superResolution` and no `topaz.enhance` — the wire words
 * these are filed under are `image-to-image`, `video-to-video` and `enhance`,
 * and none of them is an unmodel verb.
 */
const UPSCALE_IDS: readonly string[] = [
  "fal.upscale",
  "topaz.upscale",
  "topaz.upscaleGenerative",
];

test("the upscale endpoints use the category's own verb", () => {
  for (const id of UPSCALE_IDS) {
    expect(EXPECTED_IDS).toContain(id);
    expect(id.split(".")[1] ?? "").toMatch(/^upscale([A-Z]|$)/);
  }
  // Bare at every provider that serves the category, which is what makes
  // `unmodel/upscale`'s ref union read the same as the provider surface it
  // compiles down to.
  for (const provider of [...new Set(UPSCALE_IDS.map((id) => id.split(".")[0] as string))]) {
    expect(UPSCALE_IDS).toContain(`${provider}.upscale`);
  }

  // Disjoint from the two image categories, which is the content of the split:
  // an edit says what the result should look like, an upscale says how much
  // bigger it should be.
  expect(UPSCALE_IDS.filter((id) => IMAGE_GENERATION_IDS.includes(id))).toEqual([]);
  expect(UPSCALE_IDS.filter((id) => IMAGE_EDIT_IDS.includes(id))).toEqual([]);
  expect(UPSCALE_IDS.filter((id) => VIDEO_IDS.includes(id))).toEqual([]);

  const retired = [
    "fal.upscaleVideo",
    "fal.superResolution",
    "fal.imageToImage",
    "topaz.enhance",
    "topaz.enhanceGen",
    "topaz.gigapixel",
    // Topaz's Video API is a five-step protocol rather than a request; see
    // src/providers/topaz/models.ts for why it is absent rather than qualified.
    "topaz.upscaleVideo",
  ];
  for (const id of retired) expect(EXPECTED_IDS).not.toContain(id);
});

/**
 * The 3D half — the newest category, and the only one whose verb is not its
 * category id.
 *
 * ## The naming decision, and why it went this way
 *
 * The category id is the literal string `"3d"`: it is what `UnifiedCategory`
 * holds, what `CANONICAL_KEY_LISTS` is keyed on, what the package subpath
 * (`unmodel/3d`) and the tsdown entry (`unified/3d`) are named, what the
 * `unified.3d` key above spells, and what `endpointLabel` renders as
 * `"unmodel/3d"`. Every one of those is a STRING or a file name, and a digit is
 * fine in all of them.
 *
 * The endpoint verb is `threeD`, and that is forced rather than chosen. An
 * endpoint id's second segment is a module EXPORT NAME — `cli.test.ts` derives
 * this whole registry by walking `Object.entries` over each provider's index
 * and asserting every module-level validator appears here — and `3d` is not a
 * JavaScript identifier. `export const 3d = …` does not parse.
 *
 * The alternative was real and was rejected on evidence rather than taste.
 * ES2022 arbitrary module namespace names would allow `export { threeD as "3d" }`,
 * and it does work: `bun` and `tsc --strict` both accept it (probed). Three
 * things argued against it. It would make `unmodel/3d` the only subpath in the
 * package whose value a consumer imports as `import { "3d" as threeD } from
 * "unmodel/fal"` — exotic syntax, in a d.ts, shipped to every downstream
 * toolchain including the ones `publint` and `attw` are run to protect. It
 * would be the first non-identifier export name in a library whose every other
 * endpoint id is `<provider>.<identifier>`. And the pack's own export is
 * `threeD` regardless, because `export const 3d` fails in `src/unified/3d.ts`
 * too — so `fal.3d` would have bought inconsistency, not consistency.
 *
 * The EXPECTED_IDS pattern `/^[a-z0-9-]+\.[a-zA-Z0-9]+$/` would have accepted
 * `fal.3d`; that it would have passed the regex is not the same as its being
 * expressible, and this is where the difference is recorded.
 *
 * ## Two providers, three addresses
 *
 * fal is one address over nineteen endpoints, as it is in every other category.
 * Tripo has TWO, and the asymmetry is the point of the category having a second
 * witness at all: at fal the route is a PARAMETER (`tripo3d/h3.1/text-to-3d` and
 * `tripo3d/h3.1/image-to-3d` are two endpoint ids), while at Tripo's own API the
 * model id is the same string on both and the URL forks —
 * `POST /v3/generation/text-to-model` versus `POST /v3/generation/image-to-model`,
 * with different required fields. That is a wire-route fork, which is exactly
 * what `vidu.videoFromImage` and `lightricks.videoFromImage` qualify for.
 */
const THREE_D_IDS: readonly string[] = [
  "fal.threeD",
  "tripo3d.threeD",
  "tripo3d.threeDFromImage",
];

test("the 3D endpoints use the category's own verb", () => {
  for (const id of THREE_D_IDS) {
    expect(EXPECTED_IDS).toContain(id);
    expect(id.split(".")[1] ?? "").toMatch(/^threeD([A-Z]|$)/);
  }
  // Bare at every provider that serves the category; the qualified one is an
  // addition rather than a replacement, the `lmnt.ttsDetailed` shape.
  for (const provider of [...new Set(THREE_D_IDS.map((id) => id.split(".")[0] as string))]) {
    expect(THREE_D_IDS).toContain(`${provider}.threeD`);
  }

  // Disjoint from the image categories, which is the content of the split: an
  // image route returns a picture of a thing and a 3D route returns the thing.
  expect(THREE_D_IDS.filter((id) => IMAGE_GENERATION_IDS.includes(id))).toEqual([]);
  expect(THREE_D_IDS.filter((id) => IMAGE_EDIT_IDS.includes(id))).toEqual([]);
  expect(THREE_D_IDS.filter((id) => VIDEO_IDS.includes(id))).toEqual([]);

  // The rejected spellings. `fal.3d` and `tripo3d.3d` would have passed the id
  // pattern and cannot be export names; `fal.mesh` and `fal.textTo3d` name the
  // artifact and the wire route rather than the category.
  const retired = ["fal.3d", "tripo3d.3d", "fal.mesh", "fal.textTo3d", "tripo3d.imageTo3d"];
  for (const id of retired) expect(EXPECTED_IDS).not.toContain(id);
});

/**
 * The text-to-speech half, written out here for the first time because fal is
 * the first provider whose speech address is worth pinning against a wire
 * spelling it could have taken instead.
 *
 * Nineteen providers, and the verb is bare at every one of them except the four
 * that ship a second, STREAMING route — `ttsStream` at Murf, Resemble and
 * Speechify, `ttsDetailed` at LMNT. Those qualify because a stream is a
 * different endpoint rather than a different model, which is the same rule
 * `deepgram.listenLive` follows one category over.
 */
const TTS_IDS: readonly string[] = [
  "alibaba.tts",
  "breezeblue.tts",
  "cartesia.tts",
  "deepgram.tts",
  "elevenlabs.tts",
  // Twenty-three endpoints from ten vendors, behind one address: at fal the
  // route is a parameter, so ElevenLabs, MiniMax, Gemini, Kokoro, Chatterbox,
  // Inworld, xAI, ByteDance and Qwen all arrive through `fal.tts`.
  "fal.tts",
  "fish-audio.tts",
  "google.tts",
  "hume.tts",
  "inworld.tts",
  "lmnt.tts",
  "lmnt.ttsDetailed",
  "minimax.tts",
  "murf.tts",
  "murf.ttsStream",
  "openai.tts",
  "resemble.tts",
  "resemble.ttsStream",
  "rime.tts",
  "smallest-ai.tts",
  "speechify.tts",
  "speechify.ttsStream",
  "stepfun.tts",
];

test("the speech endpoints all use the uniform `tts` verb", () => {
  for (const id of TTS_IDS) {
    expect(EXPECTED_IDS).toContain(id);
    expect(id.split(".")[1] ?? "").toMatch(/^tts([A-Z]|$)/);
  }
  // Every provider in the list has the BARE route; the qualified ones are
  // additions rather than replacements.
  for (const provider of [...new Set(TTS_IDS.map((id) => id.split(".")[0] as string))]) {
    expect(TTS_IDS).toContain(`${provider}.tts`);
  }

  const retired = [
    "elevenlabs.textToSpeech",
    "openai.speech",
    "cartesia.bytes",
    "deepgram.speak",
    "minimax.t2aV2",
    "fal.textToSpeech",
    "fal.speechToText",
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
  "fal.imageEdit",
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
    "fal",
    "ideogram",
    "luma",
    "openai",
    "recraft",
    "reve",
    "stability",
  ]);
  // The seven whose primary route is "prompt + one image, no mask" address it
  // as bare `imageEdit` — which is the ref `unmodel/image-edit` reaches for,
  // and therefore the half of the law with teeth.
  for (const provider of ["black-forest-labs", "bria", "fal", "ideogram", "openai", "recraft", "reve"]) {
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
 * The law, closed. Every endpoint in the media categories addresses its
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
    ...LIPSYNC_IDS,
    ...AVATAR_IDS,
    ...UPSCALE_IDS,
    ...THREE_D_IDS,
    ...TTS_IDS,
    ...STT_IDS,
    ...MUSIC_IDS,
    ...SFX_IDS,
  ];
  // No id belongs to two categories — `imageEdit` vs `image` is the pair where
  // a prefix test alone would say yes twice.
  expect(new Set(MEDIA).size).toBe(MEDIA.length);
  for (const id of MEDIA) expect(EXPECTED_IDS).toContain(id);
});
