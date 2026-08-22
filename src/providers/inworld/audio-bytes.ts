/**
 * The one byte-arithmetic helper three Inworld surfaces share — sync STT
 * (16 MB cap), voice cloning (4MB per sample) and, transitively, voice
 * design. Its own import-free leaf so the voice-creation packs can size a
 * base64 payload without paying for the STT validator it used to live in.
 */

/**
 * Decoded byte length of a base64 payload, computed arithmetically. Decoding
 * would materialise up to 16 MB of audio on every validation just to read
 * `.length`; the length of the encoded text plus its padding says the same
 * thing for free. Returns undefined when the string is not base64 at all
 * (a URL, a data: prefix someone forgot to strip) — a shape unmodel cannot
 * measure is not a shape it should report a size for.
 */
export function decodedBase64Bytes(content: string): number | undefined {
  const trimmed = content.trim();
  if (trimmed.length === 0) return undefined;
  // Standard and URL-safe alphabets, with optional padding.
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) return undefined;
  const padding = /=*$/.exec(trimmed)?.[0].length ?? 0;
  return Math.floor((trimmed.length * 3) / 4) - padding;
}

