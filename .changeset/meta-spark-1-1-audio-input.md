---
"unmodel": patch
---

meta: `muse-spark-1.1` accepts audio input

`meta.chat` (and `unmodel/chat` with `"meta/muse-spark-1.1"`) refused an
`input_audio` part on `muse-spark-1.1` as `unsupported_capability`, because the
models.dev row lists its input as text, image, PDF and video only. Meta's model
page says of every Muse Spark version, 1.1 included: "All take text, image,
video, audio, and PDF input, return text, and have a 1,048,576-token context
window." (https://dev.meta.ai/docs/muse-spark, checked 2026-11-12). The
validator now uses a corrected catalog, exported as `chatModels` from
`unmodel/meta`; `models` stays the generated table.
