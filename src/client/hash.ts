// Hex SHA-256 via SubtleCrypto (secure contexts: https or localhost). Kept apart from
// image.ts so the upload path can hash without pulling in the photo pipeline.

export async function sha256Hex(data: Blob | ArrayBuffer): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
