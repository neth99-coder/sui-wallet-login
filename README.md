# Sui zkLogin Wallet with Enoki and Walrus

This project is a small Sui web wallet built to demonstrate how a user can sign in with Google, get a zkLogin-based Sui wallet, read token balances on Sui testnet, upload a binary file to Walrus, and list the Walrus Blob objects owned by the connected address without installing a browser wallet extension.

It is intentionally narrow in scope. It focuses on the core onboarding path:

1. Sign in with Google.
2. Create or restore the user's zkLogin wallet.
3. Read the wallet address.
4. Load balances from Sui testnet.
5. Upload a binary file to Walrus testnet.
6. List the Walrus files owned by the connected wallet address.
7. Log out of the dApp session.

## What this project is trying to teach

This repository is useful if you want to understand these pieces together:

- what a Sui zkLogin wallet is
- what Enoki does in the zkLogin flow
- how Google OAuth is connected to wallet creation
- how a React app can integrate the login flow
- how to read balances from Sui once the account is connected
- how Walrus stores binary blobs offchain while keeping ownership on Sui
- how to list Walrus Blob objects owned by a Sui address

## Core technologies

### Sui

Sui is the blockchain this app connects to. In this project, the app is configured for `testnet`, not mainnet.

The app uses a Sui client to:

- resolve the connected account
- request balances owned by that account
- fetch coin metadata for better balance display
- list Walrus Blob objects owned by that account

### Walrus

Walrus is the decentralized blob storage layer used by this app for file uploads.

In this project, Walrus is used in two ways:

- the public Walrus testnet publisher stores uploaded files as blobs
- the connected Sui address becomes the owner of the resulting Walrus `Blob` object and stores blob attributes on Sui when possible

That split is important:

- the file bytes live in Walrus
- ownership, storage duration, and blob metadata live on Sui as objects / attributes

This makes Walrus a better fit than storing raw file bytes directly onchain.

### Public Walrus testnet publisher

This app uses the public Walrus testnet publisher HTTP API for uploads.

That means the current implementation does **not** require the user to hold test WAL just to upload through this UI. The publisher handles the storage write on testnet and sends the resulting blob object to the connected address.

The app then lists the files by querying Sui for Walrus `Blob` objects owned by that address.

This is different from a direct Walrus SDK write flow where the user's wallet signs the registration and certification transactions itself.

### zkLogin

zkLogin is a Sui feature that lets a user authenticate with a Web2 identity provider such as Google and derive a Sui address from that login, instead of managing a traditional wallet seed phrase in the UI.

Conceptually, zkLogin combines:

- an OpenID Connect provider such as Google
- a JWT returned by that provider
- Sui-specific cryptographic proofs
- a user salt and ephemeral signing material

The result is a blockchain address that is tied to the user's identity for this app configuration.

### Enoki

Enoki is Mysten's developer platform that simplifies zkLogin integration. Instead of manually implementing the entire nonce, salt, proof, and session workflow yourself, Enoki handles the hard parts needed for a production-style zkLogin onboarding flow.

In this project, Enoki is responsible for:

- creating the zkLogin nonce
- managing the Google login integration for the wallet flow
- resolving the user's zkLogin wallet address from the Google JWT
- wiring the wallet into the Sui wallet standard / dApp Kit flow

Without Enoki, you would need to implement and operate more of the zkLogin backend-sensitive flow yourself.

### Google OAuth

Google is the identity provider used in this app. The user signs in through Google, Google returns an authentication result, and that result is used in the zkLogin flow.

This project uses a Google OAuth Web Client ID. The client secret is not needed in the frontend and should never be exposed in a Vite app.

### React + Vite

The UI is built with React and bundled with Vite. Vite is used for local development, environment variables, and production builds.

### `@mysten/dapp-kit-react`

This package provides wallet integration primitives for Sui apps. In this project it is used to:

- create the dApp Kit provider
- access the current account and wallet
- access the current Sui client and network
- connect and disconnect the Enoki wallet

### `@tanstack/react-query`

