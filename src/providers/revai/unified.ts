/**
 * `unmodel/stt` → `revai.stt` (POST /speechtotext/v1/jobs).
 *
 * The inverted one. Rev AI turns diarization **off** with `skip_diarization`,
 * so `{ enabled: true }` compiles to `skip_diarization: false` — the only
 * adapter in the category where the canonical boolean and the wire boolean
 * disagree about which way is which, and therefore the one place a mistake
 * would be invisible in a diff and expensive in a bill.
 *
 * Two more asymmetries worth naming:
 *
 * - **There is no `model` field.** `transcriber` selects the engine
 *   (`machine`, `low_cost`, `fusion`, `human`), so the ref compiles to it, and
 *   Rev AI's own `checkTranscriberScope` is what rejects the machine-only
 *   options on a human job.
 * - **The audio URL is nested.** `source_config.url` is the current field;
 *   the flat `media_url` is deprecated, so this adapter writes the nested one
 *   and declares provenance for it, which is what makes "must be an http(s)
 *   URL" arrive at `audio`.
 */
import {
  applyExtras,
  resolveAudioInput,
  resolveDiarization,
  toPrimaryLanguage,
  toTimestampGranularity,
} from "../../core/unified/derive";
import type { CompileContext, CompiledCall } from "../../core/unified/types";
import type { SttAdapterFor, SttParamsFor } from "../../core/unified/vocabulary/stt";
import { stt as validator, type JobsBody } from "./stt";
import { MODELS, REVAI_STT_MODEL_PARAMS } from "./stt-params";

const REFERENCE_DOCS = "https://docs.rev.ai/api/asynchronous/reference";

/** The wire body this adapter compiles to. */
export type RevaiSttWire = JobsBody;

/** What a unified call to `revai/…` returns. */
export type RevaiSttResult = ReturnType<typeof validator>;

export const stt = {
  category: "stt",
  provider: "revai",
  models: MODELS,
  modelParams: REVAI_STT_MODEL_PARAMS,
  audioInputs: ["url"],
  unsupported: {
    languages:
      "Rev AI has no candidate-language list — detection is `language: \"auto\"` plus " +
      "`enable_multilingual`, which is a switch rather than a shortlist. Send `language: \"auto\"` " +
      "and set `enable_multilingual` through `providerOptions.revai`.",
    prompt:
      "POST /speechtotext/v1/jobs takes no prompt — `custom_vocabularies` is a phrase list with " +
      "its own limits, so send it through `providerOptions.revai`.",
  },
  compile(
    input: SttParamsFor<"url">,
    ctx: CompileContext<SttParamsFor<"url">>,
  ): CompiledCall<RevaiSttWire, RevaiSttResult> {
    const body: RevaiSttWire = { transcriber: ctx.model, source_config: { url: "" } };
    ctx.from(["source_config", "url"], "audio");
    ctx.from(["transcriber"], "model");
    ctx.from(["skip_diarization"], "diarization");
    ctx.from(["speakers_count"], "diarization.speakers");

    const audio = ctx.take(
      resolveAudioInput(input.audio, ["url"], { path: ["audio"], warn: ctx.warn }, {
        source: REFERENCE_DOCS,
        hint:
          "For local bytes, post the multipart form `toFormData({ media, options })` from " +
          "`unmodel/revai` instead — the `media` part is not a field of the JSON job.",
      }),
    );
    if (audio?.kind === "url") body.source_config = { url: audio.url };

    if (input.language !== undefined) {
      const language = ctx.take(
        toPrimaryLanguage(input.language, { path: ["language"], warn: ctx.warn }, {
          source: REFERENCE_DOCS,
        }),
      );
      if (language !== undefined) body.language = language;
    }

    if (input.diarization !== undefined) {
      const diarization = ctx.take(
        resolveDiarization(
          input.diarization,
          { speakers: true, source: REFERENCE_DOCS },
          { path: ["diarization"], warn: ctx.warn },
        ),
      );
      if (diarization !== undefined) {
        // Inverted on purpose — see the module note.
        body.skip_diarization = !diarization.enabled;
        if (diarization.speakers !== undefined) body.speakers_count = diarization.speakers;
      }
    }

    // Word timings ride on every Rev AI transcript; `forced_alignment` is a
    // *quality* upgrade with its own price and its own model restrictions, not
    // the switch that turns timing on, so it stays in `providerOptions`.
    if (input.timestamps !== undefined) {
      ctx.take(
        toTimestampGranularity(input.timestamps, ["word"], {
          path: ["timestamps"],
          warn: ctx.warn,
        }, { source: REFERENCE_DOCS }),
      );
    }

    applyExtras(input, REVAI_STT_MODEL_PARAMS, body, ctx);

    return { params: body, validate: validator.safe };
  },
} as const satisfies SttAdapterFor<
  "url",
  typeof REVAI_STT_MODEL_PARAMS,
  RevaiSttWire,
  RevaiSttResult
>;
