import test from "node:test";
import assert from "node:assert/strict";
import { createEncryptedVault } from "../src/privacy/vault-crypto.js";
import {
  commitPreparedVault,
  acceptServerVault,
  commitVaultCredentialRotation,
  isVaultUnlocked,
  loadVaultSession,
  lockVaultSession,
  prepareVault,
  prepareVaultCredentialRotation,
  restoreEncryptedVault,
  transactDiary,
  unlockVaultWithPassphrase,
  unlockVaultWithRecoveryKey,
  vaultSessionState,
} from "../src/privacy/vault-session.js";

const passphrase = "Kiesel!Wolke!Abendlicht";

function mockVaultServer() {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const server = { vault: { revision: 0, envelope: null } };
  globalThis.fetch = async (_url, options = {}) => {
    const method = options.method || "GET";
    calls.push({ method, body: options.body });
    if (method === "GET") {
      return new Response(JSON.stringify(server.vault), { status: 200 });
    }
    if (server.failPuts) {
      return new Response(
        JSON.stringify({ error: { code: "write_unavailable", message: "write unavailable" } }),
        { status: 503 },
      );
    }
    const request = JSON.parse(options.body);
    if (request.expected_revision !== server.vault.revision) {
      return new Response(
        JSON.stringify({
          error: {
            code: "vault_revision_conflict",
            message: "Der Tresor wurde zwischenzeitlich geändert.",
          },
        }),
        { status: 409 },
      );
    }
    server.vault = {
      revision: server.vault.revision + 1,
      envelope: request.envelope,
    };
    return new Response(JSON.stringify(server.vault), { status: 200 });
  };
  return {
    calls,
    server,
    restore() {
      lockVaultSession();
      globalThis.fetch = originalFetch;
    },
  };
}

test("initial encrypted page props select setup or locked mode without plaintext", async () => {
  lockVaultSession();
  await acceptServerVault({ revision: 0, envelope: null });
  assert.equal(vaultSessionState.status, "setup");
  const mock = mockVaultServer();
  try {
    const prepared = await prepareVault(
      { profile: { display_name: "private" }, recipes: [], checkins: [] },
      passphrase,
    );
    mock.server.vault = { revision: 1, envelope: prepared.envelope };
    lockVaultSession();
    await acceptServerVault(mock.server.vault);
    assert.equal(vaultSessionState.status, "locked");
    assert.equal(vaultSessionState.diary, null);
  } finally {
    mock.restore();
  }
});

test("a delayed older Inertia snapshot cannot relock a newly saved vault", async () => {
  const mock = mockVaultServer();
  try {
    await loadVaultSession();
    const diary = {
      profile: { display_name: "Restored profile" },
      recipes: [],
      meals: [],
      checkins: [],
    };
    const prepared = await prepareVault(diary, passphrase);
    await commitPreparedVault(prepared);
    assert.equal(vaultSessionState.revision, 1);
    assert.equal(vaultSessionState.status, "unlocked");

    await acceptServerVault({ revision: 0, envelope: null });

    assert.equal(vaultSessionState.revision, 1);
    assert.equal(vaultSessionState.status, "unlocked");
    assert.equal(vaultSessionState.diary.profile.display_name, "Restored profile");
  } finally {
    mock.restore();
  }
});

test("vault session creates, verifies, saves, locks and reopens only ciphertext", async () => {
  const mock = mockVaultServer();
  try {
    const diary = {
      profile: { display_name: "Ruhige Wolke" },
      recipes: [{ title: "Privates Zitronenrezept" }],
      checkins: [{ notes: "starke Bauchschmerzen nach dem Essen" }],
    };
    await loadVaultSession();
    const prepared = await prepareVault(diary, passphrase);
    assert.equal(vaultSessionState.status, "setup");
    assert.equal(vaultSessionState.diary, null);
    assert.ok(prepared.recoveryKey.length > 30);

    const created = await commitPreparedVault(prepared);
    assert.equal(created.revision, 1);
    assert.deepEqual(created.diary, diary);
    assert.equal(isVaultUnlocked(), true);

    const appended = await transactDiary((draft) => {
      draft.checkins.push({ notes: "another private moment" });
      return { diary: draft, result: "saved" };
    });
    assert.equal(appended, "saved");
    assert.equal(vaultSessionState.revision, 2);
    assert.equal(vaultSessionState.diary.checkins.length, 2);

    const putBodies = mock.calls
      .filter((call) => call.method === "PUT")
      .map((call) => call.body)
      .join("\n");
    assert.ok(!putBodies.includes("Ruhige Wolke"));
    assert.ok(!putBodies.includes("Privates Zitronenrezept"));
    assert.ok(!putBodies.includes("starke Bauchschmerzen"));

    lockVaultSession();
    assert.equal(vaultSessionState.status, "locked");
    assert.equal(vaultSessionState.diary, null);
    assert.equal(isVaultUnlocked(), false);
    await unlockVaultWithPassphrase(passphrase);
    assert.equal(vaultSessionState.diary.checkins.length, 2);
    assert.equal(isVaultUnlocked(), true);
  } finally {
    mock.restore();
  }
});

