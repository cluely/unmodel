import { describe, expect, test } from "bun:test";
import {
  listenLive,
  listenLiveUrl,
  listenFlux,
  listenFluxUrl,
  fluxConfigure,
  speakLive,
  speakLiveUrl,
  LISTEN_LIVE_URL,
  LISTEN_FLUX_URL,
  SPEAK_LIVE_URL,
  LISTEN_LIVE_ENCODINGS,
  UTTERANCE_END_MIN_MS,
  NOVA_3_STREAMING_USD_PER_MINUTE,
  NOVA_3_MULTILINGUAL_STREAMING_USD_PER_MINUTE,
  FLUX_KEYTERMS_MAX,
  EOT_THRESHOLD_DEFAULT,
} from "./realtime";
import { transcribe } from "./transcribe";
import { models, NOVA_3_USD_PER_MINUTE } from "./models";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";

/** Ten minutes of session, declared out of band (no param references the audio). */
// The empty path addresses the params object itself, which is the whole
// coordinate system on a socket endpoint: the media is the stream. Inferred
// rather than annotated `ValidateOptions`, so the `readonly []` survives and
// the same object serves listenLive, listenFlux and speakLive.
const tenMinutes = { media: [{ path: [] as const, durationSeconds: 600 }] };

const unchecked = <T>(fn: T) =>
  fn as unknown as (
    params: unknown,
    options?: ValidateOptions,
  ) => ValidateResult<Record<string, unknown>>;

const liveSafe = unchecked(listenLive.safe);
const fluxSafe = unchecked(listenFlux.safe);
const speakSafe = unchecked(speakLive.safe);

