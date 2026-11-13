---
"unmodel": patch
---

soniox: `stt-async-v5` and `stt-rt-v5` are now catalogued as deprecated

Soniox's models page lists both as "**Deprecated** — Will be removed Dec 15,
2026" (https://docs.soniox.com/stt/models). They are still served, so both
ids still validate and price, but they now carry `status: "deprecated"` and
emit a `deprecated_model` warning.

| Deprecated id  | Replacement    | After 2026-12-15                                |
| -------------- | -------------- | ----------------------------------------------- |
| `stt-async-v5` | `stt-async-v6` | "requests using stt-async-v5 will automatically route to stt-async-v6" |
| `stt-rt-v5`    | `stt-rt-v6`    | "requests using stt-rt-v5 will automatically route to stt-rt-v6"       |

The v6 models are "fully compatible with the existing v5 models and Soniox
API", so migrating means changing the `model` string and nothing else.
`soniox/stt-async-v5` is still a valid ref on `unmodel/stt`.
