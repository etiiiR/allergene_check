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
    // Initial Inertia props can arrive after a local save or restore has
    // already accepted a newer revision. Keep the newer client state; actual
    // writes still use server-side compare-and-swap and fail closed on a real
    // server conflict.
    return mutableState.status === "unlocked";
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

// Build a replacement envelope with a fresh data key while keeping the current
// vault untouched. The caller must show and confirm the returned recovery key
// before committing this prepared rotation.
export function prepareVaultCredentialRotation(passphrase) {
  const operation = writeQueue.then(async () => {
    if (mutableState.status !== "unlocked" || !dataKey || !mutableState.diary) {
      throw new Error("Bitte entsperre zuerst dein Tagebuch.");
    }
    const epoch = sessionEpoch;
    const expectedRevision = mutableState.revision;
    const diary = structuredClone(mutableState.diary);
    const prepared = await createEncryptedVault(diary, passphrase);
    if (
      epoch !== sessionEpoch ||
      mutableState.status !== "unlocked" ||
      mutableState.revision !== expectedRevision
    ) {
      throw new Error(
        "Das Tagebuch hat sich während der Vorbereitung geändert. Bitte erneut versuchen.",
      );
    }
    return { ...prepared, diary, expectedRevision, epoch };
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

// Commit only the exact revision that was encrypted and shown to the user.
// Conflicts lock the session; recoverable request failures leave the old key,
// envelope and diary active so the user can retry safely.
export function commitVaultCredentialRotation(prepared) {
  const operation = writeQueue.then(async () => {
    if (
      !prepared?.envelope ||
      !prepared?.dataKey ||
      prepared.expectedRevision !== mutableState.revision ||
      prepared.epoch !== sessionEpoch ||
      mutableState.status !== "unlocked" ||
      !dataKey ||
      !mutableState.diary
    ) {
      const error = new Error(
        "Das Tagebuch hat sich geändert. Verwirf die neue Phrase und starte erneut.",
      );
      error.code = "vault_rotation_stale";
      throw error;
    }
    let saved;
    try {
      saved = await requestVault("PUT", {
        expected_revision: prepared.expectedRevision,
        envelope: prepared.envelope,
        migrate_legacy: false,
      });
    } catch (error) {
      if (error.status === 409) {
        dataKey = null;
        mutableState.diary = null;
        mutableState.status = "conflict";
        mutableState.error =
          "Das Tagebuch wurde in einem anderen Tab oder Gerät geändert. Bitte neu laden und erneut entsperren.";
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
        "Die gespeicherte Verschlüsselung weicht vom Entwurf ab. Bitte entsperre den Tresor erneut.",
      );
    }
    if (prepared.epoch !== sessionEpoch || mutableState.status !== "unlocked") {
      installLocked(saved);
      throw new Error(
        "Die Zugangsdaten wurden gespeichert. Bitte entsperre den Tresor erneut.",
      );
    }
    let verifiedDiary;
    try {
      verifiedDiary = await decryptVaultPayload(
        prepared.dataKey,
        saved.envelope.payload,
      );
    } catch {
      installLocked(saved);
      throw new Error(
        "Die neue Verschlüsselung konnte nicht geprüft werden. Entsperre den Tresor mit den neuen Zugangsdaten.",
      );
    }
    if (JSON.stringify(verifiedDiary) !== JSON.stringify(prepared.diary)) {
      installLocked(saved);
      throw new Error(
        "Die gespeicherten Tagebuchdaten stimmen nicht mit dem Entwurf überein. Entsperre den Tresor mit den neuen Zugangsdaten.",
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
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
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

const diaryCollections = [
  "recipes",
  "meals",
  "checkins",
  "recipe_flags",
  "stools",
  "stress_observations",
];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function sameValue(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

// Merge changes at the field level so concurrent edits to separate diary
// entries (or separate fields on one entry) can sync without losing either.
// A deletion racing an edit, or two different edits to the same field, needs
// the user's attention and is deliberately not guessed at.
function mergeObject(base, local, remote) {
  if (
    !base ||
    typeof base !== "object" ||
    Array.isArray(base) ||
    !local ||
    typeof local !== "object" ||
    Array.isArray(local) ||
    !remote ||
    typeof remote !== "object" ||
    Array.isArray(remote)
  )
    return null;

  const merged = {};
  const keys = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);
  for (const key of keys) {
    const before = base[key];
    const ours = local[key];
    const theirs = remote[key];
    const localChanged = !sameValue(before, ours);
    const remoteChanged = !sameValue(before, theirs);
    if (localChanged && remoteChanged && !sameValue(ours, theirs)) return null;
    const value = localChanged ? ours : theirs;
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

function mergeCollection(base, local, remote) {
  if (![base, local, remote].every(Array.isArray)) return null;
  const indexById = (items) => {
    const index = new Map();
    for (const item of items) {
      if (
        !item ||
        typeof item.id !== "string" ||
        !item.id ||
        index.has(item.id)
      ) {
        return null;
      }
      index.set(item.id, item);
    }
    return index;
  };
  const before = indexById(base);
  const ours = indexById(local);
  const theirs = indexById(remote);
  if (!before || !ours || !theirs) return null;

  const ids = new Set([...theirs.keys(), ...ours.keys()]);
  const result = new Map();
  for (const id of ids) {
    const prior = before.get(id);
    const localItem = ours.get(id);
    const remoteItem = theirs.get(id);
    const localChanged = !sameValue(prior, localItem);
    const remoteChanged = !sameValue(prior, remoteItem);
    let selected;
    if (localChanged && remoteChanged) {
      if (localItem === undefined || remoteItem === undefined) {
        if (localItem !== remoteItem) return null;
        selected = undefined;
      } else {
        selected = mergeObject(prior || {}, localItem, remoteItem);
        if (!selected) return null;
      }
    } else {
      selected = localChanged ? localItem : remoteItem;
    }
    if (selected !== undefined) result.set(id, selected);
  }

  // Preserve the server's ordering and append only local additions.
  const order = [...remote.map((item) => item.id)];
  for (const item of local) {
    if (!theirs.has(item.id)) order.push(item.id);
  }
  return order.filter((id) => result.has(id)).map((id) => result.get(id));
}

function diaryLinks(diary) {
  const recipeItems = diary.recipes || [];
  const mealItems = diary.meals || [];
  const checkins = diary.checkins || [];
  const flags = diary.recipe_flags || [];
  const recipes = new Set(recipeItems.map((item) => item.id));
  const meals = new Map(mealItems.map((item) => [item.id, item]));
  const links = new Map();
  for (const meal of mealItems) {
    if (meal.recipe_id) {
      links.set(
        `meal:${meal.id}:recipe:${meal.recipe_id}`,
        recipes.has(meal.recipe_id),
      );
    }
  }
  for (const checkin of checkins) {
    if (checkin.reference_meal_id) {
      links.set(
        `checkin:${checkin.id}:meal:${checkin.reference_meal_id}`,
        meals.has(checkin.reference_meal_id),
      );
    }
  }
  for (const flag of flags) {
    if (flag.recipe_id) {
      links.set(
        `flag:${flag.id}:recipe:${flag.recipe_id}`,
        recipes.has(flag.recipe_id),
      );
    }
    if (flag.meal_id) {
      links.set(
        `flag:${flag.id}:meal:${flag.meal_id}`,
        meals.get(flag.meal_id)?.recipe_id === flag.recipe_id,
      );
    }
  }
  return links;
}

function mergeConcurrentDiaries(base, local, remote) {
  const merged = structuredClone(remote);
  const profile = mergeObject(base.profile, local.profile, remote.profile);
  if (!profile) return null;
  merged.profile = profile;

  for (const name of diaryCollections) {
    const collection = mergeCollection(
      base[name] || [],
      local[name] || [],
      remote[name] || [],
    );
    if (!collection) return null;
    merged[name] = collection;
  }

  const known = new Set(["profile", ...diaryCollections]);
  const keys = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);
  for (const key of keys) {
    if (known.has(key)) continue;
    const value = mergeObject(
      { value: base[key] },
      { value: local[key] },
      { value: remote[key] },
    );
    if (!value) return null;
    if (value.value === undefined) delete merged[key];
    else merged[key] = value.value;
  }

  const existingLinks = diaryLinks(base);
  for (const [link, exists] of diaryLinks(merged)) {
    if (!exists && !existingLinks.has(link)) return null;
  }
  return merged;
}

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
    const base = structuredClone(current);
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
      if (error.status !== 409) throw error;

      try {
        const latest = await requestVault();
        if (
          epoch !== sessionEpoch ||
          mutableState.status !== "unlocked" ||
          !dataKey
        )
          throw new Error(
            "Das Tagebuch wurde während der Synchronisierung gesperrt.",
          );
        if (latest.revision <= mutableState.revision || !latest.envelope) {
          throw new Error(
            "Die aktuelle Tresorversion konnte nicht gelesen werden.",
          );
        }

        const remoteDiary = await decryptVaultPayload(
          dataKey,
          latest.envelope.payload,
        );
        const mergedDiary = mergeConcurrentDiaries(
          base,
          change.diary,
          remoteDiary,
        );
        if (!mergedDiary) {
          const conflict = new Error(
            "Ein Eintrag, eine Verknüpfung oder ein Feld wurde gleichzeitig auf einem anderen Gerät geändert. Dein bisher gespeicherter Tresor bleibt erhalten; diese Eingabe wurde nicht gespeichert. Bitte entsperre den aktuellen Tresor und gib die Änderung danach erneut ein.",
          );
          conflict.code = "vault_merge_conflict";
          throw conflict;
        }

        if (epoch !== sessionEpoch || mutableState.status !== "unlocked") {
          throw new Error(
            "Das Tagebuch wurde während der Synchronisierung gesperrt.",
          );
        }
        const mergedEnvelope = {
          ...latest.envelope,
          payload: await encryptVaultPayload(dataKey, mergedDiary),
        };
        saved = await requestVault("PUT", {
          expected_revision: latest.revision,
          envelope: mergedEnvelope,
        });
        if (
          saved.revision !== latest.revision + 1 ||
          !sameValue(saved.envelope, mergedEnvelope)
        ) {
          throw new Error(
            "Die synchronisierte Tresorversion konnte nicht bestätigt werden.",
          );
        }
        if (epoch !== sessionEpoch || mutableState.status !== "unlocked") {
          mutableState.revision = saved.revision;
          mutableState.envelope = saved.envelope;
          return change.result;
        }
        mutableState.revision = saved.revision;
        mutableState.envelope = saved.envelope;
        mutableState.diary = mergedDiary;
        return change.result;
      } catch (syncError) {
        if (epoch === sessionEpoch && mutableState.status === "unlocked") {
          dataKey = null;
          mutableState.diary = null;
          mutableState.status = "conflict";
          mutableState.error =
            syncError.code === "vault_merge_conflict"
              ? syncError.message
              : syncError.status === 409
                ? "Ein weiteres Gerät hat während der Synchronisierung gespeichert. Diese Eingabe wurde nicht gespeichert. Bitte entsperre den aktuellen Tresor und gib sie erneut ein."
                : "Die Synchronisierung konnte nicht sicher abgeschlossen werden. Diese Eingabe wurde nicht gespeichert. Bitte entsperre den aktuellen Tresor und gib sie erneut ein.";
          sessionEpoch++;
        }
        throw syncError;
      }
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
