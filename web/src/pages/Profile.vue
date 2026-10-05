<script setup>
import { reactive, ref } from "vue";
import { Head, Link, router } from "@inertiajs/vue3";
import {
  CalendarDays,
  Check,
  FileJson,
  HeartPulse,
  Info,
  Save,
  Settings,
  ShieldCheck,
  Upload,
} from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import { api } from "../lib";
import { notify } from "../ui/feedback";
import { nativeHealthAvailable, syncAppleHealth } from "../ui/health";
import { generatePseudonym } from "../privacy/pseudonym";

const props = defineProps({ diary: Object });
const stored = props.diary?.profile || {};
const form = reactive({
  ...stored,
  display_name: stored.display_name || "",
  body_group: stored.body_group || "unspecified",
  cycle_tracking: Boolean(stored.cycle_tracking),
  cycle_length_days: stored.cycle_length_days || 28,
  period_start: stored.period_start || "",
});
const busy = ref(false);
const error = ref("");
const saved = ref(false);
const tab = ref("person");
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
              ? "Dein persönliches Tagebuch. Änderungen werden auf dem Server gespeichert."
              : "Füge eine Person für dieses Tagebuch hinzu."
          }}
        </p>
      </div>
    </div>

    <div class="segmented-nav" aria-label="Profileinstellungen">
      <UiButton :aria-pressed="tab === 'person'" @click="tab = 'person'"
        >Person</UiButton
      >
      <UiButton :aria-pressed="tab === 'body'" @click="tab = 'body'"
        >Körper & Zyklus</UiButton
      >
      <UiButton :aria-pressed="tab === 'health'" @click="tab = 'health'"
        >Health</UiButton
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
          Verwende am besten keinen echten Namen. Das Pseudonym ist nur ein
          Anzeigename, keine Verschlüsselung oder Zugriffssperre. Ein Profil für
          dieses Tagebuch; derzeit gibt es keine getrennten Konten.
        </p>
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

      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <p v-if="saved" class="alert success" role="status">
        <Check :size="16" /> Profil gespeichert.
      </p>
      <UiButton
        v-if="tab !== 'health'"
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
