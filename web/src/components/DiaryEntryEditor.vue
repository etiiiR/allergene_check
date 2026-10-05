<script setup>
import { computed, reactive, ref } from "vue";
import { usePage } from "@inertiajs/vue3";
import EntryPanel from "./EntryPanel.vue";
import RecipePicker from "./RecipePicker.vue";
import { entryTone } from "../ui/entry-tones";
import {
  cyclePhases,
  dateTime,
  stoolQualities,
  timingWindows,
  useMutation,
} from "../lib";

const props = defineProps({ entry: { type: Object, required: true } });
const emit = defineEmits(["close", "saved"]);
const page = usePage();
const { busy, error, save } = useMutation();
// A detached draft keeps cancel/error paths from changing the visible diary.
const form = reactive(JSON.parse(JSON.stringify(props.entry)));
const confirmObservation = ref(false);
const kind = props.entry.kind;
const title = {
  meals: "Mahlzeit bearbeiten",
  checkins: "Befinden bearbeiten",
  stools: "Stuhlbeobachtung bearbeiten",
  stress: "Stress / Health bearbeiten",
}[kind];
const imported =
  kind === "stress" &&
  (form.source !== "generic" ||
    Boolean(form.external_id) ||
    form.metric !== "stress_score");
const originalTime =
  kind === "meals" || kind === "checkins" ? form.occurred_at : form.observed_at;
const instant = new Date(originalTime);
const initialLocalTime = new Date(
  instant.getTime() - instant.getTimezoneOffset() * 60000,
)
  .toISOString()
  .slice(0, 16);
const time = ref(initialLocalTime);
const isBaseline = computed(
  () => form.meal_baseline && form.symptom_free && !confirmObservation.value,
);
const recipes = computed(() => page.props.diary?.recipes || []);
const meals = computed(() => page.props.diary?.meals || []);
const symptoms = computed(() => page.props.symptoms || {});
const showCycle = computed(
  () =>
    (page.props.diary?.profile?.cycle_tracking &&
      page.props.diary?.profile?.body_group === "female") ||
    (form.cycle_phase && form.cycle_phase !== "unknown"),
);
const missingMeal = computed(
  () =>
    form.reference_meal_id &&
    !meals.value.some((m) => m.id === form.reference_meal_id),
);
if (kind === "checkins") {
  form.symptoms ||= {};
  for (const key of Object.keys(symptoms.value)) form.symptoms[key] ??= 0;
  form.timing_bucket ||= "unknown";
  form.cycle_phase ||= "unknown";
}

function submit() {
  // Preserve seconds, offset and sub-second precision on note-only edits.
  const timestamp =
    time.value === initialLocalTime
      ? originalTime
      : new Date(time.value).toISOString();
  let data = { notes: form.notes };
  if (kind === "meals")
    data = {
      ...data,
      recipe_id: form.recipe_id,
      portions: form.portions,
      occurred_at: timestamp,
    };
  if (kind === "stools")
    data = {
      ...data,
      quality: form.quality,
      observed_for_date: form.observed_for_date,
      observed_at: timestamp,
    };
  if (kind === "stress" && !imported)
    data = { ...data, value: form.value, observed_at: timestamp };
  if (kind === "checkins")
    data = {
      ...data,
      occurred_at: timestamp,
      symptom_free: form.symptom_free,
      symptoms: form.symptom_free ? {} : form.symptoms,
      timing_bucket: form.timing_bucket,
      reference_meal_id: form.reference_meal_id,
      cycle_phase: form.cycle_phase,
      cycle_day: form.cycle_day,
      stress: form.stress,
      sleep_hours: form.sleep_hours,
      confirm_observation: confirmObservation.value,
    };
  save(
    `/${kind}/${props.entry.id}`,
    data,
    (saved) => emit("saved", saved),
    "PUT",
  );
}
</script>

