---
"unmodel": patch
---

longcat: `LongCat-2.5-Preview` joins `unmodel/longcat`, and a fixed LongCat temperature is overridden, never refused

- `longcat.chat` catalogs `LongCat-2.5-Preview` (models.dev snapshot,
  2026-11-12): text and image input, 1,048,576-token context, 262,144-token
  output ceiling, $0.30 / 1M input, $0.006 / 1M cached input, $1.20 / 1M
  output. Rates are the "Discounted Price $/1M Tokens (limited-time)" column
  of
  https://web.archive.org/web/20261018115714/https://longcat.chat/platform/docs/pricing/longcat-2.5
  ("Pay-As-You-Go currently supports LongCat-2.5-Preview."; the live page now
  names only LongCat-2.5, at the same rates). No end date is published, so
  cost estimates move when the promotion ends. Reachable from `unmodel/chat`
  as `"longcat/LongCat-2.5-Preview"`.
- `LongCat-2.0` reprices to $0.30 / $0.006 / $1.20 from $0.75 / $0.015 /
  $2.95: https://longcat.chat/platform/docs/pricing/longcat-2.0 now shows only
  the limited-time discount column. Its context is 1,048,576 tokens and it is
  marked open weights (MIT, https://huggingface.co/meituan-longcat/LongCat-2.0).
- Both rows now carry models.dev's `temperature: false`, which on LongCat means
  "fixed", not "refused":
  https://longcat.chat/platform/docs/api/model-params — "Other values are not
  rejected — they are overridden with the default for the current thinking
  state.", with `top_p` adjustable over (0, 1]. `temperature` therefore
  validates on every LongCat model with an `unsupported_param` warning
  (`meta.ignored: true`) saying the value is replaced, and `top_p` is not gated
  at all — where the shared dialect's reading of the flag would have refused
  both.
- `createOpenAICompatible` gains `fixedSampling: "rejected" | "overridden"`
  (the `FixedSampling` type, exported from `unmodel/openai-compatible` and its
  `/types` entry). Omitted means `"rejected"` — OpenAI's behaviour, unchanged
  for every other overlay; an overlay whose provider documents that a fixed
  temperature is accepted and overridden declares `"overridden"`.
