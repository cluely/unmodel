/**
 * The capability table for `unmodel/3d`, committed and then **probed**.
 *
 * Keyed by REF rather than by provider, for the same reason as its lipsync,
 * avatar and upscale siblings: at fal the route is a parameter, so "which
 * fields does this support" is a per-ENDPOINT question. This is the first
 * category where the table spans two PROVIDERS of different kinds, and the two
 * Tripo rows at the bottom are why: `tripo3d/v3.1-20260211` and
 * `fal/tripo3d/h3.1/image-to-3d` are the same model reached two ways, and their
 * rows disagree on three of five columns.
 *
 * The words mean what they mean everywhere else in this suite:
 *
 * | word | meaning |
 * |---|---|
 * | `native` | a rename — the value the caller wrote reaches the wire unchanged |
 * | `derived` | expressible, but computed (a `data:` URI built from inline bytes) |
 * | `unsupported` | this route has no field for it; the adapter refuses it by name |
 */
import { describe, expect, test } from "bun:test";
import { threeD } from "../../src/unified/3d";
import { threeD as fal } from "../../src/providers/fal/unified-3d";
import { threeD as tripo3d } from "../../src/providers/tripo3d/unified";

type Support = "native" | "unsupported";

interface Capability {
  ref: string;
  /** Whether the route reads a prompt, and under which wire name if so. */
  prompt: Support;
  /** The wire field the reference image lands in, and whether it is a LIST. */
  image: { at: string; list?: true } | "unsupported";
  /** The wire field the GEOMETRY seed lands in. */
  seed: { at: string } | "unsupported";
  /** How this route lets a caller ask for textures — one word per vendor. */
  textureWord: string | undefined;
  /** How this route lets a caller cap the polycount — one word per vendor. */
  polycountWord: string | undefined;
}

const TABLE: Readonly<Record<string, Capability>> = {
  // ---- fal, text-driven -------------------------------------------------
  "fal/tripo-h3.1-text": {
    ref: "fal/tripo3d/h3.1/text-to-3d",
    prompt: "native",
    image: "unsupported",
    // Three seeds published; the canonical one maps to the geometry seed.
    seed: { at: "model_seed" },
    textureWord: "texture",
    polycountWord: "face_limit",
  },
  "fal/hunyuan-3.1-pro-text": {
    ref: "fal/fal-ai/hunyuan-3d/v3.1/pro/text-to-3d",
    prompt: "native",
    image: "unsupported",
    seed: "unsupported",
    // A generation-TYPE enum rather than a boolean: "Normal" is textured,
    // "Geometry" is a white model.
    textureWord: "generate_type",
    polycountWord: "face_count",
  },
  "fal/meshy-v7-text": {
    ref: "fal/meshy/v7/text-to-3d",
    prompt: "native",
    image: "unsupported",
    seed: { at: "seed" },
    textureWord: "mode",
    polycountWord: "target_polycount",
  },
  // ---- fal, image-driven ------------------------------------------------
  "fal/trellis": {
    ref: "fal/fal-ai/trellis",
    prompt: "unsupported",
    image: { at: "image_url" },
    seed: { at: "seed" },
    textureWord: undefined,
    polycountWord: "mesh_simplify",
  },
  "fal/hunyuan3d-v2": {
    ref: "fal/fal-ai/hunyuan3d/v2",
    prompt: "unsupported",
    image: { at: "input_image_url" },
    seed: { at: "seed" },
    textureWord: "textured_mesh",
    polycountWord: undefined,
  },
  "fal/tripo-v2.5-multiview": {
    ref: "fal/tripo3d/tripo/v2.5/multiview-to-3d",
    prompt: "unsupported",
    // The canonical `image` is the FRONT view; the other three angles are
    // extras, which is what makes this route servable at all.
    image: { at: "front_image_url" },
    seed: { at: "seed" },
    textureWord: "texture",
    polycountWord: "face_limit",
  },
  "fal/hitem3d": {
    ref: "fal/hitem3d/hi3d/v3.0/image-to-3d",
    prompt: "unsupported",
    image: { at: "image_url" },
    seed: "unsupported",
    textureWord: "enable_texture",
    polycountWord: "face_count",
  },
  // ---- fal, both --------------------------------------------------------
  "fal/rodin": {
    ref: "fal/fal-ai/hyper3d/rodin/v2.5",
    // The only route in the build that reads both and requires neither.
    prompt: "native",
    image: { at: "image_urls", list: true },
    seed: { at: "seed" },
    textureWord: "texture_mode",
    polycountWord: "quality_mesh_option",
  },
  // ---- tripo3d, the native half -----------------------------------------
  "tripo3d/v3.1": {
    ref: "tripo3d/v3.1-20260211",
    // Both, because at Tripo the ROUTE follows the input rather than the id.
    prompt: "native",
    image: { at: "input" },
    seed: { at: "model_seed" },
    textureWord: "texture",
    polycountWord: "face_limit",
  },
  "tripo3d/v2.5": {
    ref: "tripo3d/v2.5-20250123",
    prompt: "native",
    image: { at: "input" },
    seed: { at: "model_seed" },
    textureWord: "texture",
    polycountWord: "face_limit",
  },
};

