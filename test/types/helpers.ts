/**
 * Shared type-level assertion helpers for `test/types/*.test-d.ts`.
 *
 * NOT executed by `bun test` (no `*.test.*` / `*.spec.*` filename anywhere in
 * this directory); the files are only ever type-checked by `bun run check`
 * (tsc --noEmit), which has no `include`/`exclude` in tsconfig.json and so
 * picks up every .ts file in the repo. The runtime bodies below are no-ops —
 * every call site is a compile-time assertion.
 */

/** Fails to compile unless `value` is assignable to `T`. */
export function expectAssignable<T>(_value: T): void {}

/** Fails to compile unless the type argument resolves to exactly `true`. */
export function expectTrue<_T extends true>(): void {}

/** `true` only when `T` is exactly `never`. */
export type IsNever<T> = [T] extends [never] ? true : false;

/**
 * `true` only when `T` is `any`.
 *
 * `any` absorbs an intersection (`1 & any` is `any`), while every other type
 * leaves a type that cannot contain `0`. This also catches unions poisoned by
 * `any`, because those unions simplify to `any` before the test runs.
 */
export type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * Fails to compile when `T` is `any`.
 *
 * The conditional rest tuple is intentional: an `any` argument cannot evade
 * the check through assignability, because the failing branch changes the
 * function's arity instead of its value parameter type.
 */
export function expectNotAny<T>(
  ..._proof: IsAny<T> extends true ? ["Expected a non-any type"] : []
): void {}

/**
 * Fails to compile when `T` is `never`.
 *
 * The counterpart to {@link expectNotAny}, and not redundant with it:
 * `IsAny<never>` is `false`, so `expectNotAny<never>()` compiles happily. A
 * collapse to `never` is the characteristic failure of the conditional
 * machinery that instantiates a provider validator against a compiled body —
 * a union ref whose arms fail every body guard silently produces `never`,
 * which is assignable to everything, so nothing errors and the editor simply
 * stops completing. `expectAssignable` cannot see it either, for the same
 * reason.
 *
 * The conditional rest tuple is the same trick as `expectNotAny`: the failing
 * branch changes the function's *arity*, which assignability cannot satisfy.
 */
export function expectNotNever<T>(
  ..._proof: IsNever<T> extends true ? ["Expected a type other than never"] : []
): void {}

/**
 * `never` when `K` is absent from `T`'s keys, `K` when present. Pair with
 * `IsNever` + `expectTrue` to assert a field was STRIPPED from a
 * `Validated<...>` body type (path/query params that live only in
 * `.request.url`):
 *
 * ```ts
 * expectTrue<IsNever<KeyIn<typeof validated, "voice_id">>>();
 * ```
 */
export type KeyIn<T, K extends PropertyKey> = Extract<keyof T, K>;
