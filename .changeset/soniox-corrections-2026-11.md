---
"unmodel": patch
---

soniox: stop refusing four requests the API accepts, mark realtime `api_key` deprecated, and update doc links

- **Context length is now a warning.** Going over 10,000 characters of
  context content on `soniox.realtimeTranscription` now reports a
  `near_context` warning; it used to be an `invalid_shape` error. Soniox caps
  context at "**8,000 tokens** (about 10,000 characters)", and the server error
  reads "Context is too long: N tokens, the maximum is 8000 tokens." A
  character count cannot settle a token limit, so the old error could refuse
  a dense context the API accepts. The warning's `meta.limitTokens` is the
  real cap. `MAX_CONTEXT_CHARACTERS` is unchanged. Sources:
  https://docs.soniox.com/stt/concepts/context and
  https://docs.soniox.com/api-reference/stt/websocket-api.
- **8-bit raw audio formats.** `audio_format` now accepts `pcm_s8le`,
  `pcm_s8be`, `pcm_u8le` and `pcm_u8be` next to the bare `pcm_s8` and
  `pcm_u8`. The official SDK's `AudioFormat` union (`@soniox/node` 2.5.0)
  includes all four, which settles the docs' "`pcm_s8` … (`le`/`be`)"
  wording. Before this change they were refused with `invalid_enum_value`.
  `SONIOX_RAW_AUDIO_FORMATS` and `SonioxRawAudioFormat` both include them.
- **`null` on the async body.** `soniox.stt` now accepts an explicit `null` on
  `audio_url`, `file_id`, `language_hints`, `language_hints_strict`,
  `enable_speaker_diarization`, `enable_language_identification`,
  `webhook_url`, `webhook_auth_header_name`, `webhook_auth_header_value` and
  `client_reference_id`, and `TranscriptionsBody` types each one `| null`.
  The OpenAPI `CreateTranscriptionPayload` types every optional field
  `anyOf: [<type>, null]` (https://docs.soniox.com/openapi.yaml). A `null`
  audio source counts as absent in the exactly-one-source rule.
- **Realtime `api_key` is deprecated.** "The `api_key` field of the start
  request is **deprecated**. From **15 January 2027** a connection that sends
  its key only there is refused." (https://docs.soniox.com/api-reference/stt/websocket-api).
  The field is still accepted and passed through untouched, but it now
  carries an `unsupported_param` warning (`meta.refusedFrom: "2027-01-15"`).
  The module docs and the JSDoc example now send the key with the connection,
  either as an `Authorization: Bearer <key>` header or as
  `["soniox-api-key", key]` in the WebSocket protocols list
  (https://docs.soniox.com/authentication/migrate-websocket-authentication).
- **Doc links.** Soniox moved its docs from `soniox.com/docs` to
  `docs.soniox.com`, and every old URL now redirects. Issue `meta.source`
  values, `provider.doc` and the provenance comments now point at the new
  pages. The 5-hour audio cap is now cited from the limits pages ("300
  minutes", fixed) rather than the models page; the value is unchanged.
