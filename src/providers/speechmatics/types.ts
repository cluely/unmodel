/**
 * `unmodel/speechmatics/types` — every `speechmatics` type, and nothing else.
 *
 * **Zero runtime.** Every export in this module is a `type`, so the emitted
 * JavaScript is an empty module: importing it adds nothing to a bundle. That
 * is pinned, against a real build, by `test/types-entries.test.ts`.
 *
 * Reach for this entry when you want unmodel's doc-corrected request shapes at
 * compile time and are sending the request yourself — with `fetch`, with the
 * vendor SDK, or through your own client:
 *
 * ```ts
 * import type { SttBody } from "unmodel/speechmatics/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies SttBody;
 * ```
 *
 * Two families of name live here, and `docs/decisions.md` §2 is why:
 *
 * - the **wire names** (`JobConfig`, `SpeechmaticsTranscriptionConfig`,
 *   `SpeechmaticsFetchConfig`, …) — re-exported verbatim, because they are
 *   how you find the endpoint in the provider's own documentation;
 * - the **uniform category aliases** (`SttBody`) — one per endpoint address
 *   this provider serves, named after the word you already type at
 *   `unmodel/speechmatics` and on the CLI.
 *
 * The aliases are pure `export type X = Y`: additions, never renames. Where an
 * alias name already IS the wire name, the wire name wins and no duplicate is
 * declared.
 *
 * Runtime values — validators, `check*` helpers, URL constants, the models
 * table — stay on `unmodel/speechmatics`, which tree-shakes to the few bytes a
 * URL constant costs.
 *
 * Endpoints:
 *
 * - `speechmatics.stt` → `SttBody`
 */

import type { JobConfig } from "./stt";

export type {
  JobConfig,
  SpeechmaticsJobUpload,
  SpeechmaticsTranscriptionConfig,
  SpeechmaticsFetchConfig,
  SpeechmaticsAdditionalVocabEntry,
  SpeechmaticsPunctuationOverrides,
  SpeechmaticsAudioFilteringConfig,
  SpeechmaticsTranscriptFilteringConfig,
  SpeechmaticsReplacement,
  SpeechmaticsSpeaker,
  SpeechmaticsSpeakerDiarizationConfig,
  SpeechmaticsNotificationConfig,
  SpeechmaticsTracking,
  SpeechmaticsOutputConfig,
  SpeechmaticsTranslationConfig,
  SpeechmaticsLanguageIdentificationConfig,
  SpeechmaticsSummarizationConfig,
  SpeechmaticsTopicDetectionConfig,
  SpeechmaticsAudioEventsConfig,
} from "./stt";

export type { JobDetailsLike, SpeechmaticsJobStatus } from "./check";

export type { SpeechmaticsModelId, SpeechmaticsRegion } from "./models";

// ---------------------------------------------------------------------------
// Uniform category aliases — one per endpoint address this provider serves.
// Pure type aliases: no rename, no runtime, no cost.
// ---------------------------------------------------------------------------

export type SttBody = JobConfig;
