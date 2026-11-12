---
"unmodel": patch
---

zhipuai (2026-11-12): `glm-4.6v-flash` and `glm-5.3-flashx` join the catalog, and `zhipuai.chat` enforces GLM-5.3's always-on thinking

- New models: `glm-4.6v-flash` (free vision model, 128K context / 32,768 max
  output) and `glm-5.3-flashx` (1M context / 131,072 max output, image, video
  and file input). Both validate, price and retarget like their siblings, and
  `unmodel/chat` accepts `zhipuai/glm-4.6v-flash` and `zhipuai/glm-5.3-flashx`.
- `zhipuai.chat` refuses a `reasoning_effort` other than `"low"`, `"high"` or
  `"max"` on `glm-5.3`, `glm-5.3-flash` and `glm-5.3-flashx`. Zhipu's
  thinking guide (https://docs.bigmodel.cn/cn/guide/capabilities/thinking):
  "针对 `GLM-5.3` `GLM-5.3-FLASH` `GLM-5.3-FLASHX`，仅支持 `max`、`high`、`low`，其余输入将报错".
  The same table runs on `.toApi("zhipuai")` retargets, and an `unmodel/chat`
  request that compiles to another level (`reasoning: "medium"`, `"minimal"`,
  or `"off"`, which compiles to `"none"`) now fails validation on these three
  models with `invalid_enum_value` instead of getting a 400 from the API.
- `zhipuai.chat` refuses `thinking: { type: "disabled" }` on the same three
  models: "GLM-5.3 GLM-5.3-FLASH 不再支持关闭思考（API 请求中 thinking.type 传
  disabled 将会报错）" (same page), and the parameter page
  (https://docs.bigmodel.cn/cn/guide/start/concept-param) lists GLM-5.3-FLASHX
  as "强制需开启" too. `glm-5.2` and older keep their full effort range and can
  still turn thinking off.
- Zhipu prices follow models.dev, which now reads them off open.bigmodel.cn's
  CNY price list (https://docs.bigmodel.cn/cn/guide/start/pricing) and converts
  at a dated exchange rate. Most cost estimates drop accordingly, for example
  `glm-5.3` input 1.4 → 1.19516 USD per 1M tokens. `glm-5v-turbo` drops from
  5 / 22 to 0.74698 / 3.28669 USD per 1M input / output tokens: the old row
  carried the CNY figures labelled as USD.
