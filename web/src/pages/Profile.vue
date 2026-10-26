<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { Head, Link, router } from "@inertiajs/vue3";
import {
  CalendarDays,
  Check,
  Copy,
  Download,
  FileJson,
  HeartPulse,
  Info,
  KeyRound,
  LogOut,
  Save,
  Settings,
  ShieldCheck,
  Upload,
} from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import PrivacySummary from "../components/PrivacySummary.vue";
import { api } from "../lib";
import { notify } from "../ui/feedback";
import { nativeHealthAvailable, syncAppleHealth } from "../ui/health";
import { generatePseudonym } from "../privacy/pseudonym";
import {
  commitVaultCredentialRotation,
  prepareVaultCredentialRotation,
  useVaultDiary,
  vaultSessionState,
} from "../privacy/vault-session.js";
import { createEncryptedVaultBackup } from "../privacy/vault-backup.js";

const diary = useVaultDiary();
const stored = computed(() => diary.value.profile || {});
const form = reactive({
  ...stored.value,
  display_name: stored.value.display_name || "",
  body_group: stored.value.body_group || "unspecified",
  cycle_tracking: Boolean(stored.value.cycle_tracking),
  cycle_length_days: stored.value.cycle_length_days || 28,
  period_start: stored.value.period_start || "",
});
const busy = ref(false);
const error = ref("");
const saved = ref(false);
const backupError = ref("");
const backupStatus = ref("");
const tab = ref("person");
const rotationPassphraseField = ref(null);
const rotationConfirmPassphraseField = ref(null);
const rotationConfirmRecoveryField = ref(null);
const rotationStep = ref(false);
const rotationConfirmed = ref(false);
const rotationBusy = ref(false);
const rotationError = ref("");
const rotationStatus = ref("");
const logoutBusy = ref(false);
const logoutError = ref("");
const revokeOtherBusy = ref(false);
const revokeOtherError = ref("");
const revokeOtherStatus = ref("");
const deviceSessions = ref([]);
const deviceSessionsBusy = ref(false);
const deviceSessionsError = ref("");
const revokeSessionBusyID = ref("");
const currentAccountPasswordField = ref(null);
const newAccountPasswordField = ref(null);
const confirmAccountPasswordField = ref(null);
const accountPasswordBusy = ref(false);
const accountPasswordError = ref("");
const accountPasswordStatus = ref("");
let preparedRotation = null;
let rotationRecoveryKey = "";
const healthSource = ref("apple_healthkit");
const healthFile = ref(null);
const healthBusy = ref(false);
const healthError = ref("");
const healthStatus = ref("");
const hasNativeHealth = nativeHealthAvailable();
const nativeBusy = ref(false);
const nativeStatus = ref("");
const nativeError = ref("");
async function syncNativeHealth() {
  if (nativeBusy.value) return;
  nativeBusy.value = true;
  nativeStatus.value = "";
  nativeError.value = "";
  try {
    const result = await syncAppleHealth();
    nativeStatus.value = result.empty
      ? "Keine freigegebenen Messungen im gewählten Zeitraum. Prüfe die Berechtigungen in Apple Health. Daraus lässt sich nicht erkennen, ob du den Zugriff abgelehnt hast."
      : `${result.imported} Messungen hinzugefügt, ${result.updated || 0} aktualisiert.`;
    if (!result.empty) {
      notify(nativeStatus.value);
      router.reload();
    }
  } catch (e) {
    nativeError.value = e.message;
  } finally {
    nativeBusy.value = false;
  }
}

function chooseBodyGroup() {
  saved.value = false;
  if (form.body_group !== "female") {
    form.cycle_tracking = false;
    form.period_start = "";
  }
}

async function saveProfile() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  saved.value = false;
  try {
    await api("/profile", {
      method: "PUT",
      body: JSON.stringify(form),
    });
    saved.value = true;
    notify("Profil gespeichert.");
    router.reload({ onFinish: () => (busy.value = false) });
  } catch (e) {
    error.value = e.message;
    notify(e.message, "error");
    busy.value = false;
  }
}

