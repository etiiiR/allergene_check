<script setup>
import { reactive, computed } from "vue";
import { usePage } from "@inertiajs/vue3";
import Modal from "./Modal.vue";
import { localTime, useMutation } from "../lib";
const props = defineProps({ type: String, recipeId: String, day: String });
const emit = defineEmits(["close"]);
const page = usePage(),
  { busy, error, save } = useMutation();
const now = localTime();
const form = reactive({
  occurred_at:
    props.day && props.day !== now.slice(0, 10) ? props.day + "T20:00" : now,
  recipe_id: props.recipeId || "",
  portions: 1,
  notes: "",
  symptom_free: props.type === "free",
  symptoms: Object.fromEntries(
    Object.keys(page.props.symptoms).map((k) => [k, 0]),
  ),
  stress: 3,
  sleep_hours: 8,
});
const meal = computed(() => props.type === "meal");
function submit() {
  const data = {
    ...form,
    occurred_at: new Date(form.occurred_at).toISOString(),
    symptoms: form.symptom_free
      ? Object.fromEntries(Object.keys(form.symptoms).map((k) => [k, 0]))
      : form.symptoms,
  };
  save(meal.value ? "/meals" : "/checkins", data, () => emit("close"));
}
</script>
<template>
  <Modal
    :title="meal ? 'Mahlzeit eintragen' : 'Wie geht es deinem Bauch?'"
    @close="emit('close')"
    ><form @submit.prevent="submit" class="form">
      <label
        >Zeitpunkt<input
          v-model="form.occurred_at"
          type="datetime-local"
          required
      /></label>
      <template v-if="meal"
        ><label
          >Gekochtes Rezept<select v-model="form.recipe_id" required>
            <option value="" disabled>Rezept auswählen</option>
            <option
              v-for="r in page.props.diary.recipes"
              :value="r.id"
              :key="r.id"
            >
              {{ r.title }}
            </option>
          </select></label
        >
        <p v-if="!page.props.diary.recipes.length" class="helper">
          Lege zuerst unter „Meine Rezepte“ ein Rezept an.
        </p>
        <label
          >Gegessene Portionen<input
            v-model.number="form.portions"
            type="number"
            min="0.1"
            max="20"
            step="0.1"
            required /></label
      ></template>
      <template v-else
        ><label class="check-card"
          ><input type="checkbox" v-model="form.symptom_free" /><span
            ><strong>Mir geht es gut – symptomfrei</strong
            ><small
              >Ein wichtiger Vergleich für deine persönlichen Muster.</small
            ></span
          ></label
        >
        <div v-if="!form.symptom_free" class="symptom-sliders">
          <label v-for="(name, key) in page.props.symptoms" :key="key"
            ><span
              >{{ name }}<b>{{ form.symptoms[key] }} / 10</b></span
            ><input
              v-model.number="form.symptoms[key]"
              type="range"
              min="0"
              max="10"
            /><small>0 = keine · 10 = sehr stark</small></label
          >
        </div>
        <div class="form-row">
          <label
            >Stress (0–10)<input
              v-model.number="form.stress"
              type="number"
              min="0"
              max="10"
              required /></label
          ><label
            >Schlaf (Stunden)<input
              v-model.number="form.sleep_hours"
              type="number"
              min="0"
              max="24"
              step=".5"
              required
          /></label></div
      ></template>
      <label
        >Notiz <span class="optional">optional</span
        ><textarea
          v-model="form.notes"
          maxlength="3000"
          rows="3"
          placeholder="Was möchtest du noch festhalten?"
        />
      </label>
      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <div class="form-actions">
        <button
          type="button"
          class="button secondary"
          @click="emit('close')"
          :disabled="busy"
        >
          Abbrechen</button
        ><button class="button primary" :disabled="busy">
          {{ busy ? "Wird gespeichert …" : "Eintrag speichern" }}
        </button>
      </div>
    </form></Modal
  >
</template>
