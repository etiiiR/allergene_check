<script setup>
import { ref, reactive, nextTick, computed, onMounted } from "vue";
import { Head, Link, router } from "@inertiajs/vue3";
import AppShell from "../components/AppShell.vue";
import PrivacySummary from "../components/PrivacySummary.vue";
import UiSteps from "../components/ui/UiSteps.vue";
import { api } from "../lib";
import { notify } from "../ui/feedback";
import { generatePseudonym } from "../privacy/pseudonym";
import { useVaultDiary } from "../privacy/vault-session.js";
const diary = useVaultDiary();
// Start from the persisted profile so setup never discards existing cycle settings.
const form = reactive({
  ...(diary.value.profile || {}),
  display_name: diary.value.profile?.display_name || generatePseudonym(),
});
const step = ref(0),
  busy = ref(false),
  error = ref(""),
  heading = ref(null);
const editing = computed(() =>
  Boolean(diary.value.profile?.onboarding_completed),
);
const progress = computed(() => `${((step.value + 1) / 3) * 100}%`);
function focusStep() {
  heading.value?.focus({ preventScroll: true });
}
function move(value) {
  step.value = value;
}
onMounted(async () => {
  await nextTick();
  focusStep();
});
async function finish() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await api("/profile", {
      method: "PUT",
      body: JSON.stringify({ ...form, onboarding_completed: true }),
    });
    notify("Dein Profil ist gespeichert. Los geht’s!");
    router.visit("/", { onFinish: () => (busy.value = false) });
  } catch (e) {
    error.value = e.message;
    busy.value = false;
  }
}
</script>
<template>
  <Head :title="editing ? 'Profil-Assistent' : 'Einfach starten'" />
  <AppShell>
    <section class="setup-page" aria-labelledby="setup-title">
      <Link
        :href="editing ? '/profile' : '/?setup=later'"
        class="text-button setup-exit"
        >{{ editing ? "Zurück zum Profil" : "Später einrichten" }}</Link
      >
      <header class="setup-intro">
        <p class="eyebrow">
          DEIN TAGEBUCH · {{ editing ? "PROFIL" : "START" }}
        </p>
        <h1 id="setup-title">
          {{ editing ? "Profil-Assistent" : "Einfach starten" }}
        </h1>
        <p>
          {{
            editing
              ? "Passe deine Angaben Schritt für Schritt an. Deine Einträge bleiben erhalten."
              : "Ein paar kurze Angaben – dein Tagebuch bleibt persönlich und in deinem Tempo."
          }}
        </p>
      </header>
      <div
        class="setup-progress"
        role="progressbar"
        :aria-valuenow="step + 1"
        aria-valuemin="1"
        aria-valuemax="3"
        :aria-valuetext="`Schritt ${step + 1} von 3`"
        aria-label="Einrichtungsfortschritt"
      >
        <span :style="{ width: progress }"></span>
      </div>
      <UiSteps :labels="['Person', 'Kontext', 'Startklar']" :current="step" />
      <form
        class="panel setup-form"
        @submit.prevent="step < 2 ? move(step + 1) : finish()"
      >
        <Transition
          name="onboarding-step"
          mode="out-in"
          @after-enter="focusStep"
        >
          <div :key="step" class="onboarding-step">
            <div class="onboarding-step-mark" aria-hidden="true">
              {{ ["01", "02", "03"][step] }}
            </div>
            <h2 ref="heading" tabindex="-1">
              {{
                [
                  "Für wen ist das Tagebuch?",
                  "Was sollen wir berücksichtigen?",
                  "Kleine Einträge reichen.",
                ][step]
              }}
            </h2>
            <template v-if="step === 0">
              <p>
                Du brauchst keinen echten Namen. Passe das Pseudonym an, wenn du
                möchtest.
              </p>
              <label
                >Pseudonym<input
                  class="d-input"
                  v-model="form.display_name"
                  autocomplete="nickname"
                  maxlength="80"
                  required
              /></label>
              <UiButton
                type="button"
                class="text-button"
                @click="form.display_name = generatePseudonym()"
                >Neues Pseudonym erstellen</UiButton
              >
              <PrivacySummary compact />
            </template>
            <template v-else-if="step === 1">
              <p>Optional. Du kannst das später im Profil ändern.</p>
              <label
                >Körperkontext<select
                  class="d-select"
                  v-model="form.body_group"
                >
                  <option value="unspecified">Vorerst nicht angeben</option>
                  <option value="female">Weiblicher Körperkontext</option>
                  <option value="male">Männlicher Körperkontext</option>
                  <option value="other">Anderer Körperkontext</option>
                </select></label
              >
              <label v-if="form.body_group === 'female'" class="toggle-row"
                ><span
                  >Zyklus berücksichtigen<small
                    >Weitere Einstellungen findest du im Profil.</small
                  ></span
                ><input type="checkbox" v-model="form.cycle_tracking"
              /></label>
            </template>
            <template v-else>
              <p>Alles bereit, {{ form.display_name.trim() }}.</p>
              <ul class="setup-checklist">
                <li>
                  <strong>Essen eintragen</strong
                  ><span>Rezept einmal speichern, später wiederverwenden.</span>
                </li>
                <li>
                  <strong>Befinden festhalten</strong
                  ><span>Beschwerden und gute Momente zählen beide.</span>
                </li>
                <li>
                  <strong>Muster entdecken</strong
                  ><span
                    >Zusammenhänge beobachten, keine Diagnose stellen.</span
                  >
                </li>
              </ul>
              <p class="helper">Du musst keinen Tag vollständig ausfüllen.</p>
            </template>
          </div>
        </Transition>
        <p v-if="error" role="alert" class="alert error">{{ error }}</p>
        <div class="wizard-actions">
          <UiButton
            v-if="step > 0"
            type="button"
            class="button secondary"
            :disabled="busy"
            @click="move(step - 1)"
            >Zurück</UiButton
          >
          <Link
            v-else
            :href="editing ? '/profile' : '/?setup=later'"
            class="text-button"
          >
            {{ editing ? "Abbrechen" : "Zum Tagebuch" }}
          </Link>
          <UiButton
            class="button primary"
            :disabled="busy || !form.display_name.trim()"
            :loading="busy"
            >{{
              step === 2 ? "Profil anlegen und starten" : "Weiter"
            }}</UiButton
          >
        </div>
      </form>
    </section>
  </AppShell>
</template>
