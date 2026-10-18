// Storage adapter interface (SPEC §9.3) — FROZEN.
export interface StorageProvider {
  id: "local" | "s3";
  /**
   * `opts.sha256` (hex) is the SHA-256 of the exact body the client will PUT. The S3
   * driver signs it as `x-amz-checksum-sha256`, so the store rejects any other body;
   * the client must send every returned header. Local storage checks at complete.
   */
  presignPut(
    key: string,
    mime: string,
    bytes: number,
    expiresSec?: number,
    opts?: { sha256?: string | null },
  ): Promise<{ url: string; headers: Record<string, string> }>;
  signedGetUrl(
    key: string,
    expiresSec?: number,
    downloadName?: string,
  ): Promise<string>;
  put(
    key: string,
    body: Uint8Array | ReadableStream,
    mime: string,
  ): Promise<void>; // server-side writes (exports, PDFs)
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  head?(key: string): Promise<{ bytes: number; mime: string } | null>;
  /**
   * Hex SHA-256 of the stored object when the driver can tell cheaply: local hashes
   * the file; S3 returns the checksum the store verified on PUT, or null when it kept
   * none (S3_CHECKSUM=off, or a store without checksum support) = unverified.
   */
  sha256?(key: string): Promise<string | null>;
}
