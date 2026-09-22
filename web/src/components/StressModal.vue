<script setup>
import { reactive } from "vue";
import { HeartPulse } from "@lucide/vue";
import Modal from "./Modal.vue";
import { localDate, localTime, useMutation } from "../lib";

const props = defineProps({ day: String });
const emit = defineEmits(["close"]);
const { busy, error, save } = useMutation();
const now = localTime();
const occurredAt =
  props.day && props.day !== localDate() ? props.day + "T20:00" : now;
const form = reactive({
  observed_at: occurredAt,
  stress: 3,
  notes: "",
});
const choices = [
  { value: 0, label: "Ruhig", hint: "0/10" },
  { value: 3, label: "Leicht", hint: "3/10" },
  { value: 6, label: "Mittel", hint: "6/10" },
  { value: 9, label: "Hoch", hint: "9/10" },
];

function submit() {
  save(
    "/stress",
    {
      source: "generic",
      metric: "stress_score",
      value: Number(form.stress),
      unit: "score_0_10",
      normalized_stress: Number(form.stress),
      observed_at: new Date(form.observed_at).toISOString(),
      notes: form.notes,
    },
    () => emit("close"),
  );
}
</script>

<template>
  <Modal title="Stress manuell festhalten" @close="emit('close')">
    <form class="form stress-form" @submit.prevent="submit">
      <div class="entry-intro">
        <span class="entry-step"><HeartPulse :size="17" /></span>
        <div>
          <strong>Wie gestresst fühlst du dich gerade?</strong>
          <small>Nutze dies, wenn keine Watch- oder Ringmessung vorliegt.</small>
        </div>
      </div>
      <div class="picker-label">
        <span>Dein Stresslevel</span><small>{{ form.stress }}/10</small>
      </div>
      <div class="stress-choice-grid">
        <button
          v-for="choice in choices"
          :key="choice.value"
          type="button"
          class="level-choice pressable rounded-lg"
          :class="{ selected: form.stress === choice.value }"
          @click="form.stress = choice.value"
        >
          <strong>{{ choice.label }}</strong><small>{{ choice.hint }}</small>
        </button>
      </div>
      <label>
        Zeitpunkt
        <input v-model="form.observed_at" type="datetime-local" required />
      </label>
      <label>
        Notiz <span class="optional">optional</span>
        <textarea
          v-model="form.notes"
          maxlength="1000"
          rows="3"
          placeholder="z. B. Arbeit, Schlaf, Situation"
        />
      </label>
      <p class="manual-stress-note">
        Dieser Eintrag wird als persönlicher Stress-Score gespeichert und kann
        später zusammen mit deinen Essensmustern verglichen werden.
      </p>
      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <div class="form-actions">
        <button type="button" class="button secondary" @click="emit('close')">
          Abbrechen
        </button>
        <button class="button primary" :disabled="busy">
          {{ busy ? "Wird gespeichert …" : "Stress speichern" }}
        </button>
      </div>
    </form>
  </Modal>
</template>
