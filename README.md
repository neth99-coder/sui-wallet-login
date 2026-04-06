# Sui zkLogin Wallet with Enoki

This project is a small Sui web wallet built to demonstrate how a user can sign in with Google, get a zkLogin-based Sui wallet, and read token balances on Sui testnet without installing a browser wallet extension.

It is intentionally narrow in scope. The app does not send transactions. It focuses on the core onboarding path:

1. Sign in with Google.
2. Create or restore the user's zkLogin wallet.
3. Read the wallet address.
4. Load balances from Sui testnet.
5. Log out of the dApp session.

## What this project is trying to teach

This repository is useful if you want to understand these pieces together:

- what a Sui zkLogin wallet is
- what Enoki does in the zkLogin flow
- how Google OAuth is connected to wallet creation
- how a React app can integrate the login flow
- how to read balances from Sui once the account is connected

## Core technologies

### Sui

Sui is the blockchain this app connects to. In this project, the app is configured for `testnet`, not mainnet.

The app uses a Sui client to:

- resolve the connected account
- request balances owned by that account
- fetch coin metadata for better balance display

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

## How the implementation works

### High-level architecture

The app has three main runtime responsibilities:

1. Configure the Sui testnet client and dApp Kit.
2. Register a Google-based Enoki wallet provider.
3. Render UI that connects the wallet and reads balances.

The relevant files are:

- `src/dapp-kit.ts`
- `src/RegisterEnokiWallets.tsx`
- `src/App.tsx`

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

### 3. Wallet UI and balance loading

In `src/App.tsx`, the app:

- finds the registered Google Enoki wallet
- triggers wallet connection when the user clicks the button
- reads the connected account from dApp Kit
- loads balances for the connected Sui address
- formats and displays coin balances
- disconnects the wallet on logout

The balance loading path looks like this:

1. Get the current account address.
2. Call `client.listBalances({ owner: account.address })`.
3. For each coin type, call `client.getCoinMetadata()`.
4. Display symbol, name, and formatted amount.

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
9. The app loads token balances for that address.

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
```

Do not put a Google client secret into the frontend `.env`. Vite exposes `VITE_*` variables to the browser.

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

### `src/index.css` and `src/App.css`

Contain the global and page-level styling for the app.

## Why this project uses Enoki instead of raw zkLogin

You can build zkLogin flows directly with lower-level Sui tooling, but then you need to manage more of the integration yourself. For a learning project and a lightweight app, Enoki is the practical choice because it reduces the amount of custom infrastructure you need to write.

That is why this project can stay frontend-focused while still demonstrating a real zkLogin wallet flow.

## Current limitations

This app is intentionally limited.

It currently does not include:

- transaction signing UI
- token transfers
- sponsored transactions
- mainnet support
- multi-provider login
- profile storage or app-specific backend logic

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

## Scripts

```bash
npm run dev
npm run build
npm run preview
npm run lint
```

## Summary

This project is a simple reference implementation of a Sui zkLogin wallet using Google authentication and Enoki. The main educational value is seeing how identity, wallet creation, and balance reads fit together in a React app without requiring a traditional browser wallet extension.
