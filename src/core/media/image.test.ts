import { describe, expect, test } from "bun:test";
import { sniffImage } from "./image";
import { base64ToBytes, toBytes } from "./bytes";

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

function jpeg(width: number, height: number): Uint8Array {
  // FF D8, then a SOF0 segment directly.
  const b = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0, 0]);
  new DataView(b.buffer).setUint16(7, height);
  new DataView(b.buffer).setUint16(9, width);
  return b;
}

function gif(width: number, height: number): Uint8Array {
  const b = new Uint8Array(10);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
  new DataView(b.buffer).setUint16(6, width, true);
  new DataView(b.buffer).setUint16(8, height, true);
  return b;
}

function webpVp8x(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46]); // RIFF
  b.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  b.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
  const w = width - 1;
  const h = height - 1;
  b[24] = w & 0xff;
  b[25] = (w >> 8) & 0xff;
  b[26] = (w >> 16) & 0xff;
  b[27] = h & 0xff;
  b[28] = (h >> 8) & 0xff;
  b[29] = (h >> 16) & 0xff;
  return b;
}

describe("sniffImage", () => {
  test("png dimensions", () => {
    expect(sniffImage(png(1024, 768))).toEqual({ format: "png", width: 1024, height: 768, bytes: 24 });
  });

  test("jpeg dimensions via SOF0", () => {
    expect(sniffImage(jpeg(640, 480))).toMatchObject({ format: "jpeg", width: 640, height: 480 });
  });

  test("gif dimensions", () => {
    expect(sniffImage(gif(320, 240))).toMatchObject({ format: "gif", width: 320, height: 240 });
  });

  test("webp VP8X canvas dimensions", () => {
    expect(sniffImage(webpVp8x(2048, 1536))).toMatchObject({ format: "webp", width: 2048, height: 1536 });
  });

  test("unknown bytes return undefined", () => {
    expect(sniffImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeUndefined();
    expect(sniffImage(new Uint8Array(0))).toBeUndefined();
  });
});

describe("toBytes", () => {
  test("decodes base64 and data URLs", () => {
    const bytes = png(10, 10);
    const base64 = Buffer.from(bytes).toString("base64");
    expect(toBytes(base64)).toEqual(bytes);
    expect(toBytes(`data:image/png;base64,${base64}`)).toEqual(bytes);
  });

  test("passes through byte shapes", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(toBytes(bytes)).toBe(bytes);
    expect(toBytes(bytes.buffer)).toEqual(bytes);
  });

  test("rejects non-base64 strings without throwing", () => {
    expect(base64ToBytes("https://example.com/cat.png")).toBeUndefined();
    expect(base64ToBytes("hello world this is text")).toBeUndefined();
  });
});