test("encrypted backup restore validates locally and writes only ciphertext to an empty vault", async () => {
  const mock = mockVaultServer();
  try {
    const diary = {
      profile: { display_name: "Private restore identity" },
      recipes: [{ title: "Private restore recipe" }],
      checkins: [{ notes: "Private restore symptoms" }],
    };
    const { envelope, recoveryKey } = await createEncryptedVault(
      diary,
      passphrase,
    );
    await loadVaultSession();
    await assert.rejects(
      restoreEncryptedVault(envelope, "wrong-passphrase"),
      /ungültig/u,
    );
    assert.equal(mock.calls.filter((call) => call.method === "PUT").length, 0);
    await restoreEncryptedVault(envelope, recoveryKey, true);

    assert.equal(mock.server.vault.revision, 1);
    assert.equal(vaultSessionState.status, "unlocked");
    assert.deepEqual(vaultSessionState.diary, diary);
    const write = mock.calls.find((call) => call.method === "PUT");
    assert.ok(write);
    assert.ok(!write.body.includes("Private restore identity"));
    assert.ok(!write.body.includes("Private restore recipe"));
    assert.ok(!write.body.includes("Private restore symptoms"));
    assert.ok(!write.body.includes(recoveryKey));
  } finally {
    mock.restore();
  }
});

test("encrypted backup restore refuses a non-empty or legacy vault without writing", async () => {
  const mock = mockVaultServer();
  try {
    const { envelope } = await createEncryptedVault(
      { checkins: [] },
      passphrase,
    );
    await loadVaultSession();
    mock.server.vault = { revision: 1, envelope };
    await acceptServerVault(mock.server.vault);
    await assert.rejects(
      restoreEncryptedVault(envelope, passphrase),
      /leeren Tresor/u,
    );
    assert.equal(mock.calls.filter((call) => call.method === "PUT").length, 0);
  } finally {
    mock.restore();
  }
});

test("backup restore cannot overwrite a vault created while the passphrase is checked", async () => {
  const mock = mockVaultServer();
  try {
    const { envelope: backup } = await createEncryptedVault(
      { checkins: [{ notes: "backup" }] },
      passphrase,
    );
    const { envelope: current } = await createEncryptedVault(
      { checkins: [{ notes: "current server copy" }] },
      passphrase,
    );
    await loadVaultSession();
    const restoring = restoreEncryptedVault(backup, passphrase);
    mock.server.vault = { revision: 1, envelope: current };
    await acceptServerVault(mock.server.vault);
    await assert.rejects(restoring, /während der Prüfung geändert/u);
    assert.equal(mock.calls.filter((call) => call.method === "PUT").length, 0);
  } finally {
    mock.restore();
  }
});

test("legacy migration is sent only with the explicit first-vault confirmation", async () => {
  const mock = mockVaultServer();
  try {
    await loadVaultSession();
    const prepared = await prepareVault(
      {
        profile: { display_name: "Imported" },
        recipes: [],
        meals: [],
        checkins: [],
      },
      passphrase,
      { migrateLegacy: true },
    );
    await commitPreparedVault(prepared);
    const createRequest = JSON.parse(
      mock.calls.find((call) => call.method === "PUT").body,
    );
    assert.equal(createRequest.migrate_legacy, true);
    assert.equal(vaultSessionState.status, "unlocked");
  } finally {
    mock.restore();
  }
});

test("credential rotation replaces both keys and preserves encrypted diary data", async () => {
  const mock = mockVaultServer();
  const nextPassphrase = "Neue!Passphrase!Abendsonne";
  try {
    const diary = {
      profile: { display_name: "Pseudonym bleibt privat" },
      recipes: [{ title: "Zitronenkuchen" }],
      checkins: [{ notes: "Bauchweh nach dem Essen" }],
    };
    await loadVaultSession();
    const first = await prepareVault(diary, passphrase);
    const previousRecoveryKey = first.recoveryKey;
    await commitPreparedVault(first);
    const previousEnvelope = mock.server.vault.envelope;

    const prepared = await prepareVaultCredentialRotation(nextPassphrase);
    assert.equal(mock.server.vault.revision, 1);
    assert.deepEqual(mock.server.vault.envelope, previousEnvelope);
    assert.deepEqual(prepared.diary, diary);
    assert.notEqual(prepared.recoveryKey, previousRecoveryKey);

    const rotated = await commitVaultCredentialRotation(prepared);
    assert.equal(rotated.revision, 2);
    assert.deepEqual(rotated.diary, diary);
    assert.equal(vaultSessionState.status, "unlocked");
    assert.equal(vaultSessionState.revision, 2);

    const writes = mock.calls
      .filter((call) => call.method === "PUT")
      .map((call) => call.body)
      .join("\n");
    for (const secret of [passphrase, nextPassphrase, previousRecoveryKey, prepared.recoveryKey]) {
      assert.ok(!writes.includes(secret));
    }
    assert.ok(!writes.includes("Pseudonym bleibt privat"));
    assert.ok(!writes.includes("Bauchweh nach dem Essen"));

    lockVaultSession();
    await assert.rejects(
      unlockVaultWithPassphrase(passphrase),
      /ungültig/u,
    );
    await unlockVaultWithPassphrase(nextPassphrase);
    assert.deepEqual(vaultSessionState.diary, diary);
    lockVaultSession();
    await assert.rejects(
      unlockVaultWithRecoveryKey(previousRecoveryKey),
      /ungültig/u,
    );
    await unlockVaultWithRecoveryKey(prepared.recoveryKey);
    assert.deepEqual(vaultSessionState.diary, diary);
  } finally {
    mock.restore();
  }
});

