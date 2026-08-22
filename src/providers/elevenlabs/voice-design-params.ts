/**
 * The voice-design adapter's **data**: the model list and the per-model
 * narrowing table. The ./tts-params split, for the ./tts-params reason.
 */

import { EXTRA } from "../../core/unified/derive";
import type { VoiceDesignModelParamTable } from "../../core/unified/vocabulary/voice-design";
import type { ElevenlabsVoiceDesignOutputFormat } from "./voice-design";

/** The two text-to-voice model ids — the ref union for `elevenlabs/…`. */
export const MODELS = ["eleven_multilingual_ttv_v2", "eleven_ttv_v3"] as const;

export const VOICE_DESIGN_DOCS =
  "https://elevenlabs.io/docs/api-reference/text-to-voice/design";

/**
 * The extras both models share. `text` and `auto_generate_text` are excluded
 * — they are the canonical `previewText`'s wire spellings — and so are
 * `voice_description` (← `prompt`), `seed` and `guidance_scale`
 * (← `guidance`).
 */
const SHARED_EXTRAS = {
  loudness: EXTRA as number | null,
  quality: EXTRA as number | null,
  stream_previews: EXTRA as boolean,
  should_enhance: EXTRA as boolean,
  remixing_session_id: EXTRA as string | null,
  remixing_session_iteration_id: EXTRA as string | null,
  /** QUERY param — the validator strips it onto `.request.url`. */
  output_format: EXTRA as ElevenlabsVoiceDesignOutputFormat,
} as const;

/**
 * Two rows because the wire genuinely diverges: `reference_audio_base64` and
 * `prompt_strength` are "only supported when using the eleven_ttv_v3 model"
 * — on the v2 row they are compile errors here and `unsupported_param` in
 * the validator's own gate, one fact enforced at both layers from one doc
 * sentence.
 */
export const ELEVENLABS_VOICE_DESIGN_MODEL_PARAMS = {
  eleven_multilingual_ttv_v2: {
    extras: SHARED_EXTRAS,
  },
  eleven_ttv_v3: {
    extras: {
      ...SHARED_EXTRAS,
      reference_audio_base64: EXTRA as string | null,
      prompt_strength: EXTRA as number | null,
    },
  },
} as const satisfies VoiceDesignModelParamTable;