const PROMPT = "a brass astrolabe on a walnut stand";
const PHOTO = { url: "https://example.com/chair.png" } as const;

const ROWS = { ...fal.modelParams, ...tripo3d.modelParams } as Readonly<
  Record<
    string,
    {
      readonly keys?: readonly string[];
      readonly inputs?: readonly string[];
      readonly imageWire?: string;
      readonly imageWireList?: true;
      readonly seedWire?: string;
      readonly extras?: Readonly<Record<string, unknown>>;
    }
  >
>;

/** The bare model id a ref points at. */
const bare = (ref: string): string => ref.slice(ref.indexOf("/") + 1);

test("the table covers both providers and every shape the category has", () => {
  const providers = new Set(Object.values(TABLE).map((c) => c.ref.split("/")[0]));
  expect([...providers].sort()).toEqual([...threeD.providers]);
  // Every input arm: text-only, image-only, and both.
  const arms = new Set(
    Object.values(TABLE).map((c) =>
      c.prompt === "native" && c.image !== "unsupported"
        ? "both"
        : c.prompt === "native"
          ? "text"
          : "image",
    ),
  );
  expect([...arms].sort()).toEqual(["both", "image", "text"]);
});

describe.each(Object.entries(TABLE))("%s", (_name, cap) => {
  test("the committed row matches the generated one", () => {
    const row = ROWS[bare(cap.ref)];
    expect(row, cap.ref).toBeDefined();
    expect(row?.inputs?.includes("text") === true, `${cap.ref} prompt`).toBe(
      cap.prompt === "native",
    );
    if (cap.image === "unsupported") {
      expect(row?.inputs?.includes("image"), `${cap.ref} image`).not.toBe(true);
    } else {
      expect(row?.inputs?.includes("image"), `${cap.ref} image`).toBe(true);
      // The native provider's `input` is not a row field: its adapter knows the
      // one name, because there is only one. fal's rows carry the wire name
      // because there are four of them.
      if (cap.ref.startsWith("fal/")) {
        expect(row?.imageWire, `${cap.ref} imageWire`).toBe(cap.image.at);
        expect(row?.imageWireList === true, `${cap.ref} list`).toBe(cap.image.list === true);
      }
    }
  });

  test("a request in each supported mood compiles cleanly", () => {
    if (cap.prompt === "native") {
      const result = threeD.safe({ model: cap.ref, prompt: PROMPT } as never);
      expect(result.ok, `${cap.ref} prompt`).toBe(true);
    }
    if (cap.image !== "unsupported") {
      const result = threeD.safe({ model: cap.ref, image: PHOTO } as never);
      expect(result.ok, `${cap.ref} image`).toBe(true);
    }
  });

  test("an unsupported mood is refused by name rather than dropped", () => {
    if (cap.prompt === "unsupported") {
      const result = threeD.safe({ model: cap.ref, image: PHOTO, prompt: PROMPT } as never);
      // Either a compile refusal (fal's adapter) or a wire-level unknown param
      // — both name `prompt`, and neither silently drops it.
      const named = result.ok
        ? result.warnings.some((i) => i.path?.[0] === "prompt")
        : result.errors.some((i) => i.path?.[0] === "prompt");
      expect(named, `${cap.ref} prompt refusal`).toBe(true);
    }
    if (cap.image === "unsupported") {
      const result = threeD.safe({ model: cap.ref, prompt: PROMPT, image: PHOTO } as never);
      expect(result.ok, `${cap.ref} image refusal`).toBe(false);
    }
  });

  test("the seed lands where the row says, or is refused", () => {
    const params = cap.prompt === "native" ? { prompt: PROMPT } : { image: PHOTO };
    const result = threeD.safe({ model: cap.ref, ...params, seed: 7 } as never);
    if (cap.seed === "unsupported") {
      expect(result.ok, `${cap.ref} seed`).toBe(false);
      return;
    }
    expect(result.ok, `${cap.ref} seed`).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(JSON.stringify(result.params))).toMatchObject({ [cap.seed.at]: 7 });
  });

  test("the texture and polycount words are extras, never vocabulary", () => {
    // The whole argument for the five-word vocabulary, made per row: each
    // vendor's word for "give me textures" and "cap the polygons" is on the
    // row's `extras` rather than in `CANONICAL_KEY_LISTS`.
    const row = ROWS[bare(cap.ref)];
    for (const word of [cap.textureWord, cap.polycountWord]) {
      if (word === undefined) continue;
      expect(Object.keys(row?.extras ?? {}), `${cap.ref}.${word}`).toContain(word);
    }
  });
});