React Query is used for loading balances from Sui and managing loading / error state around those requests.

### `@mysten/walrus`

The Walrus SDK is used here for Walrus-specific client helpers, especially:

- resolving the Walrus `Blob` Move type for object listing
- reading parsed Walrus blob objects from Sui by object ID
- reading Walrus blob attributes when present

### `@mysten/seal`

The Seal SDK is now included for encryption and decryption helpers.

This repo does not yet ship a published Seal access-policy Move package, so the
frontend cannot offer a generic one-click decrypt button by itself. Seal
decryption always depends on two app-specific pieces:

- a deployed Move package that defines one or more `seal_approve*` functions
- transaction-kind bytes that call the correct `seal_approve*` function for that
  package

The helper module lives in `src/seal.ts` and gives you the browser-side pieces
that are reusable across policies:

- create a `SealClient` with testnet key server defaults
- encrypt bytes with `encryptWithSeal()`
- create a wallet-backed `SessionKey` using `dAppKit.signPersonalMessage()`
- build transaction-kind bytes for a `seal_approve` call
- decrypt bytes with `decryptWithSeal()` once you have the correct approval PTB

The default server config in `src/seal.ts` uses the public Mysten testnet
committee aggregator:

- committee object ID:
  `0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98`
- aggregator URL:
  `https://seal-aggregator-testnet.mystenlabs.com`

That is enough to start encrypting on testnet, but you still need your own
policy package ID and approval call shape before decryption can be wired into an
app workflow such as Walrus download.

## How the implementation works

### High-level architecture

The app has four main runtime responsibilities:

1. Configure the Sui testnet client and dApp Kit.
2. Register a Google-based Enoki wallet provider.
3. Upload files to Walrus testnet through the public publisher.
4. Render UI that connects the wallet, reads balances, and lists owned Walrus files.

The relevant files are:

- `src/dapp-kit.ts`
- `src/RegisterEnokiWallets.tsx`
- `src/App.tsx`
- `src/walrus.ts`

### 1. Sui client and dApp Kit setup

In `src/dapp-kit.ts`, the app creates a dApp Kit instance for `testnet`.

Key points:

- the default network is `testnet`
- the app creates a `SuiGrpcClient` for that network
- `autoConnect: true` lets the app restore the wallet session when possible

This file is the central network configuration for the app.

### 2. Registering the Enoki wallet

In `src/RegisterEnokiWallets.tsx`, the app registers a Google wallet backed by Enoki.

That component does four important things:

1. Reads the current Sui client and network from dApp Kit.
2. Reads `VITE_ENOKI_API_KEY` and `VITE_GOOGLE_CLIENT_ID` from the frontend environment.
3. Builds the redirect URL from the current browser location.
4. Calls `registerEnokiWallets()` to create a Google wallet provider for the app.

This is the bridge between the wallet framework and Enoki.

### 3. Walrus upload and owned-file listing

In `src/App.tsx`, the app also adds a Walrus workflow:

1. The user selects a file, number of epochs, and whether the blob should be deletable.
2. The app uploads the file with an HTTP `PUT` request to the public Walrus testnet publisher.
3. The request includes `send_object_to=<current wallet address>` so the new Walrus `Blob` object is owned by the connected user.
4. After the publisher returns the new blob object ID, the app attempts to write blob attributes on Sui using `writeBlobAttributesTransaction()`.
5. The app polls and refetches the owned Walrus objects until the new object is visible in the wallet's file list.
6. The app queries Sui for Walrus `Blob` objects owned by that address.
7. For each object, the app loads Walrus blob metadata and renders a file list with object ID, blob ID, size, storage expiry, and download link.

### 4. Wallet UI and balance loading

In `src/App.tsx`, the app:

- finds the registered Google Enoki wallet
- triggers wallet connection when the user clicks the button
- reads the connected account from dApp Kit
- loads balances for the connected Sui address
- uploads files to Walrus
- loads Walrus Blob objects for the connected address
- formats and displays coin balances
- disconnects the wallet on logout

The balance loading path looks like this:

