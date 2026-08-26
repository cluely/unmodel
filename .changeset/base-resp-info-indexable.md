---
"unmodel": patch
---

**`MINIMAX_BASE_RESP_INFO` is now indexable by the checker's own `finishReason`.**
An adopter hit TS7053 pairing the two exports this library ships side by side:
`checkTts`'s `finishReason` is open-tailed (`MinimaxBaseRespStatus` carries a
`(number & {})` arm, because MiniMax can mint codes we have not transcribed), but
the table declared only exact numeric keys, so `MINIMAX_BASE_RESP_INFO[report.finishReason]`
needed a widening cast.

The export's declared type is now the literal table intersected with a numeric
index signature — both reads work without a cast, and both are pinned in
`test/types/minimax.test-d.ts`:

- `MINIMAX_BASE_RESP_INFO[report.finishReason]` → `MinimaxBaseRespInfo | undefined`
- `MINIMAX_BASE_RESP_INFO[1004].retryable` → still the literal `false`

**Declined as asked:** typing the export `Partial<Record<MinimaxBaseRespStatus, …>>`
would have allowed the first read by destroying the second — every exact-key
lookup would degrade to `MinimaxBaseRespInfo | undefined` and every literal
payload to its wide type. An accessor function was also unnecessary once the
intersection carries both.
