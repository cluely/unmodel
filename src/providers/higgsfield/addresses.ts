/**
 * Which route ids each wide `higgsfield.*` address serves — the map behind
 * the signpost a foreign id gets.
 *
 * Imports the id lists and nothing else. Every address module reads
 * {@link elsewhere} so that `higgsfield.video({ endpoint: "z-image/turbo", … })`
 * answers "that is a route `higgsfield.image` validates" and not a bare
 * "unknown model" about an id that is in Higgsfield's catalog.
 *
 * Only the WIDE addresses are listed. `image` and `video` partition the
 * generated roster by what a route answers, so every generated id has exactly
 * one home here; `imageEdit` is a view over `image` and would only name the
 * same route twice. `characterTrain` has one route and no `endpoint`
 * parameter, and is listed so that its path, typed at a generation address,
 * is pointed at the address that validates its body.
 */

import { CHARACTER_TRAIN_ENDPOINT } from "./character-train-models";
import { HIGGSFIELD_IMAGE_ENDPOINTS, HIGGSFIELD_VIDEO_ENDPOINTS } from "./gen/endpoints.gen";

const WIDE_ADDRESSES = {
  "higgsfield.image": HIGGSFIELD_IMAGE_ENDPOINTS,
  "higgsfield.video": HIGGSFIELD_VIDEO_ENDPOINTS,
  "higgsfield.characterTrain": [CHARACTER_TRAIN_ENDPOINT],
} as const satisfies Record<string, readonly string[]>;

/** Every wide address except `own`, with the ids it serves. */
export function elsewhere(own: keyof typeof WIDE_ADDRESSES): Record<string, readonly string[]> {
  const others: Record<string, readonly string[]> = {};
  for (const [address, ids] of Object.entries(WIDE_ADDRESSES)) {
    if (address !== own) others[address] = ids;
  }
  return others;
}
