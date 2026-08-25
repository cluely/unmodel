// Hand-maintained MIRROR of the generated rows — models.dev DOES track
// StepFun's audio ids (`stepaudio-2.5-tts`, `step-tts-2` in
// `StepfunAudioModelId`), but importing `src/catalog/stepfun.gen.ts` here
// would put the whole generated chat catalog inside `unmodel/tts` (the pack
// is pinned catalog-free in test/bundle-budget.test.ts), so the two rows are
// copied by hand with the documented character cap layered on — the same
// trade google's tts-models.ts makes. Refresh from
//   https://platform.stepfun.ai/docs/en/api-reference/audio/create-audio.md   (endpoint, params, 1,000-char input cap)
//   https://platform.stepfun.ai/docs/en/guides/models/stepaudio-2.5-tts.md    (model card)
//   https://platform.stepfun.ai/docs/en/guides/models/audio.md                (audio model roster)
// and cross-check the mirrored fields against src/catalog/stepfun.gen.ts on
// each codegen refresh. Verified 2026-08-24.
//
// PRICING: platform.stepfun.ai publishes no USD rate on the reachable
// English doc pages for stepaudio-2.5-tts (the models.dev row carries none
// either), so `cost` is deliberately omitted rather than guessed — cost
// estimation returns no `costUSD` for StepFun speech.
//
// `step-tts-2` is in the generated catalog (released 2026-03-01) but the
// create-speech reference says the endpoint "Currently supports
// `stepaudio-2.5-tts`" — the older id is carried for catalog completeness and
// ./tts.ts warns when it is sent.

import type { ModelInfo } from "../../core/catalog-types";

/**
 * "Maximum length is 1,000 characters" — the `input` cap the create-speech
 * reference documents on the ENDPOINT, so every speech model carries it and
 * an id the catalog does not know yet still gets it as a fallback.
 */
export const SPEECH_MAX_INPUT_CHARACTERS = 1000;

const SPEECH_BASE = {
  family: "step",
  attachment: false,
  reasoning: false,
  toolCall: false,
  temperature: false,
  openWeights: false,
  modalities: { input: ["text"], output: ["audio"] },
  // Speech is not context-window bound; `characters` carries the real cap.
  limit: { context: 0, output: 0, characters: SPEECH_MAX_INPUT_CHARACTERS },
} as const;

/** The speech rows: the generated rows' fields, mirrored, + the character cap. */
export const speechModels = {
  "stepaudio-2.5-tts": {
    ...SPEECH_BASE,
    id: "stepaudio-2.5-tts",
    name: "StepAudio 2.5 TTS",
    releaseDate: "2026-04-16",
    lastUpdated: "2026-07-02",
  },
  "step-tts-2": {
    ...SPEECH_BASE,
    id: "step-tts-2",
    name: "Step TTS 2",
    releaseDate: "2026-03-01",
    lastUpdated: "2026-07-02",
    // Off the current create-speech enum — see the header note.
    status: "deprecated",
  },
} as const satisfies Record<string, ModelInfo>;

export type StepfunTtsModelId = keyof typeof speechModels;
