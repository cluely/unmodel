---
"unmodel": patch
---

resemble: `resemble.tts` no longer refuses 2,001–3,000-character requests, and the catalog says why it carries no price

- `resemble.tts` (`POST /synthesize`) errors only above 3,000 characters of
  `data` — the cap in its API reference ("max 3,000 characters",
  https://docs.resemble.ai/api-reference/text-to-speech/synthesize). Its guide
  says "≤ 2,000 characters"
  (https://docs.resemble.ai/voice-generation/text-to-speech/synchronous), so
  2,001–3,000 characters now validates with an `over_output_limit` warning that
  names both pages (`meta.source`, `meta.referenceSource`), where it used to be
  an error. New export: `RESEMBLE_SYNTHESIZE_MAX_CHARACTERS` (3000).
- `resemble.ttsStream` (`POST /stream`) keeps its 2,000-character error: both of
  its pages agree ("max 2000 characters",
  https://docs.resemble.ai/api-reference/text-to-speech/stream-synthesize).
  `RESEMBLE_MAX_CHARACTERS` and the `resemble-ultra` row's `limit.characters`
  stay 2000, the figure every page of both routes accepts.
- Docs corrected: Resemble does publish per-second voice rates
  (https://app.resemble.ai/billing/api/v1/plans — Text-To-Speech 0.00067 USD/s
  on Flex, 0.0005 on Team and Business), but they depend on the caller's plan
  and are no longer sold to new customers, so `cost` stays omitted and
  `estimate.costUSD` stays `undefined`.
- Resemble stopped selling voice generation to new customers on 2026-08-13 and
  keeps serving existing ones
  (https://www.resemble.ai/resources/why-a-former-voice-ai-company-went-all-in-on-deepfake-detection);
  `resemble.tts` and `resemble.ttsStream` stay, and `docs/providers.md` now says
  so.
