---
"unmodel": minor
---

**New unified category `unmodel/3d`, and the native `unmodel/tripo3d` provider that made it
possible.**

The first category in the library that did **not** ship on one provider, and that was the
point. `unmodel/lipsync`, `unmodel/avatar` and `unmodel/upscale` all arrived with fal alone;
3D waited for a second, independent witness, because a vocabulary read off a single vendor is
that vendor's request schema with the field names changed — and 3D is where that shows fastest.
Two schemas in, `texture` already had five spellings (`texture`, `textured_mesh`,
`enable_texture`, `should_texture`, `texture_mode`) and the output container had four more plus
a boolean that changes it as a side effect. None of them is in the vocabulary.

```ts
import { threeD } from "unmodel/3d";

JSON.stringify(threeD({ model: "tripo3d/v3.1-20260211", prompt: "a brass astrolabe", seed: 7 }));
// → {"model":"v3.1-20260211","prompt":"a brass astrolabe","model_seed":7}
//   POST https://openapi.tripo3d.ai/v3/generation/text-to-model
```

**Five canonical words**, and the first category whose two content words are ALTERNATIVES
rather than companions: `model`, `prompt` XOR `image`, `seed`, `providerOptions`. One row field
(`inputs`) moves both in opposite directions, with three populated arms — text-only routes type
`image` as `never`, image-only routes do the reverse, and a route that publishes both (fal's
Hyper3D Rodin, and every Tripo model) leaves both optional. No `size`, no `aspectRatio`, no
`resolution`, no `n`: a mesh has no frame, and these routes return one object per request.

**`unmodel/tripo3d`** — Tripo's own v3 API, `https://openapi.tripo3d.ai/v3`, flat JSON,
`Authorization: Bearer <TRIPO_API_KEY>`. Two endpoints (`tripo3d.threeD` for
`POST /v3/generation/text-to-model`, `tripo3d.threeDFromImage` for `…/image-to-model`) across
four models — `v3.1-20260211`, `v3.0-20250812`, `v2.5-20250123` and the low-poly
`P1-20260311`. Subpaths: `unmodel/tripo3d`, `/unified`, `/types`, `/values`.

Three cross-field rules Tripo documents, each of them a 4xx otherwise, are compile-time or
validation errors here: seven parameters are gated on the model version and `v2.5-20250123`
takes none of them; `generate_parts: true` requires `texture`, `pbr` and `quad` all false, and
the first two DEFAULT to true; and the polycount ceiling moves with the model, with Ultra mode
and with `quad`. Its `input` is one polymorphic string — a `file_…` token, a public URL or a
prior `task_…` id, never inline bytes — so a `{ data }` ref is refused naming `POST /v3/files`
rather than compiled into a `data:` URI Tripo would reject.

Tripo is also the rare media provider whose estimate is **exact**: the price is a pure function
of the request body (a per-task credit base plus the add-ons the body switched on, at $0.01 a
credit), with no duration to guess and no output pixel count to infer from a URL. P1 declines,
because its credit table is rendered client-side only on Tripo's pricing page.

**`fal.threeD`** — 19 curated endpoints from seven vendors, taking `unmodel/fal` to **165
endpoints across ten verbs**. Tripo H3.1 and P1 (text and image), Tripo v2.5 image and
multiview, Hunyuan3D 2.0 and turbo, Hunyuan 3D 3.1 Pro and Rapid, TRELLIS and TRELLIS 2,
TripoSR, Hyper3D Rodin v2.5 and its text-only sibling, Meshy 7, Hi3D v3.0. The verb is `threeD`
rather than `3d` for a mechanical reason: an endpoint id's second segment is a module export
name and `3d` is not a JavaScript identifier. The category id, the package subpath
(`unmodel/3d`) and the CLI's `unified.3d` all keep the digit.

The two providers overlap on purpose. `tripo3d/h3.1/image-to-3d` at fal and
`tripo3d/v3.1-20260211` natively are the same model reached two ways, and they compile to
visibly different bodies — which is the comparison the category exists to make cheap:

```ts
threeD({ model: "fal/tripo3d/h3.1/image-to-3d", image: { url } });
// → {"image_url":"…"}                          POST https://queue.fal.run/tripo3d/h3.1/image-to-3d

threeD({ model: "tripo3d/v3.1-20260211", image: { url } });
// → {"model":"v3.1-20260211","input":"…"}      POST https://openapi.tripo3d.ai/v3/generation/image-to-model
```

Also in this release:

- `Modality` gains a `"3d"` member. A mesh is not a picture of one, and every route here also
  returns a preview render — filing the whole category under `"image"` would have made
  `modalities.output` lie about what the request bought.
- `unmodel/fal` now exports a `provider` `ProviderInfo` (`{ id: "fal", name: "fal.ai",
  env: ["FAL_KEY"] }`), which every other hand-catalogued provider already had.
- `unmodel validate` gains `fal.threeD`, `tripo3d.threeD`, `tripo3d.threeDFromImage` and
  `unified.3d`.
