<script setup>
import { ref, reactive, nextTick } from "vue";
import { Head, Link, router } from "@inertiajs/vue3";
import AppShell from "../components/AppShell.vue";
import UiSteps from "../components/ui/UiSteps.vue";
import { api } from "../lib";
import { notify } from "../ui/feedback";
const props = defineProps({ diary: Object });
// Start from the persisted profile so setup never discards existing cycle settings.
const form = reactive({
  ...props.diary.profile,
  display_name: props.diary.profile.display_name || "",
});
const step = ref(0),
  busy = ref(false),
  error = ref(""),
  heading = ref(null);
async function move(value) {
  step.value = value;
  await nextTick();
  heading.value?.focus({ preventScroll: true });
}
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
  <Head title="Einfach starten" />
  <AppShell>
    <section class="setup-page">
      <Link href="/" class="text-button">Zurück zu Heute</Link>
      <h1>Einfach starten</h1>
      <UiSteps :labels="['Person', 'Kontext', 'Startklar']" :current="step" />
      <form
        class="panel setup-form"
        @submit.prevent="step < 2 ? move(step + 1) : finish()"
      >
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
          <p>Ein Vorname oder Spitzname genügt.</p>
          <label
            >Name der Person<input
              class="d-input"
              v-model="form.display_name"
              autocomplete="given-name"
              maxlength="80"
              required
          /></label>
          <p class="helper">
            Ein persönliches Tagebuch auf diesem Server. Kein Konto und keine
            Anmeldung. Vorhandene Einträge bleiben erhalten.
          </p>
        </template>
        <template v-else-if="step === 1">
          <p>Optional. Du kannst das später im Profil ändern.</p>
          <label
            >Körperkontext<select class="d-select" v-model="form.body_group">
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
              ><span>Zusammenhänge beobachten, keine Diagnose stellen.</span>
            </li>
          </ul>
          <p class="helper">Du musst keinen Tag vollständig ausfüllen.</p>
        </template>
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
          <Link v-else href="/" class="text-button">Später einrichten</Link>
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
