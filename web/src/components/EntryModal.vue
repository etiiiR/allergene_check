<script setup>
import { computed, reactive, ref, nextTick } from "vue";
import { usePage } from "@inertiajs/vue3";
import { Check, ChevronDown, Plus } from "@lucide/vue";
import EntryPanel from "./EntryPanel.vue";
import RecipeModal from "./RecipeModal.vue";
import RecipePicker from "./RecipePicker.vue";
import SymptomRating from "./SymptomRating.vue";
import UiSteps from "./ui/UiSteps.vue";
import { useVaultDiary } from "../privacy/vault-session.js";
import {
  allSelectedSymptomsRated,
  toggleSelectedSymptom,
} from "../symptom-selection.js";
import {
  localTime,
  symptomIntensityFromScore,
  symptomScoreFromIntensity,
  symptomIntensityLabels,
  useMutation,
} from "../lib";

const props = defineProps({
  type: String,
  recipeId: String,
  day: String,
  initialSymptom: String,
});
const emit = defineEmits(["close"]);
const page = usePage();
const diary = useVaultDiary();
const { busy, error, save } = useMutation();
const now = localTime();
const symptoms = computed(() => page.props.symptoms || {});
const symptomKeys = computed(() => Object.keys(symptoms.value));
const profile = computed(() => diary.value.profile || {});
const cycleEnabled = computed(
  () => profile.value.body_group === "female" && profile.value.cycle_tracking,
);
const commonSymptoms = computed(() =>
  ["bloating", "pain", "nausea"].filter((key) => symptoms.value[key]),
);
const followup = ref(false);
const meal = computed(() => props.type === "meal" && !followup.value);
const creatingRecipe = ref(false);
const recipeEditor = ref(null);
async function startRecipe() {
  creatingRecipe.value = true;
  await nextTick();
  recipeEditor.value?.$el.querySelector("input")?.focus();
}
async function closeRecipe() {
  creatingRecipe.value = false;
  await nextTick();
  stepHeading.value?.focus();
}
const wellbeing = ref("good");
const showDetails = ref(false);
const step = ref(0);
const stepHeading = ref(null);
async function moveStep(value) {
  step.value = value;
  await nextTick();
  stepHeading.value?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "instant" });
}
const showAllSymptoms = ref(false);
const selectedSymptoms = ref(
  props.initialSymptom ? [props.initialSymptom] : [],
);
const portionChoices = [0.5, 1, 1.5, 2];
const timingChoices = [
  { value: "immediate", label: "Direkt", hint: "0–30 min" },
  { value: "early", label: "Bald danach", hint: "30 min–2 h" },
  { value: "mid", label: "Später", hint: "2–6 h" },
  { value: "late", label: "Sehr spät", hint: "6–24 h" },
  { value: "unknown", label: "Unsicher", hint: "weiß ich nicht" },
];
const foodRelationChoices = [
  {
    value: "timed_window",
    label: "Mahlzeiten vergleichen",
    hint: "Zeitfenster",
  },
  {
    value: "none",
    label: "Keine Mahlzeit zuordnen",
    hint: "Nicht im Zutatenmuster",
  },
];
const cycleChoices = [
  { value: "unknown", label: "Unsicher" },
  { value: "menstruation", label: "Menstruation" },
  { value: "follicular", label: "Follikelphase" },
  { value: "ovulation", label: "Ovulationsfenster" },
  { value: "luteal", label: "Lutealphase" },
];
const initialOccurredAt =
  props.day && props.day !== now.slice(0, 10) ? props.day + "T20:00" : now;

function inferredCycle(value) {
  const currentProfile = profile.value;
  if (
    !cycleEnabled.value ||
    !currentProfile.period_start ||
    !currentProfile.cycle_length_days
  ) {
    return { phase: "unknown", day: 0 };
  }
  const start = new Date(currentProfile.period_start + "T00:00:00");
  const occurred = new Date(value);
  const calendarDay = Math.floor((occurred - start) / 86400000) + 1;
  if (calendarDay < 1) return { phase: "unknown", day: 0 };
  const day = ((calendarDay - 1) % currentProfile.cycle_length_days) + 1;
  if (day <= 5) return { phase: "menstruation", day };
  if (day <= 13) return { phase: "follicular", day };
  if (day === 14) return { phase: "ovulation", day };
  return { phase: "luteal", day };
}

