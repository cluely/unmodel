import { describe, expect, test } from "bun:test";
import {
  transcribe,
  listenUrl,
  LISTEN_URL,
  NOVA_3_MULTILINGUAL_USD_PER_MINUTE,
  REDACT_GROUPS,
} from "./transcribe";
import { models, NOVA_3_USD_PER_MINUTE } from "./models";

describe("deepgram.transcribe wire split (body vs query string)", () => {
  test("remote audio: body is exactly {url}, options ride in .request.url", () => {
    const v = transcribe({
      url: "https://dpgr.am/spacewalk.wav",
      model: "nova-3",
      smart_format: true,
      diarize: true,
    });

    expect(Object.keys(v)).toEqual(["url"]);
    expect(JSON.parse(JSON.stringify(v))).toEqual({ url: "https://dpgr.am/spacewalk.wav" });

    const url = new URL(v.request.url);
    expect(`${url.origin}${url.pathname}`).toBe(LISTEN_URL);
    expect(url.searchParams.get("model")).toBe("nova-3");
    expect(url.searchParams.get("smart_format")).toBe("true");
    expect(url.searchParams.get("diarize")).toBe("true");
    expect(url.searchParams.get("url")).toBeNull();
    expect(v.request.method).toBe("POST");
    expect(v.request.headers["content-type"]).toBe("application/json");
  });

  test("local audio: no url → empty JSON body for the binary-upload path", () => {
    const v = transcribe({ model: "nova-3", punctuate: true });
    expect(Object.keys(v)).toEqual([]);
    expect(JSON.stringify(v)).toBe("{}");
    expect(v.request.url).toContain("model=nova-3");
  });

  test("toSdk returns the options object (query params without url)", () => {
    const v = transcribe({ url: "https://a.com/x.wav", model: "nova-3", filler_words: true });
    expect(v.toSdk("deepgram")).toEqual({ model: "nova-3", filler_words: true });
  });

  test("array params repeat the key; booleans and numbers are stringified", () => {
    const url = listenUrl({
      model: "nova-3",
      redact: ["pci", "numbers"],
      keyterm: ["anthropic"],
      utt_split: 1.2,
      utterances: true,
    });
    expect(url).toBe(
      `${LISTEN_URL}?model=nova-3&redact=pci&redact=numbers&keyterm=anthropic&utt_split=1.2&utterances=true`,
    );
  });

  test("no params at all → bare endpoint URL", () => {
    expect(listenUrl({})).toBe(LISTEN_URL);
  });
});