test("failed credential save leaves the existing vault and unlocked diary usable", async () => {
  const mock = mockVaultServer();
  try {
    const diary = { profile: {}, recipes: [], checkins: [{ notes: "still here" }] };
    await loadVaultSession();
    await commitPreparedVault(await prepareVault(diary, passphrase));
    const previousEnvelope = mock.server.vault.envelope;
    const prepared = await prepareVaultCredentialRotation(
      "Another!New!Passphrase!123",
    );
    mock.server.failPuts = true;

    await assert.rejects(commitVaultCredentialRotation(prepared), /write unavailable/u);
    assert.equal(vaultSessionState.status, "unlocked");
    assert.equal(vaultSessionState.revision, 1);
    assert.deepEqual(vaultSessionState.envelope, previousEnvelope);
    assert.deepEqual(vaultSessionState.diary, diary);
    assert.deepEqual(mock.server.vault.envelope, previousEnvelope);

    mock.server.failPuts = false;
    lockVaultSession();
    await unlockVaultWithPassphrase(passphrase);
    assert.deepEqual(vaultSessionState.diary, diary);
  } finally {
    mock.restore();
  }
});

test("credential rotation refuses to overwrite diary edits made during confirmation", async () => {
  const mock = mockVaultServer();
  try {
    await loadVaultSession();
    await commitPreparedVault(
      await prepareVault(
        { profile: {}, recipes: [], checkins: [] },
        passphrase,
      ),
    );
    const prepared = await prepareVaultCredentialRotation(
      "Another!New!Passphrase!456",
    );
    await transactDiary((draft) => {
      draft.checkins.push({ notes: "latest edit must survive" });
      return { diary: draft, result: null };
    });
    const writesBeforeRotation = mock.calls.filter(
      (call) => call.method === "PUT",
    ).length;

    await assert.rejects(
      commitVaultCredentialRotation(prepared),
      (error) => error.code === "vault_rotation_stale",
    );
    assert.equal(
      mock.calls.filter((call) => call.method === "PUT").length,
      writesBeforeRotation,
    );
    assert.equal(vaultSessionState.status, "unlocked");
    assert.equal(vaultSessionState.revision, 2);
    assert.deepEqual(vaultSessionState.diary.checkins, [
      { notes: "latest edit must survive" },
    ]);
  } finally {
    mock.restore();
  }
});

test("queued diary updates serialize against the latest decrypted state", async () => {
  const mock = mockVaultServer();
  try {
    await loadVaultSession();
    await commitPreparedVault(
      await prepareVault(
        { profile: {}, recipes: [], checkins: [] },
        passphrase,
      ),
    );
    const first = transactDiary(async (draft) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      draft.recipes.push({ title: "first" });
      return { diary: draft, result: null };
    });
    const second = transactDiary((draft) => {
      draft.recipes.push({ title: "second" });
      return { diary: draft, result: null };
    });
    await Promise.all([first, second]);
    assert.deepEqual(
      vaultSessionState.diary.recipes.map((recipe) => recipe.title),
      ["first", "second"],
    );
    assert.equal(vaultSessionState.revision, 3);
  } finally {
    mock.restore();
  }
});

test("stale vault writes fail closed and discard the unlocked plaintext view", async () => {
  const mock = mockVaultServer();
  try {
    await loadVaultSession();
    await commitPreparedVault(
      await prepareVault(
        { profile: {}, recipes: [], checkins: [] },
        passphrase,
      ),
    );
    mock.server.vault.revision++;
    await assert.rejects(
      transactDiary((draft) => {
        draft.recipes.push({ title: "must not overwrite another tab" });
        return { diary: draft, result: null };
      }),
      /zwischenzeitlich geändert/u,
    );
    assert.equal(vaultSessionState.status, "conflict");
    assert.equal(vaultSessionState.diary, null);
    assert.equal(isVaultUnlocked(), false);
  } finally {
    mock.restore();
  }
});
