const VAULT_VERSION = 1;
const CIPHER = "AES-GCM-256";
const KDF = "PBKDF2-SHA-256";
const KDF_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const encoder = new TextEncoder();
const AAD = {
  payload: encoder.encode("gutfeeling:vault:payload:v1"),
  passphrase: encoder.encode("gutfeeling:vault:key:passphrase:v1"),
  recovery: encoder.encode("gutfeeling:vault:key:recovery:v1"),
};

function subtleCrypto() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error(
      "Sichere Verschlüsselung ist in diesem Browser nicht verfügbar.",
    );
  }
  return globalThis.crypto.subtle;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function encodeBase64URL(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64URL(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("Verschlüsselter Tresor ist ungültig.");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function checkPassphrase(passphrase) {
  if (typeof passphrase !== "string") {
    throw new Error(
      "Bitte eine Passphrase mit mindestens 12 Zeichen verwenden.",
    );
  }
  const normalized = passphrase.normalize("NFKC");
  if (Array.from(normalized.trim()).length < 12) {
    throw new Error(
      "Bitte eine Passphrase mit mindestens 12 Zeichen verwenden.",
    );
  }
  return normalized;
}

async function deriveWrappingKey(passphrase, salt) {
  const subtle = subtleCrypto();
  const material = await subtle.importKey(
    "raw",
    encoder.encode(checkPassphrase(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: KDF_ITERATIONS,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

async function wrapDataKey(dataKey, wrappingKey, purpose) {
  const iv = randomBytes(NONCE_BYTES);
  const ciphertext = await subtleCrypto().wrapKey("raw", dataKey, wrappingKey, {
    name: "AES-GCM",
    iv,
    additionalData: AAD[purpose],
    tagLength: 128,
  });
  return {
    iv: encodeBase64URL(iv),
    ciphertext: encodeBase64URL(new Uint8Array(ciphertext)),
  };
}

async function unwrapDataKey(wrapped, wrappingKey, purpose) {
  const iv = decodeBase64URL(wrapped?.iv);
  const ciphertext = decodeBase64URL(wrapped?.ciphertext);
  if (iv.length !== NONCE_BYTES || ciphertext.length !== KEY_BYTES + 16) {
    throw new Error("Verschlüsselter Tresor ist ungültig.");
  }
  return subtleCrypto().unwrapKey(
    "raw",
    ciphertext,
    wrappingKey,
    { name: "AES-GCM", iv, additionalData: AAD[purpose], tagLength: 128 },
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

function checkEnvelope(envelope) {
  const salt = decodeBase64URL(envelope?.kdf?.salt);
  if (
    envelope?.version !== VAULT_VERSION ||
    envelope?.cipher !== CIPHER ||
    envelope?.kdf?.name !== KDF ||
    envelope?.kdf?.iterations !== KDF_ITERATIONS ||
    salt.length !== SALT_BYTES ||
    !envelope.wraps?.passphrase ||
    !envelope.wraps?.recovery ||
    !envelope.payload
  ) {
    throw new Error("Diese Tresor-Version wird nicht unterstützt.");
  }
  return salt;
}

export async function encryptVaultPayload(dataKey, diary) {
  if (!diary || typeof diary !== "object" || Array.isArray(diary)) {
    throw new Error("Tagebuchdaten sind ungültig.");
  }
  const subtle = subtleCrypto();
  const iv = randomBytes(NONCE_BYTES);
  const plaintext = encoder.encode(JSON.stringify(diary));
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: AAD.payload, tagLength: 128 },
    dataKey,
    plaintext,
  );
  return {
    iv: encodeBase64URL(iv),
    ciphertext: encodeBase64URL(new Uint8Array(ciphertext)),
  };
}

export async function decryptVaultPayload(dataKey, payload) {
  try {
    const iv = decodeBase64URL(payload?.iv);
    const ciphertext = decodeBase64URL(payload?.ciphertext);
    if (iv.length !== NONCE_BYTES || ciphertext.length < 16) throw new Error();
    const plaintext = await subtleCrypto().decrypt(
      { name: "AES-GCM", iv, additionalData: AAD.payload, tagLength: 128 },
      dataKey,
      ciphertext,
    );
    const diary = JSON.parse(new TextDecoder().decode(plaintext));
    if (!diary || typeof diary !== "object" || Array.isArray(diary))
      throw new Error();
    return diary;
  } catch {
    throw new Error(
      "Passphrase, recovery key oder verschlüsselte Daten sind ungültig.",
    );
  }
}

export async function createEncryptedVault(diary, passphrase) {
  const subtle = subtleCrypto();
  checkPassphrase(passphrase);
  const salt = randomBytes(SALT_BYTES);
  const dataKeyBytes = randomBytes(KEY_BYTES);
  const recoveryKeyBytes = randomBytes(KEY_BYTES);
  try {
    const exportableKey = await subtle.importKey(
      "raw",
      dataKeyBytes,
      "AES-GCM",
      true,
      ["encrypt", "decrypt"],
    );
    const passphraseKey = await deriveWrappingKey(passphrase, salt);
    const recoveryKey = await subtle.importKey(
      "raw",
      recoveryKeyBytes,
      "AES-GCM",
      false,
      ["wrapKey", "unwrapKey"],
    );
    const [passphraseWrap, recoveryWrap] = await Promise.all([
      wrapDataKey(exportableKey, passphraseKey, "passphrase"),
      wrapDataKey(exportableKey, recoveryKey, "recovery"),
    ]);
    const dataKey = await subtle.importKey(
      "raw",
      dataKeyBytes,
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
    const payload = await encryptVaultPayload(dataKey, diary);
    return {
      envelope: {
        version: VAULT_VERSION,
        cipher: CIPHER,
        kdf: {
          name: KDF,
          iterations: KDF_ITERATIONS,
          salt: encodeBase64URL(salt),
        },
        wraps: { passphrase: passphraseWrap, recovery: recoveryWrap },
        payload,
      },
      dataKey,
      recoveryKey: encodeBase64URL(recoveryKeyBytes),
    };
  } finally {
    dataKeyBytes.fill(0);
    recoveryKeyBytes.fill(0);
  }
}

async function unlock(envelope, wrappingKey, purpose) {
  try {
    checkEnvelope(envelope);
    const dataKey = await unwrapDataKey(
      envelope.wraps[purpose],
      wrappingKey,
      purpose,
    );
    const diary = await decryptVaultPayload(dataKey, envelope.payload);
    return { dataKey, diary };
  } catch {
    throw new Error(
      "Passphrase, recovery key oder verschlüsselte Daten sind ungültig.",
    );
  }
}

export async function unlockWithPassphrase(envelope, passphrase) {
  const salt = checkEnvelope(envelope);
  const key = await deriveWrappingKey(passphrase, salt);
  return unlock(envelope, key, "passphrase");
}

export async function unlockWithRecoveryKey(envelope, recoveryKey) {
  let keyBytes;
  try {
    keyBytes = decodeBase64URL(recoveryKey);
    if (keyBytes.length !== KEY_BYTES) throw new Error();
    const key = await subtleCrypto().importKey(
      "raw",
      keyBytes,
      "AES-GCM",
      false,
      ["wrapKey", "unwrapKey"],
    );
    return await unlock(envelope, key, "recovery");
  } catch {
    throw new Error(
      "Passphrase, recovery key oder verschlüsselte Daten sind ungültig.",
    );
  } finally {
    keyBytes?.fill(0);
  }
}
