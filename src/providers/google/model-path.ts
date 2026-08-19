/**
 * How a Google model id becomes a URL — and nothing else.
 *
 * Every Gemini-API route is `models/{model}:{method}` against the same v1beta
 * base, so all three endpoint modules in this directory (`chat.ts`,
 * `generate-images.ts`, `generate-videos.ts`) need the same two things: the
 * `models/` prefix stripped, and that path assembled.
 *
 * It lives in its own module because of what sharing it used to cost.
 * `generate-images.ts` imported `stripModelsPrefix` from `chat.ts` — one
 * six-line function — and thereby pulled the entire `generateContent`
 * validator into a bundle that only wanted Imagen: the Gemini wire schema, the
 * chat constraint tables, the retarget engine and two dialect codecs, ~100 KiB
 * of code an image request never executes. A leaf that imports nothing costs
 * every consumer exactly its own bytes.
 *
 * Keep it that way: this module must import nothing. `core/translate/
 * endpoints.ts` deliberately keeps its own private copy of the strip for the
 * same reason (it is forbidden from importing `src/providers/**` at all), and
 * the duplication there is the cheaper of the two mistakes.
 */

/** The shared base every Gemini-API model route hangs off. */
export const GOOGLE_MODELS_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Users copy `"models/gemini-2.5-flash"` ids out of `listModels`; the bare id
 * is canonical for the catalog, the constraint tables and the endpoint URL.
 * Both spellings are accepted everywhere and normalize to the bare form.
 */
export function stripModelsPrefix(model: string): string {
  return model.startsWith("models/") ? model.slice("models/".length) : model;
}

/**
 * `("models/veo-3.1", "predictLongRunning")` →
 * `".../v1beta/models/veo-3.1:predictLongRunning"`.
 *
 * The one place the `models/{id}:{method}` shape is written down, so a route
 * that spells it differently is a visible diff rather than a silent drift.
 */
export function googleModelUrl(model: string, method: string): string {
  return `${GOOGLE_MODELS_BASE_URL}/${stripModelsPrefix(model)}:${method}`;
}
