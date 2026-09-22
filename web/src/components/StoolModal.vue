<script setup>
import { reactive } from "vue";
import { ClipboardCheck } from "@lucide/vue";
import Modal from "./Modal.vue";
import { localDate, localTime, useMutation } from "../lib";

const props = defineProps({ day: String });
const emit = defineEmits(["close"]);
const { busy, error, save } = useMutation();
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const form = reactive({
  observed_at: localTime(),
  observed_for_date: props.day || localDate(yesterday),
  quality: "formed",
  notes: "",
  show_details: false,
});
const qualities = [
  { value: "formed", label: "Gut geformt", hint: "unauffällig" },
  { value: "hard", label: "Hart", hint: "schwer" },
  { value: "soft", label: "Weich", hint: "breiig" },
  { value: "watery", label: "Wässrig", hint: "sehr weich" },
  { value: "mixed", label: "Unterschiedlich", hint: "gemischt" },
  { value: "no_stool", label: "Kein Stuhl", hint: "heute nicht" },
];

function submit() {
  save(
    "/stools",
    { ...form, observed_at: new Date(form.observed_at).toISOString() },
    () => emit("close"),
  );
}
</script>

<template>
  <Modal title="Stuhl beobachten" @close="emit('close')">
    <form class="form stool-form" @submit.prevent="submit">
      <div class="entry-intro">
        <span class="entry-step"><ClipboardCheck :size="17" /></span>
        <div>
          <strong>Wie war der Stuhl am Folgetag?</strong>
          <small>Eine kurze Beobachtung reicht — kein medizinischer Test.</small>
        </div>
      </div>
      <label class="profile-field">
        Für welchen Tag?
        <input v-model="form.observed_for_date" type="date" required />
      </label>
      <div class="picker-label"><span>Wie war die Konsistenz?</span><small>Wähle die passendste Beschreibung</small></div>
      <div class="stool-choice-grid">
        <button
          v-for="choice in qualities"
          :key="choice.value"
          type="button"
          class="stool-choice pressable rounded-lg"
          :class="{ selected: form.quality === choice.value }"
          @click="form.quality = choice.value"
        >
          <strong>{{ choice.label }}</strong><small>{{ choice.hint }}</small>
        </button>
      </div>
      <button type="button" class="details-toggle pressable" @click="form.show_details = !form.show_details">
        <span>Notiz oder genauen Zeitpunkt ergänzen</span>
        <span>{{ form.show_details ? "Ausblenden" : "Öffnen" }}</span>
      </button>
      <div v-if="form.show_details" class="entry-details">
        <label>Beobachtet um<input v-model="form.observed_at" type="datetime-local" required /></label>
        <label>Notiz <span class="optional">optional</span><textarea v-model="form.notes" maxlength="1000" rows="3" placeholder="z. B. Dringlichkeit oder Bauchgefühl" /></label>
      </div>
      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <div class="form-actions">
        <button type="button" class="button secondary" @click="emit('close')">Abbrechen</button>
        <button class="button primary" :disabled="busy">{{ busy ? "Wird gespeichert …" : "Beobachtung speichern" }}</button>
      </div>
    </form>
  </Modal>
</template>
