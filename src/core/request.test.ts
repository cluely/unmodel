import { describe, expect, test } from "bun:test";

import { UnmodelValidationError } from "./issues";
import { JSON_HEADERS, toValidated, type ApiRetargeter, type RequestMeta } from "./request";

const REQUEST: RequestMeta = {
  url: "https://api.example.com/v1/chat/completions",
  method: "POST",
  headers: { ...JSON_HEADERS },
};

const BODY = { model: "m-1", messages: [{ role: "user", content: "hi" }] };

describe("toValidated", () => {
  test("enumerable properties are exactly the wire body", () => {
    const validated = toValidated({ ...BODY }, REQUEST, { sdk: { openai: () => BODY } });

    expect(Object.keys(validated)).toEqual(["model", "messages"]);
    expect(JSON.parse(JSON.stringify(validated))).toEqual(BODY);
    expect({ ...validated } as Record<string, unknown>).toEqual(BODY);
  });

  test("toSdk and request are non-enumerable", () => {
    const validated = toValidated({ ...BODY }, REQUEST, { sdk: { openai: () => BODY } });

    for (const key of ["toSdk", "request"]) {
      expect(Object.getOwnPropertyDescriptor(validated, key)?.enumerable).toBe(false);
    }
  });

  test("the request meta is deep-copied so results never share a headers object", () => {
    const a = toValidated({ ...BODY }, REQUEST, { sdk: { openai: () => BODY } });
    const b = toValidated({ ...BODY }, REQUEST, { sdk: { openai: () => BODY } });

    a.request.headers["authorization"] = "Bearer secret";

    expect(b.request.headers["authorization"]).toBeUndefined();
    expect(REQUEST.headers["authorization"]).toBeUndefined();
    expect(a.request).not.toBe(b.request);
  });
});

describe("toSdk(target)", () => {
  test("dispatches to the named formatter", () => {
    const validated = toValidated({ ...BODY }, REQUEST, {
      sdk: { openai: () => BODY, "ai-sdk": () => ({ messages: [] }) },
    });

    expect(validated.toSdk("openai")).toEqual(BODY);
    expect(validated.toSdk("ai-sdk")).toEqual({ messages: [] });
  });

  test("an unknown target throws a TypeError naming what is available", () => {
    const validated = toValidated({ ...BODY }, REQUEST, {
      sdk: { anthropic: () => BODY, "ai-sdk": () => BODY },
    });
    const call = (): unknown => (validated.toSdk as (t: string) => unknown)("openai");

    expect(call).toThrow(TypeError);
    expect(call).toThrow(
      'unmodel: "openai" is not an SDK target for this endpoint. Available: anthropic, ai-sdk.',
    );
  });

  test("a formatter is called on every access, not memoized at build time", () => {
    let calls = 0;
    const validated = toValidated({ ...BODY }, REQUEST, {
      sdk: {
        openai: () => {
          calls += 1;
          return BODY;
        },
      },
    });

    expect(calls).toBe(0);
    validated.toSdk("openai");
    validated.toSdk("openai");
    expect(calls).toBe(2);
  });

  test("inherited Object.prototype keys are not SDK targets", () => {
    const validated = toValidated({ ...BODY }, REQUEST, { sdk: { openai: () => BODY } });

    expect(() => (validated.toSdk as (t: string) => unknown)("constructor")).toThrow(TypeError);
    expect(() => (validated.toSdk as (t: string) => unknown)("toString")).toThrow(TypeError);
  });
});

describe("toApi / toApiSafe", () => {
  const retargeted = { model: "openai/gpt-oss-120b" };

  const ok: ApiRetargeter = () => ({
    route: "groq.chat → openrouter.chat",
    result: { ok: true, params: retargeted, warnings: [], estimate: {} },
  });

  const failing: ApiRetargeter = () => ({
    route: "groq.chat → openrouter.chat",
    result: {
      ok: false,
      errors: [
        {
          severity: "error",
          code: "unsupported_param",
          path: ["logprobs"],
          message: "`logprobs` is not supported by \"openai/gpt-oss-120b\": returns a 400.",
        },
      ],
      warnings: [],
    },
  });

  test("are absent entirely when the endpoint declares no API targets", () => {
    const validated = toValidated({ ...BODY }, REQUEST, { sdk: { openai: () => BODY } });

    expect("toApi" in validated).toBe(false);
    expect("toApiSafe" in validated).toBe(false);
  });

  test("are non-enumerable when present", () => {
    const validated = toValidated({ ...BODY }, REQUEST, { sdk: { openai: () => BODY }, api: ok });

    expect(Object.keys(validated)).toEqual(["model", "messages"]);
    for (const key of ["toApi", "toApiSafe"]) {
      expect(Object.getOwnPropertyDescriptor(validated, key)?.enumerable).toBe(false);
    }
  });

  test("toApi returns the retargeted params", () => {
    const validated = toValidated({ ...BODY }, REQUEST, {
      sdk: { openai: () => BODY },
      api: ok,
    }) as unknown as { toApi(t: string): unknown };

    expect(validated.toApi("openrouter")).toBe(retargeted);
  });

  test("toApi throws UnmodelValidationError labelled with the route", () => {
    const validated = toValidated({ ...BODY }, REQUEST, {
      sdk: { openai: () => BODY },
      api: failing,
    }) as unknown as { toApi(t: string): unknown };

    try {
      validated.toApi("openrouter");
      throw new Error("expected toApi to throw");
    } catch (error) {
      expect(UnmodelValidationError.isInstance(error)).toBe(true);
      const err = error as UnmodelValidationError;
      expect(err.message).toContain("groq.chat → openrouter.chat");
      expect(err.issues[0]?.code).toBe("unsupported_param");
    }
  });

  test("toApiSafe returns the failure instead of throwing", () => {
    const validated = toValidated({ ...BODY }, REQUEST, {
      sdk: { openai: () => BODY },
      api: failing,
    }) as unknown as { toApiSafe(t: string): { ok: boolean } };

    const result = validated.toApiSafe("openrouter");

    expect(result.ok).toBe(false);
  });
});
