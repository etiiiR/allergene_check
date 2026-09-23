<script setup>
import { reactive, ref } from "vue";
import { Head, router } from "@inertiajs/vue3";
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

const props = defineProps({ diary: Object });
const stored = props.diary?.profile || {};
const form = reactive({
  body_group: stored.body_group || "unspecified",
  cycle_tracking: Boolean(stored.cycle_tracking),
  cycle_length_days: stored.cycle_length_days || 28,
  period_start: stored.period_start || "",
});
const busy = ref(false);
const error = ref("");
const saved = ref(false);
const healthSource = ref("apple_healthkit");
const healthFile = ref(null);
const healthBusy = ref(false);
const healthError = ref("");
const healthStatus = ref("");

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
        <p>Damit die Muster zu deinem Körperkontext passen.</p>
      </div>
    </div>

    <form class="profile-settings" @submit.prevent="saveProfile">
      <section class="panel profile-card">
        <div class="section-heading">
          <div>
            <h2>Getrennte Analysegruppen</h2>
            <small>Deine Daten bleiben in diesem persönlichen Kontext.</small>
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
        v-if="form.body_group === 'female'"
        class="panel profile-card cycle-card"
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

      <section class="panel profile-card health-card">
        <div class="section-heading">
          <div>
            <h2>Stress aus Health-Daten</h2>
            <small>Watch, Ring oder Smartphone als zusätzliche Zeitspur.</small>
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
            >Nur ausdrücklich normalisierte Stress-Scores werden analysiert. HRV
            und Puls werden nicht automatisch in Stress umgerechnet.</span
          >
        </div>
      </section>

      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <p v-if="saved" class="alert success" role="status">
        <Check :size="16" /> Profil gespeichert.
      </p>
      <UiButton class="button primary profile-save" :disabled="busy">
        <Save :size="16" />
        {{ busy ? "Wird gespeichert …" : "Profil speichern" }}
      </UiButton>
    </form>
  </AppShell>
</template>