<template>
  <EntryPanel
    :title="title"
    :busy="busy"
    :tone="entryTone(form)"
    @close="emit('close')"
  >
    <form class="form diary-edit-form" @submit.prevent="submit">
      <fieldset class="diary-edit-fields" :disabled="busy">
        <template v-if="kind === 'meals'">
          <RecipePicker
            v-model="form.recipe_id"
            :recipes="recipes"
            :meals="meals"
            :fallback="{
              id: entry.recipe_id,
              title: entry.title,
              ingredients: entry.ingredients,
            }"
          />
          <label
            >Portionen<input
              class="d-input"
              type="number"
              min="0.1"
              max="20"
              step="any"
              v-model.number="form.portions"
              required
          /></label>
          <p class="helper">
            Beim gleichen Rezept bleiben die damals erfassten Zutaten erhalten.
            Befinden-Einträge behalten ihren eigenen Zeitpunkt und lassen sich
            separat bearbeiten.
          </p>
        </template>
        <template v-if="kind === 'checkins'">
          <fieldset>
            <legend>Befinden zu diesem Zeitpunkt</legend>
            <div class="choice-row">
              <UiButton
                type="button"
                class="choice-button"
                data-tone="well"
                :class="{ selected: form.symptom_free }"
                :aria-pressed="form.symptom_free"
                @click="form.symptom_free = true"
                >Gut</UiButton
              >
              <UiButton
                type="button"
                class="choice-button"
                data-tone="symptom"
                :class="{ selected: !form.symptom_free }"
                :aria-pressed="!form.symptom_free"
                @click="form.symptom_free = false"
                >Beschwerden</UiButton
              >
            </div>
          </fieldset>
          <div v-if="!form.symptom_free" class="edit-symptom-grid">
            <label v-for="(label, key) in symptoms" :key="key"
              >{{ label
              }}<input
                class="d-input"
                type="number"
                min="0"
                max="10"
                step="1"
                v-model.number="form.symptoms[key]"
                required
            /></label>
            <small
              >0 = keine Beschwerden, 10 = sehr stark. Mehrere Symptome sind
              möglich.</small
            >
          </div>
          <template v-if="entry.meal_baseline && form.symptom_free">
            <label class="edit-confirm"
              ><input type="checkbox" v-model="confirmObservation" />Als
              eigenständige Beobachtung bestätigen</label
            >
            <p class="helper">
              {{
                isBaseline
                  ? "Dieser gute Moment wurde beim Essen angelegt. Eine Korrektur allein macht ihn nicht zu einem Verträglichkeitsnachweis."
                  : "Du bestätigst dein Befinden zum angegebenen Zeitpunkt. Dieser Check-in fließt künftig in die Auswertung ein."
              }}
            </p>
          </template>
        </template>
        <template v-if="kind === 'stools'">
          <label
            >Beobachtung für den Tag<input
              class="d-input"
              type="date"
              v-model="form.observed_for_date"
              required
          /></label>
          <label
            >Beschaffenheit<select class="d-select" v-model="form.quality">
              <option
                v-for="(label, value) in stoolQualities"
                :key="value"
                :value="value"
              >
                {{ label }}
              </option>
            </select></label
          >
        </template>
        <template v-if="kind === 'stress'">
          <p v-if="imported" class="helper">
            {{ form.metric }}: {{ form.value }} {{ form.unit }} ·
            {{ dateTime(form.observed_at) }}. Originalmessung aus
            {{ form.source }}. Hier ist nur die Notiz änderbar; eine erneute
            Synchronisation kann sie ersetzen.
          </p>
          <label v-else
            >Stress (0–10)<input
              class="d-input"
              type="number"
              min="0"
              max="10"
              step="any"
              v-model.number="form.value"
              required
          /></label>
        </template>
        <label v-if="!imported"
          >Zeitpunkt<input
            class="d-input"
            type="datetime-local"
            v-model="time"
            required
        /></label>
        <details v-if="kind === 'checkins' && !isBaseline" class="entry-note">
          <summary>Zeit nach dem Essen, Stress, Schlaf & Kontext</summary>
          <div class="entry-details">
            <template v-if="!form.symptom_free">
              <label
                >Zeit nach dem Essen<select
                  class="d-select"
                  v-model="form.timing_bucket"
                >
                  <option
                    v-for="(choice, key) in timingWindows"
                    :key="key"
                    :value="key"
                  >
                    {{ choice.label }}
                  </option>
                </select></label
              >
              <label
                >Mögliche Mahlzeit<select
                  class="d-select"
                  v-model="form.reference_meal_id"
                >
                  <option value="">Nicht zuordnen</option>
                  <option v-if="missingMeal" :value="form.reference_meal_id">
                    Bisherige Mahlzeit (gelöscht)
                  </option>
                  <option v-for="meal in meals" :key="meal.id" :value="meal.id">
                    {{ meal.title }} · {{ dateTime(meal.occurred_at) }}
                  </option>
                </select></label
              >
            </template>
            <div class="form-row">
              <label data-tone="stress"
                >Stress (manuell)<input
                  class="d-input"
                  type="number"
                  min="0"
                  max="10"
                  step="1"
                  v-model.number="form.stress"
                  required
              /></label>
              <label data-tone="time"
                >Schlaf (Stunden)<input
                  class="d-input"
                  type="number"
                  min="0"
                  max="24"
                  step="any"
                  v-model.number="form.sleep_hours"
                  required
              /></label>
            </div>
            <div v-if="showCycle" class="form-row">
              <label data-tone="cycle"
                >Zyklusphase<select class="d-select" v-model="form.cycle_phase">
                  <option
                    v-for="(label, key) in cyclePhases"
                    :key="key"
                    :value="key"
                  >
                    {{ label }}
                  </option>
                </select></label
              >
              <label
                >Zyklustag (0 = unbekannt)<input
                  class="d-input"
                  type="number"
                  min="0"
                  max="45"
                  v-model.number="form.cycle_day"
                  required
              /></label>
            </div>
          </div>
        </details>
        <label
          >Notiz<textarea
            class="d-textarea"
            v-model="form.notes"
            :maxlength="kind === 'stools' || kind === 'stress' ? 1000 : 3000"
            rows="2"
          />
        </label>
      </fieldset>
      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <p class="helper">
        Nach dem Speichern wird die Auswertung mit den geänderten Daten erneut
        angefragt.
      </p>
      <div class="form-actions">
        <UiButton
          type="button"
          class="button secondary"
          :disabled="busy"
          @click="emit('close')"
          >Abbrechen</UiButton
        >
        <UiButton class="button primary" :disabled="busy" :loading="busy"
          >Änderungen speichern</UiButton
        >
      </div>
    </form>
  </EntryPanel>
</template>
