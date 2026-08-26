export {
  music,
  instrumental,
  songConstraints,
  songQueryUrl,
  instrumentalQueryUrl,
  SONG_GENERATE_URL,
  SONG_QUERY_URL,
  INSTRUMENTAL_GENERATE_URL,
  INSTRUMENTAL_QUERY_URL,
  LYRICS_MAX_CHARACTERS,
  PROMPT_MAX_CHARACTERS,
  N_MAX,
  DEFAULT_N,
  GENDERS,
  TASK_STATUSES,
} from "./music";
export type {
  SongGenerateBody,
  InstrumentalGenerateBody,
  MurekaSongTask,
  MurekaInstrumentalTask,
  MurekaSong,
  MurekaInstrumental,
  MurekaLyricsSection,
  MurekaLyricsLine,
  MurekaWordTiming,
  MurekaGender,
  MurekaTaskStatus,
} from "./music";

export {
  models,
  provider,
  MUREKA_SONG_MODEL_IDS,
  MUREKA_INSTRUMENTAL_MODEL_IDS,
} from "./models";
export type {
  MurekaModelId,
  MurekaSongModelId,
  MurekaInstrumentalModelId,
} from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
