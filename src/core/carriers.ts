/**
 * The types a **declaration-emitting consumer** must be able to name.
 *
 * ## The failure this exists to stop
 *
 * A downstream library that wraps unmodel and ships its own `.d.ts` cannot
 * compile:
 *
 * ```
 * TS2883: The inferred type of 'ask' cannot be named without a reference to
 * 'Validated' | 'RequestMeta' | 'ExactKeys' | 'ValidateOptions' |
 * 'ValidateResult' | 'Retargeted' from 'unmodel/dist/request-C5iXilo6'.
 * This is likely not portable.
 * ```
 *
 * (TS2883 is TypeScript 7's message and appears under a pnpm-style nested
 * `node_modules`; TypeScript 5.9 raises the older, less helpful TS2742 for the
 * same cause under a flat layout. Both are the same bug.)
 *
 * ## Why re-exporting them "somewhere public" was not enough
 *
 * Half of these were *already* exported — `Validated`, `RequestMeta`,
 * `TranslationWarning` and `EndpointConstraints` from `unmodel`, and
 * `ChatSdkTargets` from `unmodel/openai-compatible`. The error persisted
 * anyway, because **TypeScript can only name a symbol through a module already
 * in the program**. A consumer whose only import is
 * `import { chat } from "unmodel/openai"` has no reference to `unmodel`, so
 * nothing in `unmodel`'s root is nameable from it — no matter how public it is.
 *
 * That is the whole design constraint: the carriers must be reachable **from
 * the entry the consumer actually imported**. Hence one line per entry, on
 * every entry, rather than one tidy re-export at the root.
 *
 * ## The set
 *
 * Everything here is already `export`ed at its source module and every member
 * is already re-exported by name from the root entry, so this module adds no
 * public surface — only reachability. It is **not** a hand-guessed list: it
 * grew by running the real repro (a `declaration: true` consumer, under both a
 * flat and a pnpm-style layout) and adding whatever the diagnostic still named,
 * and `test/types/declaration-portability.test.ts` is that repro, kept. Removing
 * any one member fails it — a negative control was run on `Retargeted`.
 *
 * It is wider than the chat case alone, because the sweep is wider: a
 * multipart endpoint returns `ValidatedForm`, a realtime one `ValidatedSocket`,
 * and every media result that carries `.toApi("fal")` names `MediaRetargeted`
 * and the target-id vocabulary it is generic in.
 *
 * Two things deliberately live elsewhere:
 *
 * - **The per-provider result kinds** (`OpenAIChatResultKind`,
 *   `AnthropicChatResultKind`, `GoogleChatResultKind`, `MessagesArm`,
 *   `GenerateContentArm`) are re-exported from their own provider `index.ts`.
 *   A shared module naming them would put three providers' declarations behind
 *   every entry, which is the layout `unmodel/<provider>/types` exists to
 *   avoid.
 * - **`ChatSdkTargets`** — three distinct symbols wear that name
 *   (`openai-compatible/chat-completions.ts`, `anthropic/chat.ts`,
 *   `chat/public-types.ts`), so they cannot share one address. Each entry
 *   re-exports the one its own inferred types actually mention, under an
 *   unambiguous alias where it would collide. `src/core/**` may not import a
 *   provider at all (`test/import-graph.test.ts`), which settles it here.
 *
 * Every member is `export type`, so this module is worth zero runtime bytes and
 * an entry that re-exports it grows only its `.d.ts`.
 *
 * ## One recorded gap
 *
 * A result carrying `.toApi("fal")` still names fal's own GENERATED
 * per-endpoint body interface (`FalAiFlux2ProInput`, …) and cannot reach it:
 * the cross-provider import rule opens exactly one door into fal
 * (`fal/interop.ts`), and the alternatives are a hand-written list of ~23
 * generated names in six modules that goes stale on the next roster change, or
 * an `export type *` of fal's whole wire chunk into six providers' public
 * surfaces. Left open with a name on it, and asserted in
 * `test/types/declaration-portability.test.ts` so it cannot grow.
 */
// The `Validated` family. All eight shapes, not only the chat one: a
// multipart endpoint returns `ValidatedForm`, a realtime one
// `ValidatedSocket`, and both carry their own `…RequestMeta` — so a consumer
// wrapping `elevenlabs.dub` or `openai.realtimeSession` needs the same
// reachability a chat consumer does.
export type {
  ApiRetargeter,
  ApiRetargetOutcome,
  ExactKeys,
  FormRequestMeta,
  RequestMeta,
  SdkFormatters,
  SocketMeta,
  Validated,
  ValidatedForm,
  ValidatedInit,
  ValidatedSocket,
} from "./request";
export type {
  MediaDeclaration,
  MediaFacts,
  MediaPath,
  MediaPathFor,
  ValidateOptions,
  ValidateOptionsBase,
} from "./options";
export type { ValidateEstimate, ValidateResult } from "./result";
export type { EndpointConstraints } from "./constraint-types";
export type { TranslationWarning } from "./translate/warnings";
export type {
  Apply,
  ValidatorProviderCarrier,
  ValidatorResultKind,
  ValidatorResultKindCarrier,
  ValidatorResultKindOf,
} from "./validator-result-kind";
// The retarget surface hangs off every result that carries `.toApi` — chat
// through `Retargeted`, the ~106 media endpoints through `MediaRetargeted` —
// so the target-id vocabulary those return types are generic in has to come
// with them. `./request.ts` already names all three modules (they are
// `Validated.toApi`'s return and parameter types), so this adds no edge the
// core did not already have.
export type {
  MediaApiMember,
  MediaOverlapTable,
  MediaRetargeted,
  Retargeted,
} from "../retarget/types";
export type {
  ApiModelFor,
  ApiTargetId,
  ApiTargetsFor,
  FactoryApiTargetId,
  MediaApiTargetId,
  SdkTargetId,
  StaticApiTargetId,
} from "../retarget/ids";
