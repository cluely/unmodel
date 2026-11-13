---
"unmodel": patch
---

stability: `toRequestInit` refuses the Stable Audio and Stable Image edit routes, which are multipart-only

`toRequestInit` now refuses `stability.music`, `stability.musicFromAudio`,
`stability.musicInpaint` and the six `stability.imageEdit*` routes (`Erase`,
`Inpaint`, `Outpaint`, `SearchAndReplace`, `SearchAndRecolor`,
`RemoveBackground`) at compile time and at run time, the way it already
refused `stability.image` / `imageCore` / `imageSd3`. Their results now carry
`.request.body: "form"` and are typed `ValidatedForm`.

Before this, the helper JSON-encoded these bodies without any error. Every
`Blob` (`audio`, `image`, `mask`) came out as `{}`, so the request could
never succeed. Stability's v2beta spec (https://api.stability.ai/v2alpha/openapi,
checked 2026-11-12) declares only `multipart/form-data` for all nine routes. Send
`.request.url` with `stability.toFormData(validated)` as the body instead.
