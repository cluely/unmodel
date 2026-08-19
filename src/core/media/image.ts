export interface SniffedImage {
  format: "png" | "jpeg" | "webp" | "gif";
  width: number;
  height: number;
  bytes: number;
}

/**
 * Zero-dep, sync image header sniffing. Reads only magic bytes and size
 * fields — never decodes pixel data. Returns undefined when the bytes are
 * not a recognizable PNG/JPEG/WebP/GIF.
 */
export function sniffImage(bytes: Uint8Array): SniffedImage | undefined {
  return sniffPng(bytes) ?? sniffJpeg(bytes) ?? sniffWebp(bytes) ?? sniffGif(bytes);
}

function u32be(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}
function u16be(b: Uint8Array, o: number): number {
  return (b[o]! << 8) | b[o + 1]!;
}
function u16le(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8);
}
function u24le(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
}

function sniffPng(b: Uint8Array): SniffedImage | undefined {
  if (b.length < 24) return undefined;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (b[i] !== sig[i]) return undefined;
  // Bytes 12-15 must be "IHDR"; width/height follow.
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return undefined;
  return { format: "png", width: u32be(b, 16), height: u32be(b, 20), bytes: b.length };
}

function sniffJpeg(b: Uint8Array): SniffedImage | undefined {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = b[offset + 1]!;
    // Standalone markers without a length segment.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01 || marker === 0xff) {
      offset += 2;
      continue;
    }
    const length = u16be(b, offset + 2);
    // SOF0-SOF15 carry dimensions, excluding DHT/JPG/DAC (C4, C8, CC).
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { format: "jpeg", height: u16be(b, offset + 5), width: u16be(b, offset + 7), bytes: b.length };
    }
    if (marker === 0xda) return undefined; // start of scan; no SOF found
    if (length < 2) return undefined;
    offset += 2 + length;
  }
  return undefined;
}

function sniffWebp(b: Uint8Array): SniffedImage | undefined {
  if (b.length < 30) return undefined;
  // "RIFF" .... "WEBP"
  if (b[0] !== 0x52 || b[1] !== 0x49 || b[2] !== 0x46 || b[3] !== 0x46) return undefined;
  if (b[8] !== 0x57 || b[9] !== 0x45 || b[10] !== 0x42 || b[11] !== 0x50) return undefined;
  const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (chunk === "VP8 ") {
    // Lossy: frame tag (3 bytes) then start code 9D 01 2A, then 14-bit dims.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return undefined;
    return {
      format: "webp",
      width: u16le(b, 26) & 0x3fff,
      height: u16le(b, 28) & 0x3fff,
      bytes: b.length,
    };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return undefined;
    const bits = u32be(b, 21); // actually LE stream; read manually below
    void bits;
    const raw = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    const width = (raw & 0x3fff) + 1;
    const height = ((raw >> 14) & 0x3fff) + 1;
    return { format: "webp", width, height, bytes: b.length };
  }
  if (chunk === "VP8X") {
    return {
      format: "webp",
      width: u24le(b, 24) + 1,
      height: u24le(b, 27) + 1,
      bytes: b.length,
    };
  }
  return undefined;
}

function sniffGif(b: Uint8Array): SniffedImage | undefined {
  if (b.length < 10) return undefined;
  // "GIF87a" or "GIF89a"
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46 || b[3] !== 0x38) return undefined;
  if ((b[4] !== 0x37 && b[4] !== 0x39) || b[5] !== 0x61) return undefined;
  return { format: "gif", width: u16le(b, 6), height: u16le(b, 8), bytes: b.length };
}
