/**
 * `unmodel/speech` — the canonical vocabulary for text-to-speech.
 */
import type { AudioFormatRequest } from "./audio";
import type { ProviderOptions } from "./common";

export type {
  AudioContainer,
  AudioFormat,
  AudioFormatCodec,
  AudioFormatRequest,
} from "./audio";
export type { ProviderOptions } from "./common";

/**
 * Which voice.
 *
 * Three spellings because providers genuinely disagree about what a voice
 * *is*: an opaque id (`"21m00Tcm4TlvDq8ikWAM"`), a human name (`"Kore"`), or
 * either. The bare string is the shorthand for whichever one the provider
 * takes; `{ id }` and `{ name }` exist for the providers that take both and
 * would otherwise have to guess which you meant from the shape of the string.
 */
export type Voice = string | { id: string } | { name: string };

export interface SpeechParams {
  /** What to say. */
  text: string;
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  voice?: Voice;
  /** A codec shorthand (`"mp3"`) or a fully-spelled encoding. */
  outputFormat?: AudioFormatRequest;
  /**
   * A multiplier: `1.0` is the model's normal rate, `2.0` is twice as fast,
   * `0.5` half.
   *
   * One convention, chosen because it is the only one that is unambiguous
   * without a unit. Providers encode it as a multiplier, as its reciprocal (a
   * *time* scale — Rime's `speedAlpha`), and as a signed percentage delta
   * (Murf's `rate`); `derive.ts` has an exact converter for each, and the two
   * that cannot represent a given value say so instead of rounding quietly.
   */
  speed?: number;
  /** BCP-47, e.g. `"pt-BR"`. Multilingual models use it to pick pronunciation. */
  language?: string;
  providerOptions?: ProviderOptions;
}