1. Get the current account address.
2. Call `client.listBalances({ owner: account.address })`.
3. For each coin type, call `client.getCoinMetadata()`.
4. Display symbol, name, and formatted amount.

The Walrus file listing path looks like this:

1. Resolve the Walrus `Blob` type through the Walrus SDK.
2. Call `client.listOwnedObjects({ owner, type })` for the connected address.
3. Load each Walrus blob object by its Sui object ID.
4. Read Walrus blob attributes when available.
5. Render a download URL through the Walrus aggregator.

## Walrus logic in this app

This repository has three separate Walrus flows that are worth understanding: upload, retrieval, and download.

### Upload flow

When a user uploads a file, the app performs these steps:

1. Read the selected browser `File` object.
2. Validate the upload size against the public publisher limit.
3. Build Walrus publisher query params:
   `epochs`, `send_object_to=<connected Sui address>`, and either `deletable=true` or `permanent=true`.
4. Send the file bytes to the public Walrus publisher with an HTTP `PUT`.
5. Read the publisher response and extract:
   the Walrus blob ID, the Sui blob object ID, and the storage end epoch.
6. Attempt to write blob attributes on Sui for that blob object.
7. Poll the owned-object query until the object appears in the list.

The upload code lives primarily in `handleWalrusUpload()` in `src/App.tsx`.

## Seal helper example

The frontend now includes a reusable Seal helper module in `src/seal.ts`. A
minimal usage pattern looks like this:

```ts
import {
  buildTransactionKindBytes,
  createSealApprovalTransaction,
  createWalletBackedSessionKey,
  decryptWithSeal,
  encryptWithSeal,
  hexStringToBytes,
} from "./src/seal";

const { encryptedObject } = await encryptWithSeal({
  suiClient: client,
  packageId: "0x...policy-package",
  id: "0x...policy-id",
  data: fileBytes,
});

const tx = createSealApprovalTransaction({
  packageId: "0x...policy-package",
  moduleName: "private_data",
  idBytes: hexStringToBytes("0x...policy-id"),
});

const txBytes = await buildTransactionKindBytes(client, tx);

const sessionKey = await createWalletBackedSessionKey({
  address: account.address,
  dAppKit,
  packageId: "0x...policy-package",
  suiClient: client,
});

const decryptedBytes = await decryptWithSeal({
  suiClient: client,
  encryptedBytes: encryptedObject,
  sessionKey,
  txBytes,
});
```

Replace the package ID, module name, policy ID, and any extra PTB arguments with
the ones required by your Move package. That policy-specific part is what decides
who is allowed to decrypt.

### What metadata is stored on Sui

After upload, the app tries to write blob attributes on Sui with `writeBlobAttributesTransaction()`.

The metadata payload is created in `src/walrus.ts` and currently includes:

- `fileName`
- `contentType`
- `originalSize`
- `uploadedAt`

This metadata is not stored in browser local storage. It is intended to be stored as Walrus blob attributes on Sui.

Important caveat: the metadata write is currently best-effort. If that transaction fails, the blob upload still succeeds, but the file may later fall back to a generated label instead of the original file name.

### Retrieval / file listing flow

The Files panel does not come from local app state. It is rebuilt from on-chain ownership each time the query runs.

The logic is:

1. Ask the Walrus SDK for the Move type of a Walrus `Blob` object.
2. Query Sui for all owned objects of that type for the connected address.
3. For each owned object ID:
   try `walrusClient.walrus.getBlobObject(objectId)` first. If that fails, fall back to reading raw Sui object JSON and extracting the blob fields manually.
4. Try to read blob attributes with `readBlobAttributes()`.
5. Normalize the blob ID if it is stored in raw decimal form on the Sui object.
6. Build the UI model for each file row.

If metadata is present, the UI uses:

- `fileName` from blob attributes
- `contentType` from blob attributes

If metadata is missing, the UI falls back to a generated file label based on the blob ID.

### Download flow

Downloads are served through the Walrus aggregator, not directly from Sui.

The logic is:

