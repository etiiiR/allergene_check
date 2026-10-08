import { computed, readonly, shallowReactive } from "vue";
import {
  createEncryptedVault,
  decryptVaultPayload,
  encryptVaultPayload,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
} from "./vault-crypto.js";

const mutableState = shallowReactive({
  status: "loading", // loading | setup | locked | unlocked | conflict | error
  revision: 0,
  envelope: null,
  legacyAvailable: false,
  diary: null,
  error: "",
});

// Keep the non-extractable key outside Vue state. It is never persisted to
// localStorage, Inertia props, URLs, or the encrypted envelope.
export const vaultSessionState = readonly(mutableState);
let dataKey = null;
let sessionEpoch = 0;
let writeQueue = Promise.resolve();

function normaliseVault(value) {
  if (
    !value ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    (value.envelope !== null &&
      (typeof value.envelope !== "object" || Array.isArray(value.envelope)))
  ) {
    throw new Error("Die Tresor-Antwort ist ungültig.");
  }
  if ((value.revision === 0) !== (value.envelope === null)) {
    throw new Error(
      "Tresor-Version und verschlüsselte Daten passen nicht zusammen.",
    );
  }
  return {
    revision: value.revision,
    envelope: value.envelope,
    legacyAvailable: Boolean(value.legacy_available),
  };
}

