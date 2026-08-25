/**
 * `unmodel/topaz/values` — the **runtime** lists behind this provider's unified
 * surface (upscale).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the model ids, the per-model narrowing rows (which dials each model
 * reads), the two route enums, the output formats, the subject-detection and
 * enhancement-strength choices, the film-grain models.
 *
 * The category table is **the same object the adapter compiles with** —
 * re-exported, never copied — so a picker built from `UPSCALE_MODEL_PARAMS` and
 * the request the matching `unmodel/upscale` builds cannot disagree. It is read
 * from the import-free `./upscale-params.ts` leaf rather than from the adapter,
 * which is what keeps this entry off this provider's validators, its zod schemas
 * and its catalog; `test/values-entries.test.ts` measures that against a real
 * build.
 *
 * Three exports here are not request-side vocabularies and are the most useful
 * ones for a form:
 *
 * - `TOPAZ_SETTINGS_BY_MODEL` — which dials each model reads, as data. Topaz
 *   IGNORES a dial a model does not take rather than refusing it, so greying
 *   one out is the only way a user finds out before they are billed.
 * - `TOPAZ_MEGAPIXEL_LIMITS` — the input and output ceilings, which differ
 *   eight-fold across the roster (128 MP at `Wonder`, 1024 at `Standard V2`).
 * - `MP_PER_CREDIT` + `TOPAZ_PRICING_FAMILY` + `CREDIT_USD` — enough to show a
 *   live price as the user drags an output-size slider, since Topaz's price is
 *   a pure function of the output's pixel count.
 */

export {
  TOPAZ_UPSCALE_MODEL_PARAMS as UPSCALE_MODEL_PARAMS,
  MODELS as UPSCALE_MODELS,
} from "./upscale-params";

export {
  OUTPUT_DIMENSION_MAX,
  OUTPUT_DIMENSION_MIN,
  PROMPT_MAX_CHARS,
  TOPAZ_ENHANCEMENT_STRENGTHS,
  TOPAZ_ENHANCE_GEN_MODELS,
  TOPAZ_ENHANCE_MODELS,
  TOPAZ_GRAIN_MODELS,
  TOPAZ_INPUT_FORMATS,
  TOPAZ_MEGAPIXEL_LIMITS,
  TOPAZ_MODELS,
  TOPAZ_OUTPUT_FORMATS,
  TOPAZ_SETTINGS_BY_MODEL,
  TOPAZ_STATUSES,
  TOPAZ_SUBJECT_DETECTION,
} from "./shared";

export { CREDIT_USD, MP_PER_CREDIT, TOPAZ_PRICING_FAMILY } from "./pricing";
