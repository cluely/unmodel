---
"unmodel": patch
---

alibaba: retire the Qwen3-TTS snapshots and the Instruct-Flash models

Model Studio retired these TTS ids on 2026-10-10 ("Upon retirement, these
models will no longer support inference, and any applications or services
continuing to call them will fail to receive responses"), and the
international Qwen3-TTS model list is now `qwen3-tts-flash` alone. They are
removed from `alibaba.tts`, the `unmodel/tts` adapter and the hand catalog:

- `qwen3-tts-flash-2025-11-27` and `qwen3-tts-flash-2025-09-18` → use
  `qwen3-tts-flash` (the notice names `cosyvoice-v3.5-plus` as the
  replacement; the qwen-tts page lists that model for China (Beijing) only).
- `qwen3-tts-instruct-flash` and `qwen3-tts-instruct-flash-2026-01-26` → use
  `qwen3-tts-flash` (notice replacement: `cosyvoice-v3.5-plus`).
- `qwen3-tts-instruct-flash-realtime` (WebSocket-only catalog row) → use
  `qwen3-tts-flash-realtime` (notice replacement:
  `qwen3.5-omni-plus-realtime`).

Requests naming a retired id now fail `alibaba.tts`'s model gate
(`invalid_enum_value`, naming `qwen3-tts-flash`).

The Instruct-only wire fields go with them: `input.instructions` and
`input.optimize_instructions` are no longer part of `TtsGenerationParams`
(the qwen-tts-api reference documents neither), and the `unmodel/tts` rows no
longer offer them as extras.

Removed exports (`unmodel/alibaba`, `unmodel/alibaba/values`):
`INSTRUCTIONS_MAX_TOKENS`, `TTS_INSTRUCT_PER_MILLION_CHARACTERS`,
`QWEN3_TTS_FLASH_2025_09_18_VOICES`, `QWEN3_TTS_INSTRUCT_FLASH_VOICES`.

Sources: https://www.alibabacloud.com/en/notice/model_studio_notice_of_retirement_for_selected_legacy_models_7d9,
https://www.alibabacloud.com/help/en/model-studio/qwen-tts,
https://www.alibabacloud.com/help/en/model-studio/qwen-tts-api,
https://www.alibabacloud.com/help/en/model-studio/realtime-tts-user-guide.