function chooseHealthFile(event) {
  healthFile.value = event.target.files?.[0] || null;
  healthError.value = "";
  healthStatus.value = "";
}

async function importHealth() {
  if (!healthFile.value) {
    healthError.value = "Bitte zuerst eine JSON-Datei auswählen.";
    return;
  }
  healthBusy.value = true;
  healthError.value = "";
  healthStatus.value = "";
  try {
    const raw = JSON.parse(await healthFile.value.text());
    const records = Array.isArray(raw) ? raw : raw?.records;
    if (!Array.isArray(records) || !records.length) {
      throw new Error("Die Datei enthält keine records-Liste.");
    }
    const source = healthSource.value;
    const payload = {
      source,
      records: records.map((record) => ({ ...record, source })),
    };
    const response = await api("/health/import", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    healthStatus.value = `${response.imported} neu importiert${response.updated ? `, ${response.updated} aktualisiert` : ""}.`;
    healthFile.value = null;
    notify(healthStatus.value);
    router.reload();
  } catch (e) {
    healthError.value =
      e instanceof SyntaxError
        ? "Die Datei ist kein gültiges JSON."
        : e.message;
  } finally {
    healthBusy.value = false;
  }
}

function downloadEncryptedBackup() {
  backupError.value = "";
  backupStatus.value = "";
  try {
    const backup = createEncryptedVaultBackup(vaultSessionState.envelope);
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gutfeeling-encrypted-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    backupStatus.value =
      "Verschlüsselte Sicherung heruntergeladen. Bewahre die Datei sicher auf.";
  } catch (e) {
    backupError.value = e.message;
  }
}

const fieldValue = (field) => field.value?.value || "";
const clearField = (field) => {
  if (field.value) field.value.value = "";
};

async function logoutThisDevice() {
  if (logoutBusy.value) return;
  logoutBusy.value = true;
  logoutError.value = "";
  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-Diary-Request": "1" },
    });
    if (!response.ok) {
      throw new Error("Dieses Gerät konnte nicht abgemeldet werden.");
    }
    window.location.replace("/login");
  } catch (cause) {
    logoutError.value = cause.message;
    logoutBusy.value = false;
  }
}

async function revokeOtherDevices() {
  if (revokeOtherBusy.value) return;
  revokeOtherBusy.value = true;
  revokeOtherError.value = "";
  revokeOtherStatus.value = "";
  try {
    const response = await fetch("/api/auth/sessions/others", {
      method: "DELETE",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-Diary-Request": "1" },
    });
    let result;
    try {
      result = await response.json();
    } catch {}
    if (!response.ok) {
      throw new Error(
        result?.error?.message ||
          "Andere Geräte konnten nicht abgemeldet werden.",
      );
    }
    const revoked = Number(result?.revoked) || 0;
    revokeOtherStatus.value = revoked
      ? `${revoked} weitere Anmeldung${revoked === 1 ? "" : "en"} abgemeldet.`
      : "Es waren keine weiteren Anmeldungen aktiv.";
    await loadDeviceSessions();
  } catch (cause) {
    revokeOtherError.value = cause.message;
  } finally {
    revokeOtherBusy.value = false;
  }
}

async function loadDeviceSessions() {
  if (deviceSessionsBusy.value) return;
  deviceSessionsBusy.value = true;
  deviceSessionsError.value = "";
  try {
    const response = await fetch("/api/auth/sessions", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        result?.error?.message || "Anmeldungen konnten nicht geladen werden.",
      );
    }
    deviceSessions.value = Array.isArray(result.sessions) ? result.sessions : [];
  } catch (cause) {
    deviceSessionsError.value = cause.message;
  } finally {
    deviceSessionsBusy.value = false;
  }
}