1. Convert the blob ID to the correct normalized base64url form when necessary.
2. Build the aggregator URL: `/v1/blobs/<normalized blob id>`.
3. Fetch the blob bytes from the aggregator.
4. Determine the best MIME type:
   use stored metadata if available, otherwise use the response content type, and if that is still generic, sniff the file header bytes.
5. Create a browser `Blob` and trigger a file download.
6. Add a file extension when the original name is missing one.

This is why the app can still download files correctly even when metadata is incomplete.

## End-to-end login flow

This is the actual user flow in this project:

1. The page loads and mounts the dApp Kit provider.
2. The app registers the Enoki Google wallet using the API key and Google client ID.
3. The user clicks `Log in with Google`.
4. dApp Kit asks the selected Enoki wallet to connect.
5. Enoki opens the Google OAuth popup.
6. Google authenticates the user and returns control to the redirect URL.
7. Enoki uses the login result to resolve the user's zkLogin wallet.
8. dApp Kit exposes the connected Sui account to the React app.
9. The app loads token balances and Walrus Blob objects for that address.

## What logout means in this app

Logout in this app means disconnecting the current Enoki wallet session from the dApp.

It does not necessarily mean:

- the user is globally signed out of Google
- all browser-level authentication state is cleared

It means the dApp is no longer treating the wallet as the active connected account.

## Setup guide

## 1. Prerequisites

You need:

- Node.js 20+
- npm 10+
- a Google Cloud project
- a Google OAuth 2.0 Web Client ID
- an Enoki app
- an Enoki public API key

## 2. Google Cloud configuration

In Google Cloud Console:

1. Create or choose a project.
2. Configure the OAuth consent screen.
3. Create an OAuth 2.0 Client ID of type `Web application`.
4. Add the frontend origin to `Authorized JavaScript origins`.
5. Add the exact redirect URL to `Authorized redirect URIs`.

For local development with Vite, use:

- Authorized JavaScript origin: `http://localhost:5173`
- Authorized redirect URI: `http://localhost:5173/`

The trailing slash matters because the app uses the exact browser URL as the redirect target.

If you run Vite on another port, replace `5173` with the actual port.

## 3. Enoki configuration

In the Enoki portal:

1. Create an app.
2. Add `http://localhost:5173` to the allowed origins list.
3. Open `Auth providers`.
4. Enable `Google`.
5. Paste the same Google OAuth Client ID you created in Google Cloud.
6. Ensure the app supports `testnet`, since this project uses testnet.
7. Copy the public API key for that app.

The key point is that the Google client ID must match in all three places:

- Google Cloud
- Enoki Auth provider configuration
- `.env` as `VITE_GOOGLE_CLIENT_ID`

## 4. Local environment variables

Copy the example file:

```bash
cp .env.example .env
```

Then set:

```dotenv
VITE_ENOKI_API_KEY=your_enoki_public_api_key
VITE_GOOGLE_CLIENT_ID=your_google_oauth_web_client_id
VITE_WALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space
VITE_WALRUS_AGGREGATOR_URL=https://aggregator.walrus-testnet.walrus.space
```

Do not put a Google client secret into the frontend `.env`. Vite exposes `VITE_*` variables to the browser.

The Walrus URLs are optional. If omitted, the app uses the testnet defaults shown above.

## 5. Install and run

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Build the project:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Repository walkthrough

### `src/main.tsx`

Bootstraps the React app and wraps it with:

- `QueryClientProvider` for React Query
- `DAppKitProvider` for Sui wallet state
- `RegisterEnokiWallets` so the Google wallet is available before the app renders

### `src/dapp-kit.ts`

Creates the dApp Kit instance and pins the app to Sui testnet.

### `src/RegisterEnokiWallets.tsx`

Registers the Google Enoki wallet and supplies:

- the Enoki public API key
- the Google client ID
- the redirect URL
- the active Sui client and network

### `src/App.tsx`

Contains the app's main business logic:

- login button
- logout button
- account display
- error display for auth failures
- balance fetching and formatting
- Walrus file upload form
- Walrus metadata write after upload
- Walrus owned-file listing
- Walrus download logic with MIME sniffing and extension recovery