const initialCycle = inferredCycle(initialOccurredAt);
const form = reactive({
  occurred_at: initialOccurredAt,
  recipe_id: props.recipeId || "",
  portions: 1,
  notes: "",
  symptom_free: props.type === "free",
  symptoms: Object.fromEntries(symptomKeys.value.map((key) => [key, 0])),
  timing_bucket: "unknown",
  food_relation: "timed_window",
  reference_meal_id: "",
  cycle_phase: initialCycle.phase,
  cycle_day: initialCycle.day,
  stress: null,
  sleep_hours: null,
});

const ratedSymptoms = computed(() =>
  selectedSymptoms.value
    .filter((key) => form.symptoms[key] > 0)
    .map((key) => ({
      key,
      name: symptoms.value[key] || "Beschwerden",
      level: symptomIntensityFromScore(form.symptoms[key]),
    })),
);
const recentMeals = computed(() =>
  [...(diary.value.meals || [])]
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, 3),
);
const canSubmit = computed(() =>
  meal.value
    ? Boolean(form.recipe_id)
    : form.symptom_free ||
      allSelectedSymptomsRated(selectedSymptoms.value, form.symptoms),
);

function clearSymptoms() {
  for (const key of symptomKeys.value) form.symptoms[key] = 0;
}

function chooseFree() {
  form.symptom_free = true;
  selectedSymptoms.value = [];
  form.timing_bucket = "unknown";
  form.food_relation = "timed_window";
  form.reference_meal_id = "";
  clearSymptoms();
}

function chooseSymptom(key) {
  const isSelected = selectedSymptoms.value.includes(key);
  selectedSymptoms.value = toggleSelectedSymptom(selectedSymptoms.value, key);
  if (isSelected) {
    form.symptoms[key] = 0;
  } else {
    form.symptom_free = false;
  }
}

function chooseTiming(bucket) {
  form.timing_bucket = bucket;
}

function chooseFoodRelation(value) {
  form.food_relation = value;
  form.timing_bucket = "unknown";
  if (value === "none") form.reference_meal_id = "";
}

function chooseLevel(key, level) {
  form.symptom_free = false;
  form.symptoms[key] = symptomScoreFromIntensity(level);
}

function submit() {
  if (!canSubmit.value || busy.value) return;
  if (!meal.value && !form.symptom_free && step.value === 0) {
    moveStep(1);
    return;
  }
  const data = {
    ...form,
    context_recorded:
      !meal.value &&
      [form.stress, form.sleep_hours].some(
        (value) => value !== null && value !== undefined && value !== "",
      ),
    record_good_moment: meal.value && wellbeing.value === "good",
    occurred_at: new Date(form.occurred_at).toISOString(),
    symptoms: form.symptom_free
      ? Object.fromEntries(symptomKeys.value.map((key) => [key, 0]))
      : form.symptoms,
  };
  const needsFollowup = meal.value && wellbeing.value === "symptoms";
  save(meal.value ? "/meals" : "/checkins", data, (saved) => {
    if (needsFollowup) {
      followup.value = true;
      form.reference_meal_id = saved.id;
      form.symptom_free = false;
      moveStep(0);
    } else emit("close");
  });
}
</script>