async function revokeDeviceSession(session) {
  if (session.current || revokeSessionBusyID.value) return;
  revokeSessionBusyID.value = session.id;
  deviceSessionsError.value = "";
  try {
    const response = await fetch(
      `/api/auth/sessions/${encodeURIComponent(session.id)}`,
      {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "X-Diary-Request": "1" },
      },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        result?.error?.message || "Dieses Gerät konnte nicht abgemeldet werden.",
      );
    }
    deviceSessions.value = deviceSessions.value.filter(
      (item) => item.id !== session.id,
    );
    notify(`${session.device_label} wurde abgemeldet.`);
  } catch (cause) {
    deviceSessionsError.value = cause.message;
  } finally {
    revokeSessionBusyID.value = "";
  }
}

function sessionCreatedAt(timestamp) {
  if (!timestamp) return "Datum nicht verfügbar";
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp * 1000));
}

watch(
  tab,
  (value) => {
    if (value === "security") loadDeviceSessions();
  },
  { immediate: true },
);

async function changeAccountPassword() {
  if (accountPasswordBusy.value) return;
  accountPasswordError.value = "";
  accountPasswordStatus.value = "";
  const currentPassword = currentAccountPasswordField.value?.value || "";
  const newPassword = newAccountPasswordField.value?.value || "";
  const confirmation = confirmAccountPasswordField.value?.value || "";
  if (newPassword.length < 12) {
    accountPasswordError.value =
      "Das neue Kontopasswort muss mindestens 12 Zeichen lang sein.";
    return;
  }
  if (newPassword !== confirmation) {
    accountPasswordError.value = "Die neuen Passwörter stimmen nicht überein.";
    return;
  }
  accountPasswordBusy.value = true;
  try {
    const response = await fetch("/api/auth/password", {
      method: "PUT",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Diary-Request": "1",
      },
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
    let result;
    try {
      result = await response.json();
    } catch {}
    if (!response.ok) {
      throw new Error(
        result?.error?.message ||
          "Das Kontopasswort konnte nicht geändert werden.",
      );
    }
    for (const field of [
      currentAccountPasswordField,
      newAccountPasswordField,
      confirmAccountPasswordField,
    ]) {
      if (field.value) field.value.value = "";
    }
    const revoked = Number(result?.revoked_other_sessions) || 0;
    const deviceStatus = revoked
      ? revoked === 1
        ? "1 weitere Anmeldung wurde abgemeldet."
        : `${revoked} weitere Anmeldungen wurden abgemeldet.`
      : "Es waren keine weiteren Geräte angemeldet.";
    accountPasswordStatus.value = `Kontopasswort geändert. ${deviceStatus} Deine Tresor-Passphrase bleibt unverändert.`;
  } catch (cause) {
    accountPasswordError.value = cause.message;
  } finally {
    accountPasswordBusy.value = false;
  }
}

function clearRotation() {
  preparedRotation = null;
  rotationRecoveryKey = "";
  rotationStep.value = false;
  rotationConfirmed.value = false;
  clearField(rotationPassphraseField);
  clearField(rotationConfirmPassphraseField);
  clearField(rotationConfirmRecoveryField);
}

function cancelCredentialRotation() {
  clearRotation();
  rotationError.value = "";
  rotationStatus.value = "";
}

async function prepareCredentialRotation() {
  if (rotationBusy.value) return;
  const nextPassphrase = fieldValue(rotationPassphraseField);
  const confirmation = fieldValue(rotationConfirmPassphraseField);
  rotationError.value = "";
  rotationStatus.value = "";
  if (nextPassphrase.normalize("NFKC").trim().length < 12) {
    rotationError.value = "Verwende eine Passphrase mit mindestens 12 Zeichen.";
    return;
  }
  if (nextPassphrase !== confirmation) {
    rotationError.value = "Die Passphrasen stimmen nicht überein.";
    return;
  }
  rotationBusy.value = true;
  try {
    preparedRotation = await prepareVaultCredentialRotation(nextPassphrase);
    rotationRecoveryKey = preparedRotation.recoveryKey;
    rotationStep.value = true;
    rotationConfirmed.value = false;
    clearField(rotationPassphraseField);
    clearField(rotationConfirmPassphraseField);
  } catch (cause) {
    rotationError.value = cause.message;
    clearField(rotationPassphraseField);
    clearField(rotationConfirmPassphraseField);
  } finally {
    rotationBusy.value = false;
  }
}

function checkRotationRecovery() {
  rotationConfirmed.value =
    fieldValue(rotationConfirmRecoveryField).trim() === rotationRecoveryKey;
}

async function saveCredentialRotation() {
  if (rotationBusy.value || !preparedRotation) return;
  rotationError.value = "";
  rotationStatus.value = "";
  if (!rotationConfirmed.value) {
    rotationError.value =
      "Die Wiederherstellungsphrase stimmt noch nicht exakt überein.";
    return;
  }
  rotationBusy.value = true;
  try {
    await commitVaultCredentialRotation(preparedRotation);
    clearRotation();
    rotationStatus.value =
      "Der Tresor ist mit den neuen Zugangsdaten verschlüsselt. Bewahre die neue Wiederherstellungsphrase sicher auf.";
  } catch (cause) {
    rotationError.value = cause.message;
    if (
      cause.code === "vault_rotation_stale" ||
      vaultSessionState.status === "conflict"
    ) {
      clearRotation();
    }
  } finally {
    rotationBusy.value = false;
  }
}

async function copyRotationRecoveryKey() {
  try {
    await navigator.clipboard.writeText(rotationRecoveryKey);
    rotationStatus.value =
      "Wiederherstellungsphrase kopiert. Bewahre sie zusätzlich sicher auf.";
  } catch {
    rotationStatus.value =
      "Markiere die Wiederherstellungsphrase und speichere sie ausserhalb dieses Geräts.";
  }
}

onBeforeUnmount(clearRotation);
</script>

<template>
  <Head title="Profil und Zyklus" />
  <AppShell>
    <div class="page-heading profile-heading">
      <div>
        <p class="eyebrow"><Settings :size="14" /> DEIN KONTEXT</p>
        <h1>Profil & Zyklus</h1>
        <p>
          {{
            stored.display_name
              ? "Dein persönliches Tagebuch. Änderungen werden verschlüsselt im Tresor gespeichert."
              : "Füge eine Person für dieses Tagebuch hinzu."
          }}
        </p>
      </div>
    </div>

    <div class="segmented-nav" aria-label="Profileinstellungen">
      <UiButton
        type="button"
        :aria-pressed="tab === 'person'"
        @click="tab = 'person'"
        >Person</UiButton
      >
      <UiButton
        type="button"
        :aria-pressed="tab === 'body'"
        @click="tab = 'body'"
        >Körper & Zyklus</UiButton
      >
      <UiButton
        type="button"
        :aria-pressed="tab === 'health'"
        @click="tab = 'health'"
        >Health</UiButton
      >
      <UiButton
        type="button"
        :aria-pressed="tab === 'security'"
        @click="tab = 'security'"
        >Sicherheit</UiButton
      >
    </div>
    <form
      class="profile-settings compact-profile"
      @submit.prevent="saveProfile"
    >
      <section
        v-if="tab === 'person'"
        class="panel profile-card"
        data-tone="well"
      >
        <div class="section-heading">
          <h2>Deine Person</h2>
          <Link href="/onboarding?edit=1" class="text-button">{{
            stored.onboarding_completed
              ? "Profil-Assistent öffnen"
              : "Geführt einrichten"
          }}</Link>
        </div>
        <label
          >Pseudonym<input
            class="d-input"
            v-model="form.display_name"
            maxlength="80"
            autocomplete="nickname"
            :required="Boolean(form.onboarding_completed)"
            @input="saved = false"
        /></label>
        <UiButton
          type="button"
          class="text-button"
          @click="
            form.display_name = generatePseudonym();
            saved = false;
          "
          >Neues Pseudonym erstellen</UiButton
        >
        <p class="helper">
          Ein Pseudonym ist nur ein Anzeigename und macht dich nicht anonym.
          Auch der Name liegt im verschlüsselten Tagebuch.
        </p>
        <div class="profile-backup">
          <div>
            <strong>Verschlüsselte Sicherung</strong>
            <p class="helper">
              Lädt eine Datei mit verschlüsselten Daten herunter. Für eine
              Wiederherstellung brauchst du deine Passphrase oder Phrase.
            </p>
          </div>
          <UiButton
            type="button"
            class="button secondary"
            @click="downloadEncryptedBackup"
          >
            <Download :size="16" /> Sicherung herunterladen
          </UiButton>
          <p v-if="backupError" class="alert error" role="alert">
            {{ backupError }}
          </p>
          <p v-if="backupStatus" class="alert success" role="status">
            {{ backupStatus }}
          </p>
        </div>
        <PrivacySummary />
      </section>
      <section
        v-show="tab === 'body'"
        class="panel profile-card"
        data-tone="cycle"
      >
        <div class="section-heading">
          <div>
            <h2>Optionaler Körperkontext</h2>
          </div>
          <Info :size="18" class="muted" />
        </div>
        <label class="profile-field">
          Körperkontext
          <select
            class="d-select"
            v-model="form.body_group"
            aria-label="Körperkontext"
            @change="chooseBodyGroup"
          >
            <option value="unspecified">Nicht angegeben</option>
            <option value="male">Männlicher Körperkontext</option>
            <option value="female">Weiblicher Körperkontext</option>
            <option value="other">Anderer Körperkontext</option>
          </select>
        </label>
        <p class="helper">
          Männer-, Frauen- und andere Kontexte werden nicht in ein gemeinsames
          Zyklusmodell gemischt. Die Einstellung ist optional.
        </p>
      </section>

      <section
        v-if="tab === 'body' && form.body_group === 'female'"
        class="panel profile-card cycle-card"
        data-tone="cycle"
      >
        <div class="section-heading">
          <div>
            <h2>Zyklusbeobachtung</h2>
            <small
              >Nur aktivieren, wenn du diesen Kontext nutzen möchtest.</small
            >
          </div>
          <CalendarDays :size="19" class="muted" />
        </div>
        <label class="toggle-row">
          <span>
            <strong>Zyklus in Check-ins berücksichtigen</strong>
            <small
              >Symptome können zusätzlich nach Phase verglichen werden.</small
            >
          </span>
          <input
            class="d-input"
            v-model="form.cycle_tracking"
            type="checkbox"
          />
        </label>
        <div v-if="form.cycle_tracking" class="cycle-fields">
          <label class="profile-field">
            Beginn der letzten Periode
            <input class="d-input" v-model="form.period_start" type="date" />
          </label>
          <label class="profile-field">
            Übliche Zykluslänge
            <span class="inline-input">
              <input
                class="d-input"
                v-model.number="form.cycle_length_days"
                type="number"
                min="21"
                max="45"
                required
              />
              <small>Tage</small>
            </span>
          </label>
        </div>
        <p class="helper">
          Die Phasen werden nur grob aus deinen Angaben abgeleitet. Sie sind
          keine Fruchtbarkeits-, Verhütungs- oder Diagnosefunktion.
        </p>
      </section>

      <section
        v-show="tab === 'health'"
        class="panel profile-card health-card"
        data-tone="stress"
      >
        <h2>Apple Health verbinden</h2>
        <p class="helper">
          Mit deiner Freigabe liest die iOS-App Puls, Ruhepuls und HRV aus den
          letzten 7 Tagen und überträgt sie an diesen Tagebuch-Server. Keine
          Datei nötig. HRV ist kein Stress-Score. Gelesen werden höchstens 500
          der neuesten Messungen pro Typ.
        </p>
        <UiButton
          type="button"
          class="button primary"
          :loading="nativeBusy"
          :disabled="!hasNativeHealth || nativeBusy"
          @click="syncNativeHealth"
          >Apple Health freigeben & synchronisieren</UiButton
        >
        <p v-if="!hasNativeHealth" class="helper">
          Hier läuft die Web-App. Die Freigabe funktioniert in der nativen
          iOS-App, nicht im Browser. Die iOS-Hülle muss zuerst gebaut und auf
          deinem iPhone installiert werden.
        </p>
        <p v-if="nativeStatus" role="status" class="alert success">
          {{ nativeStatus }}
        </p>
        <p v-if="nativeError" role="alert" class="alert error">
          {{ nativeError }}
        </p>
        <p class="helper">
          Berechtigungen kannst du jederzeit in Apple Health widerrufen. Bereits
          synchronisierte Einträge bleiben im Tagebuch, bis du sie dort löschst.
          Android/Samsung sind noch nicht angebunden.
        </p>
        <details class="legacy-health-import">
          <summary>Datei-Import für andere Quellen (optional)</summary>
          <div class="section-heading">
            <div>
              <h2>Stress aus Health-Daten</h2>
              <small
                >Watch, Ring oder Smartphone als zusätzliche Zeitspur.</small
              >
            </div>
            <HeartPulse :size="19" class="muted" />
          </div>
          <p class="helper">
            Die Web-App kann nicht direkt auf Apple Health oder Android Health
            Connect zugreifen. Eine kleine iOS-/Android-Bridge oder ein Export
            liest die Daten mit deiner Zustimmung und übergibt hier eine
            normalisierte JSON-Datei.
          </p>
          <label class="profile-field">
            Quelle der Datei
            <select
              class="d-select"
              v-model="healthSource"
              aria-label="Quelle der Gesundheitsdaten"
            >
              <option value="apple_healthkit">Apple Health / HealthKit</option>
              <option value="android_health_connect">
                Android Health Connect
              </option>
              <option value="oura">Oura / Ring</option>
              <option value="watch">Andere Watch</option>
              <option value="generic">Andere normalisierte Quelle</option>
            </select>
          </label>
          <label class="health-file-picker">
            <FileJson :size="18" />
            <span>
              <strong>{{ healthFile?.name || "JSON-Datei auswählen" }}</strong>
              <small>Stress-Score 0–10 oder Rohwerte wie HRV / Puls</small>
            </span>
            <input
              class="d-input"
              type="file"
              accept="application/json,.json"
              @change="chooseHealthFile"
            />
          </label>
          <UiButton
            class="button secondary health-import"
            type="button"
            :disabled="healthBusy"
            @click="importHealth"
          >
            <Upload :size="16" />
            {{ healthBusy ? "Wird importiert …" : "Health-Daten importieren" }}
          </UiButton>
          <p v-if="healthError" class="alert error" role="alert">
            {{ healthError }}
          </p>
          <p v-if="healthStatus" class="alert success" role="status">
            <Check :size="16" /> {{ healthStatus }}
          </p>
          <div class="health-safety-note">
            <ShieldCheck :size="16" />
            <span
              >Nur ausdrücklich normalisierte Stress-Scores werden analysiert.
              HRV und Puls werden nicht automatisch in Stress umgerechnet.</span
            >
          </div>
        </details>
      </section>

      <section
        v-if="tab === 'security'"
        class="panel profile-card vault-credentials-card"
        data-tone="privacy"
      >
        <div class="section-heading security-heading">
          <div>
            <h2>Tresor-Zugangsdaten</h2>
            <small>Dein Tagebuch bleibt Ende-zu-Ende verschlüsselt.</small>
          </div>
          <ShieldCheck :size="19" class="muted" />
        </div>
        <p class="helper">
          Neue Zugangsdaten verschlüsseln dein Tagebuch auf diesem Gerät mit
          einem neuen Schlüssel. Der Server erhält nur verschlüsselte Daten.
        </p>
        <p class="helper">
          Alte Sicherungen benötigen weiterhin die Zugangsdaten, mit denen sie
          erstellt wurden.
        </p>

        <template v-if="!rotationStep">
          <label class="vault-field">
            Neue Passphrase <span>mindestens 12 Zeichen</span>
            <input
              class="d-input"
              ref="rotationPassphraseField"
              type="password"
              autocomplete="new-password"
              minlength="12"
              @keydown.enter.prevent="prepareCredentialRotation"
            />
          </label>
          <label class="vault-field">
            Neue Passphrase wiederholen
            <input
              class="d-input"
              ref="rotationConfirmPassphraseField"
              type="password"
              autocomplete="new-password"
              minlength="12"
              @keydown.enter.prevent="prepareCredentialRotation"
            />
          </label>
          <UiButton
            type="button"
            class="button primary"
            :disabled="rotationBusy"
            :loading="rotationBusy"
            @click="prepareCredentialRotation"
          >
            <KeyRound :size="16" /> Zugangsdaten vorbereiten
          </UiButton>
        </template>

        <template v-else>
          <div class="vault-recovery-warning" role="note">
            <strong>Neue Wiederherstellungsphrase – nur jetzt sichtbar</strong>
            <p>
              Die alte Phrase öffnet den aktuellen Tresor nach dem Speichern
              nicht mehr. Kopiere diese neue Phrase und bewahre sie sicher auf.
            </p>
          </div>
          <div
            class="vault-recovery-key"
            aria-label="Neue Wiederherstellungsphrase"
          >
            {{ rotationRecoveryKey }}
          </div>
          <UiButton
            type="button"
            class="button secondary"
            @click="copyRotationRecoveryKey"
          >
            <Copy :size="16" /> Phrase kopieren
          </UiButton>
          <label class="vault-field">
            Wiederherstellungsphrase zur Bestätigung erneut eingeben
            <input
              class="d-input"
              ref="rotationConfirmRecoveryField"
              type="password"
              autocomplete="off"
              spellcheck="false"
              @input="checkRotationRecovery"
              @keydown.enter.prevent="saveCredentialRotation"
            />
          </label>
          <UiButton
            type="button"
            class="button primary"
            :disabled="rotationBusy || !rotationConfirmed"
            :loading="rotationBusy"
            @click="saveCredentialRotation"
          >
            <ShieldCheck :size="16" /> Tresor mit neuen Daten speichern
          </UiButton>
          <UiButton
            type="button"
            class="button secondary"
            :disabled="rotationBusy"
            @click="cancelCredentialRotation"
          >
            Abbrechen – bisherige Zugangsdaten behalten
          </UiButton>
        </template>

        <p v-if="rotationError" class="alert error" role="alert">
          {{ rotationError }}
        </p>
        <p v-if="rotationStatus" class="alert success" role="status">
          {{ rotationStatus }}
        </p>
      </section>

      <section
        v-if="tab === 'security'"
        class="panel profile-card account-session-card"
        data-tone="privacy"
      >
        <div>
          <h2>Kontopasswort ändern</h2>
          <p class="helper">
            Das schützt die Anmeldung und ist nicht deine Tresor-Passphrase.
            Nach dem Ändern bleiben die verschlüsselten Tagebuchdaten
            unverändert; andere Geräte müssen sich neu anmelden.
          </p>
        </div>
        <form
          class="form account-password-form"
          @submit.prevent="changeAccountPassword"
        >
          <label class="vault-field">
            Aktuelles Kontopasswort
            <input
              class="d-input"
              ref="currentAccountPasswordField"
              type="password"
              autocomplete="current-password"
              maxlength="1024"
              required
            />
          </label>
          <label class="vault-field">
            Neues Kontopasswort <span>mindestens 12 Zeichen</span>
            <input
              class="d-input"
              ref="newAccountPasswordField"
              type="password"
              autocomplete="new-password"
              minlength="12"
              maxlength="1024"
              required
            />
          </label>
          <label class="vault-field">
            Neues Kontopasswort wiederholen
            <input
              class="d-input"
              ref="confirmAccountPasswordField"
              type="password"
              autocomplete="new-password"
              minlength="12"
              maxlength="1024"
              required
            />
          </label>
          <UiButton
            type="submit"
            class="button secondary"
            :disabled="accountPasswordBusy"
            :loading="accountPasswordBusy"
          >
            Kontopasswort ändern
          </UiButton>
        </form>
        <p v-if="accountPasswordError" class="alert error" role="alert">
          {{ accountPasswordError }}
        </p>
        <p v-if="accountPasswordStatus" class="alert success" role="status">
          {{ accountPasswordStatus }}
        </p>
        <hr class="session-divider" />
        <div>
          <h2>Angemeldete Geräte</h2>
          <p class="helper">
            Prüfe deine aktiven Anmeldungen und melde einzelne Geräte oder alle
            anderen ab. Online
            geöffnete Tagebücher werden spätestens bei der nächsten Prüfung in
            etwa 30 Sekunden gesperrt. Offlinegeräte werden beim nächsten
            Verbindungsversuch abgewiesen. Deine Daten bleiben verschlüsselt;
            dieses Gerät kann angemeldet bleiben.
          </p>
        </div>
        <div class="device-session-list" aria-label="Aktive Anmeldungen">
          <p v-if="deviceSessionsBusy" class="helper" role="status">
            Anmeldungen werden geladen …
          </p>
          <p v-else-if="!deviceSessions.length" class="helper">
            Keine aktiven Anmeldungen gefunden.
          </p>
          <article
            v-for="session in deviceSessions"
            :key="session.id"
            class="device-session-row"
            data-testid="device-session"
          >
            <div>
              <strong>{{ session.device_label }}</strong>
              <p class="helper">
                {{ session.current ? "Dieses Gerät · aktuell" : "Angemeldet" }}
                <span aria-hidden="true">·</span>
                {{ sessionCreatedAt(session.created_at) }}
              </p>
            </div>
            <UiButton
              v-if="!session.current"
              type="button"
              class="button secondary compact"
              :disabled="Boolean(revokeSessionBusyID)"
              :loading="revokeSessionBusyID === session.id"
              :aria-label="`${session.device_label} abmelden`"
              @click="revokeDeviceSession(session)"
            >
              Abmelden
            </UiButton>
            <span v-else class="device-session-current">Aktuell</span>
          </article>
        </div>
        <p v-if="deviceSessionsError" class="alert error" role="alert">
          {{ deviceSessionsError }}
        </p>
        <UiButton
          type="button"
          class="button secondary"
          :disabled="revokeOtherBusy"
          :loading="revokeOtherBusy"
          @click="revokeOtherDevices"
        >
          <ShieldCheck :size="16" /> Andere Geräte abmelden
        </UiButton>
        <p v-if="revokeOtherError" class="alert error" role="alert">
          {{ revokeOtherError }}
        </p>
        <p v-if="revokeOtherStatus" class="alert success" role="status">
          {{ revokeOtherStatus }}
        </p>
        <hr class="session-divider" />
        <div>
          <h2>Dieses Gerät</h2>
          <p class="helper">
            Wenn du dich hier abmeldest, brauchst du beim nächsten Besuch wieder
            dein Kontopasswort und zum Öffnen des Tagebuchs die
            Tresor-Passphrase.
          </p>
        </div>
        <UiButton
          type="button"
          class="button secondary"
          :disabled="logoutBusy"
          :loading="logoutBusy"
          @click="logoutThisDevice"
        >
          <LogOut :size="16" /> Dieses Gerät abmelden
        </UiButton>
        <p v-if="logoutError" class="alert error" role="alert">
          {{ logoutError }}
        </p>
      </section>

      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <p v-if="saved" class="alert success" role="status">
        <Check :size="16" /> Profil gespeichert.
      </p>
      <UiButton
        v-if="tab === 'person' || tab === 'body'"
        class="button primary profile-save"
        :disabled="busy"
        :loading="busy"
      >
        <Save :size="16" />
        {{ busy ? "Wird gespeichert …" : "Profil speichern" }}
      </UiButton>
    </form>
  </AppShell>
</template>
