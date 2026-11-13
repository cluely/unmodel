/**
 * The `keyterms` rules ElevenLabs applies on more than one route.
 *
 * Speech to Text and Dubbing publish BYTE-IDENTICAL caps — at most 1000 terms,
 * each at most 50 characters and at most 5 words after normalisation — and they
 * are the same product decision rather than a coincidence: both bias the same
 * transcription model toward the same kind of proper noun. Two copies of three
 * numbers is two chances to update one of them, so they live here and both
 * validators read them.
 *
 * Dubbing states one more rule as a refusal: "the characters `<>{}[]\` are not
 * allowed". It rides as an opt-in flag rather than as a fourth constant applied
 * everywhere: Speech to Text's description says only that those characters
 * "are not supported", which does not say the request is refused, so applying
 * it there could refuse a request ElevenLabs accepts.
 *
 * Sources, both read 2026-11-12:
 * - `keyterms` on POST /v1/speech-to-text, https://api.elevenlabs.io/openapi.json
 *   — "The length of each keyterm must be at most 50 characters. Keyterms can
 *   contain at most 5 words (after normalisation). … The following characters
 *   are not supported: `<`, `>`, `{`, `}`, `[`, `]`, `\`." (and "cannot exceed
 *   1000" on the reference page, verified 2026-08-26).
 * - https://elevenlabs.io/docs/api-reference/dubbing/create-project — "At most
 *   1,000 terms; each term at most 50 characters and 5 words; the characters
 *   `<>{}[]\` are not allowed."
 *
 * Zero runtime dependencies beyond a type-only `PipelineContext` import: this
 * is a leaf, so both graphs pay three numbers and one loop.
 */

import type { PipelineContext } from "../../core/pipeline";

/** "The number of keyterms cannot exceed 1000." */
export const KEYTERMS_MAX = 1000;
/** "The length of each keyterm must be at most 50 characters." — inclusive. */
export const KEYTERM_MAX_CHARACTERS = 50;
/** "Keyterms can contain at most 5 words (after normalisation)." */
export const KEYTERM_MAX_WORDS = 5;

/**
 * Dubbing only: "the characters `<>{}[]\` are not allowed."
 *
 * Spelled as an array of single characters rather than as a regex so the
 * refusal message can list them the way the documentation does.
 */
export const KEYTERM_DISALLOWED_CHARACTERS = ["<", ">", "{", "}", "[", "]", "\\"] as const;

/**
 * Reports the per-keyterm limits a count-only zod cap cannot express: the
 * character length and the word count of each individual term, and — when
 * `disallowedCharacters` is set — the characters the route refuses.
 *
 * `source` is the endpoint's own reference URL, so a caller who reads the
 * warning can go straight to the sentence it came from. `path` is the wire
 * field name (`"keyterms"` on both routes today), kept a parameter so a route
 * that spells it differently does not need a second copy of this function.
 */
export function checkKeytermRules(
  keyterms: unknown,
  ctx: PipelineContext,
  options: { source: string; path?: string; disallowedCharacters?: readonly string[] },
): void {
  if (!Array.isArray(keyterms)) return;
  const field = options.path ?? "keyterms";
  keyterms.forEach((term, index) => {
    if (typeof term !== "string") return;
    if (term.length > KEYTERM_MAX_CHARACTERS) {
      ctx.report({
        code: "invalid_shape",
        path: [field, index],
        message: `keyterm ${JSON.stringify(term)} is ${term.length} characters; each keyterm can be at most ${KEYTERM_MAX_CHARACTERS} characters.`,
        meta: { limit: KEYTERM_MAX_CHARACTERS, actual: term.length, source: options.source },
      });
    }
    const words = term.split(/\s+/u).filter((word) => word !== "");
    if (words.length > KEYTERM_MAX_WORDS) {
      ctx.report({
        code: "invalid_shape",
        path: [field, index],
        message: `keyterm ${JSON.stringify(term)} has ${words.length} words; a keyterm can contain at most ${KEYTERM_MAX_WORDS} words.`,
        meta: { limit: KEYTERM_MAX_WORDS, actual: words.length, source: options.source },
      });
    }
    const disallowed = options.disallowedCharacters;
    if (disallowed === undefined) return;
    const found = disallowed.filter((character) => term.includes(character));
    if (found.length === 0) return;
    ctx.report({
      code: "invalid_shape",
      path: [field, index],
      message: `keyterm ${JSON.stringify(term)} contains ${found.map((c) => JSON.stringify(c)).join(", ")}; the characters ${disallowed.join("")} are not allowed in a keyterm.`,
      meta: { disallowed: [...disallowed], found, source: options.source },
    });
  });
}
