import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useCurrentAccount,
  useCurrentClient,
  useCurrentNetwork,
  useDAppKit,
  useWallets,
} from "@mysten/dapp-kit-react";
import { isEnokiWallet, isGoogleWallet } from "@mysten/enoki";

import "./App.css";
import {
  createWalrusBlobAttributes,
  formatBlobLabel,
  formatBytes,
  getMaxPublicUploadBytes,
  getRawWalrusBlobObject,
  getWalrusAggregatorUrl,
  getWalrusClient,
  getWalrusContentType,
  getWalrusDownloadUrl,
  getWalrusFileName,
  getWalrusPublisherUrl,
  isObjectNotFoundError,
  type WalrusBlobRecord,
} from "./walrus";

type BalanceRow = {
  balance: string;
  coinType: string;
  decimals: number;
  name: string;
  symbol: string;
};

type UploadFeedback =
  | {
      blobId: string;
      kind: "already-certified";
      storedUntilEpoch: number;
      txDigest: string | null;
    }
  | {
      blobId: string;
      kind: "newly-created";
      objectId: string;
      storedUntilEpoch: number;
    };

type UploadResponse = {
  alreadyCertified?: {
    blobId: string;
    endEpoch: number;
    event?: {
      eventSeq: string;
      txDigest: string;
    };
  };
  newlyCreated?: {
    blobObject: {
      blobId: string;
      id: string;
      storage: {
        endEpoch: number;
      };
    };
  };
};

const isConfigured = Boolean(
  import.meta.env.VITE_ENOKI_API_KEY && import.meta.env.VITE_GOOGLE_CLIENT_ID,
);

const walrusPublisherUrl = getWalrusPublisherUrl();
const walrusAggregatorUrl = getWalrusAggregatorUrl();
const maxUploadBytes = getMaxPublicUploadBytes();