### `src/walrus.ts`

Contains Walrus-specific helpers:

- default publisher and aggregator URLs
- blob ID normalization from raw decimal u256 to base64url
- blob attribute helpers for file name and content type
- raw Sui object parsing fallback for Walrus blob objects
- Walrus blob formatting helpers

### `src/index.css` and `src/App.css`

Contain the global and page-level styling for the app.

## Why this project uses Enoki instead of raw zkLogin

You can build zkLogin flows directly with lower-level Sui tooling, but then you need to manage more of the integration yourself. For a learning project and a lightweight app, Enoki is the practical choice because it reduces the amount of custom infrastructure you need to write.

That is why this project can stay frontend-focused while still demonstrating a real zkLogin wallet flow.

## Current limitations

This app is intentionally limited.

It currently does not include:

- token transfers
- sponsored transactions
- mainnet support
- multi-provider login
- profile storage or app-specific backend logic

The Walrus file listing is based on owned Walrus `Blob` objects on Sui. If a blob was uploaded elsewhere without transferring the blob object to this address, it will not appear in the list.

## Common issues

### `redirect_uri_mismatch`

Your Google Cloud redirect URI does not exactly match the redirect URI used by the app.

For local dev, verify:

- `http://localhost:5173` in Authorized JavaScript origins
- `http://localhost:5173/` in Authorized redirect URIs

### `Request to Enoki API failed (status: 400)`

This usually means one of these is wrong:

- the Enoki app does not allow your local origin
- the Enoki API key belongs to a different app than the one you configured
- the Google client ID does not match between Google, Enoki, and `.env`
- the app is running on a different port than the one you allowed
- the Enoki app is not configured for the network this project uses

### Wallet stays in `Waiting`

This usually means the popup flow completed, but the wallet session was not fully established. Check the auth error shown in the UI and verify the configuration items above.

## Funding the wallet on testnet

The first login usually creates an address with no funds.

To test balances:

1. Copy the address shown in the app.
2. Send testnet assets to that address.
3. Click `Refresh balances`.

## How Walrus testnet works in this app

This repository uses the **public Walrus testnet publisher**.

That means:

- uploads go to a public publisher endpoint over HTTP
- the publisher stores the blob on Walrus testnet
- the request tells the publisher to send the resulting Walrus `Blob` object to your connected Sui address
- the app lists your files by reading the Walrus `Blob` objects your address owns on Sui testnet

### Do you need test WAL for this app?

For the current implementation in this repository: **no, not for the upload button in the UI**.

Because the app uses the public Walrus testnet publisher, the browser upload flow does not directly spend your wallet's WAL balance.

You may still want testnet SUI in the wallet for other dApp testing and for any future extension that writes Walrus metadata or signs Walrus transactions directly.

### When do you need test WAL?

You need test WAL if you switch to a direct Walrus client flow where **your own wallet** signs and pays for storage operations, for example:

- using the Walrus CLI directly
- using the Walrus TypeScript SDK to register and certify blobs with your wallet
- running your own publisher or other custom Walrus write infrastructure

In that model, you generally need:

- testnet SUI for gas
- testnet WAL for Walrus storage fees

### How do you get test WAL?

For a direct Walrus wallet flow on testnet:

1. Fund your Sui address with testnet SUI from the Sui faucet.
2. Install the Walrus CLI.
3. Exchange some testnet SUI for testnet WAL with:

```bash
walrus get-wal --context testnet
```

The Walrus docs describe the standard setup flow as:

1. Configure the Sui client for testnet.
2. Fund the address with testnet SUI.
3. Run `walrus get-wal --context testnet`.

If you only use this repository exactly as implemented today, that extra step is not required.

## Scripts

```bash
npm run dev
npm run build
npm run preview
npm run lint
```

## Summary

This project is a simple reference implementation of a Sui zkLogin wallet using Google authentication and Enoki. The main educational value is seeing how identity, wallet creation, and balance reads fit together in a React app without requiring a traditional browser wallet extension.
