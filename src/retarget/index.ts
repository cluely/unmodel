/**
 * The retarget layer: the id vocabulary, the dialect keying and the shape
 * `.toApi(provider)` returns.
 *
 * Types only, plus the id lists. The *engine* lives in
 * `src/core/translate/retarget.ts` (`createToApi`) because it must stay free
 * of provider imports; this directory is where the type-level half is allowed
 * to reach provider `wire.ts` leaves.
 */
export {
  API_TARGET_IDS,
  FACTORY_API_TARGET_IDS,
  SDK_TARGET_IDS,
  STATIC_API_TARGET_IDS,
  isApiTargetId,
  isStaticApiTargetId,
} from "./ids";
export type {
  ApiModelFor,
  ApiTargetId,
  ApiTargetsFor,
  FactoryApiTargetId,
  SdkTargetId,
  StaticApiTargetId,
} from "./ids";
export type {
  DialectBody,
  DialectId,
  DialectOf,
  DialectSdkMap,
  DialectSdkResult,
  DialectSdkTargets,
  GeminiSdkParams,
  GenerateContentBodyFor,
  MessagesBodyFor,
} from "./dialects";
export type { Retargeted } from "./types";
