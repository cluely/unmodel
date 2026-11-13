---
"unmodel": patch
---

meta: `meta.chat` warns on the penalties and on `reasoning_effort: "max"` where Meta's docs say they are unsupported

Both are `unsupported_param` **warnings**: the request still validates, because
no Meta page says the API returns HTTP 400 for them. `unmodel/chat` raises the
same warnings for `"meta/<id>"`, on `frequencyPenalty` / `presencePenalty`.

- `frequency_penalty` / `presence_penalty`, on every Muse model. Meta: "are not
  supported." "Leave them unset: they do not change the output, and a request
  that sets them can return an error."
  (https://dev.meta.ai/docs/protocols/chat-completions)
- `reasoning_effort: "max"` on `muse-spark-1.1`, `muse-spark-1.2`,
  `muse-spark-1.2-contributor` and `muse-spark-1.3-contributor`. Meta: "`"max"`
  isn't available on `muse-spark-1.2`, `muse-spark-1.1`, or
  `muse-spark-1.3-contributor`." (https://dev.meta.ai/docs/choose-a-model). It
  is offered on `muse-wonder-1.0`, `muse-spark-1.3` and `muse-ember-1.0`
  (https://dev.meta.ai/docs/reasoning). `unmodel/chat` already compiles
  `reasoning: "max"` to `"high"` for Meta, so the warning reaches only
  `meta.chat` bodies.
