/**
 * Best-effort sync extraction of raw bytes from the media shapes that appear
 * inline in provider params. Returns undefined for anything that would need
 * I/O (URLs, Blobs — Blob reading is async and not worth infecting the sync
 * validation path; Blobs are currently skipped entirely, no `.size`/`.type`
 * validation exists yet).
 */
export function toBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === "string") {
    const base64 = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
    return base64ToBytes(base64);
  }
  return undefined;
}

export function base64ToBytes(base64: string): Uint8Array | undefined {
  const trimmed = base64.trim();
  // Reject strings that clearly aren't base64 (e.g. URLs, plain text with spaces).
  if (trimmed.length < 8 || !/^[A-Za-z0-9+/=_-]+$/.test(trimmed)) return undefined;
  try {
    const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}
