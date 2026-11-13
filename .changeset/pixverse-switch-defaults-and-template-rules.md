---
"unmodel": patch
---

pixverse: a switch sent as `false` passes on every model, a template task lifts the image-to-video sound-effect / lip-sync gate, and a template task refuses multi-clip

All checked against PixVerse's current docs on 2026-11-12.

- **A gated switch sent as `false` is no longer refused.** `false` is each
  switch's documented default. The image-to-video schema's `allOf` admits
  `generate_multi_clip_switch: false` on any model, and text-to-video
  declares both switches `default: false`
  ([image-to-video](https://docs.platform.pixverse.ai/image-to-video-and-video-templates-13016633e0),
  [text-to-video](https://docs.platform.pixverse.ai/text-to-video-13016634e0)).
  Before this fix, `generate_multi_clip_switch: false` on c1, v5.6 or v6-max,
  `generate_audio_switch: false` on v5 and `lip_sync_switch: false` on v6 all
  came back as `unsupported_param`. `true` is still gated by model.
- **`pixverse.videoFromImage` accepts the sound-effect / lip-sync fields on
  any model when the request has a `template_id`.** That route's schema reads
  "use only with a supporting model/template", and it says "Template metadata
  determines supported model, duration, and quality". The field docs already
  said "or with a `template_id`", but the validator refused these fields on
  every model above v5. `template_id` is still refused on v6-max. `pixverse.video` (text-to-video) keeps the plain
  v5-and-below gate, because its docs give only "Supported in v5 models and
  below".
- **`pixverse.videoFromImage` refuses `generate_multi_clip_switch: true`
  next to `template_id`.** The schema description reads "Not supported with
  other models or template_id", and the `allOf` arm that allows `true` also
  requires that `template_id` is absent. A `false` switch on a template task
  still passes.
- The `unmodel/video` refusal for an image input on `pixverse/…` now names
  the real route, `POST /openapi/v2/video/img/generate`. It used to say
  `/video/image/generate`, which does not exist.
