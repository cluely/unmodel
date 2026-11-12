---
"unmodel": patch
---

deepgram: correct the STT rates, accept `eot_threshold` up to 1.0, type `language_hint` / `redact_usage`

Rates (pay-as-you-go, read off the JSON-LD offers on https://deepgram.com/pricing,
2026-11-12). The pre-recorded Nova-3 figures were the streaming list prices,
and the streaming figures a promotion that has ended, so cost estimates move:

| | was | now |
|---|---|---|
| Nova-3 pre-recorded (`NOVA_3_USD_PER_MINUTE`, `deepgram.stt`, `checkListen`) | $0.0077/min | $0.0043/min |
| Nova-3 `language=multi` pre-recorded (`NOVA_3_MULTILINGUAL_USD_PER_MINUTE`) | $0.0092/min | $0.0052/min |
| Nova-3 streaming (`NOVA_3_STREAMING_USD_PER_MINUTE`, `deepgram.listenLive`) | $0.0048/min | $0.0077/min |
| Nova-3 `language=multi` streaming (`NOVA_3_MULTILINGUAL_STREAMING_USD_PER_MINUTE`) | $0.0058/min | $0.0092/min |
| `flux-general-en` (`deepgram.listenFlux`) | $0.0065/min | $0.0077/min |
| `whisper-large` pre-recorded | unpriced | $0.0048/min |

`flux-general-multi` ($0.0078/min) and Aura-2 / Aura-1 ($0.030 / $0.015 per
1,000 characters) are unchanged.

False refusals fixed:

- `deepgram.listenFlux` and `deepgram.fluxConfigure` accept `eot_threshold`
  up to `1.0` (`EOT_THRESHOLD_MAX` is now 1.0): "Valid Values: `0.5` to
  `1.0`" — `1.0` fully suppresses natural end-of-turn detection and hands turn
  endings to `ForceEndTurn` (https://developers.deepgram.com/docs/flux/configuration).
- `language_hint` (string or list, repeated on the wire) is now typed on
  `deepgram.stt` and `deepgram.listenLive`, and as a Nova-3 extra in
  `unmodel/stt`. It is refused when `language` is not `"multi"` (Deepgram
  ignores it) or on a non-Nova-3 model ("Nova-2 does not support
  `language_hint`", https://developers.deepgram.com/docs/nova-3-language-prompting),
  and warns on Nova-3 variants other than `nova-3` / `nova-3-general`, where
  support is undocumented.
- `redact_usage` (boolean) is now typed on `deepgram.stt`,
  `deepgram.listenLive`, `deepgram.listenFlux` and `deepgram.fluxConfigure`,
  and as an extra on every Deepgram model in `unmodel/stt`; `fluxConfigure`
  also takes `numerals` (https://developers.deepgram.com/docs/flux/configure).
  Each was a compile error under `ExactKeys` and an `unknown_param` warning at
  run time.
