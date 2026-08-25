/**
 * `unmodel/breezeblue/types` — every `breezeblue` type, and nothing else.
 *
 * **Zero runtime.** Every export in this module is a `type`, so the emitted
 * JavaScript is an empty module: importing it adds nothing to a bundle.
 *
 * Reach for this entry when you want unmodel's doc-corrected request shapes at
 * compile time and are sending the request yourself — with `fetch`, with
 * `@breeze.blue/sdk`, or through your own client:
 *
 * ```ts
 * import type { TtsBody } from "unmodel/breezeblue/types";
 *
 * const body = {
 *   // … the documented fields, checked at compile time
 * } satisfies TtsBody;
 * ```
 *
 * Two families of name live here:
 *
 * - the **wire names** (`TtsBody`, `TtsParams`, `TtsQuery`, …) — re-exported
 *   verbatim, because they are how you find the endpoint in the provider's
 *   own documentation;
 * - the **uniform category aliases** — one per endpoint address this provider
 *   serves, named after the word you already type at `unmodel/breezeblue`.
 *
 * Runtime values — the validator, URL helpers, the models table — stay on
 * `unmodel/breezeblue`, which tree-shakes to the few bytes a URL constant
 * costs.
 *
 * Endpoints:
 *
 * - `breezeblue.tts` → `TtsBody` (already the wire name — no alias declared;
 *   the wire name wins)
 */

export type {
  TtsBody,
  TtsParams,
  TtsQuery,
  BreezeblueVoiceSettings,
  BreezeblueOutputFormat,
  BreezeblueStreamOutputFormat,
  BreezeblueDelivery,
  BreezeblueSdkParams,
  BreezeblueSdkRequest,
  BreezeblueSdkOptions,
  BreezeblueSdkVoiceSettings,
} from "./tts";

export type {
  BreezeblueModelId,
  BreezeblueTtsModelId,
  BreezeblueVoiceLanguageCode,
} from "./models";
