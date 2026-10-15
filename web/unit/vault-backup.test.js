import test from "node:test";
import assert from "node:assert/strict";
import { createEncryptedVault } from "../src/privacy/vault-crypto.js";
import {
  createEncryptedVaultBackup,
  parseEncryptedVaultBackup,
} from "../src/privacy/vault-backup.js";

test("encrypted backup round-trips only the opaque envelope", async () => {
  const diary = {
    profile: { display_name: "private pseudonym" },
    checkins: [{ notes: "private symptom notes" }],
  };
  const { envelope, recoveryKey } = await createEncryptedVault(
    diary,
    "Kiesel!Wolke!Abendlicht",
  );
  const backup = createEncryptedVaultBackup(
    envelope,
    new Date("2026-10-08T12:00:00.000Z"),
  );
  const serialized = JSON.stringify(backup);

  assert.equal(backup.format, "gutfeeling-encrypted-vault");
  assert.deepEqual(parseEncryptedVaultBackup(serialized), backup);
  assert.ok(!serialized.includes("private pseudonym"));
  assert.ok(!serialized.includes("private symptom notes"));
  assert.ok(!serialized.includes(recoveryKey));
});

test("backup parser rejects wrong formats, malformed JSON, and oversized data", () => {
  assert.throws(() => parseEncryptedVaultBackup("{"), /gültiges JSON/u);
  assert.throws(
    () =>
      parseEncryptedVaultBackup(
        JSON.stringify({ format: "other", version: 1, envelope: {} }),
      ),
    /nicht unterstützt/u,
  );
  assert.throws(
    () => parseEncryptedVaultBackup("x".repeat(16 * 1024 * 1024 + 1)),
    /16 MB/u,
  );
});
