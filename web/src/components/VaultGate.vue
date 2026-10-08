<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { usePage } from "@inertiajs/vue3";
import {
  LockKeyhole,
  ShieldCheck,
  KeyRound,
  Copy,
  LoaderCircle,
  Download,
} from "@lucide/vue";
import {
  acceptServerVault,
  commitPreparedVault,
  isVaultUnlocked,
  loadVaultSession,
  lockVaultSession,
  prepareVault,
  unlockVaultWithPassphrase,
  unlockVaultWithRecoveryKey,
  restoreEncryptedVault,
  vaultSessionState,
} from "../privacy/vault-session.js";
import {
  MAX_ENCRYPTED_BACKUP_BYTES,
  parseEncryptedVaultBackup,
} from "../privacy/vault-backup.js";
import { createVaultIdleLock } from "../privacy/vault-idle-lock.js";

const page = usePage();
const pageError = computed(() => page.props.loadError || "");
const passphraseField = ref(null);
const confirmPassphraseField = ref(null);
const recoveryInputField = ref(null);
const recoveryConfirmationField = ref(null);
const restoreSecretField = ref(null);
const recoveryStep = ref(false);
const recoveryConfirmed = ref(false);
const legacyLoaded = ref(false);
const recoveryMode = ref(false);
const restoreRecoveryMode = ref(false);
const backupFile = ref(null);
const backupName = ref("");
const busy = ref(false);
const error = ref("");
const message = ref("");
const unlocked = computed(() => isVaultUnlocked());
const legacyAvailable = computed(() => vaultSessionState.legacyAvailable);
// Keep prepared keys and imported legacy plaintext outside Vue's reactive
// object graph. They exist only during setup/migration in this component.
let preparedVault = null;
let recoveryKeyForConfirmation = "";
let legacyDiary = null;

const fieldValue = (field) => field.value?.value || "";
const clearField = (field) => {
  if (field.value) field.value.value = "";
};
const clearCredentials = () => {
  clearField(passphraseField);
  clearField(confirmPassphraseField);
  clearField(recoveryInputField);
  clearField(recoveryConfirmationField);
  clearField(restoreSecretField);
};

const blankDiary = () => ({
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
});

watch(
  () => page.props.vault,
  (vault) => {
    if (vault)
      acceptServerVault(vault).catch((cause) => (error.value = cause.message));
  },
  { immediate: true, deep: true },
);

async function loadLegacyDiary() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const response = await fetch("/api/legacy/diary", {
      cache: "no-store",
      headers: { "X-Encrypted-Migration": "1" },
    });
    const payload = await response.json();
    if (!response.ok)
      throw new Error(
        payload?.error?.message ||
          "Vorhandene Einträge konnten nicht geladen werden.",
      );
    legacyDiary = payload;
    legacyLoaded.value = true;
    message.value =
      "Deine vorhandenen Einträge sind nur in diesem Browser geöffnet. Beim Speichern werden sie verschlüsselt übertragen und die Klartextkopie auf dem Server in derselben Transaktion entfernt.";
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
}

