---
"unmodel": minor
---

The image wave: one `image()` for every text-to-image provider, and one name for
the endpoint at all fifteen of them.

**Endpoint renames (breaking).** The address-vs-wire law says an endpoint's
*address* is uniform across providers even where the wire spelling is not, so
every text-to-image route is now addressed as `image`. A provider with more than
one generation route qualifies the extras and never the primary one. The wire
spellings survive exactly where they belong — URL constants, wire types, SDK
shapes, the `/ent/v2/reference2image` path — and the editing routes are
untouched (they get their own wave).

| old | new |
| --- | --- |
| `openai.images` | `openai.image` |
| `google.generateImages` | `google.image` |
| `black-forest-labs.flux2` / `black-forest-labs.flux1` | `black-forest-labs.image` / `black-forest-labs.imageFlux1` |
| `ideogram.generate` / `ideogram.generateV4` | `ideogram.image` / `ideogram.imageV4` |
| `recraft.generations` | `recraft.image` |
| `stability.stableImageUltra` / `stableImageCore` / `stableImageSd3` | `stability.image` / `imageCore` / `imageSd3` |
| `luma.imageGenerations` | `luma.image` |
| `bytedance.imageGenerations` | `bytedance.image` |
| `runway.textToImage` | `runway.image` |
| `kling.imageGenerations` / `kling.omniImage` | `kling.image` / `kling.imageOmni` |
| `vidu.reference2image` | `vidu.imageFromReference` |
| `bria.imageGenerate` / `bria.imageGenerateLite` | `bria.image` / `bria.imageLite` |
| `leonardo.generations` | `leonardo.image` |
| `krea.krea2` | `krea.image` |
| `reve.create` / `reve.createV2` | `reve.image` / `reve.imageV2` |

The constraint tables move with them (`openai.imagesConstraints` →
`imageConstraints`, likewise google, black-forest-labs, bytedance, runway and
recraft's family rules), as do the module filenames and the CLI ids
(`unmodel validate openai.image`). Wire-shaped names — `IMAGES_GENERATIONS_URL`,
`GenerateImagesBody`, `Flux2Body`, `GenerationsParams`, `krea2Url`,
`REFERENCE2IMAGE_URL` — keep their wire spelling on purpose.

**`unmodel/image` now ships a ready-made pack.** `image()` carries all fifteen
adapters, so one canonical request reaches any of them:

```ts
import { image } from "unmodel/image";

const req = image({
  model: "openai/gpt-image-2",
  prompt: "a lighthouse in fog",
  aspectRatio: "16:9",
  resolution: "1k",
});
```

Change the ref to `"google/imagen-4.0-generate-001"` and the same object
compiles to an Imagen `:predict` body; to `"black-forest-labs/flux-2-pro"` and it
becomes a grid-snapped `width`/`height` pair. The result is that provider's own
`Validated`: its `.request`, its `.toSdk(…)`, its estimate and its findings,
because a unified call ends in the same validator a hand-written one does. To pay
for two providers instead of fifteen, build your own pack from the new
`unmodel/<provider>/unified` subpaths:

```ts
import { createImage } from "unmodel/image";
import { image as openai } from "unmodel/openai/unified";
import { image as ideogram } from "unmodel/ideogram/unified";

const image = createImage([openai, ideogram]);
```

**New package exports:** `unmodel/<provider>/unified` for each of the fifteen
(`unmodel/openai/unified` already existed and now exports both `speech` and
`image`).

**One vocabulary, six spellings of size.** `aspectRatio` XOR `dimensions`, plus a
`resolution` tier, compile to every shape a provider offers: a closed ratio enum,
a grid-snapped pixel pair, a documented size enum, a free-form `WxH`, an open
ratio string with numeric bounds, and a bare tier name. The loss contract holds
across all of them — a param a provider cannot express is an error naming what it
does offer, a value it expresses approximately is an `approximated_param` warning
naming both numbers (16:9 at 1k on a 32-px grid is 1344×768, and it says so;
DALL·E 3's `1792x1024` is 1.750:1, not 16:9, and it says that too). Zero warnings
means the request mapped exactly, asserted by a golden matrix that compiles one
canonical request at every provider that can express it.
