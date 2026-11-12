---
"unmodel": patch
---

moonshotai: `kimi-k2.6` temperature is checked against Kimi's two fixed values

Kimi fixes `kimi-k2.6`'s temperature at 1.0 with thinking on and at 0.6 with
thinking off. `moonshotai.chat` now accepts
exactly those two values and refuses any other with `invalid_enum_value`; the
refreshed catalog's `temperature: false` alone would have refused 0.6. Source:
https://platform.kimi.ai/docs/api/models-overview ("Fixed at `1.0` with
thinking on and `0.6` with thinking off").

Moonshot AI's documentation now lives at https://platform.kimi.ai/docs; the
platform.moonshot.ai links redirect there.
