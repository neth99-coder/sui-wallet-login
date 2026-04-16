/**
 * Compute the SHA-256 digest of `data` and return it as a lower-case hex
 * string, e.g. `"e3b0c44298fc1c149afb..."`.
 */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf: ArrayBuffer = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
  const hashBuffer = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(hashBuffer);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
