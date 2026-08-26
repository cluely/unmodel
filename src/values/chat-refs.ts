/**
 * `unmodel/values/chat-refs` — every `"provider/model"` pair `chat()` accepts,
 * as an array.
 *
 * The runtime twin of `ChatModelRef` (`unmodel/types`), for the one thing a
 * union cannot do: be iterated. A model picker maps over this; a server route
 * validates a form field against it.
 *
 * ```ts
 * import { CHAT_MODEL_REFS } from "unmodel/values/chat-refs";
 *
 * const byProvider = Map.groupBy(CHAT_MODEL_REFS, (ref) => ref.slice(0, ref.indexOf("/")));
 * ```
 *
 * ## Why its own subpath rather than a name on `unmodel/values`
 *
 * Measured both ways against a real build, before deciding.
 *
 * With this entry declared, rolldown gives the generated array a chunk of its
 * own — it is reached from two entries — and `dist/values/index.js` stays
 * **2.4 KiB**. Delete the entry and export `CHAT_MODEL_REFS` from the hub
 * instead, and rolldown inlines all 1,330 strings into that entry: the file
 * every consumer downloads goes to **49 KiB**, a 20× regression on the obvious
 * specifier. A bundler that tree-shakes recovers it (measured: one import of
 * `ASPECT_RATIO_PRESETS` from the fat hub still shook to 0.17 KiB), but the
 * entry a `<script type="module">`, a Deno import or an un-shaken dev build
 * pulls is the whole file — and "the cheap path has to be the only path" is the
 * same trade `docs/decisions.md` §3 settled for `unmodel/chat/factory`.
 *
 * So the split is structural: two entries, two chunks, and the expensive one
 * has to be asked for by name. `test/values-entries.test.ts` pins both numbers.
 *
 * The array is generated beside the union it mirrors and the two are asserted
 * equal in both directions, so a models.dev refresh cannot move one without the
 * other.
 */

export { CHAT_MODEL_REFS } from "../catalog/chat-refs-values.gen";