function App() {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const currentNetwork = useCurrentNetwork();
  const dAppKit = useDAppKit();
  const wallets = useWallets();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadEpochs, setUploadEpochs] = useState("1");
  const [isUploadDeletable, setIsUploadDeletable] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState<UploadFeedback | null>(
    null,
  );

  const walrusClient = useMemo(() => getWalrusClient(client), [client]);

  const googleWallet = useMemo(
    () => wallets.filter(isEnokiWallet).find(isGoogleWallet) ?? null,
    [wallets],
  );

  const balancesQuery = useQuery({
    queryKey: ["balances", currentNetwork, account?.address],
    enabled: Boolean(account),
    queryFn: async (): Promise<BalanceRow[]> => {
      if (!account) {
        return [];
      }

      const { balances } = await client.listBalances({
        owner: account.address,
      });

      const rows = await Promise.all(
        balances.map(async (balance) => {
          const metadataResponse = await client
            .getCoinMetadata({ coinType: balance.coinType })
            .catch(() => ({ coinMetadata: null }));

          const metadata = metadataResponse.coinMetadata;
          const fallbackSymbol = balance.coinType.split("::").at(-1) ?? "TOKEN";

          return {
            balance: balance.balance,
            coinType: balance.coinType,
            decimals: metadata?.decimals ?? 0,
            name: metadata?.name ?? fallbackSymbol,
            symbol: metadata?.symbol ?? fallbackSymbol,
          };
        }),
      );

      return rows.sort((left, right) =>
        Number(BigInt(right.balance) - BigInt(left.balance)),
      );
    },
  });

  const walrusFilesQuery = useQuery({
    queryKey: ["walrus-files", currentNetwork, account?.address],
    enabled: Boolean(account),
    queryFn: async (): Promise<WalrusBlobRecord[]> => {
      if (!account) {
        return [];
      }

      const blobType = await walrusClient.walrus.getBlobType();
      const ownedObjectIds: string[] = [];
      let cursor: string | null = null;
      let hasNextPage = true;

      while (hasNextPage) {
        const listResponse: {
          cursor: string | null;
          hasNextPage: boolean;
          objects: Array<{ objectId: string }>;
        } = await client.listOwnedObjects({
          owner: account.address,
          type: blobType,
          cursor,
          limit: 100,
        });

        ownedObjectIds.push(
          ...listResponse.objects.map((object) => object.objectId),
        );
        cursor = listResponse.cursor;
        hasNextPage = listResponse.hasNextPage;
      }

      const rows: Array<WalrusBlobRecord | null> = await Promise.all(
        ownedObjectIds.map(async (objectId) => {
          try {
            let blobObject: {
              blob_id: string;
              certified_epoch: number | null;
              deletable: boolean;
              id: string;
              registered_epoch: number;
              size: string;
              storage: { end_epoch: number };
            } | null = null;

            try {
              blobObject = await walrusClient.walrus.getBlobObject(objectId);
            } catch (error) {
              const { object } = await client.getObject({
                objectId,
                include: { display: true, json: true },
              });
              const rawBlobObject = getRawWalrusBlobObject(object);

              if (!rawBlobObject) {
                if (isObjectNotFoundError(error)) {
                  return null;
                }

                throw error;
              }

              blobObject = {
                blob_id: rawBlobObject.blobId,
                certified_epoch: rawBlobObject.certifiedEpoch,
                deletable: rawBlobObject.deletable,
                id: rawBlobObject.objectId,
                registered_epoch: rawBlobObject.registeredEpoch,
                size: rawBlobObject.size,
                storage: {
                  end_epoch: rawBlobObject.storedUntilEpoch,
                },
              };
            }

            let attributes: Record<string, string> | null = null;

            try {
              attributes = await walrusClient.walrus.readBlobAttributes({
                blobObjectId: objectId,
              });
            } catch {
              attributes = null;
            }

            const fileName =
              getWalrusFileName(attributes) ??
              formatBlobLabel(blobObject.blob_id);
            const contentType = getWalrusContentType(attributes);

            return {
              blobId: blobObject.blob_id,
              certifiedEpoch: blobObject.certified_epoch,
              contentType,
              deletable: blobObject.deletable,
              downloadUrl: getWalrusDownloadUrl(blobObject.blob_id),
              fileName,
              objectId: blobObject.id,
              registeredEpoch: blobObject.registered_epoch,
              size: blobObject.size,
              storedUntilEpoch: blobObject.storage.end_epoch,
            } satisfies WalrusBlobRecord;
          } catch (error) {
            if (isObjectNotFoundError(error)) {
              return null;
            }

            throw error;
          }
        }),
      );

      return rows
        .filter((row): row is WalrusBlobRecord => row !== null)
        .sort((left, right) => Number(BigInt(right.size) - BigInt(left.size)));
    },
  });

  async function handleGoogleLogin() {
    if (!googleWallet) {
      return;
    }

    setLoginError(null);
    setIsSigningIn(true);

    try {
      const result = await dAppKit.connectWallet({ wallet: googleWallet });

      if (!result.accounts.length) {
        setLoginError(
          "Google sign-in finished, but no wallet account was returned. Check the Enoki allow list and your Google redirect URI configuration.",
        );
      }
    } catch (error) {
      setLoginError(formatLoginError(error));
    } finally {
      setIsSigningIn(false);
    }
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    setUploadError(null);
    setUploadFeedback(null);
    setUploadFile(event.target.files?.[0] ?? null);
  }

  async function delay(milliseconds: number) {
    await new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function refreshWalrusFilesUntilVisible(objectId: string) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await walrusFilesQuery.refetch();

      if (result.data?.some((file) => file.objectId === objectId)) {
        return;
      }

      if (attempt < 3) {
        await delay(1200);
      }
    }
  }

  async function persistWalrusMetadataOnSui(objectId: string, file: File) {
    const transaction =
      await walrusClient.walrus.writeBlobAttributesTransaction({
        attributes: createWalrusBlobAttributes(file),
        blobObjectId: objectId,
      });

    await dAppKit.signAndExecuteTransaction({ transaction });
  }

  async function handleWalrusUpload() {
    if (!account || !uploadFile) {
      return;
    }

    if (uploadFile.size > maxUploadBytes) {
      setUploadError(
        `Public Walrus publishers usually cap uploads at ${formatBytes(String(maxUploadBytes))}. Choose a smaller file or run your own publisher.`,
      );
      return;
    }

    const epochs = Number(uploadEpochs);

    if (!Number.isInteger(epochs) || epochs < 1) {
      setUploadError(
        "Epochs must be a whole number greater than or equal to 1.",
      );
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setUploadFeedback(null);

    try {
      const searchParams = new URLSearchParams({
        epochs: String(epochs),
        send_object_to: account.address,
      });

      if (isUploadDeletable) {
        searchParams.set("deletable", "true");
      } else {
        searchParams.set("permanent", "true");
      }

      const response = await fetch(
        `${walrusPublisherUrl}/v1/blobs?${searchParams.toString()}`,
        {
          method: "PUT",
          body: uploadFile,
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          errorText || `Upload failed with status ${response.status}`,
        );
      }

      const payload = (await response.json()) as UploadResponse;

      const newlyCreatedBlob = payload.newlyCreated?.blobObject;
      const alreadyCertifiedBlob = payload.alreadyCertified;
      const newObjectId = newlyCreatedBlob?.id;

      if (newlyCreatedBlob && newObjectId) {
        await persistWalrusMetadataOnSui(newObjectId, uploadFile);

        setUploadFeedback({
          blobId: newlyCreatedBlob.blobId,
          kind: "newly-created",
          objectId: newObjectId,
          storedUntilEpoch: newlyCreatedBlob.storage.endEpoch,
        });

        await refreshWalrusFilesUntilVisible(newObjectId);
      } else {
        await walrusFilesQuery.refetch();
      }

      if (alreadyCertifiedBlob) {
        setUploadFeedback({
          blobId: alreadyCertifiedBlob.blobId,
          kind: "already-certified",
          storedUntilEpoch: alreadyCertifiedBlob.endEpoch,
          txDigest: alreadyCertifiedBlob.event?.txDigest ?? null,
        });
      }

      setUploadFile(null);
      setUploadEpochs("1");
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  function formatLoginError(error: unknown) {
    if (!(error instanceof Error)) {
      return "Unknown login error";
    }

    const clientError = error as Error & {
      code?: string;
      status?: number;
      cause?: unknown;
      errors?: Array<{ code?: string; message?: string }>;
    };

    const detail =
      clientError.errors?.[0]?.message ??
      (clientError.cause instanceof Error ? clientError.cause.message : null);

    const code = clientError.errors?.[0]?.code ?? clientError.code;

    if (detail && code) {
      return `${error.message} [${code}] ${detail}`;
    }

    if (detail) {
      return `${error.message}: ${detail}`;
    }

    return error.message;
  }
  async function handleLogout() {
    setLoginError(null);
    await dAppKit.disconnectWallet();
  }

  async function handleDownload(
    url: string,
    fileName: string,
    contentType: string | null,
  ) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const headerMime =
      contentType ?? response.headers.get("content-type") ?? null;
    // If stored type is generic/absent, sniff the actual bytes
    const mimeType =
      !headerMime || headerMime === "application/octet-stream"
        ? (sniffMimeType(arrayBuffer) ??
          headerMime ??
          "application/octet-stream")
        : headerMime;
    const blob = new Blob([arrayBuffer], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = ensureExtension(fileName, mimeType);
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(objectUrl);
  }

  const walrusEpochQuery = useQuery({
    queryKey: ["walrus-epoch", currentNetwork],
    enabled: Boolean(account),
    queryFn: async (): Promise<number> => {
      const state = await walrusClient.walrus.stakingState();
      return state.epoch;
    },
  });

  const currentEpoch = walrusEpochQuery.data ?? null;
  const allFiles = walrusFilesQuery.data ?? [];
  const activeFiles =
    currentEpoch !== null
      ? allFiles.filter((f) => f.storedUntilEpoch >= currentEpoch)
      : allFiles;
  const expiredFiles =
    currentEpoch !== null
      ? allFiles.filter((f) => f.storedUntilEpoch < currentEpoch)
      : [];
  const totalFiles = allFiles.length;
  const totalAssets = balancesQuery.data?.length ?? 0;

  return (
    <div className="app-root">
      {/* Top navigation */}
      <nav className="topnav">
        <div className="topnav-brand">
          <span className="brand-mark" aria-hidden="true">
            ◈
          </span>
          <span className="brand-name">Walrus Vault</span>
        </div>
        <div className="topnav-right">
          <span className="badge-network">{currentNetwork}</span>
          {account ? (
            <>
              <span className="topnav-address mono">
                {shortenAddress(account.address)}
              </span>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => void handleLogout()}
              >
                Sign out
              </button>
            </>
          ) : null}
        </div>
      </nav>

      {/* Not configured warning */}
      {!isConfigured ? (
        <div className="page-content">
          <div className="alert alert-warning">
            <strong>Missing environment variables</strong>
            <p>
              Add <code>VITE_ENOKI_API_KEY</code> and{" "}
              <code>VITE_GOOGLE_CLIENT_ID</code> in <code>.env</code>.
            </p>
          </div>
        </div>
      ) : null}

      {/* Login page */}
      {isConfigured && !account ? (
        <div className="login-page">
          <div className="login-card">
            <div className="login-mark" aria-hidden="true">
              ◈
            </div>
            <h1 className="login-title">Walrus Vault</h1>
            <p className="login-sub">
              Decentralized file storage on Sui&rsquo;s Walrus protocol
            </p>
            <button
              className="btn btn-black btn-large btn-google"
              disabled={!googleWallet || !isConfigured || isSigningIn}
              onClick={() => void handleGoogleLogin()}
            >
              <span className="google-mark" aria-hidden="true">
                G
              </span>
              {isSigningIn ? "Signing in\u2026" : "Continue with Google"}
            </button>
            {!googleWallet && isConfigured ? (
              <p className="hint-text">Registering wallet provider\u2026</p>
            ) : null}
            {loginError ? <p className="feedback-error">{loginError}</p> : null}
          </div>
        </div>
      ) : null}

      {/* Dashboard */}
      {account ? (
        <div className="page-content">
          {/* Address bar */}
          <div className="address-bar">
            <div className="address-bar-left">
              <span className="address-bar-label">Wallet</span>
              <span className="address-bar-value mono break">
                {account.address}
              </span>
            </div>
            <div className="address-bar-stats">
              <div className="stat-item">
                <span className="stat-num">{totalFiles}</span>
                <span className="stat-lbl">files</span>
              </div>
              <div className="stat-sep" />
              <div className="stat-item">
                <span className="stat-num">{totalAssets}</span>
                <span className="stat-lbl">assets</span>
              </div>
            </div>
          </div>

          {/* Workspace */}
          <div className="workspace">
            {/* Left sidebar: upload + assets */}
            <div className="workspace-side">
              {/* Upload */}
              <section className="card">
                <div className="card-header">
                  <h2>Upload</h2>
                </div>
                <div className="upload-form">
                  <div className="form-field">
                    <label className="field-label" htmlFor="walrus-file-input">
                      File
                    </label>
                    <input
                      id="walrus-file-input"
                      className="text-input"
                      type="file"
                      onChange={handleFileSelection}
                    />
                  </div>

                  {uploadFile ? (
                    <div className="selected-file">
                      <span className="selected-name mono">
                        {uploadFile.name}
                      </span>
                      <span className="selected-size">
                        {formatBytes(String(uploadFile.size))}
                      </span>
                    </div>
                  ) : null}

                  <div className="form-row">
                    <div className="form-field">
                      <label
                        className="field-label"
                        htmlFor="walrus-epochs-input"
                      >
                        Epochs
                        <span
                          className="info-tip"
                          aria-label={`One epoch is ~24 hours on Walrus. Your file stays stored for this many epochs from now.${
                            currentEpoch !== null
                              ? ` Current epoch: ${currentEpoch}.`
                              : ""
                          } E.g. entering 5 stores it for ~5 days.`}
                        >
                          ⓘ
                        </span>
                      </label>
                      <input
                        id="walrus-epochs-input"
                        className="text-input"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        value={uploadEpochs}
                        onChange={(event) =>
                          setUploadEpochs(event.target.value)
                        }
                      />
                    </div>
                    <label
                      className="toggle-field"
                      htmlFor="walrus-deletable-toggle"
                    >
                      <input
                        id="walrus-deletable-toggle"
                        type="checkbox"
                        checked={isUploadDeletable}
                        onChange={(event) =>
                          setIsUploadDeletable(event.target.checked)
                        }
                      />
                      <span>Deletable</span>
                    </label>
                  </div>

                  <button
                    className="btn btn-black"
                    disabled={!uploadFile || isUploading}
                    onClick={() => void handleWalrusUpload()}
                  >
                    {isUploading ? "Uploading\u2026" : "Upload to Walrus"}
                  </button>

                  {uploadError ? (
                    <p className="feedback-error">{uploadError}</p>
                  ) : null}

                  {uploadFeedback?.kind === "newly-created" ? (
                    <p className="feedback-success">
                      Uploaded. Blob{" "}
                      <span className="mono">
                        {uploadFeedback.blobId.slice(0, 20)}\u2026
                      </span>{" "}
                      stored until epoch {uploadFeedback.storedUntilEpoch}.
                    </p>
                  ) : null}

                  {uploadFeedback?.kind === "already-certified" ? (
                    <p className="feedback-info">
                      Already stored. Blob{" "}
                      <span className="mono">
                        {uploadFeedback.blobId.slice(0, 20)}\u2026
                      </span>{" "}
                      until epoch {uploadFeedback.storedUntilEpoch}.
                    </p>
                  ) : null}
                </div>

                <div className="endpoints">
                  <div className="endpoint-row">
                    <span className="endpoint-label">Publisher</span>
                    <span className="endpoint-url mono">
                      {walrusPublisherUrl}
                    </span>
                  </div>
                  <div className="endpoint-row">
                    <span className="endpoint-label">Aggregator</span>
                    <span className="endpoint-url mono">
                      {walrusAggregatorUrl}
                    </span>
                  </div>
                  <p className="hint-text">
                    Max {formatBytes(String(maxUploadBytes))} per file
                  </p>
                </div>
              </section>

              {/* Assets */}
              <section className="card">
                <div className="card-header">
                  <h2>
                    Assets
                    {totalAssets > 0 ? (
                      <span className="count-badge">{totalAssets}</span>
                    ) : null}
                  </h2>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void balancesQuery.refetch()}
                    title="Refresh balances"
                  >
                    ↻ Refresh
                  </button>
                </div>

                {balancesQuery.isPending ? (
                  <p className="state-text">Loading\u2026</p>
                ) : null}

                {balancesQuery.isError ? (
                  <p className="state-text state-error">
                    {(balancesQuery.error as Error).message}
                  </p>
                ) : null}

                {!balancesQuery.isPending && !balancesQuery.isError ? (
                  balancesQuery.data && balancesQuery.data.length > 0 ? (
                    <div className="asset-list">
                      {balancesQuery.data.map((balance) => (
                        <article className="asset-row" key={balance.coinType}>
                          <div className="asset-row-name">
                            <span className="asset-symbol">
                              {balance.symbol}
                            </span>
                            <span className="asset-coin-type mono break">
                              {balance.coinType}
                            </span>
                          </div>
                          <span className="asset-amount mono">
                            {formatBalance(balance.balance, balance.decimals)}
                          </span>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="state-text">No assets on {currentNetwork}.</p>
                  )
                ) : null}
              </section>
            </div>

            {/* Files panel */}
            <section className="card files-panel">
              <div className="card-header">
                <h2>
                  Files
                  {totalFiles > 0 ? (
                    <span className="count-badge">{totalFiles}</span>
                  ) : null}
                </h2>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => void walrusFilesQuery.refetch()}
                >
                  ↻ Refresh
                </button>
              </div>

              {walrusFilesQuery.isPending ? (
                <p className="state-text">Loading files\u2026</p>
              ) : null}

              {walrusFilesQuery.isError ? (
                <p className="state-text state-error">
                  {(walrusFilesQuery.error as Error).message}
                </p>
              ) : null}

              {!walrusFilesQuery.isPending && !walrusFilesQuery.isError ? (
                allFiles.length > 0 ? (
                  <div className="file-list">
                    {activeFiles.map((file) => (
                      <article className="file-row" key={file.objectId}>
                        <div className="file-row-info">
                          <span className="file-name">
                            {file.objectId.slice(0, 4) +
                              " ... " +
                              file.objectId.slice(-4)}
                          </span>
                          <span className="file-blob-id mono">
                            {file.blobId.slice(0, 28)}\u2026
                          </span>
                        </div>
                        <div className="file-row-meta">
                          {file.contentType ? (
                            <span className="badge-type">
                              {file.contentType}
                            </span>
                          ) : null}
                          <span className="file-size">
                            {formatBytes(file.size)}
                          </span>
                          <span className="file-epoch">
                            ep.{file.storedUntilEpoch}
                            {currentEpoch !== null ? (
                              <span
                                className="info-tip"
                                aria-label={`Expires at Walrus epoch ${file.storedUntilEpoch}. Current epoch: ${currentEpoch}. ${file.storedUntilEpoch - currentEpoch} epoch(s) (~${file.storedUntilEpoch - currentEpoch} day(s)) remaining.`}
                              >
                                ⓘ
                              </span>
                            ) : null}
                          </span>
                          <span
                            className={`badge-mode ${file.deletable ? "badge-del" : "badge-perm"}`}
                          >
                            {file.deletable ? "deletable" : "permanent"}
                          </span>
                        </div>
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() =>
                            void handleDownload(
                              file.downloadUrl,
                              file.fileName !==
                                `blob-${file.blobId.slice(0, 10)}`
                                ? file.fileName
                                : file.objectId,
                              file.contentType,
                            )
                          }
                        >
                          ↓
                        </button>
                      </article>
                    ))}
                    {expiredFiles.length > 0 ? (
                      <>
                        <div className="file-section-divider">
                          <span>Expired</span>
                        </div>
                        {expiredFiles.map((file) => (
                          <article
                            className="file-row file-row-expired"
                            key={file.objectId}
                          >
                            <div className="file-row-info">
                              <span className="file-name">
                                {file.objectId.slice(0, 4) +
                                  " ... " +
                                  file.objectId.slice(-4)}
                              </span>
                              <span className="file-blob-id mono">
                                {file.blobId.slice(0, 28)}\u2026
                              </span>
                            </div>
                            <div className="file-row-meta">
                              {file.contentType ? (
                                <span className="badge-type">
                                  {file.contentType}
                                </span>
                              ) : null}
                              <span className="file-size">
                                {formatBytes(file.size)}
                              </span>
                              <span className="file-epoch file-epoch-expired">
                                ep.{file.storedUntilEpoch}
                                <span
                                  className="info-tip"
                                  aria-label={`Storage ended at epoch ${file.storedUntilEpoch}. Current epoch: ${currentEpoch ?? "unknown"}. The blob object still exists on Sui but the data may no longer be retrievable.`}
                                >
                                  ⓘ
                                </span>
                              </span>
                              <span className="badge-mode badge-expired">
                                expired
                              </span>
                            </div>
                            <button
                              className="btn btn-outline btn-sm"
                              disabled
                              title="Storage epoch has ended"
                            >
                              ↓
                            </button>
                          </article>
                        ))}
                      </>
                    ) : null}
                  </div>
                ) : (
                  <p className="state-text">No files found for this address.</p>
                )
              ) : null}
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatBalance(balance: string, decimals: number) {
  const value = BigInt(balance);

  if (decimals <= 0) {
    return value.toString();
  }

  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  const fractionText = fraction
    .toString()
    .padStart(decimals, "0")
    .slice(0, 4)
    .replace(/0+$/, "");

  return fractionText
    ? `${whole.toString()}.${fractionText}`
    : whole.toString();
}

function shortenAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}\u2026${address.slice(-4)}`;
}

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/gzip": ".gz",
  "application/json": ".json",
  "application/octet-stream": ".bin",
  "text/plain": ".txt",
  "text/html": ".html",
  "text/css": ".css",
  "text/csv": ".csv",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
};

function ensureExtension(fileName: string, mimeType: string): string {
  // Already has an extension
  if (/\.[a-zA-Z0-9]+$/.test(fileName)) {
    return fileName;
  }
  const ext = MIME_TO_EXT[mimeType.split(";")[0].trim().toLowerCase()];
  return ext ? `${fileName}${ext}` : fileName;
}

function sniffMimeType(buffer: ArrayBuffer): string | null {
  const b = new Uint8Array(buffer);
  const check = (offset: number, ...bytes: number[]) =>
    bytes.every((byte, i) => b[offset + i] === byte);

  if (check(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
    return "image/png";
  if (check(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (check(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (check(0, 0x52, 0x49, 0x46, 0x46) && check(8, 0x57, 0x45, 0x42, 0x50))
    return "image/webp";
  if (check(0, 0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  if (check(0, 0x50, 0x4b, 0x03, 0x04)) return "application/zip";
  if (check(0, 0x1f, 0x8b)) return "application/gzip";
  if (check(0, 0x42, 0x4d)) return "image/bmp";
  if (check(0, 0x49, 0x49, 0x2a, 0x00) || check(0, 0x4d, 0x4d, 0x00, 0x2a))
    return "image/tiff";
  if (check(0, 0x00, 0x00, 0x00) && check(4, 0x66, 0x74, 0x79, 0x70))
    return "video/mp4";
  return null;
}

export default App;
