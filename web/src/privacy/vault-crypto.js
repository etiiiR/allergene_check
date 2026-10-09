const VAULT_VERSION = 1;
const CIPHER = "AES-GCM-256";
const KDF = "PBKDF2-SHA-256";
const KDF_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
export const MAX_VAULT_CIPHERTEXT_CHARS = 16 * 1024 * 1024;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
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

function isBase64URL(value, maxChars) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxChars &&
    value.length % 4 !== 1 &&
    BASE64URL.test(value)
  );
}

function decodeBase64URL(value, maxChars = MAX_VAULT_CIPHERTEXT_CHARS) {
  if (!isBase64URL(value, maxChars)) {
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
  const iv = decodeBase64URL(wrapped?.iv, 16);
  const ciphertext = decodeBase64URL(wrapped?.ciphertext, 64);
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
  const saltValue = envelope?.kdf?.salt;
  const passphraseWrap = envelope?.wraps?.passphrase;
  const recoveryWrap = envelope?.wraps?.recovery;
  const payload = envelope?.payload;
  if (
    envelope?.version !== VAULT_VERSION ||
    envelope?.cipher !== CIPHER ||
    envelope?.kdf?.name !== KDF ||
    envelope?.kdf?.iterations !== KDF_ITERATIONS ||
    !isBase64URL(saltValue, 22) ||
    saltValue.length !== 22 ||
    !passphraseWrap ||
    !isBase64URL(passphraseWrap.iv, 16) ||
    passphraseWrap.iv.length !== 16 ||
    !isBase64URL(passphraseWrap.ciphertext, 64) ||
    passphraseWrap.ciphertext.length !== 64 ||
    !recoveryWrap ||
    !isBase64URL(recoveryWrap.iv, 16) ||
    recoveryWrap.iv.length !== 16 ||
    !isBase64URL(recoveryWrap.ciphertext, 64) ||
    recoveryWrap.ciphertext.length !== 64 ||
    !payload ||
    !isBase64URL(payload.iv, 16) ||
    payload.iv.length !== 16 ||
    !isBase64URL(payload.ciphertext, MAX_VAULT_CIPHERTEXT_CHARS) ||
    payload.ciphertext.length < 22
  ) {
    throw new Error("Diese Tresor-Version wird nicht unterstützt.");
  }
  const salt = decodeBase64URL(saltValue, 22);
  if (salt.length !== SALT_BYTES) {
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
    const iv = decodeBase64URL(payload?.iv, 16);
    const ciphertext = decodeBase64URL(
      payload?.ciphertext,
      MAX_VAULT_CIPHERTEXT_CHARS,
    );
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
    keyBytes = decodeBase64URL(recoveryKey, 43);
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
