import { walrus } from "@mysten/walrus";
import type { SuiGrpcClient } from "@mysten/sui/grpc";

const DEFAULT_PUBLISHER_URL = "https://publisher.walrus-testnet.walrus.space";
const DEFAULT_AGGREGATOR_URL = "https://aggregator.walrus-testnet.walrus.space";
const MAX_PUBLIC_UPLOAD_BYTES = 10 * 1024 * 1024;

export type WalrusBlobRecord = {
  blobId: string;
  certifiedEpoch: number | null;
  contentType: string | null;
  deletable: boolean;
  downloadUrl: string;
  fileName: string;
  objectId: string;
  registeredEpoch: number;
  size: string;
  storedUntilEpoch: number;
  uploadedAt: string | null;
};

type RawWalrusBlobObject = {
  blobId: string;
  certifiedEpoch: number | null;
  deletable: boolean;
  displayName: string | null;
  objectId: string;
  registeredEpoch: number;
  size: string;
  storedUntilEpoch: number;
};

export function getWalrusPublisherUrl() {
  return import.meta.env.VITE_WALRUS_PUBLISHER_URL ?? DEFAULT_PUBLISHER_URL;
}

export function getWalrusAggregatorUrl() {
  return import.meta.env.VITE_WALRUS_AGGREGATOR_URL ?? DEFAULT_AGGREGATOR_URL;
}

/**
 * The Walrus SDK returns blob IDs as base64url strings, but the raw Sui object
 * JSON stores blob_id as a u256 decimal integer string.  The aggregator URL
 * always expects base64url, so convert when necessary.
 *
 * Conversion mirrors the SDK's blobIdFromInt():
 *   bcs.u256().serialize(bigint)  →  little-endian 32 bytes  →  base64url
 */
export function normalizeBlobId(blobId: string): string {
  // Already base64url (contains non-digit characters)
  if (!/^\d+$/.test(blobId)) {
    return blobId;
  }

  // Decimal u256 → 32-byte BCS little-endian → base64url
  const bytes = new Uint8Array(32);
  let remaining = BigInt(blobId);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  const binary = String.fromCharCode(...bytes);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function getWalrusDownloadUrl(blobId: string) {
  return `${getWalrusAggregatorUrl()}/v1/blobs/${normalizeBlobId(blobId)}`;
}

export function getMaxPublicUploadBytes() {
  return MAX_PUBLIC_UPLOAD_BYTES;
}

export function getWalrusClient(client: SuiGrpcClient) {
  return client.$extend(walrus());
}

export function createWalrusBlobAttributes(file: File) {
  return {
    contentType: file.type || "application/octet-stream",
    fileName: file.name,
    originalSize: String(file.size),
    uploadedAt: new Date().toISOString(),
  };
}

export function getWalrusFileName(attributes: Record<string, string> | null) {
  return attributes?.fileName ?? attributes?.filename ?? null;
}

export function getWalrusContentType(
  attributes: Record<string, string> | null,
) {
  return attributes?.contentType ?? attributes?.["content-type"] ?? null;
}

export function getWalrusUploadedAt(attributes: Record<string, string> | null) {
  return attributes?.uploadedAt ?? attributes?.["uploaded-at"] ?? null;
}

export function getRawWalrusBlobObject(
  object: unknown,
): RawWalrusBlobObject | null {
  if (!object || typeof object !== "object") {
    return null;
  }

  const candidate = object as {
    display?: { output?: { name?: unknown } };
    json?: {
      blob_id?: unknown;
      certified_epoch?: unknown;
      deletable?: unknown;
      id?: unknown;
      registered_epoch?: unknown;
      size?: unknown;
      storage?: { end_epoch?: unknown };
    };
  };

  const blobId = candidate.json?.blob_id;
  const objectId = candidate.json?.id;
  const size = candidate.json?.size;
  const registeredEpoch = candidate.json?.registered_epoch;
  const storedUntilEpoch = candidate.json?.storage?.end_epoch;
  const deletable = candidate.json?.deletable;
  const certifiedEpoch = candidate.json?.certified_epoch;
  const displayName = candidate.display?.output?.name;

  if (
    typeof blobId !== "string" ||
    typeof objectId !== "string" ||
    typeof size !== "string" ||
    typeof registeredEpoch !== "number" ||
    typeof storedUntilEpoch !== "number" ||
    typeof deletable !== "boolean"
  ) {
    return null;
  }

  return {
    blobId,
    certifiedEpoch: typeof certifiedEpoch === "number" ? certifiedEpoch : null,
    deletable,
    displayName: typeof displayName === "string" ? displayName : null,
    objectId,
    registeredEpoch,
    size,
    storedUntilEpoch,
  };
}

export function isObjectNotFoundError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /not found/i.test(error.message);
}

export function formatBytes(rawBytes: string) {
  const bytes = Number(rawBytes);

  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatBlobLabel(blobId: string) {
  return `blob-${blobId.slice(0, 10)}`;
}
