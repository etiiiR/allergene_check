const BACKUP_FORMAT = "gutfeeling-encrypted-vault";
const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 16 * 1024 * 1024;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// A backup contains only the opaque vault envelope. Never add the diary,
// passphrase, recovery key, or an unlocked data key to this file.
export function createEncryptedVaultBackup(envelope, createdAt = new Date()) {
  if (!isRecord(envelope) || !isRecord(envelope.payload)) {
    throw new Error("Der verschlüsselte Tresor ist ungültig.");
  }
  const created = new Date(createdAt);
  if (!Number.isFinite(created.getTime())) {
    throw new Error("Das Sicherungsdatum ist ungültig.");
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    created_at: created.toISOString(),
    envelope: structuredClone(envelope),
  };
}

// Reject unexpected formats and oversized files before asking the vault
// cryptography to inspect their contents.
export function parseEncryptedVaultBackup(contents) {
  if (typeof contents !== "string" || contents.length > MAX_BACKUP_BYTES) {
    throw new Error("Die Sicherungsdatei ist leer oder grösser als 16 MB.");
  }
  let backup;
  try {
    backup = JSON.parse(contents);
  } catch {
    throw new Error("Die Sicherungsdatei ist kein gültiges JSON.");
  }
  if (
    !isRecord(backup) ||
    backup.format !== BACKUP_FORMAT ||
    backup.version !== BACKUP_VERSION ||
    !Number.isFinite(Date.parse(backup.created_at)) ||
    !isRecord(backup.envelope) ||
    !isRecord(backup.envelope.payload)
  ) {
    throw new Error("Diese verschlüsselte Sicherung wird nicht unterstützt.");
  }
  if (JSON.stringify(backup.envelope).length > MAX_BACKUP_BYTES) {
    throw new Error("Der verschlüsselte Tresor ist grösser als 16 MB.");
  }
  return structuredClone(backup);
}

export const MAX_ENCRYPTED_BACKUP_BYTES = MAX_BACKUP_BYTES;
