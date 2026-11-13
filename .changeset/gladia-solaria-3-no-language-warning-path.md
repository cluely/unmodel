---
"unmodel": patch
---

gladia: through `unmodel/stt`, the `solaria-3` no-language warning now names `language`

A `gladia/solaria-3` call that sets neither `language` nor `languages` gets a
warning asking it to pin one language. That warning was reported at the raw
wire path `language_config.languages`, a field the caller never wrote. It is
now reported at `language`, and its message ends "(compiled from
`language_config.languages`)", like the other solaria-3 language findings.
A `language_config` sent through `providerOptions.gladia` is still reported
at its wire path.
