import test from "node:test";
import assert from "node:assert/strict";
import {
  createEncryptedVault,
  decryptVaultPayload,
  encryptVaultPayload,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
} from "../src/privacy/vault-crypto.js";

const passphrase = "Kiesel!Wolke!Abendlicht";

test("encrypted vault hides diary text and can be unlocked with either key", async () => {
  const diary = {
    profile: { display_name: "Ruhige Wolke", cycle_tracking: true },
    checkins: [{ symptoms: { pain: 8 }, notes: "private symptom phrase" }],
    recipes: [{ title: "private recipe phrase" }],
  };
  const { envelope, dataKey, recoveryKey } = await createEncryptedVault(
    diary,
    passphrase,
  );
  const serialized = JSON.stringify(envelope);
  assert.ok(!serialized.includes("private symptom phrase"));
  assert.ok(!serialized.includes("private recipe phrase"));
  assert.ok(!serialized.includes("Ruhige Wolke"));
  assert.ok(!serialized.includes(recoveryKey));
  assert.equal(dataKey.extractable, false);

  const unlocked = await unlockWithPassphrase(envelope, passphrase);
  assert.deepEqual(unlocked.diary, diary);
  assert.equal(unlocked.dataKey.extractable, false);

  const recovered = await unlockWithRecoveryKey(envelope, recoveryKey);
  assert.deepEqual(recovered.diary, diary);
  assert.equal(recovered.dataKey.extractable, false);
});

test("wrong passphrases and modified ciphertext cannot reveal diary data", async () => {
  const { envelope } = await createEncryptedVault(
    { checkins: [{ notes: "never readable from the vault" }] },
    passphrase,
  );
  await assert.rejects(
    unlockWithPassphrase(envelope, "AnotherWrongPassphrase"),
    /ungültig/u,
  );

  const key = await unlockWithPassphrase(envelope, passphrase);
  const ciphertext = envelope.payload.ciphertext;
  const first = ciphertext[0];
  envelope.payload.ciphertext = `${first === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
  await assert.rejects(
    decryptVaultPayload(key.dataKey, envelope.payload),
    /ungültig/u,
  );
});

test("each diary update uses a fresh authenticated-encryption nonce", async () => {
  const { envelope, dataKey } = await createEncryptedVault(
    { checkins: [] },
    passphrase,
  );
  const next = await encryptVaultPayload(dataKey, {
    checkins: [{ symptoms: {} }],
  });
  assert.notEqual(next.iv, envelope.payload.iv);
  assert.deepEqual(await decryptVaultPayload(dataKey, next), {
    checkins: [{ symptoms: {} }],
  });
});
