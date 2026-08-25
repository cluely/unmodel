---
"unmodel": minor
---

**Media retargeting: `.toApi("fal")` on validated native image, video and speech requests.**

`.toApi(provider)` has been chat-only since it shipped, and the reason given was that media has
no shared wire dialect to translate through and no availability data to derive a target union
from. Both halves are still true. What changed is the conclusion: the overlap is a hand table
per family and the crossing is a hand mapping per family, checked at compile time against fal's
own generated wire types.

```ts
import { video } from "unmodel/kling";

const request = video({
  model_name: "kling-v2-5-turbo",
  prompt: "A slow push-in through a rainy neon alley",
  mode: "pro",
  duration: "10",
});

const onFal = request.toApi("fal");
onFal.request.url; // https://queue.fal.run/fal-ai/kling-video/v2.5-turbo/pro/text-to-video
onFal.warnings;    // []  ← empty means the mapping was exact
onFal.toSdk("fal");// { input: { … } }, the shape @fal-ai/client takes
```

Six provider families across three categories, transcribed from fal's endpoint pages on
2026-08-25 and drift-guarded against fal's curated roster:

| source | models |
|---|---|
| `kling.video` / `kling.videoFromImage` | `kling-v3`, `kling-v2-6`, `kling-v2-5-turbo` |
| `pixverse.video` | `v6` |
| `lightricks.video` | `ltx-2-5-pro` |
| `elevenlabs.tts` | `eleven_v3`, `eleven_multilingual_v2`, `eleven_turbo_v2_5` |
| `minimax.tts` | `speech-2.8-hd`, `speech-2.8-turbo`, `speech-02-hd` |
| `black-forest-labs.image` / `.imageFlux1` | `flux-2-pro`, `flux-2-max`, `flux-pro-1.1`, `flux-pro-1.1-ultra`, `flux-dev` |

**The loss policy, stated normatively.** A parameter fal cannot express is an **error** naming
the parameter, the fal endpoint and the reason — never a silent drop, because a dropped
`camera_control` produces a different video rather than a lossier one. A value fal expresses
approximately is exactly one `approximated_param` warning carrying `requested` and `achieved`.
So `warnings.length === 0` *means* the mapping was exact, and the goldens assert it.

**`.toApi` exists only where a mapping does.** Where chat degrades an unrecognised model to the
full target union — its catalog is a models.dev snapshot that lags a release by days — the
media tables are hand-written, so "unmapped" and "unknown" are the same thing:
`kling.video({ model_name: "kling-v1", … }).toApi` is a compile error naming a member that is
not on the type. Every model outside the tables carries a recorded reason rather than a bare
"unknown model", including the ones refused on purpose: Recraft as a whole family (fal's rows
drop `num_images`, `seed` and `negative_prompt` and speak a style vocabulary Recraft retired),
`mode: "std"` on Kling 2.5-turbo and 2.6 (fal serves the pro tier only, and promoting a tier
changes the resolution and the price), `safety_tolerance: 0` at Black Forest Labs (fal's enum
starts at `"1"`, and 0 is the *strictest* native setting — promoting it would loosen
moderation), and zero-retention, webhooks and account-scoped ids everywhere.

**`EndpointAuth.scheme` gains `"Key"`**, because retargeting invalidates the auth header the
caller already wrote: Kling takes `authorization: Bearer <key>`, fal takes
`authorization: Key <FAL_KEY>` — the literal word `Key`, which fal's own OpenAPI security
scheme omits. Stated, never derived.

**The media packs are byte-identical.** `unmodel/video`, `unmodel/tts`, `unmodel/image` and the
other nine reach these providers through their `unified-<category>.ts` adapter leaves, whose
results carry no `.toApi` at all — so the seam is applied in `src/providers/<p>/index.ts`, the
one module only `unmodel/<p>` imports, rather than in the endpoint module's `finalize` where
chat wires its own. `test/bundle-budget.test.ts` asserts both directions.

New type exports from the root entry: `MediaApiMember`, `MediaApiTargetId`, `MediaOverlapTable`,
`MediaRetargeted`, `MediaMapContext`, `MediaOverlapRow`, `MediaRetargetSpec`,
`MediaTargetEndpoint` and `EndpointAuth`. Each family's overlap and refusal tables are exported
from its own provider entry (`KLING_VIDEO_FAL_OVERLAP`, `ELEVENLABS_TTS_FAL_REFUSALS`, …) so a
caller can ask what is mappable before calling.
