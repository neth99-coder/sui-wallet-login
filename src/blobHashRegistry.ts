/**
 * On-chain blob hash registry utilities.
 *
 * Uploaders call `buildRegisterHashTransaction` and submit it with their
 * wallet — a `HashRegistered` event is emitted on-chain.
 *
 * Verifiers (no wallet required) call `queryAllBlobHashes` which pages
 * through all `HashRegistered` events via free Sui RPC read calls.
 */

import { Transaction } from "@mysten/sui/transactions";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";

export const BLOB_HASH_MODULE = "blob_hash_registry";
export const REGISTER_HASH_FUNCTION = "register_hash";

export type HashEntry = {
  blobId: string;
  objectId: string;
  sha256Hex: string;
  fileName: string;
  uploader: string;
  timestampMs: string | null;
};

// ---------------------------------------------------------------------------
// Write (requires connected wallet)
// ---------------------------------------------------------------------------

/**
 * Build a `Transaction` that registers a SHA-256 hash on-chain by emitting
 * a `HashRegistered` event.  Pass the returned transaction to
 * `signAndExecuteTransaction`.
 */
export function buildRegisterHashTransaction(
  packageId: string,
  blobId: string,
  objectId: string,
  sha256Hex: string,
  fileName: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::${BLOB_HASH_MODULE}::${REGISTER_HASH_FUNCTION}`,
    arguments: [
      tx.pure.string(blobId),
      tx.pure.string(objectId),
      tx.pure.string(sha256Hex),
      tx.pure.string(fileName),
    ],
  });
  return tx;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

type RawParsedJson = {
  blob_id?: unknown;
  object_id?: unknown;
  sha256_hex?: unknown;
  file_name?: unknown;
  uploader?: unknown;
};

function parseHashEntry(
  parsedJson: unknown,
  sender: string,
  timestampMs: string | null | undefined,
): HashEntry | null {
  if (!parsedJson || typeof parsedJson !== "object") {
    return null;
  }

  const raw = parsedJson as RawParsedJson;

  if (
    typeof raw.blob_id !== "string" ||
    typeof raw.object_id !== "string" ||
    typeof raw.sha256_hex !== "string" ||
    typeof raw.file_name !== "string" ||
    typeof raw.uploader !== "string"
  ) {
    return null;
  }

  return {
    blobId: raw.blob_id,
    objectId: raw.object_id,
    sha256Hex: raw.sha256_hex,
    fileName: raw.file_name,
    uploader: raw.uploader || sender,
    timestampMs: timestampMs ?? null,
  };
}

/**
 * Fetch every `HashRegistered` event for the given package from the Sui
 * network and return them as `HashEntry` records.
 */
export async function queryAllBlobHashes(
  packageId: string,
  rpcUrl: string,
): Promise<HashEntry[]> {
  const rpcClient = new SuiJsonRpcClient({
    network: "testnet",
    url: rpcUrl,
  });

  const eventType = `${packageId}::${BLOB_HASH_MODULE}::HashRegistered`;
  const entries: HashEntry[] = [];
  let cursor: { eventSeq: string; txDigest: string } | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const page = await rpcClient.queryEvents({
      query: { MoveEventType: eventType },
      cursor: cursor ?? undefined,
      limit: 100,
      order: "ascending",
    });

    for (const event of page.data) {
      const parsedJson = "parsedJson" in event ? event.parsedJson : undefined;
      const sender = "sender" in event ? (event.sender as string) : "";
      const timestampMs =
        "timestampMs" in event
          ? (event.timestampMs as string | null | undefined)
          : undefined;

      const entry = parseHashEntry(parsedJson, sender, timestampMs);
      if (entry) {
        entries.push(entry);
      }
    }

    cursor = page.nextCursor as { eventSeq: string; txDigest: string } | null;
    hasNextPage = page.hasNextPage;
  }

  return entries;
}
