import test from "node:test";
import assert from "node:assert/strict";
import {
  createEncryptedVault,
  decryptVaultPayload,
  encryptVaultPayload,
} from "../src/privacy/vault-crypto.js";
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
import { logoutCurrentDevice } from "../src/privacy/account-session.js";

const passphrase = "Kiesel!Wolke!Abendlicht";

function mockVaultServer() {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const server = { vault: { revision: 0, envelope: null } };
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || "GET";
    calls.push({ method, body: options.body });
    if (url === "/api/auth/logout") {
      return new Response(null, { status: server.failLogout ? 503 : 204 });
    }
    if (method === "GET") {
      return new Response(JSON.stringify(server.vault), { status: 200 });
    }
    if (server.failPuts) {
      return new Response(
        JSON.stringify({
          error: { code: "write_unavailable", message: "write unavailable" },
        }),
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

function pausePlaintextAfterDecryptCall(callToPause = 1) {
  const subtle = globalThis.crypto.subtle;
  const originalDecrypt = subtle.decrypt;
  let calls = 0;
  let announceStarted;
  let releaseDecrypt;
  const started = new Promise((resolve) => {
    announceStarted = resolve;
  });
  const paused = new Promise((resolve) => {
    releaseDecrypt = resolve;
  });
  subtle.decrypt = function (...args) {
    calls++;
    const result = originalDecrypt.apply(this, args);
    if (calls !== callToPause) return result;
    return result.then(async (plaintext) => {
      announceStarted();
      await paused;
      return plaintext;
    });
  };
  return {
    started,
    release: () => releaseDecrypt(),
    restore: () => {
      subtle.decrypt = originalDecrypt;
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
    assert.equal(
      vaultSessionState.diary.profile.display_name,
      "Restored profile",
    );
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

test("a lock made during passphrase verification cannot be undone by the pending unlock", async () => {
  const mock = mockVaultServer();
  try {
    const { envelope } = await createEncryptedVault(
      { profile: { display_name: "Private" }, recipes: [], checkins: [] },
      passphrase,
    );
    await loadVaultSession();
    mock.server.vault = { revision: 1, envelope };
    await acceptServerVault(mock.server.vault);

    const pendingUnlock = unlockVaultWithPassphrase(passphrase);
    lockVaultSession();

    await assert.rejects(pendingUnlock, /status hat sich während des Öffnens/u);
    assert.equal(vaultSessionState.status, "locked");
    assert.equal(vaultSessionState.diary, null);
    assert.equal(isVaultUnlocked(), false);
  } finally {
    mock.restore();
  }
});

test("confirmed sign-out locks the in-memory diary before navigation", async () => {
  const mock = mockVaultServer();
  try {
    await loadVaultSession();
    const prepared = await prepareVault(
      { profile: { display_name: "Private" }, recipes: [], checkins: [] },
      passphrase,
    );
    await commitPreparedVault(prepared);
    assert.equal(isVaultUnlocked(), true);

    await logoutCurrentDevice();

    assert.equal(vaultSessionState.status, "locked");
    assert.equal(vaultSessionState.diary, null);
    assert.equal(isVaultUnlocked(), false);
  } finally {
    mock.restore();
  }
});

test("failed sign-out keeps the unlocked diary available for a retry", async () => {
  const mock = mockVaultServer();
  try {
    await loadVaultSession();
    const prepared = await prepareVault(
      { profile: { display_name: "Private" }, recipes: [], checkins: [] },
      passphrase,
    );
    await commitPreparedVault(prepared);
    mock.server.failLogout = true;

    await assert.rejects(logoutCurrentDevice(), /konnte nicht abgemeldet werden/u);
    assert.equal(isVaultUnlocked(), true);
    assert.equal(vaultSessionState.status, "unlocked");
    assert.equal(vaultSessionState.diary.profile.display_name, "Private");
  } finally {
    mock.restore();
  }
});

test("locking after initial-vault verification leaves the saved vault locked", async () => {
  const mock = mockVaultServer();
  const pause = pausePlaintextAfterDecryptCall();
  try {
    await loadVaultSession();
    const prepared = await prepareVault(
      { profile: { display_name: "Private" }, recipes: [], checkins: [] },
      passphrase,
    );
    const committing = commitPreparedVault(prepared);
    await pause.started;
    lockVaultSession();
    pause.release();

    await assert.rejects(committing, /bleibt gesperrt/u);
    assert.equal(mock.server.vault.revision, 1);
    assert.equal(vaultSessionState.status, "locked");
    assert.equal(vaultSessionState.diary, null);
    assert.equal(isVaultUnlocked(), false);
  } finally {
    pause.restore();
    mock.restore();
  }
});

test("locking after backup verification leaves the restored vault locked", async () => {
  const mock = mockVaultServer();
  const pause = pausePlaintextAfterDecryptCall(2);
  try {
    const { envelope } = await createEncryptedVault(
      { profile: { display_name: "Private backup" }, recipes: [], checkins: [] },
      passphrase,
    );
    await loadVaultSession();
    const restoring = restoreEncryptedVault(envelope, passphrase);
    await pause.started;
    lockVaultSession();
    pause.release();

    await assert.rejects(restoring, /bleibt gesperrt/u);
    assert.equal(mock.server.vault.revision, 1);
    assert.equal(vaultSessionState.status, "locked");
    assert.equal(vaultSessionState.diary, null);
    assert.equal(isVaultUnlocked(), false);
  } finally {
    pause.restore();
    mock.restore();
  }
});

test("locking after credential-rotation verification keeps the new vault locked", async () => {
  const mock = mockVaultServer();
  const nextPassphrase = "Neue!Passphrase!Abendsonne";
  try {
    await loadVaultSession();
    const initial = await prepareVault(
      { profile: { display_name: "Private" }, recipes: [], checkins: [] },
      passphrase,
    );
    await commitPreparedVault(initial);
    const prepared = await prepareVaultCredentialRotation(nextPassphrase);
    const pause = pausePlaintextAfterDecryptCall();
    try {
      const committing = commitVaultCredentialRotation(prepared);
      await pause.started;
      lockVaultSession();
      pause.release();

      await assert.rejects(committing, /entsperre den Tresor erneut/u);
      assert.equal(mock.server.vault.revision, 2);
      assert.equal(vaultSessionState.status, "locked");
      assert.equal(vaultSessionState.diary, null);
      assert.equal(isVaultUnlocked(), false);
      await unlockVaultWithPassphrase(nextPassphrase);
      assert.equal(vaultSessionState.status, "unlocked");
    } finally {
      pause.restore();
    }
  } finally {
    mock.restore();
  }
});

test("concurrent changes to separate diary entries merge and retry safely", async () => {
  const mock = mockVaultServer();
  try {
    const base = {
      profile: { display_name: "Private", body_group: "unspecified" },
      recipes: [{ id: "recipe-1", title: "Original", notes: "Original notes" }],
      meals: [],
      checkins: [],
      recipe_flags: [],
      stools: [],
      stress_observations: [],
    };
    await loadVaultSession();
    const prepared = await prepareVault(base, passphrase);
    await commitPreparedVault(prepared);

    const remoteDiary = structuredClone(base);
    remoteDiary.recipes[0].title = "Phone title";
    remoteDiary.meals.push({ id: "meal-from-phone", title: "Phone meal" });
    mock.server.vault = {
      revision: 2,
      envelope: {
        ...mock.server.vault.envelope,
        payload: await encryptVaultPayload(prepared.dataKey, remoteDiary),
      },
    };

    await transactDiary((draft) => {
      draft.recipes[0].notes = "Tablet notes";
      draft.checkins.push({ id: "note-from-tablet", notes: "Tablet note" });
      return { diary: draft, result: "saved" };
    });

    assert.equal(vaultSessionState.status, "unlocked");
    assert.equal(vaultSessionState.revision, 3);
    assert.deepEqual(vaultSessionState.diary.recipes[0], {
      ...remoteDiary.recipes[0],
      notes: "Tablet notes",
    });
    assert.deepEqual(vaultSessionState.diary.meals, remoteDiary.meals);
    assert.deepEqual(vaultSessionState.diary.checkins, [
      { id: "note-from-tablet", notes: "Tablet note" },
    ]);
    const stored = await decryptVaultPayload(
      prepared.dataKey,
      mock.server.vault.envelope.payload,
    );
    assert.deepEqual(stored, vaultSessionState.diary);
  } finally {
    mock.restore();
  }
});

test("same-field edits on two devices fail closed without overwriting either server copy", async () => {
  const mock = mockVaultServer();
  try {
    const base = {
      profile: { display_name: "Private" },
      recipes: [{ id: "recipe-1", title: "Original" }],
      meals: [],
      checkins: [],
      recipe_flags: [],
      stools: [],
      stress_observations: [],
    };
    await loadVaultSession();
    const prepared = await prepareVault(base, passphrase);
    await commitPreparedVault(prepared);

    const remoteDiary = structuredClone(base);
    remoteDiary.recipes[0].title = "Phone edit";
    mock.server.vault = {
      revision: 2,
      envelope: {
        ...mock.server.vault.envelope,
        payload: await encryptVaultPayload(prepared.dataKey, remoteDiary),
      },
    };

    await assert.rejects(
      transactDiary((draft) => {
        draft.recipes[0].title = "Tablet edit";
        return { diary: draft, result: "unsaved" };
      }),
      /gleichzeitig auf einem anderen Gerät geändert/u,
    );

    assert.equal(vaultSessionState.status, "conflict");
    assert.equal(vaultSessionState.diary, null);
    assert.equal(mock.server.vault.revision, 2);
    assert.equal(
      (
        await decryptVaultPayload(
          prepared.dataKey,
          mock.server.vault.envelope.payload,
        )
      ).recipes[0].title,
      "Phone edit",
    );
  } finally {
    mock.restore();
  }
});

test("a recipe deletion cannot orphan a meal added on another device", async () => {
  const mock = mockVaultServer();
  try {
    const base = {
      profile: { display_name: "Private" },
      recipes: [{ id: "recipe-1", title: "Saved recipe" }],
      meals: [],
      checkins: [],
      recipe_flags: [],
      stools: [],
      stress_observations: [],
    };
    await loadVaultSession();
    const prepared = await prepareVault(base, passphrase);
    await commitPreparedVault(prepared);

    const remoteDiary = structuredClone(base);
    remoteDiary.meals.push({
      id: "meal-from-phone",
      recipe_id: "recipe-1",
      title: "Saved recipe",
    });
    mock.server.vault = {
      revision: 2,
      envelope: {
        ...mock.server.vault.envelope,
        payload: await encryptVaultPayload(prepared.dataKey, remoteDiary),
      },
    };

    await assert.rejects(
      transactDiary((draft) => {
        draft.recipes = [];
        return { diary: draft, result: null };
      }),
      /gleichzeitig auf einem anderen Gerät geändert/u,
    );

    assert.equal(vaultSessionState.status, "conflict");
    assert.equal(mock.server.vault.revision, 2);
    const stored = await decryptVaultPayload(
      prepared.dataKey,
      mock.server.vault.envelope.payload,
    );
    assert.equal(stored.recipes[0].id, "recipe-1");
    assert.equal(stored.meals[0].recipe_id, "recipe-1");
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
    for (const secret of [
      passphrase,
      nextPassphrase,
      previousRecoveryKey,
      prepared.recoveryKey,
    ]) {
      assert.ok(!writes.includes(secret));
    }
    assert.ok(!writes.includes("Pseudonym bleibt privat"));
    assert.ok(!writes.includes("Bauchweh nach dem Essen"));

    lockVaultSession();
    await assert.rejects(unlockVaultWithPassphrase(passphrase), /ungültig/u);
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
    const diary = {
      profile: {},
      recipes: [],
      checkins: [{ notes: "still here" }],
    };
    await loadVaultSession();
    await commitPreparedVault(await prepareVault(diary, passphrase));
    const previousEnvelope = mock.server.vault.envelope;
    const prepared = await prepareVaultCredentialRotation(
      "Another!New!Passphrase!123",
    );
    mock.server.failPuts = true;

    await assert.rejects(
      commitVaultCredentialRotation(prepared),
      /write unavailable/u,
    );
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

test("stale revision with unchanged data is retried without losing the edit", async () => {
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
    await transactDiary((draft) => {
      draft.recipes.push({ id: "local-recipe", title: "keep this edit" });
      return { diary: draft, result: null };
    });
    assert.equal(vaultSessionState.status, "unlocked");
    assert.equal(vaultSessionState.diary.recipes[0].title, "keep this edit");
    assert.equal(vaultSessionState.revision, 3);
    assert.equal(isVaultUnlocked(), true);
  } finally {
    mock.restore();
  }
});
