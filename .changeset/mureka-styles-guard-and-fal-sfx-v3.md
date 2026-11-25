---
"unmodel": minor
---

- **fal (`unmodel/fal`, `unmodel/sfx`):** Curate `elevenlabs/sound-effects/v3` (fal's replacement for `fal-ai/elevenlabs/sound-effects/v2`, scheduled to retire 2027-02-01), with 0.5–30s duration, 19-value `output_format`, `loop`, `prompt_influence`, `enable_safety_checker`, and $0.002/s catalog provenance.
- **mureka (`unmodel/music`):** Guard the `styles` extra in `compileSong` and `compileInstrumental` so passing `styles` with `lyrics` or `instrumental: true` returns an `unsupported_param` error naming `POST /v1/song/easy-generate` instead of passing through as an `unknown_param` warning.