async function requestVault(method = "GET", body) {
  let response;
  try {
    response = await fetch("/api/vault", {
      method,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(method === "GET" ? {} : { "X-Diary-Request": "1" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error("Der verschlüsselte Tresor ist gerade nicht erreichbar.");
  }
  if (!response.ok) {
    let payload;
    try {
      payload = await response.json();
    } catch {}
    const error = new Error(
      payload?.error?.message || "Der Tresor konnte nicht gespeichert werden.",
    );
    error.status = response.status;
    error.code = payload?.error?.code || "vault_request_failed";
    throw error;
  }
  return normaliseVault(await response.json());
}

function installLocked(vault) {
  dataKey = null;
  mutableState.revision = vault.revision;
  mutableState.envelope = vault.envelope;
  mutableState.legacyAvailable = vault.legacyAvailable;
  mutableState.diary = null;
  mutableState.status = vault.envelope ? "locked" : "setup";
  mutableState.error = "";
  sessionEpoch++;
}

export async function loadVaultSession() {
  mutableState.status = "loading";
  mutableState.error = "";
  try {
    const vault = await requestVault();
    installLocked(vault);
    return vault;
  } catch (error) {
    mutableState.status = "error";
    mutableState.error = error.message;
    throw error;
  }
}

// Inertia pages carry the opaque envelope only. On same-revision visits reuse
// the in-memory unlocked diary; on a newer revision decrypt it before rendering.
export async function acceptServerVault(value) {
  const incoming = normaliseVault(value);
  if (mutableState.status === "loading" || mutableState.status === "error") {
    installLocked(incoming);
    return false;
  }
  if (incoming.revision < mutableState.revision) {
    dataKey = null;
    mutableState.diary = null;
    mutableState.status = "conflict";
    mutableState.error =
      "Der Server-Tresor ist älter als dieser geöffnete Stand. Bitte neu laden, bevor du weiterarbeitest.";
    sessionEpoch++;
    return false;
  }
  if (incoming.revision === mutableState.revision) {
    if (
      JSON.stringify(incoming.envelope) !==
      JSON.stringify(mutableState.envelope)
    ) {
      dataKey = null;
      mutableState.diary = null;
      mutableState.status = "conflict";
      mutableState.error =
        "Der Tresorinhalt hat sich ohne neue Version geändert. Bitte lade die Seite neu.";
      sessionEpoch++;
      return false;
    }
    return mutableState.status === "unlocked";
  }
  if (mutableState.status === "unlocked" && dataKey && incoming.envelope) {
    const epoch = sessionEpoch;
    try {
      const diary = await decryptVaultPayload(
        dataKey,
        incoming.envelope.payload,
      );
      if (epoch !== sessionEpoch) return false;
      mutableState.revision = incoming.revision;
      mutableState.envelope = incoming.envelope;
      mutableState.diary = diary;
      mutableState.error = "";
      return true;
    } catch (error) {
      dataKey = null;
      mutableState.diary = null;
      mutableState.status = "conflict";
      mutableState.error = error.message;
      sessionEpoch++;
      return false;
    }
  }
  installLocked(incoming);
  return false;
}

export async function prepareVault(
  diary,
  passphrase,
  { migrateLegacy = false } = {},
) {
  if (mutableState.status !== "setup" || mutableState.envelope !== null) {
    throw new Error(
      "Ein Tresor ist bereits eingerichtet. Bitte zuerst entsperren.",
    );
  }
  const prepared = await createEncryptedVault(diary, passphrase);
  return {
    ...prepared,
    diary: structuredClone(diary),
    migrateLegacy,
    expectedRevision: mutableState.revision,
  };
}

// Call only after the user has saved the one-time recovery key. Read-after-write
// verifies that the stored envelope decrypts before the session is unlocked.
export async function commitPreparedVault(prepared) {
  if (
    !prepared?.envelope ||
    !prepared?.dataKey ||
    prepared.expectedRevision !== mutableState.revision ||
    mutableState.status !== "setup"
  ) {
    throw new Error("Der Tresorentwurf ist veraltet. Bitte erneut einrichten.");
  }
  const epoch = sessionEpoch;
  let saved;
  try {
    saved = await requestVault("PUT", {
      expected_revision: prepared.expectedRevision,
      envelope: prepared.envelope,
      migrate_legacy: prepared.migrateLegacy,
    });
  } catch (error) {
    if (error.status === 409) {
      dataKey = null;
      mutableState.diary = null;
      mutableState.status = "conflict";
      mutableState.error =
        "Ein Tresor wurde parallel eingerichtet. Bitte neu laden und den gespeicherten Tresor entsperren.";
      sessionEpoch++;
    }
    throw error;
  }
  if (
    saved.revision !== prepared.expectedRevision + 1 ||
    JSON.stringify(saved.envelope) !== JSON.stringify(prepared.envelope)
  ) {
    installLocked(saved);
    throw new Error(
      "Der gespeicherte Tresor stimmt nicht mit dem Entwurf überein.",
    );
  }
  if (epoch !== sessionEpoch || mutableState.status !== "setup") {
    installLocked(saved);
    throw new Error(
      "Der Tresor wurde gespeichert und bleibt gesperrt. Bitte entsperre ihn erneut.",
    );
  }
  const verifiedDiary = await decryptVaultPayload(
    prepared.dataKey,
    saved.envelope.payload,
  );
  if (JSON.stringify(verifiedDiary) !== JSON.stringify(prepared.diary)) {
    installLocked(saved);
    throw new Error(
      "Die gespeicherten Tagebuchdaten konnten nicht verifiziert werden.",
    );
  }
  dataKey = prepared.dataKey;
  mutableState.revision = saved.revision;
  mutableState.envelope = saved.envelope;
  mutableState.diary = verifiedDiary;
  mutableState.status = "unlocked";
  mutableState.error = "";
  sessionEpoch++;
  return { revision: saved.revision, diary: verifiedDiary };
}

async function unlockWith(unlocker, secret) {
  if (mutableState.status !== "locked" || !mutableState.envelope) {
    throw new Error("Es gibt keinen gesperrten Tresor zum Öffnen.");
  }
  mutableState.error = "";
  const unlocked = await unlocker(mutableState.envelope, secret);
  dataKey = unlocked.dataKey;
  mutableState.diary = unlocked.diary;
  mutableState.status = "unlocked";
  mutableState.error = "";
  sessionEpoch++;
  return unlocked.diary;
}

// Restore only into a truly empty vault. The backup is authenticated locally
// before any ciphertext is sent, and revision checks prevent overwriting a
// vault created by another tab while the restore screen was open.
export async function restoreEncryptedVault(
  envelope,
  secret,
  useRecoveryKey = false,
) {
  if (
    mutableState.status !== "setup" ||
    mutableState.envelope !== null ||
    mutableState.legacyAvailable
  ) {
    throw new Error(
      "Eine Sicherung kann nur in einen leeren Tresor importiert werden.",
    );
  }
  const expectedRevision = mutableState.revision;
  const epoch = sessionEpoch;
  const unlocker = useRecoveryKey
    ? unlockWithRecoveryKey
    : unlockWithPassphrase;
  const opened = await unlocker(envelope, secret);
  if (
    epoch !== sessionEpoch ||
    mutableState.status !== "setup" ||
    mutableState.envelope !== null ||
    mutableState.legacyAvailable ||
    mutableState.revision !== expectedRevision
  ) {
    throw new Error(
      "Der Tresor hat sich während der Prüfung geändert. Bitte lade die Seite neu.",
    );
  }
  let saved;
  try {
    saved = await requestVault("PUT", {
      expected_revision: expectedRevision,
      envelope,
      migrate_legacy: false,
    });
  } catch (error) {
    if (error.status === 409) {
      dataKey = null;
      mutableState.diary = null;
      mutableState.status = "conflict";
      mutableState.error =
        "Der Tresor wurde zwischenzeitlich eingerichtet. Bitte neu laden, bevor du fortfährst.";
      sessionEpoch++;
    }
    throw error;
  }
  if (
    saved.revision !== expectedRevision + 1 ||
    JSON.stringify(saved.envelope) !== JSON.stringify(envelope)
  ) {
    installLocked(saved);
    throw new Error(
      "Die wiederhergestellte Sicherung konnte nicht verifiziert werden.",
    );
  }
  if (epoch !== sessionEpoch || mutableState.status !== "setup") {
    installLocked(saved);
    throw new Error(
      "Die Sicherung wurde gespeichert. Bitte entsperre den Tresor erneut.",
    );
  }
  const verifiedDiary = await decryptVaultPayload(
    opened.dataKey,
    saved.envelope.payload,
  );
  if (JSON.stringify(verifiedDiary) !== JSON.stringify(opened.diary)) {
    installLocked(saved);
    throw new Error(
      "Die wiederhergestellten Tagebuchdaten konnten nicht verifiziert werden.",
    );
  }
  dataKey = opened.dataKey;
  mutableState.revision = saved.revision;
  mutableState.envelope = saved.envelope;
  mutableState.diary = verifiedDiary;
  mutableState.status = "unlocked";
  mutableState.error = "";
  sessionEpoch++;
  return { revision: saved.revision, diary: verifiedDiary };
}

export const unlockVaultWithPassphrase = (passphrase) =>
  unlockWith(unlockWithPassphrase, passphrase);

export const unlockVaultWithRecoveryKey = (recoveryKey) =>
  unlockWith(unlockWithRecoveryKey, recoveryKey);

// Serialize local mutations and encrypt each complete snapshot with a fresh
// nonce. Mutators receive a private clone, so failed validation never changes
// the visible diary or the last successfully saved vault.
export function transactDiary(mutator) {
  const operation = writeQueue.then(async () => {
    if (mutableState.status !== "unlocked" || !dataKey || !mutableState.diary) {
      throw new Error("Bitte entsperre zuerst dein Tagebuch.");
    }
    const epoch = sessionEpoch;
    const current = mutableState.diary;
    const draft = structuredClone(current);
    const change = await mutator(draft);
    if (!change || !change.diary || typeof change.diary !== "object") {
      throw new Error("Die Tagebuchänderung ist ungültig.");
    }
    if (epoch !== sessionEpoch || mutableState.status !== "unlocked") {
      throw new Error("Das Tagebuch wurde während der Änderung gesperrt.");
    }
    const encryptedPayload = await encryptVaultPayload(dataKey, change.diary);
    const nextEnvelope = {
      ...mutableState.envelope,
      payload: encryptedPayload,
    };
    if (epoch !== sessionEpoch || mutableState.status !== "unlocked") {
      throw new Error("Das Tagebuch wurde während der Änderung gesperrt.");
    }
    let saved;
    try {
      saved = await requestVault("PUT", {
        expected_revision: mutableState.revision,
        envelope: nextEnvelope,
      });
    } catch (error) {
      if (error.status === 409) {
        dataKey = null;
        mutableState.diary = null;
        mutableState.status = "conflict";
        mutableState.error =
          "Das Tagebuch wurde auf einem anderen Tab oder Gerät geändert. Bitte neu laden; deine noch nicht gespeicherte Eingabe bleibt im Formular.";
        sessionEpoch++;
      }
      throw error;
    }
    if (
      saved.revision !== mutableState.revision + 1 ||
      JSON.stringify(saved.envelope) !== JSON.stringify(nextEnvelope)
    ) {
      dataKey = null;
      mutableState.diary = null;
      mutableState.status = "conflict";
      mutableState.error =
        "Die gespeicherte Tresorversion weicht ab. Bitte lade die Seite neu.";
      sessionEpoch++;
      throw new Error(mutableState.error);
    }
    if (epoch !== sessionEpoch || mutableState.status !== "unlocked") {
      // The ciphertext is safely stored, but a lock that happened during the
      // request must not restore sensitive plaintext into the UI.
      mutableState.revision = saved.revision;
      mutableState.envelope = saved.envelope;
      return change.result;
    }
    mutableState.revision = saved.revision;
    mutableState.envelope = saved.envelope;
    mutableState.diary = change.diary;
    return change.result;
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

export function lockVaultSession() {
  dataKey = null;
  mutableState.diary = null;
  mutableState.status = mutableState.envelope ? "locked" : "setup";
  mutableState.error = "";
  sessionEpoch++;
}

export function isVaultUnlocked() {
  return (
    mutableState.status === "unlocked" && Boolean(dataKey && mutableState.diary)
  );
}

const emptyDiary = {
  profile: {
    display_name: "",
    onboarding_completed: false,
    body_group: "unspecified",
    cycle_tracking: false,
    cycle_length_days: 28,
    period_start: "",
  },
  recipes: [],
  meals: [],
  checkins: [],
  recipe_flags: [],
  stools: [],
  stress_observations: [],
};

export function useVaultDiary() {
  return computed(() => vaultSessionState.diary || emptyDiary);
}
