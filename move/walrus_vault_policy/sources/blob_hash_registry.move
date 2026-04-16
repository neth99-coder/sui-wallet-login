/// Stores a SHA-256 fingerprint of every plaintext blob on-chain so that
/// external parties can verify document authenticity without accessing the
/// encrypted content stored on Walrus.
///
/// The registry is event-based: each call to `register_hash` emits a
/// `HashRegistered` event.  Anyone can query all events of this type via the
/// Sui JSON-RPC `suix_queryEvents` endpoint without owning a wallet or paying
/// gas fees (read operations are free).
module walrus_vault_policy::blob_hash_registry;

use std::string::String;
use sui::event;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Emitted once per successful blob upload.  `sha256_hex` is the lower-case
/// hex-encoded SHA-256 digest of the **plaintext** file bytes, computed in
/// the browser before encryption.
public struct HashRegistered has copy, drop {
    /// Walrus base64url blob ID returned by the publisher.
    blob_id: String,
    /// Sui object ID of the Walrus Blob object owned by the uploader.
    object_id: String,
    /// Lower-case hex-encoded SHA-256 of the original plaintext bytes.
    sha256_hex: String,
    /// Original file name for display purposes.
    file_name: String,
    /// Sui address of the uploader.
    uploader: address,
}

// ---------------------------------------------------------------------------
// Entry functions
// ---------------------------------------------------------------------------

/// Register the SHA-256 hash of a blob that was just uploaded to Walrus.
/// Called by the uploader in the same session as the Walrus upload.
/// The only on-chain effect is emitting `HashRegistered`; no objects are
/// created, so this is inexpensive.
entry fun register_hash(
    blob_id: String,
    object_id: String,
    sha256_hex: String,
    file_name: String,
    ctx: &TxContext,
) {
    event::emit(HashRegistered {
        blob_id,
        object_id,
        sha256_hex,
        file_name,
        uploader: ctx.sender(),
    });
}