describe("deepgram.listenLive config → socket URL", () => {
  test("the enumerable body IS the config; .request is the wss handshake", () => {
    const params = {
      model: "nova-3" as const,
      encoding: "linear16" as const,
      sample_rate: 16000,
      interim_results: true,
    };
    const v = listenLive(params);

    expect(Object.keys(v)).toEqual(["model", "encoding", "sample_rate", "interim_results"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual(params);

    const url = new URL(v.request.url);
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(LISTEN_LIVE_URL);
    expect(url.protocol).toBe("wss:");
    expect(url.searchParams.get("model")).toBe("nova-3");
    expect(url.searchParams.get("sample_rate")).toBe("16000");
    expect(url.searchParams.get("interim_results")).toBe("true");
    // A WebSocket opening handshake is an HTTP GET upgrade with no body, and
    // auth (Token header / ["token", key] subprotocol) is the caller's.
    expect(v.request.method).toBe("GET");
    expect(v.request.headers).toEqual({});
    expect(v.toSdk("deepgram")).toEqual(params);
  });

  test("arrays repeat the key; endpointing=false survives as a literal", () => {
    expect(
      listenLiveUrl({ model: "nova-3", keyterm: ["ketamine", "propofol"], endpointing: false }),
    ).toBe(`${LISTEN_LIVE_URL}?model=nova-3&keyterm=ketamine&keyterm=propofol&endpointing=false`);
  });

  test("no params at all → the bare socket URL", () => {
    expect(listenLiveUrl({})).toBe(LISTEN_LIVE_URL);
  });

  test("unknown param warns but passes through", () => {
    const r = liveSafe({ model: "nova-3", brand_new_param: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });
});

describe("deepgram.listenLive value space vs the pre-recorded route", () => {
  test("the three streaming-only encodings pass here and fail on POST /v1/listen", () => {
    for (const encoding of ["linear32", "alaw", "ogg-opus"] as const) {
      const live = liveSafe({ model: "nova-3", encoding, sample_rate: 16000 });
      expect(live.ok, `${encoding} should be a live encoding`).toBe(true);

      const batch = unchecked(transcribe.safe)({ url: "https://a.com/x.wav", encoding });
      expect(batch.ok, `${encoding} is not documented for pre-recorded`).toBe(false);
    }
    // …and the shared ones stay shared.
    expect(LISTEN_LIVE_ENCODINGS).toContain("flac");
  });

  test("encoding outside the live set is invalid_enum_value", () => {
    const r = liveSafe({ model: "nova-3", encoding: "mp3", sample_rate: 16000 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["encoding"]);
    }
  });

  test("callback_method: DELETE is live-only, and case-insensitive", () => {
    expect(liveSafe({ callback: "https://cb.example", callback_method: "DELETE" }).ok).toBe(true);
    expect(liveSafe({ callback: "https://cb.example", callback_method: "delete" }).ok).toBe(true);
    expect(unchecked(transcribe.safe)({ url: "https://a.com/x.wav", callback_method: "DELETE" }).ok).toBe(
      false,
    );
  });

  test("diarize_model v2 is documented for pre-recorded only", () => {
    const live = liveSafe({ model: "nova-3", diarize_model: "v2" });
    expect(live.ok).toBe(false);
    if (!live.ok) expect(live.errors[0]?.path).toEqual(["diarize_model"]);
    expect(liveSafe({ model: "nova-3", diarize_model: "v1" }).ok).toBe(true);
    expect(unchecked(transcribe.safe)({ url: "https://a.com/x.wav", diarize_model: "v2" }).ok).toBe(true);
  });
});

describe("deepgram.listenLive pairing + routing rules (doc audit 2026-08-13)", () => {
  test("utterance_end_ms requires interim_results", () => {
    const bad = listenLive.safe({ model: "nova-3", utterance_end_ms: 1000 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors[0]?.path).toEqual(["utterance_end_ms"]);
      expect(bad.errors[0]?.message).toContain("interim_results");
    }
    expect(
      listenLive.safe({ model: "nova-3", utterance_end_ms: 1000, interim_results: true }).ok,
    ).toBe(true);
  });

  test("utterance_end_ms below the documented 1000 ms minimum is rejected", () => {
    expect(UTTERANCE_END_MIN_MS).toBe(1000);
    const r = liveSafe({ model: "nova-3", utterance_end_ms: 500, interim_results: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("invalid_shape");
  });

  test("raw audio must declare encoding AND sample_rate together", () => {
    const noRate = listenLive.safe({ model: "nova-3", encoding: "linear16" });
    expect(noRate.ok).toBe(false);
    if (!noRate.ok) expect(noRate.errors[0]?.path).toEqual(["sample_rate"]);

    const noEncoding = listenLive.safe({ model: "nova-3", sample_rate: 16000 });
    expect(noEncoding.ok).toBe(false);
    if (!noEncoding.ok) expect(noEncoding.errors[0]?.path).toEqual(["encoding"]);

    // Containerized audio carries its parameters in the header: opus alone is fine.
    expect(listenLive.safe({ model: "nova-3", encoding: "opus" }).ok).toBe(true);
  });

  test("flux ids are routed to the /v2 socket", () => {
    const r = listenLive.safe({ model: "flux-general-en" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.message).toContain("listenFlux");
      expect(r.errors[0]?.message).toContain(LISTEN_FLUX_URL);
    }
  });

  test("the shared /v1/listen checks apply here too (keyterm, dictation)", () => {
    const keyterm = listenLive.safe({ model: "nova-2", keyterm: "ketamine" });
    expect(keyterm.ok).toBe(false);
    if (!keyterm.ok) expect(keyterm.errors[0]?.path).toEqual(["keyterm"]);

    const dictation = listenLive.safe({ model: "nova-3", dictation: true });
    expect(dictation.ok).toBe(false);
    if (!dictation.ok) expect(dictation.errors[0]?.path).toEqual(["dictation"]);
    expect(listenLive.safe({ model: "nova-3", dictation: true, punctuate: true }).ok).toBe(true);
  });

  test("a fully-loaded live config validates warning-free", () => {
    const r = listenLive.safe({
      model: "nova-3",
      language: "multi",
      version: "latest",
      callback: "https://cb.example",
      callback_method: "POST",
      channels: 2,
      multichannel: true,
      detect_entities: true,
      diarize_model: "latest",
      dictation: true,
      punctuate: true,
      encoding: "mulaw",
      sample_rate: 8000,
      endpointing: 500,
      extra: ["key:value"],
      filler_words: true,
      interim_results: true,
      keyterm: ["ketamine"],
      keywords: ["snuffleupagus"],
      mip_opt_out: true,
      numerals: true,
      profanity_filter: true,
      redact: ["pci", "ssn"],
      replace: ["horse:zebra"],
      search: ["flamingo"],
      smart_format: true,
      tag: ["session-1"],
      utterance_end_ms: 1200,
      vad_events: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });
});

describe("deepgram.listenLive cost estimation (STREAMING rates)", () => {
  test("nova-3 bills the $0.0048/min streaming rate, not the catalog's pre-recorded one", () => {
    expect(NOVA_3_STREAMING_USD_PER_MINUTE).toBe(0.0048);
    expect(models["nova-3"].cost?.perAudioMinute).toBe(NOVA_3_USD_PER_MINUTE);
    expect(NOVA_3_STREAMING_USD_PER_MINUTE).toBeLessThan(NOVA_3_USD_PER_MINUTE);

    const r = listenLive.safe({ model: "nova-3" }, tenMinutes);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.048, 10);
  });

  test("language=multi bills the multilingual streaming rate", () => {
    expect(NOVA_3_MULTILINGUAL_STREAMING_USD_PER_MINUTE).toBe(0.0058);
    const r = listenLive.safe({ model: "nova-3", language: "multi" }, tenMinutes);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.058, 10);
  });

  test("tiers without a published streaming rate estimate nothing", () => {
    for (const model of ["nova-2", "whisper-medium", "nova-3-medical"]) {
      const r = liveSafe({ model }, tenMinutes);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
    }
  });

  test("without a declared session length there is no estimate", () => {
    const r = listenLive.safe({ model: "nova-3" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("over_budget fires against the streaming estimate", () => {
    const r = listenLive.safe({ model: "nova-3" }, { ...tenMinutes, maxCostUSD: 0.01 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});

describe("deepgram.listenFlux", () => {
  test("config → /v2/listen socket URL, with toSdk as the identity", () => {
    const params = { model: "flux-general-en" as const, encoding: "linear16" as const, sample_rate: 16000 };
    const v = listenFlux(params);

    expect(Object.keys(v)).toEqual(["model", "encoding", "sample_rate"]);
    expect(v.request.url).toBe(
      `${LISTEN_FLUX_URL}?model=flux-general-en&encoding=linear16&sample_rate=16000`,
    );
    expect(v.request.method).toBe("GET");
    expect(v.toSdk("deepgram")).toEqual(params);
    expect(listenFluxUrl({ model: "flux-general-multi", language_hint: ["en", "es"] })).toBe(
      `${LISTEN_FLUX_URL}?model=flux-general-multi&language_hint=en&language_hint=es`,
    );
  });

  test("model is required and must be a Flux model", () => {
    const missing = fluxSafe({ encoding: "linear16", sample_rate: 16000 });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]?.code).toBe("invalid_shape");

    const wrong = listenFlux.safe({ model: "nova-3" });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) {
      expect(wrong.errors[0]?.code).toBe("unsupported_capability");
      expect(wrong.errors[0]?.message).toContain("listenLive");
    }
  });

  test("end-of-turn thresholds carry their documented ranges", () => {
    expect(fluxSafe({ model: "flux-general-en", eot_threshold: 0.4 }).ok).toBe(false);
    expect(fluxSafe({ model: "flux-general-en", eot_threshold: 0.95 }).ok).toBe(false);
    expect(fluxSafe({ model: "flux-general-en", eager_eot_threshold: 0.2 }).ok).toBe(false);
    expect(fluxSafe({ model: "flux-general-en", eot_timeout_ms: 400 }).ok).toBe(false);
    expect(fluxSafe({ model: "flux-general-en", eot_timeout_ms: 60_001 }).ok).toBe(false);
    expect(
      listenFlux.safe({ model: "flux-general-en", eot_threshold: 0.9, eot_timeout_ms: 60_000 }).ok,
    ).toBe(true);
  });

  test("eager_eot_threshold must not exceed eot_threshold (explicit or default)", () => {
    const vsDefault = listenFlux.safe({ model: "flux-general-en", eager_eot_threshold: 0.8 });
    expect(EOT_THRESHOLD_DEFAULT).toBe(0.7);
    expect(vsDefault.ok).toBe(false);
    if (!vsDefault.ok) {
      expect(vsDefault.errors[0]?.path).toEqual(["eager_eot_threshold"]);
      expect(vsDefault.errors[0]?.message).toContain("the default");
    }

    expect(
      listenFlux.safe({ model: "flux-general-en", eot_threshold: 0.9, eager_eot_threshold: 0.8 }).ok,
    ).toBe(true);
    expect(
      listenFlux.safe({ model: "flux-general-en", eot_threshold: 0.5, eager_eot_threshold: 0.5 }).ok,
    ).toBe(true);
  });

  test("language_hint is multilingual-only", () => {
    const r = listenFlux.safe({ model: "flux-general-en", language_hint: "es" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["language_hint"]);
    }
    expect(listenFlux.safe({ model: "flux-general-multi", language_hint: ["en", "es"] }).ok).toBe(
      true,
    );
  });

  test("redact on Flux is the closed numbers/aggressive_numbers pair", () => {
    for (const redact of ["numbers", "aggressive_numbers"] as const) {
      expect(listenFlux.safe({ model: "flux-general-en", redact }).ok).toBe(true);
    }
    const r = fluxSafe({ model: "flux-general-en", redact: ["pci"] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["redact"]);
    }
  });

  test("flac is a /v1 encoding, not a Flux one; raw audio still needs a sample rate", () => {
    expect(fluxSafe({ model: "flux-general-en", encoding: "flac" }).ok).toBe(false);
    const noRate = listenFlux.safe({ model: "flux-general-en", encoding: "mulaw" });
    expect(noRate.ok).toBe(false);
    if (!noRate.ok) expect(noRate.errors[0]?.path).toEqual(["sample_rate"]);
  });

  test("Flux prices from the catalog, whose flux rates are already streaming rates", () => {
    expect(models["flux-general-en"].cost?.perAudioMinute).toBe(0.0065);
    const r = listenFlux.safe({ model: "flux-general-en" }, tenMinutes);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.065, 10);
  });
});

describe("deepgram.fluxConfigure (the Configure client message)", () => {
  test("the body is the message; .request names the socket it belongs to", () => {
    const message = {
      type: "Configure" as const,
      thresholds: { eot_threshold: 0.8, eager_eot_threshold: 0.4, eot_timeout_ms: 5000 },
      keyterms: ["term1", "term2"],
      language_hints: ["en", "es"],
    };
    const v = fluxConfigure(message);
    expect(JSON.parse(JSON.stringify(v))).toEqual(message);
    expect(v.request.url).toBe(LISTEN_FLUX_URL);
    expect(v.toSdk("deepgram")).toEqual(message);
  });

  test("type must be the literal Configure", () => {
    const r = unchecked(fluxConfigure.safe)({ type: "configure" });
    expect(r.ok).toBe(false);
  });

  test("keyterms cap at 100 terms", () => {
    expect(FLUX_KEYTERMS_MAX).toBe(100);
    const terms = Array.from({ length: FLUX_KEYTERMS_MAX }, (_, i) => `t${i}`);
    expect(fluxConfigure.safe({ type: "Configure", keyterms: terms }).ok).toBe(true);
    expect(fluxConfigure.safe({ type: "Configure", keyterms: [...terms, "one-too-many"] }).ok).toBe(
      false,
    );
  });

  test("threshold ordering is enforced inside `thresholds` too", () => {
    const r = fluxConfigure.safe({
      type: "Configure",
      thresholds: { eot_threshold: 0.5, eager_eot_threshold: 0.9 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["thresholds", "eager_eot_threshold"]);
  });

  test("an empty Configure is legal — omitted fields keep their current value", () => {
    const r = fluxConfigure.safe({ type: "Configure" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });
});

describe("deepgram.speakLive", () => {
  test("config → /v1/speak socket URL; the text is not part of it", () => {
    const params = { model: "aura-2-thalia-en" as const, encoding: "mulaw" as const, sample_rate: 8000 as const };
    const v = speakLive(params);
    expect(Object.keys(v)).toEqual(["model", "encoding", "sample_rate"]);
    expect(v.request.url).toBe(
      `${SPEAK_LIVE_URL}?model=aura-2-thalia-en&encoding=mulaw&sample_rate=8000`,
    );
    expect(v.request.method).toBe("GET");
    expect(v.toSdk("deepgram")).toEqual(params);
    expect(speakLiveUrl({})).toBe(SPEAK_LIVE_URL);
  });

  test("only linear16/mulaw/alaw stream; the REST-only codecs are rejected", () => {
    for (const encoding of ["linear16", "mulaw", "alaw"] as const) {
      expect(speakLive.safe({ encoding, sample_rate: 8000 }).ok).toBe(true);
    }
    for (const encoding of ["mp3", "opus", "flac", "aac"]) {
      const r = speakSafe({ encoding });
      expect(r.ok, `${encoding} is REST-only`).toBe(false);
      if (!r.ok) expect(r.errors[0]?.path).toEqual(["encoding"]);
    }
  });

  test("sample_rate is narrowed by the encoding, with linear16 as the socket default", () => {
    // mulaw/alaw stop at 16000 …
    const tooHigh = speakSafe({ encoding: "mulaw", sample_rate: 24000 });
    expect(tooHigh.ok).toBe(false);
    if (!tooHigh.ok) {
      expect(tooHigh.errors[0]?.code).toBe("invalid_enum_value");
      expect(tooHigh.errors[0]?.path).toEqual(["sample_rate"]);
    }
    // … and an omitted encoding is judged as linear16 (the documented
    // streaming default), which has no 22050 rate.
    const notLinear16 = speakSafe({ sample_rate: 22050 });
    expect(notLinear16.ok).toBe(false);
    if (!notLinear16.ok) expect(notLinear16.errors[0]?.path).toEqual(["sample_rate"]);
    expect(speakLive.safe({ sample_rate: 48000 }).ok).toBe(true);
  });

  test("an STT model on the TTS socket is unsupported_capability", () => {
    const r = speakLive.safe({ model: "nova-3" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.message).toContain(SPEAK_LIVE_URL);
    }
  });

  test("speed keeps its 0.7–1.5 bounds and warns on Aura-1 voices", () => {
    expect(speakSafe({ model: "aura-2-thalia-en", speed: 1.6 }).ok).toBe(false);
    expect(speakSafe({ model: "aura-2-thalia-en", speed: 0.6 }).ok).toBe(false);
    expect(speakLive.safe({ model: "aura-2-thalia-en", speed: 1.2 }).ok).toBe(true);

    const aura1 = speakLive.safe({ model: "aura-asteria-en", speed: 1.2 });
    expect(aura1.ok).toBe(true);
    if (aura1.ok) {
      expect(aura1.warnings.map((w) => w.code)).toEqual(["unsupported_param"]);
      expect(aura1.warnings[0]?.path).toEqual(["speed"]);
    }
  });

  test("no cost estimate: the config carries no text", () => {
    const r = speakLive.safe({ model: "aura-2-thalia-en" }, tenMinutes);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });
});
