import {
  SealClient,
  SessionKey,
  type KeyServerConfig,
  type SealCompatibleClient,
} from "@mysten/seal";
import {
  Transaction,
  type TransactionArgument,
} from "@mysten/sui/transactions";

export const DEFAULT_TESTNET_SEAL_SERVER_CONFIGS: KeyServerConfig[] = [
  {
    objectId:
      "0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98",
    aggregatorUrl: "https://seal-aggregator-testnet.mystenlabs.com",
    weight: 1,
  },
];

export type SealSigner = {
  signPersonalMessage(args: { message: Uint8Array }): Promise<{
    signature: string;
  }>;
};

type SealClientOptions = {
  serverConfigs?: KeyServerConfig[];
  timeout?: number;
  verifyKeyServers?: boolean;
};

type EncryptWithSealArgs = SealClientOptions & {
  aad?: Uint8Array;
  data: Uint8Array;
  id: string;
  packageId: string;
  suiClient: SealCompatibleClient;
  threshold?: number;
};

type CreateSessionKeyArgs = {
  address: string;
  dAppKit: SealSigner;
  mvrName?: string;
  packageId: string;
  suiClient: SealCompatibleClient;
  ttlMin?: number;
};

type DecryptWithSealArgs = SealClientOptions & {
  address?: string;
  checkLEEncoding?: boolean;
  checkShareConsistency?: boolean;
  dAppKit?: SealSigner;
  encryptedBytes: Uint8Array;
  mvrName?: string;
  packageId?: string;
  sessionKey?: SessionKey;
  suiClient: SealCompatibleClient;
  ttlMin?: number;
  txBytes: Uint8Array;
};

type CreateApprovalTransactionArgs = {
  additionalArguments?: (tx: Transaction) => TransactionArgument[];
  functionName?: string;
  idBytes: Uint8Array;
  moduleName: string;
  packageId: string;
};

export function createSealClient(
  suiClient: SealCompatibleClient,
  options: SealClientOptions = {},
) {
  return new SealClient({
    serverConfigs: options.serverConfigs ?? DEFAULT_TESTNET_SEAL_SERVER_CONFIGS,
    suiClient,
    timeout: options.timeout,
    verifyKeyServers: options.verifyKeyServers ?? false,
  });
}

export async function encryptWithSeal({
  aad,
  data,
  id,
  packageId,
  serverConfigs,
  suiClient,
  threshold = 1,
  timeout,
  verifyKeyServers,
}: EncryptWithSealArgs) {
  const sealClient = createSealClient(suiClient, {
    serverConfigs,
    timeout,
    verifyKeyServers,
  });

  return sealClient.encrypt({
    aad,
    data,
    id,
    packageId,
    threshold,
  });
}

export async function createWalletBackedSessionKey({
  address,
  dAppKit,
  mvrName,
  packageId,
  suiClient,
  ttlMin = 10,
}: CreateSessionKeyArgs) {
  const sessionKey = await SessionKey.create({
    address,
    mvrName,
    packageId,
    suiClient,
    ttlMin,
  });

  const { signature } = await dAppKit.signPersonalMessage({
    message: sessionKey.getPersonalMessage(),
  });

  await sessionKey.setPersonalMessageSignature(signature);

  return sessionKey;
}

export function createSealApprovalTransaction({
  additionalArguments,
  functionName = "seal_approve",
  idBytes,
  moduleName,
  packageId,
}: CreateApprovalTransactionArgs) {
  const tx = new Transaction();

  tx.moveCall({
    target: `${packageId}::${moduleName}::${functionName}`,
    arguments: [
      tx.pure.vector("u8", Array.from(idBytes)),
      ...(additionalArguments?.(tx) ?? []),
    ],
  });

  return tx;
}

export async function buildTransactionKindBytes(
  suiClient: SealCompatibleClient,
  transaction: Transaction,
) {
  return transaction.build({ client: suiClient, onlyTransactionKind: true });
}

export async function decryptWithSeal({
  address,
  checkLEEncoding,
  checkShareConsistency,
  dAppKit,
  encryptedBytes,
  mvrName,
  packageId,
  serverConfigs,
  sessionKey,
  suiClient,
  timeout,
  ttlMin,
  txBytes,
  verifyKeyServers,
}: DecryptWithSealArgs) {
  const sealClient = createSealClient(suiClient, {
    serverConfigs,
    timeout,
    verifyKeyServers,
  });

  const resolvedSessionKey =
    sessionKey ??
    (await createWalletBackedSessionKey({
      address: requiredValue(address, "address"),
      dAppKit: requiredValue(dAppKit, "dAppKit"),
      mvrName,
      packageId: requiredValue(packageId, "packageId"),
      suiClient,
      ttlMin,
    }));

  return sealClient.decrypt({
    checkLEEncoding,
    checkShareConsistency,
    data: encryptedBytes,
    sessionKey: resolvedSessionKey,
    txBytes,
  });
}

export function hexStringToBytes(hex: string): Uint8Array {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;

  if (normalized.length === 0) {
    return new Uint8Array();
  }

  if (normalized.length % 2 !== 0 || /[^\da-f]/i.test(normalized)) {
    throw new Error("Expected an even-length hex string.");
  }

  const bytes = new Uint8Array(normalized.length / 2);

  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }

  return bytes;
}

function requiredValue<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Missing required Seal option: ${name}`);
  }

  return value;
}
