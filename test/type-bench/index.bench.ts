/**
 * Type-instantiation benches for the surfaces consumers actually type-check.
 *
 * The declaration budgets in `test/bundle-budget.test.ts` measure what tsserver
 * *reads* (bytes of `.d.ts`); these measure what it *does* — the instantiations
 * one call costs. The two move independently: the chat-entry regression that
 * motivated the declaration budgets was invisible to every JS number, and a
 * recursive path type that stays tiny on disk can still add +40% instantiations
 * per call (`test/types/openai.test-d.ts`, the media-path section). Each bench
 * below pins one of those historically-regressed surfaces.
 *
 * Run with `bun run bench:types`. This is `@ark/attest`, which does not support
 * `bun test` yet — the script shells out to tsx (node) instead, and this file
 * deliberately lives outside the glob `bun test` picks up (`*.bench.ts`, not
 * `*.test.ts`). On first run attest writes the snapshot into the `.types()`
 * call; after a deliberate change, re-run with `ATTEST_updateSnapshots=1` and
 * commit the new number with the change that caused it — same contract as the
 * KiB budgets ("before you raise a number, find out which module joined the
 * graph").
 */
import { bench } from "@ark/attest";
import { chat } from "../../src/chat/index";
import { getProviderTyped } from "../../src/catalog/typed.gen";
import { tts } from "../../src/unified/tts";
import { image as falImage } from "../../src/providers/fal/image";
import { video as klingVideo } from "../../src/providers/kling";

bench("chat: one unified call", () => {
  return chat.safe({
    model: "anthropic/claude-opus-5",
    messages: [{ role: "user", content: "hi" }],
  });
}).types([9717, "instantiations"]);

bench("chat: media path declaration", () => {
  // The root segment is closed against the params; everything deeper is the
  // runtime check's job. If this number jumps, someone reopened the recursive
  // path type.
  return chat.safe(
    { model: "openai/gpt-5.2", messages: [{ role: "user", content: "hi" }] },
    { media: [{ path: ["messages", 0, "content", 0], bytes: 1024 }] },
  );
}).types([9963, "instantiations"]);

bench("catalog: typed provider access", () => {
  return getProviderTyped("openai");
}).types([1740, "instantiations"]);

bench("tts: unified pack call", () => {
  return tts.safe({ model: "openai/tts-1", text: "hello", voice: "alloy" });
}).types([20352, "instantiations"]);

bench("fal: image pack call", () => {
  return falImage.safe({ endpoint: "fal-ai/flux/dev", prompt: "a lighthouse" });
}).types([472, "instantiations"]);

/**
 * The media retarget seam: `.toApi("fal")` on a native media request.
 *
 * Pinned because `MediaApiMember` is a conditional over a per-family overlap
 * table, evaluated on every call to a wrapped validator — including the calls
 * that get `unknown` back because the model has no row. That is the shape most
 * likely to regress as families are added: a table keyed less precisely, or an
 * arm that distributes, would show up here long before it showed up in a `.d.ts`
 * byte count.
 *
 * The `kling.video` arm is deliberate rather than the cheapest one. It layers
 * the member on top of `TextToVideoArm`'s own per-model narrowing, so it
 * measures the seam's cost *in combination with* the narrowing it rides on,
 * which is the thing an editor actually pays for.
 */
bench("media retarget: a native call carrying .toApi", () => {
  return klingVideo.safe({
    model_name: "kling-v2-5-turbo",
    prompt: "a kite",
    mode: "pro",
  });
}).types([628, "instantiations"]);
