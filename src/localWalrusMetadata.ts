import { type WalrusBlobRecord } from "./walrus";

export type LocalWalrusFileMetadata = {
  blobId: string;
  contentType: string | null;
  fileName: string | null;
  objectId: string;
  uploadedAt: string | null;
};

export type DeletedBlobRecord = {
  blobId: string | null;
  contentType: string | null;
  deletable: boolean | null;
  digest: string | null;
  fileName: string | null;
  objectId: string;
  size: string | null;
  storedUntilEpoch: number | null;
  timestampMs: string | null;
  uploadedAt: string | null;
};

type LocalWalrusMetadataState = {
  active: LocalWalrusFileMetadata[];
  deleted: DeletedBlobRecord[];
};

const STORAGE_KEY_PREFIX = "walrus-local-metadata";

function createStorageKey(network: string, address: string) {
  return `${STORAGE_KEY_PREFIX}:${network}:${address.toLowerCase()}`;
}

function getEmptyState(): LocalWalrusMetadataState {
  return {
    active: [],
    deleted: [],
  };
}

function canUseLocalStorage() {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

function readState(network: string, address: string): LocalWalrusMetadataState {
  if (!canUseLocalStorage()) {
    return getEmptyState();
  }

  try {
    const rawValue = window.localStorage.getItem(
      createStorageKey(network, address),
    );

    if (!rawValue) {
      return getEmptyState();
    }

    const parsed = JSON.parse(rawValue) as Partial<LocalWalrusMetadataState>;

    return {
      active: Array.isArray(parsed.active) ? parsed.active : [],
      deleted: Array.isArray(parsed.deleted) ? parsed.deleted : [],
    };
  } catch {
    return getEmptyState();
  }
}

function writeState(
  network: string,
  address: string,
  state: LocalWalrusMetadataState,
) {
  if (!canUseLocalStorage()) {
    return;
  }

  window.localStorage.setItem(
    createStorageKey(network, address),
    JSON.stringify(state),
  );
}

export function listLocalWalrusFileMetadata(network: string, address: string) {
  return readState(network, address).active;
}

export function listLocalDeletedWalrusFiles(network: string, address: string) {
  return readState(network, address).deleted.sort(
    (left, right) =>
      Number(right.timestampMs ?? 0) - Number(left.timestampMs ?? 0),
  );
}

export function saveLocalWalrusFile(
  network: string,
  address: string,
  record: Pick<
    WalrusBlobRecord,
    "blobId" | "contentType" | "fileName" | "objectId" | "uploadedAt"
  >,
) {
  const current = readState(network, address);
  const active = current.active.filter(
    (item) => item.objectId !== record.objectId,
  );
  const deleted = current.deleted.filter(
    (item) => item.objectId !== record.objectId,
  );

  active.push(record);

  writeState(network, address, {
    active,
    deleted,
  });
}

export function markLocalWalrusFileDeleted(
  network: string,
  address: string,
  file: WalrusBlobRecord,
): DeletedBlobRecord {
  const current = readState(network, address);
  const deletedRecord: DeletedBlobRecord = {
    blobId: file.blobId,
    contentType: file.contentType,
    deletable: file.deletable,
    digest: null,
    fileName: file.fileName,
    objectId: file.objectId,
    size: file.size,
    storedUntilEpoch: file.storedUntilEpoch,
    timestampMs: String(Date.now()),
    uploadedAt: file.uploadedAt,
  };

  writeState(network, address, {
    active: current.active.filter((item) => item.objectId !== file.objectId),
    deleted: [
      deletedRecord,
      ...current.deleted.filter((item) => item.objectId !== file.objectId),
    ],
  });

  return deletedRecord;
}
