<script setup>
import { computed, reactive } from "vue";
import { usePage } from "@inertiajs/vue3";
import { Flag, Heart, Save } from "@lucide/vue";
import EntryPanel from "./EntryPanel.vue";
import { useMutation } from "../lib";

const props = defineProps({ recipe: Object, kind: String, meals: Array });
const emit = defineEmits(["close"]);
const page = usePage();
const { busy, error, save } = useMutation();
const symptoms = computed(() => page.props.symptoms || {});
const selectedSymptom = reactive({ key: "bloating", severity: 5 });
const form = reactive({
  meal_id: "",
  notes: "",
});
const severityChoices = [
  { value: 3, label: "Leicht" },
  { value: 6, label: "Mittel" },
  { value: 9, label: "Stark" },
];

const recipeMeals = computed(() =>
  (props.meals || [])
    .filter((meal) => meal.recipe_id === props.recipe.id)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
);

function submit() {
  const symptomsPayload =
    props.kind === "reaction"
      ? Object.fromEntries(
          Object.keys(symptoms.value).map((key) => [
            key,
            key === selectedSymptom.key ? selectedSymptom.severity : 0,
          ]),
        )
      : {};
  save(
    "/recipe-flags",
    {
      recipe_id: props.recipe.id,
      meal_id: form.meal_id,
      kind: props.kind,
      symptoms: symptomsPayload,
      severity: props.kind === "reaction" ? selectedSymptom.severity : 0,
      notes: form.notes,
    },
    () => emit("close"),
  );
}
</script>

<template>
  <EntryPanel
    :busy="busy"
    :title="kind === 'reaction' ? 'Reaktion markieren' : 'Rezept markieren'"
    @close="emit('close')"
  >
    <form class="form flag-form" @submit.prevent="submit">
      <div class="entry-intro">
        <span class="entry-step"
          ><Heart v-if="kind === 'reaction'" :size="17" /><Flag
            v-else
            :size="17"
        /></span>
        <div>
          <strong>{{ recipe.title }}</strong>
          <small>
            {{
              kind === "reaction"
                ? "Du vermutest, dass diese Mahlzeit Beschwerden ausgelöst hat."
                : "Ein persönlicher Hinweis für deine spätere Auswertung."
            }}
          </small>
        </div>
      </div>

      <label v-if="kind === 'reaction'" class="profile-field">
        Zugehörige Mahlzeit <span class="optional">optional</span>
        <select class="d-select" v-model="form.meal_id">
          <option value="">Keine konkrete Mahlzeit auswählen</option>
          <option v-for="meal in recipeMeals" :key="meal.id" :value="meal.id">
            {{ meal.occurred_at.slice(0, 16).replace("T", " · ") }}
          </option>
        </select>
      </label>

      <template v-if="kind === 'reaction'">
        <div class="picker-label">
          <span>Was hast du bemerkt?</span><small>Eine Auswahl reicht</small>
        </div>
        <div class="symptom-choice-grid">
          <UiButton
            v-for="(label, key) in symptoms"
            :key="key"
            type="button"
            class="symptom-choice pressable"
            :class="{ selected: selectedSymptom.key === key }"
            :aria-pressed="selectedSymptom.key === key"
            @click="selectedSymptom.key = key"
          >
            {{ label }}
          </UiButton>
        </div>
        <div class="level-choice-grid">
          <UiButton
            v-for="choice in severityChoices"
            :key="choice.value"
            type="button"
            class="level-choice pressable"
            :class="{ selected: selectedSymptom.severity === choice.value }"
            :aria-pressed="selectedSymptom.severity === choice.value"
            @click="selectedSymptom.severity = choice.value"
          >
            {{ choice.label }}
          </UiButton>
        </div>
      </template>

      <label>
        Notiz <span class="optional">optional</span>
        <textarea
          class="d-textarea"
          v-model="form.notes"
          maxlength="1500"
          rows="3"
          placeholder="Warum möchtest du es markieren?"
        />
      </label>
      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <p class="helper">
        Eine Markierung verstärkt nur den persönlichen Hinweis. Sie beweist
        keine Unverträglichkeit oder Allergie.
      </p>
      <div class="form-actions">
        <UiButton type="button" class="button secondary" @click="emit('close')"
          >Abbrechen</UiButton
        >
        <UiButton class="button primary" :loading="busy" :disabled="busy">
          <Save :size="16" />{{
            busy
              ? "Wird gespeichert …"
              : kind === "reaction"
                ? "Reaktion markieren"
                : "Verdacht speichern"
          }}
        </UiButton>
      </div>
    </form>
  </EntryPanel>
</template>