describe("deepgram.transcribe model checks", () => {
  test("flux models are rejected on the pre-recorded endpoint", () => {
    const r = transcribe.safe({ url: "https://a.com/x.wav", model: "flux-general-en" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_capability");
      expect(r.errors[0]?.message).toContain("streaming-only");
    }
  });

  test("unknown model warns but passes", () => {
    // base-general IS catalogued now (it is documented for pre-recorded), so
    // this uses an id Deepgram does not document at all.
    const r = transcribe.safe({ url: "https://a.com/x.wav", model: "nova-4-general" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_model"]);
  });

  test("unknown query param warns but passes through", () => {
    const r = transcribe.safe({
      url: "https://a.com/x.wav",
      model: "nova-3",
      brand_new_param: true,
    } as never);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(["unknown_param"]);
  });
});

describe("deepgram.transcribe enum checks", () => {
  test("diarize_model outside latest/v1/v2 is invalid_enum_value", () => {
    const bad = transcribe.safe as unknown as (p: unknown) => ReturnType<typeof transcribe.safe>;
    const r = bad({ url: "https://a.com/x.wav", model: "nova-3", diarize_model: "v3" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("invalid_enum_value");
      expect(r.errors[0]?.path).toEqual(["diarize_model"]);
    }
  });

  test("encoding outside the documented set is invalid_enum_value", () => {
    const bad = transcribe.safe as unknown as (p: unknown) => ReturnType<typeof transcribe.safe>;
    const r = bad({ url: "https://a.com/x.wav", encoding: "mp3" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toEqual(["encoding"]);
  });

  test("callback_method is case-insensitive at runtime", () => {
    const bad = transcribe.safe as unknown as (p: unknown) => ReturnType<typeof transcribe.safe>;
    const r = bad({ url: "https://a.com/x.wav", callback: "https://cb.example", callback_method: "put" });
    expect(r.ok).toBe(true);
  });

  test("every redaction group validates, alone and in an array", () => {
    // Keep in sync with DeepgramRedact. Unlike the other enum-ish query
    // params, `redact` has NO entry in QUERY_ENUMS: on top of these five
    // groups Deepgram accepts arbitrary entity types, so the union is
    // autocomplete only and the field keeps its `(string & {})` escape — the
    // last case below is an entity type, not a group, and must also pass.
    expect(REDACT_GROUPS.length).toBe(5);
    for (const redact of REDACT_GROUPS) {
      const scalar = transcribe.safe({ url: "https://a.com/x.wav", model: "nova-3", redact });
      expect(scalar.ok, `group ${redact} should validate`).toBe(true);
      if (scalar.ok) expect(scalar.warnings, `group ${redact} should be warning-free`).toEqual([]);

      const array = transcribe.safe({ url: "https://a.com/x.wav", model: "nova-3", redact: [redact] });
      expect(array.ok, `group [${redact}] should validate`).toBe(true);
      if (array.ok) expect(array.warnings, `group [${redact}] should be warning-free`).toEqual([]);
    }

    const entityType = transcribe.safe({
      url: "https://a.com/x.wav",
      model: "nova-3",
      redact: ["email_address"],
    });
    expect(entityType.ok).toBe(true);
    if (entityType.ok) expect(entityType.warnings).toEqual([]);
  });
});

describe("deepgram.transcribe cost estimation", () => {
  const tenMinutes = { media: [{ path: ["url"], durationSeconds: 600 }] };

  test("nova-3 monolingual: 10 min x the $0.0077/min PRE-RECORDED rate", () => {
    // deepgram.com/pricing lists streaming and pre-recorded separately;
    // /v1/listen is pre-recorded, so $0.0077/min (not the $0.0048 streaming
    // rate) is what a request here actually costs.
    expect(models["nova-3"].cost?.perAudioMinute).toBe(NOVA_3_USD_PER_MINUTE);
    expect(NOVA_3_USD_PER_MINUTE).toBe(0.0077);
    const r = transcribe.safe({ url: "https://a.com/x.wav", model: "nova-3" }, tenMinutes);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.077, 10);
  });

  test("nova-3 with language=multi bills the multilingual pre-recorded rate", () => {
    expect(NOVA_3_MULTILINGUAL_USD_PER_MINUTE).toBe(0.0092);
    const r = transcribe.safe(
      { url: "https://a.com/x.wav", model: "nova-3", language: "multi" },
      tenMinutes,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeCloseTo(0.092, 10);
  });

  test("models without a published pre-recorded rate estimate no cost", () => {
    expect("cost" in models["nova-2"]).toBe(false);
    const r = transcribe.safe({ url: "https://a.com/x.wav", model: "nova-2" }, tenMinutes);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
  });

  test("over_budget fires against the estimated cost", () => {
    const r = transcribe.safe(
      { url: "https://a.com/x.wav", model: "nova-3" },
      { ...tenMinutes, maxCostUSD: 0.01 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.code).toBe("over_budget");
  });
});

describe("deepgram.transcribe per-model + pairing rules (doc audit 2026-08-13)", () => {
  test("keyterm on a pre-Nova-3 model is unsupported_param with the doc source", () => {
    const r = transcribe.safe({ url: "https://a.com/x.wav", model: "nova-2", keyterm: ["ketamine"] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe("unsupported_param");
      expect(r.errors[0]?.path).toEqual(["keyterm"]);
      expect(String(r.errors[0]?.meta?.source)).toContain("keyterm");
    }
  });

  test("keyterm passes on every nova-3 variant and on unknown models", () => {
    for (const model of ["nova-3", "nova-3-general", "nova-3-medical", "nova-4-general"]) {
      const r = transcribe.safe({ url: "https://a.com/x.wav", model, keyterm: "ketamine" });
      expect(r.ok).toBe(true);
    }
  });

  test("keywords (the pre-Nova-3 feature) is never gated", () => {
    const r = transcribe.safe({ url: "https://a.com/x.wav", model: "nova-2", keywords: "snuffleupagus" });
    expect(r.ok).toBe(true);
  });

  test("dictation without punctuate is an error; with punctuate it passes", () => {
    const bad = transcribe.safe({ url: "https://a.com/x.wav", model: "nova-3", dictation: true });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]?.path).toEqual(["dictation"]);

    const good = transcribe.safe({
      url: "https://a.com/x.wav",
      model: "nova-3",
      dictation: true,
      punctuate: true,
    });
    expect(good.ok).toBe(true);
  });

  test("the legacy families the docs still list are catalogued, not unknown", () => {
    for (const model of ["base-general", "enhanced-phonecall", "nova-medical", "whisper-medium"]) {
      const r = transcribe.safe({ url: "https://a.com/x.wav", model });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings).toEqual([]);
      // No published pre-recorded rate for these tiers → no invented estimate.
      if (r.ok) expect(r.estimate.costUSD).toBeUndefined();
    }
  });
});
