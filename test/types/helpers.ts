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
