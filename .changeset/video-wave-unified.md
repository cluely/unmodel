---
"unmodel": minor
---

The video wave: one `video()` for every video-generation provider, and one name
for the endpoint at all ten of them.

**Endpoint renames (breaking).** The address-vs-wire law says an endpoint's
*address* is uniform across providers even where the wire spelling is not, so
every video route is now addressed as `video`. A provider with more than one
video route qualifies the extras by what makes them different — what the clip is
made from (`videoFromImage`, `videoFromVideo`, `videoFromReference`,
`videoFromAudio`), which route family serves it (`videoV2`, `videoV3`,
`videoOmni`), or what it does to a finished clip (`videoModify`, `videoReframe`,
`videoUpscale`, `videoAddAudio`) — and never the primary one.

| old | new |
| --- | --- |
| `openai.videos` | `openai.video` |
| `google.generateVideos` | `google.video` |
| `bytedance.contentGenerationTasks` | `bytedance.video` |
| `runway.textToVideo` / `imageToVideo` / `videoToVideo` | `runway.video` / `videoFromImage` / `videoFromVideo` |
| `kling.textToVideo` / `imageToVideo` | `kling.video` / `videoFromImage` |
| `kling.textToVideoV3` / `imageToVideoV3` / `omniVideo` | `kling.videoV3` / `videoV3FromImage` / `videoOmni` |
| `luma.generations` | `luma.video` |
| `luma.modifyVideo` / `reframeVideo` / `upscale` / `addAudio` | `luma.videoModify` / `videoReframe` / `videoUpscale` / `videoAddAudio` |
| `minimax.videoGeneration` / `videoGenerationV2` | `minimax.video` / `videoV2` |
| `vidu.text2video` / `img2video` / `reference2video` | `vidu.video` / `videoFromImage` / `videoFromReference` |
| `pixverse.textToVideo` / `imageToVideo` | `pixverse.video` / `videoFromImage` |
| `lightricks.textToVideo` / `imageToVideo` / `audioToVideo` | `lightricks.video` / `videoFromImage` / `videoFromAudio` |

The constraint tables move with them (`openai.videosConstraints` →
`videoConstraints`, google's `generateVideosConstraints` / `FamilyRules` /
`Models`, runway's three `*Constraints` / `*Required` / `*ShapeRules` triples,
bytedance's `contentGenerationTasksConstraints`, luma's `modifyVideoConstraints`,
vidu's three), as do the module filenames and the CLI ids (`unmodel validate
openai.video`). Wire-shaped names — `VIDEOS_URL`, `GENERATE_VIDEOS_BASE_URL`,
`generateVideosUrl`, `GenerateVideosBody`, `TEXT2VIDEO_URL`,
`CONTENT_GENERATION_TASKS_URL`, `Text2VideoParams`, `omniVideoUrl` — keep their
wire spelling on purpose.

**`unmodel/video` now ships a ready-made pack.** `video()` carries all ten
adapters (twenty-one endpoint modules between them), so one canonical request
reaches any of them:

```ts
import { video } from "unmodel/video";

const req = video({
  model: "luma/ray-2",
  prompt: "a drone shot over a fjord",
  duration: 5,
  resolution: "1080p",
  aspectRatio: "16:9",
});
```

**`duration` is a plain number of seconds, and that is the whole argument for
this vocabulary.** The same `duration: 8` compiles to five different wire
shapes: `8` (google, runway, vidu, bytedance, pixverse, minimax), `"8"`
(openai's `seconds`, kling's `/v1/videos/*` family), `"8s"` (luma), a nested
`settings.duration` (kling's path-addressed family) and the documented `null`
"automatic duration" (LTX-2.5). A duration a model does not offer is an
`invalid_enum_value` listing the ones it does — never the nearest, because a
9-second clip is not approximately a 5-second one at any price.

**The inputs choose the endpoint.** A prompt is text-to-video; adding `image`
makes it image-to-video; tagging that image `role: "reference"` makes it
reference-to-video; and `video` makes it video-to-video. At four of the ten
providers those are four different URLs. A model with no arm for the route you
derived says exactly that:

```ts
video({ model: "runway/gen4_turbo", prompt: "a fox in snow", duration: 5 });
// throws: "gen4_turbo" has no text-to-video route; it serves image-to-video —
// pass `image`.
```

The loss contract holds across all of it: `resolution: "720p"` on MiniMax is an
`approximated_param` naming 768 lines, and `1440p` at a provider that has no
such tier is an error naming the tiers it does. Zero warnings means the request
mapped exactly, asserted by a golden matrix that compiles one canonical request
at every provider that can express it.

**New package exports:** `unmodel/pixverse/unified` and
`unmodel/lightricks/unified`. Seven providers that serve more than one media
category now split their adapter per category behind the same
`unmodel/<provider>/unified` barrel (`unified-image.ts` / `unified-video.ts` /
`unified-speech.ts`), so no pack pays for another category's catalog.