<template>
  <EntryPanel
    :busy="busy"
    :tone="meal ? 'meal' : form.symptom_free ? 'well' : 'symptom'"
    :title="meal ? 'Mahlzeit eintragen' : 'Wie geht es deinem Bauch?'"
    @close="emit('close')"
  >
    <RecipeModal
      v-if="creatingRecipe"
      ref="recipeEditor"
      inline
      class="inline-recipe-create"
      @saved="
        (recipe) => {
          form.recipe_id = recipe.id;
        }
      "
      @close="closeRecipe"
    />
    <form class="form guided-entry" @submit.prevent="submit">
      <p v-if="followup" role="status" class="helper">
        Mahlzeit gespeichert. Jetzt kannst du die Beschwerden ergänzen.
      </p>
      <UiSteps
        v-if="!meal && !form.symptom_free"
        :labels="['Befinden', 'Bezug & Zeit']"
        :current="step"
      />
      <h2 ref="stepHeading" tabindex="-1" class="guided-question">
        {{
          meal
            ? "Was hast du gegessen?"
            : step === 0
              ? "Was spürst du gerade?"
              : "Essensbezug und Zeitpunkt?"
        }}
      </h2>
      <template v-if="meal">
        <RecipePicker
          v-model="form.recipe_id"
          :recipes="diary.recipes || []"
          :meals="diary.meals || []"
        />
        <UiButton
          type="button"
          class="button secondary"
          :disabled="creatingRecipe"
          @click="startRecipe"
          ><Plus :size="18" />Neues Rezept direkt hinzufügen</UiButton
        >
        <fieldset class="meal-wellbeing" data-tone="well">
          <legend>Befinden beim Essen</legend>
          <div class="choice-row">
            <UiButton
              v-for="[value, label] in [
                ['good', 'Gut'],
                ['symptoms', 'Beschwerden'],
                ['unrecorded', 'Nicht erfassen'],
              ]"
              :key="value"
              :data-tone="
                value === 'good'
                  ? 'well'
                  : value === 'symptoms'
                    ? 'symptom'
                    : 'neutral'
              "
              type="button"
              class="choice-button"
              :aria-pressed="wellbeing === value"
              :class="{ selected: wellbeing === value }"
              @click="wellbeing = value"
              >{{ label }}</UiButton
            >
          </div>
          <small>{{
            wellbeing === "good"
              ? "Speichert einen guten Moment zum Essen, nicht für den ganzen Tag. Für Verträglichkeit zählt ein späterer Check-in."
              : wellbeing === "symptoms"
                ? "Nach dem Speichern geht es direkt zur Symptomerfassung."
                : "Nur die Mahlzeit wird gespeichert; Befinden bleibt offen."
          }}</small>
        </fieldset>
      </template>
      <template v-else-if="step === 0">
        <UiButton
          type="button"
          class="feeling-good"
          data-tone="well"
          :class="{ selected: form.symptom_free }"
          :aria-pressed="form.symptom_free"
          @click="chooseFree"
          ><Check :size="18" /><strong
            >Zu diesem Zeitpunkt geht es gut</strong
          ></UiButton
        >
        <UiButton
          v-if="form.symptom_free"
          type="button"
          class="text-button"
          @click="form.symptom_free = false"
          >Stattdessen Beschwerden festhalten</UiButton
        >
        <template v-else>
          <p class="symptom-selection-hint">
            Wähle alles aus, was gerade zutrifft.
          </p>
          <div class="symptom-choice-grid">
            <UiButton
              v-for="key in showAllSymptoms ? symptomKeys : commonSymptoms"
              :key="key"
              type="button"
              class="symptom-choice"
              :class="{ selected: selectedSymptoms.includes(key) }"
              :aria-pressed="selectedSymptoms.includes(key)"
              @click="chooseSymptom(key)"
              >{{ symptoms[key] }}</UiButton
            >
          </div>
          <UiButton
            type="button"
            class="text-button"
            :aria-expanded="showAllSymptoms"
            @click="showAllSymptoms = !showAllSymptoms"
            >{{
              showAllSymptoms ? "Weniger anzeigen" : "Weitere Beschwerden"
            }}</UiButton
          >
          <div v-if="selectedSymptoms.length" class="level-picker">
            <div class="picker-label">
              <span>Wie stark ist jedes Symptom?</span>
            </div>
            <div class="symptom-ratings-list">
              <SymptomRating
                v-for="key in selectedSymptoms"
                :key="key"
                :model-value="symptomIntensityFromScore(form.symptoms[key])"
                :symptom-key="key"
                :symptom-label="symptoms[key]"
                @update:model-value="(level) => chooseLevel(key, level)"
              />
            </div>
          </div>
        </template>
      </template>
      <template v-else>
        <p class="entry-recap">
          {{
            ratedSymptoms
              .map(
                ({ name, level }) =>
                  `${name} · ${symptomIntensityLabels[level]}`,
              )
              .join("  /  ")
          }}
          <UiButton type="button" class="text-button" @click="moveStep(0)"
            >Ändern</UiButton
          >
        </p>
        <fieldset class="food-relation-picker">
          <legend>Wie soll der Essensbezug behandelt werden?</legend>
          <div class="food-relation-options">
            <UiButton
              v-for="choice in foodRelationChoices"
              :key="choice.value"
              type="button"
              class="food-relation-option"
              :aria-pressed="form.food_relation === choice.value"
              :class="{ selected: form.food_relation === choice.value }"
              @click="chooseFoodRelation(choice.value)"
              ><strong>{{ choice.label }}</strong
              ><small>{{ choice.hint }}</small></UiButton
            >
          </div>
        </fieldset>
        <template v-if="form.food_relation === 'timed_window'">
          <p class="helper">
            Ein Zeitfenster zeigt Nähe, keinen Auslöser. Die Zeit gilt für alle
            ausgewählten Symptome; bei unterschiedlichem Beginn bitte getrennt
            erfassen.
          </p>
          <div class="timing-choice-grid">
            <UiButton
              v-for="choice in timingChoices"
              :key="choice.value"
              type="button"
              class="timing-choice"
              :class="{ selected: form.timing_bucket === choice.value }"
              :aria-pressed="form.timing_bucket === choice.value"
              @click="chooseTiming(choice.value)"
              ><strong>{{ choice.label }}</strong
              ><small>{{ choice.hint }}</small></UiButton
            >
          </div>
          <small
            >Zeit seit einer Mahlzeit; „Unsicher“ ist auch eine Antwort.</small
          >
        </template>
        <p v-else class="food-relation-note">
          Der genaue Beobachtungszeitpunkt bleibt gespeichert. Für diesen Moment
          werden keine Mahlzeiten oder Zutaten verglichen; Stress und andere
          dokumentierte Einflüsse bleiben auswertbar.
        </p>
      </template>
      <template v-if="meal || step === 1 || form.symptom_free">
        <label class="entry-date" data-tone="time"
          >Zeitpunkt<input
            class="d-input"
            v-model="form.occurred_at"
            type="datetime-local"
            required
        /></label>
        <UiButton
          type="button"
          class="details-toggle"
          :aria-expanded="showDetails"
          @click="showDetails = !showDetails"
          ><span>{{
            showDetails
              ? "Details ausblenden"
              : meal
                ? "Portionen oder Notiz ergänzen"
                : "Stress, Schlaf oder Notiz ergänzen"
          }}</span
          ><ChevronDown :size="16"
        /></UiButton>
        <div v-if="showDetails" class="entry-details">
          <label v-if="meal"
            >Portionen<select class="d-select" v-model.number="form.portions">
              <option
                v-for="portion in portionChoices"
                :key="portion"
                :value="portion"
              >
                {{ portion }}
              </option>
            </select></label
          >
          <template v-else>
            <div class="form-row">
              <label data-tone="stress"
                >Stress (manuell)<input
                  class="d-input"
                  type="number"
                  min="0"
                  max="10"
                  v-model.number="form.stress" /></label
              ><label data-tone="time"
                >Schlaf<input
                  class="d-input"
                  type="number"
                  min="0"
                  max="24"
                  step=".5"
                  v-model.number="form.sleep_hours"
              /></label>
            </div>
            <small
              >Leer lassen, wenn du Stress oder Schlaf nicht eintragen
              möchtest.</small
            >
            <label
              v-if="
                !form.symptom_free &&
                form.food_relation === 'timed_window' &&
                recentMeals.length
              "
              >Eine Mahlzeit fest zuordnen (optional)<select
                class="d-select"
                v-model="form.reference_meal_id"
              >
                <option value="">Alle Mahlzeiten im Zeitfenster</option>
                <option
                  v-for="item in recentMeals"
                  :key="item.id"
                  :value="item.id"
                >
                  {{ item.title }}
                </option>
              </select></label
            >
            <label v-if="cycleEnabled"
              >Zyklus-Kontext<select
                class="d-select"
                v-model="form.cycle_phase"
              >
                <option
                  v-for="choice in cycleChoices"
                  :key="choice.value"
                  :value="choice.value"
                >
                  {{ choice.label }}
                </option></select
              ><small>Grobe Kalender-Schätzung, keine Diagnose.</small></label
            >
          </template>
          <label
            >Notiz <span class="optional">optional</span
            ><textarea
              class="d-textarea"
              v-model="form.notes"
              maxlength="3000"
              rows="2"
            />
          </label>
        </div>
      </template>
      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <div class="wizard-actions">
        <UiButton
          type="button"
          class="button secondary"
          :disabled="busy"
          @click="step === 1 ? moveStep(0) : emit('close')"
          >{{ step === 1 ? "Zurück" : "Abbrechen" }}</UiButton
        >
        <UiButton
          class="button primary"
          :loading="busy"
          :disabled="busy || !canSubmit || creatingRecipe"
          >{{
            !meal && !form.symptom_free && step === 0
              ? "Weiter"
              : meal
                ? "Mahlzeit speichern"
                : "Eintrag speichern"
          }}</UiButton
        >
      </div>
    </form>
  </EntryPanel>
</template>
