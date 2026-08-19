/**
 * `unmodel/music` — the canonical vocabulary for music generation.
 *
 * Deliberately the smallest of the six. Music APIs disagree about almost
 * everything above the prompt — lyrics, sections, reference tracks, stems,
 * continuation — and none of those disagreements has a canonical spelling yet.
 * Four params that every provider means the same way is a vocabulary; adding a
 * fifth that three providers interpret differently would make the category's
 * warnings meaningless, which is the one thing it cannot afford.
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

export interface MusicParams {
  /** What to generate — style, mood, instrumentation. */
  prompt: string;
  /** `"provider/model"`, split on the **first** slash. */
  model: string;
  /**
   * Length in seconds. Spelled out rather than `duration` because music APIs
   * take milliseconds about as often as seconds, and a bare `duration` is the
   * kind of field people assume the unit of.
   */
  durationSeconds?: number;
  /** No vocals. Providers with no such switch report it unsupported. */
  instrumental?: boolean;
  outputFormat?: AudioFormatRequest;
  seed?: number;
  providerOptions?: ProviderOptions;
}
