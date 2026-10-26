const PASSPHRASE_RANDOM_BYTES = 24;

// Generate a password-manager-friendly passphrase locally. The returned
// base64url string contains 192 bits of cryptographic randomness and is never
// sent to the server; callers must keep it out of reactive application state.
export function generateVaultPassphrase(cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.getRandomValues || typeof btoa !== "function") {
    throw new Error("Sichere Passphrase-Erstellung ist in diesem Browser nicht verfügbar.");
  }

  const bytes = new Uint8Array(PASSPHRASE_RANDOM_BYTES);
  cryptoProvider.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