async function createVault() {
  if (busy.value) return;
  if (pageError.value) return;
  error.value = "";
  message.value = "";
  const passphrase = fieldValue(passphraseField);
  const confirmation = fieldValue(confirmPassphraseField);
  if (passphrase.normalize("NFKC").trim().length < 12) {
    error.value = "Verwende eine Passphrase mit mindestens 12 Zeichen.";
    return;
  }
  if (passphrase !== confirmation) {
    error.value = "Die Passphrasen stimmen nicht überein.";
    return;
  }
  if (legacyAvailable.value && !legacyLoaded.value) {
    error.value =
      "Lade zuerst dein vorhandenes Tagebuch, damit kein Eintrag verloren geht.";
    return;
  }
  busy.value = true;
  try {
    preparedVault = await prepareVault(
      legacyDiary || blankDiary(),
      passphrase,
      { migrateLegacy: Boolean(legacyDiary) },
    );
    recoveryKeyForConfirmation = preparedVault.recoveryKey;
    recoveryStep.value = true;
    recoveryConfirmed.value = false;
    clearField(passphraseField);
    clearField(confirmPassphraseField);
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
}

async function confirmAndSaveVault() {
  if (busy.value || !preparedVault) return;
  if (pageError.value) return;
  if (!recoveryConfirmed.value) {
    error.value =
      "Die Wiederherstellungsphrase stimmt noch nicht exakt überein.";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    await commitPreparedVault(preparedVault);
    preparedVault = null;
    recoveryKeyForConfirmation = "";
    recoveryStep.value = false;
    recoveryConfirmed.value = false;
    legacyDiary = null;
    legacyLoaded.value = false;
    clearCredentials();
    message.value =
      "Dein Tagebuch ist eingerichtet und verschlüsselt gespeichert.";
  } catch (cause) {
    error.value = cause.message;
    if (vaultSessionState.status === "conflict") {
      preparedVault = null;
      recoveryKeyForConfirmation = "";
      recoveryStep.value = false;
      recoveryConfirmed.value = false;
      legacyDiary = null;
      legacyLoaded.value = false;
      clearCredentials();
    }
  } finally {
    busy.value = false;
  }
}

async function unlock() {
  if (busy.value) return;
  if (pageError.value) return;
  const useRecoveryKey = recoveryMode.value;
  let secret = useRecoveryKey
    ? fieldValue(recoveryInputField).trim()
    : fieldValue(passphraseField);
  busy.value = true;
  error.value = "";
  try {
    await loadVaultSession();
    if (useRecoveryKey) await unlockVaultWithRecoveryKey(secret);
    else await unlockVaultWithPassphrase(secret);
    clearField(passphraseField);
    clearField(recoveryInputField);
  } catch (cause) {
    error.value = cause.message;
  } finally {
    secret = "";
    busy.value = false;
  }
}

function selectBackup(event) {
  backupFile.value = event.target.files?.[0] || null;
  backupName.value = backupFile.value?.name || "";
  error.value = "";
}

async function restoreBackup() {
  if (busy.value || !backupFile.value || pageError.value) return;
  error.value = "";
  if (backupFile.value.size > MAX_ENCRYPTED_BACKUP_BYTES) {
    error.value = "Die Sicherungsdatei ist grösser als 16 MB.";
    return;
  }
  busy.value = true;
  try {
    const backup = parseEncryptedVaultBackup(await backupFile.value.text());
    const restoreSecret = fieldValue(restoreSecretField);
    await restoreEncryptedVault(
      backup.envelope,
      restoreRecoveryMode.value ? restoreSecret.trim() : restoreSecret,
      restoreRecoveryMode.value,
    );
    clearField(restoreSecretField);
    backupFile.value = null;
    backupName.value = "";
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
}

function checkRecoveryConfirmation() {
  recoveryConfirmed.value =
    fieldValue(recoveryConfirmationField).trim() === recoveryKeyForConfirmation;
}

function toggleRestoreCredentialMode() {
  restoreRecoveryMode.value = !restoreRecoveryMode.value;
  clearField(restoreSecretField);
}

async function copyRecoveryKey() {
  try {
    await navigator.clipboard.writeText(recoveryKeyForConfirmation);
    message.value =
      "Wiederherstellungsphrase kopiert. Speichere sie zusätzlich an einem sicheren Ort.";
  } catch {
    message.value =
      "Markiere die Wiederherstellungsphrase und speichere sie ausserhalb dieses Geräts.";
  }
}

let idleLock;
const recordActivity = () => idleLock?.activity();
const recheckIdleLock = () => {
  if (document.visibilityState === "visible") idleLock?.recheck();
};
onMounted(() => {
  idleLock = createVaultIdleLock({
    isUnlocked: () => unlocked.value,
    lock: lockVaultSession,
  });
  window.addEventListener("pointerdown", recordActivity, { passive: true });
  window.addEventListener("touchstart", recordActivity, { passive: true });
  window.addEventListener("wheel", recordActivity, { passive: true });
  window.addEventListener("keydown", recordActivity);
  document.addEventListener("visibilitychange", recheckIdleLock);
  window.addEventListener("pageshow", recheckIdleLock);
  idleLock.activity();
});
watch(unlocked, recordActivity);
onBeforeUnmount(() => {
  idleLock?.dispose();
  preparedVault = null;
  recoveryKeyForConfirmation = "";
  legacyDiary = null;
  clearCredentials();
  window.removeEventListener("pointerdown", recordActivity);
  window.removeEventListener("touchstart", recordActivity);
  window.removeEventListener("wheel", recordActivity);
  window.removeEventListener("keydown", recordActivity);
  document.removeEventListener("visibilitychange", recheckIdleLock);
  window.removeEventListener("pageshow", recheckIdleLock);
});
</script>

<template>
  <div v-if="unlocked" class="vault-active">
    <button class="vault-lock-button" type="button" @click="lockVaultSession">
      <LockKeyhole :size="15" /> Tagebuch sperren
    </button>
    <slot />
  </div>

  <main v-else class="vault-gate" aria-labelledby="vault-heading">
    <section class="vault-panel">
      <div class="vault-mark"><ShieldCheck :size="23" /></div>
      <p class="eyebrow">BAUCHGEFÜHL · PRIVATER TRESOR</p>
      <h1 id="vault-heading">
        {{
          vaultSessionState.status === "loading"
            ? "Tresor wird geprüft"
            : recoveryStep
              ? "Wiederherstellung sichern"
              : vaultSessionState.status === "setup"
                ? "Dein Tagebuch bleibt bei dir"
                : "Tagebuch entsperren"
        }}
      </h1>
      <p class="vault-intro">
        Deine Einträge werden auf diesem Gerät verschlüsselt. Der Server
        speichert nur den verschlüsselten Tresor; Passphrase und Schlüssel
        bleiben bei dir.
      </p>

      <div v-if="pageError" class="alert error" role="alert">
        {{ pageError }}
      </div>
      <div
        v-if="vaultSessionState.status === 'error'"
        class="alert error"
        role="alert"
      >
        {{ vaultSessionState.error }}
      </div>

      <section
        v-if="vaultSessionState.status === 'loading'"
        class="vault-loading"
        role="status"
      >
        <LoaderCircle class="loading-spinner" :size="20" /> Verschlüsselten
        Tresor laden …
      </section>

      <template v-else-if="recoveryStep">
        <div class="vault-recovery-warning" role="note">
          <strong>Diese Phrase wird nur jetzt angezeigt.</strong>
          <p>
            Ohne Passphrase und Wiederherstellungsphrase kann niemand dein
            Tagebuch wiederherstellen – auch nicht der Anbieter.
          </p>
        </div>
        <div class="vault-recovery-key" aria-label="Wiederherstellungsphrase">
          {{ recoveryKeyForConfirmation }}
        </div>
        <button class="button secondary" type="button" @click="copyRecoveryKey">
          <Copy :size="16" /> Phrase kopieren
        </button>
        <label class="vault-field">
          Wiederherstellungsphrase zur Bestätigung erneut eingeben
          <input
            class="d-input"
            ref="recoveryConfirmationField"
            type="password"
            autocomplete="off"
            spellcheck="false"
            @input="checkRecoveryConfirmation"
          />
        </label>
        <button
          class="button primary"
          type="button"
          :disabled="busy || !recoveryConfirmed"
          @click="confirmAndSaveVault"
        >
          <LoaderCircle v-if="busy" class="loading-spinner" :size="16" />
          Verschlüsselt speichern
        </button>
      </template>

      <form
        v-else-if="vaultSessionState.status === 'setup'"
        class="vault-form"
        @submit.prevent="createVault"
      >
        <div v-if="legacyAvailable" class="vault-migration-note">
          <strong>Vorhandene Einträge erkannt</strong>
          <p>
            Übernimm dein bisheriges Tagebuch. Erst wenn der verschlüsselte
            Upload geprüft ist, wird die Klartextkopie auf dem Server entfernt.
          </p>
          <button
            class="button secondary"
            type="button"
            :disabled="busy || legacyLoaded"
            @click="loadLegacyDiary"
          >
            {{
              legacyLoaded
                ? "Tagebuch für die Verschlüsselung bereit"
                : busy
                  ? "Lade Einträge …"
                  : "Vorhandenes Tagebuch übernehmen"
            }}
          </button>
        </div>
        <label class="vault-field">
          Neue Passphrase <span>mindestens 12 Zeichen</span>
          <input
            class="d-input"
            ref="passphraseField"
            type="password"
            autocomplete="new-password"
            minlength="12"
            required
          />
        </label>
        <label class="vault-field">
          Passphrase wiederholen
          <input
            class="d-input"
            ref="confirmPassphraseField"
            type="password"
            autocomplete="new-password"
            minlength="12"
            required
          />
        </label>
        <button
          class="button primary"
          type="submit"
          :disabled="busy || pageError || (legacyAvailable && !legacyLoaded)"
        >
          <KeyRound :size="16" /> Verschlüsselten Tresor einrichten
        </button>
      </form>

      <details
        v-if="vaultSessionState.status === 'setup' && !legacyAvailable"
        class="vault-backup-restore"
      >
        <summary>Verschlüsselte Sicherung wiederherstellen</summary>
        <p>
          Nur für einen leeren Tresor. Die Datei wird erst lokal mit deiner
          Passphrase oder Wiederherstellungsphrase geprüft; importiert wird
          ausschliesslich der verschlüsselte Inhalt. Es werden keine Einträge
          zusammengeführt.
        </p>
        <form class="vault-form" @submit.prevent="restoreBackup">
          <label class="vault-field">
            Sicherungsdatei
            <input
              class="d-input"
              type="file"
              accept="application/json,.json"
              @change="selectBackup"
              required
            />
            <small v-if="backupName">Ausgewählt: {{ backupName }}</small>
          </label>
          <label class="vault-field">
            {{
              restoreRecoveryMode ? "Wiederherstellungsphrase" : "Passphrase"
            }}
            <input
              class="d-input"
              ref="restoreSecretField"
              type="password"
              :autocomplete="restoreRecoveryMode ? 'off' : 'current-password'"
              spellcheck="false"
              required
            />
          </label>
          <button
            class="text-button"
            type="button"
            @click="toggleRestoreCredentialMode"
          >
            {{
              restoreRecoveryMode
                ? "Passphrase verwenden"
                : "Wiederherstellungsphrase verwenden"
            }}
          </button>
          <button
            class="button secondary"
            type="submit"
            :disabled="busy || pageError"
          >
            <Download :size="16" />
            {{
              busy
                ? "Sicherung wird geprüft …"
                : "Sicherung prüfen & wiederherstellen"
            }}
          </button>
        </form>
      </details>

      <form
        v-else-if="
          vaultSessionState.status === 'locked' ||
          vaultSessionState.status === 'conflict'
        "
        class="vault-form"
        @submit.prevent="unlock"
      >
        <label v-if="!recoveryMode" class="vault-field">
          Passphrase
          <input
            class="d-input"
            ref="passphraseField"
            type="password"
            autocomplete="current-password"
            required
          />
        </label>
        <label v-else class="vault-field">
          Wiederherstellungsphrase
          <input
            class="d-input"
            ref="recoveryInputField"
            type="password"
            autocomplete="off"
            spellcheck="false"
            required
          />
        </label>
        <button
          class="button primary"
          type="submit"
          :disabled="busy || pageError"
        >
          <LoaderCircle v-if="busy" class="loading-spinner" :size="16" />
          Tagebuch entsperren
        </button>
        <button
          class="text-button"
          type="button"
          @click="
            recoveryMode = !recoveryMode;
            error = '';
          "
        >
          {{
            recoveryMode
              ? "Stattdessen Passphrase verwenden"
              : "Mit Wiederherstellungsphrase öffnen"
          }}
        </button>
      </form>

      <p
        v-if="error || vaultSessionState.error"
        class="alert error"
        role="alert"
      >
        {{ error || vaultSessionState.error }}
      </p>
      <p v-if="message" class="alert info" role="status">{{ message }}</p>
      <p class="vault-footnote">
        Verwende ein langes, einzigartiges Passwort und bewahre die
        Wiederherstellungsphrase separat auf. Ein Pseudonym schützt deine
        Identität, ersetzt aber keine Verschlüsselung.
      </p>
    </section>
  </main>
</template>