describe("the two witnesses disagree, which is why the vocabulary is five words", () => {
  test("`texture` has five spellings across the table", () => {
    const words = new Set(
      Object.values(TABLE)
        .map((c) => c.textureWord)
        .filter((w): w is string => w !== undefined),
    );
    expect(words.size).toBeGreaterThanOrEqual(5);
    expect([...words].sort()).toContain("textured_mesh");
    expect([...words].sort()).toContain("enable_texture");
    expect([...words].sort()).toContain("texture");
  });

  test("the polycount cap has four", () => {
    const words = new Set(
      Object.values(TABLE)
        .map((c) => c.polycountWord)
        .filter((w): w is string => w !== undefined),
    );
    expect(words.size).toBeGreaterThanOrEqual(4);
  });

  test("the same model through two providers disagrees on three of five columns", () => {
    const viaFal = TABLE["fal/tripo-h3.1-text"] as Capability;
    const viaTripo = TABLE["tripo3d/v3.1"] as Capability;
    // Same vendor, same model generation. Same seed word and same texture word
    // — Tripo agreeing with itself — and different everything else: fal's
    // resale is text-ONLY on that endpoint, spells the image differently on its
    // sibling, and drops three of Tripo's own parameters entirely.
    expect(viaFal.seed).toEqual(viaTripo.seed);
    expect(viaFal.textureWord).toBe(viaTripo.textureWord);
    expect(viaFal.image).not.toEqual(viaTripo.image);
    const falExtras = Object.keys(ROWS["tripo3d/h3.1/text-to-3d"]?.extras ?? {});
    const tripoExtras = Object.keys(ROWS["v3.1-20260211"]?.extras ?? {});
    for (const dropped of ["smart_low_poly", "generate_parts", "compress"]) {
      expect(tripoExtras, dropped).toContain(dropped);
      expect(falExtras, dropped).not.toContain(dropped);
    }
  });
});
