---
"unmodel": patch
---

revai: the `low_cost` restrictions no longer refuse non-English jobs, and they cite the archived reference

- `revai.stt` refused `diarization_type` and `forced_alignment` with
  `transcriber: "low_cost"` even on non-English jobs (for example
  `language: "es"`). Rev AI's transcribers page says "The `transcriber`
  option is ignored for non-English transcription requests", so those jobs
  never run in the low-cost environment. The validator already warned that
  the transcriber is ignored and priced the job at the foreign-language rate.
  These requests now validate, with the existing `deprecated_model` and
  ignored-`transcriber` warnings. English jobs (an absent `language`, `en`,
  `en-us`, `en-gb`) are still refused.
- The two low-cost refusals now set `meta.source` to the archived reference
  that carries the clauses word for word
  (https://web.archive.org/web/20250601173112/https://docs.rev.ai/api/asynchronous/reference),
  not to the changelog, which does not mention them. The live reference no
  longer documents `low_cost`.

Sources: https://docs.rev.ai/api/asynchronous/transcribers,
https://docs.rev.ai/api/asynchronous/changelog,
https://web.archive.org/web/20250601173112/https://docs.rev.ai/api/asynchronous/reference.
