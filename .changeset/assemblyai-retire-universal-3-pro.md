---
"unmodel": patch
---

assemblyai: retire `universal-3-pro`, replaced by `universal-3-5-pro`

- `universal-3-pro` has left the `assemblyai` catalog,
  `unmodel/assemblyai/values` (`STT_MODELS`, `STT_MODEL_PARAMS`) and the typed
  `unmodel/stt` refs. AssemblyAI retired it. Its changelog
  (https://www.assemblyai.com/changelog, checked 2026-11-12) says requests
  pinning it "return an error: The universal-3-pro speech model(s) have been
  deprecated. Use speech_models: ["universal-3-5-pro", "universal-2"]
  instead." The 2026-08-01 update moved the cut-over to September 2, 2026.
  The submit reference now lists "Supported values: `universal-3-5-pro`,
  `universal-2`."
- **Replacement: `universal-3-5-pro`** ($0.21/hr pre-recorded). A request
  that still names `universal-3-pro` validates with an `unknown_model`
  warning and no cost estimate, and AssemblyAI will refuse it.
- `slam-1` stays in the catalog as `deprecated`, but its row now cites
  AssemblyAI's current model reference
  (https://www.assemblyai.com/llms/models.md: "| `slam-1` | Deprecated |
  `universal-3-5-pro` (+ Medical Mode for medical use cases) |"). The old
  citation named the retired model as its migration target.
