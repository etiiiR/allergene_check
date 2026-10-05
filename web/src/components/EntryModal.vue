<script setup>
import { computed, reactive, ref, nextTick } from "vue";
import { usePage } from "@inertiajs/vue3";
import { Check, ChevronDown, Plus } from "@lucide/vue";
import EntryPanel from "./EntryPanel.vue";
import RecipeModal from "./RecipeModal.vue";
import RecipePicker from "./RecipePicker.vue";
import UiSteps from "./ui/UiSteps.vue";
import { localTime, useMutation } from "../lib";

const props = defineProps({
  type: String,
  recipeId: String,
  day: String,
  initialSymptom: String,
});
const emit = defineEmits(["close"]);
const page = usePage();
const { busy, error, save } = useMutation();
const now = localTime();
const symptoms = computed(() => page.props.symptoms || {});
const symptomKeys = computed(() => Object.keys(symptoms.value));
const profile = computed(() => page.props.diary?.profile || {});
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
const selectedSymptom = ref(props.initialSymptom || "");
const selectedLevel = ref(5);
const portionChoices = [0.5, 1, 1.5, 2];
const timingChoices = [
  { value: "immediate", label: "Direkt", hint: "0–30 min" },
  { value: "early", label: "Bald danach", hint: "30 min–2 h" },
  { value: "mid", label: "Später", hint: "2–6 h" },
  { value: "late", label: "Sehr spät", hint: "6–24 h" },
  { value: "unknown", label: "Unsicher", hint: "weiß ich nicht" },
];
const cycleChoices = [
  { value: "unknown", label: "Unsicher" },
  { value: "menstruation", label: "Menstruation" },
  { value: "follicular", label: "Follikelphase" },
  { value: "ovulation", label: "Ovulationsfenster" },
  { value: "luteal", label: "Lutealphase" },
];
const levelChoices = [
  { value: 3, label: "Leicht", hint: "spürbar" },
  { value: 6, label: "Mittel", hint: "stärker" },
  { value: 9, label: "Stark", hint: "sehr stark" },
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
  reference_meal_id: "",
  cycle_phase: initialCycle.phase,
  cycle_day: initialCycle.day,
  stress: 3,
  sleep_hours: 8,
});

const selectedSymptomName = computed(
  () => symptoms.value[selectedSymptom.value] || "Beschwerden",
);
const recentMeals = computed(() =>
  [...(page.props.diary?.meals || [])]
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, 3),
);
const canSubmit = computed(() =>
  meal.value
    ? Boolean(form.recipe_id)
    : form.symptom_free || Boolean(selectedSymptom.value),
);

function clearSymptoms() {
  for (const key of symptomKeys.value) form.symptoms[key] = 0;
}

function chooseFree() {
  form.symptom_free = true;
  selectedSymptom.value = "";
  form.timing_bucket = "unknown";
  form.reference_meal_id = "";
  clearSymptoms();
}

function chooseSymptom(key) {
  form.symptom_free = false;
  selectedSymptom.value = key;
  clearSymptoms();
  form.symptoms[key] = selectedLevel.value;
}

function chooseTiming(bucket) {
  form.timing_bucket = bucket;
}

function chooseLevel(level) {
  form.symptom_free = false;
  selectedLevel.value = level;
  if (selectedSymptom.value) {
    clearSymptoms();
    form.symptoms[selectedSymptom.value] = level;
  }
}

function submit() {
  if (!canSubmit.value || busy.value) return;
  if (!meal.value && !form.symptom_free && step.value === 0) {
    moveStep(1);
    return;
  }
  const data = {
    ...form,
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
        :labels="['Befinden', 'Zeit & Speichern']"
        :current="step"
      />
      <h2 ref="stepHeading" tabindex="-1" class="guided-question">
        {{
          meal
            ? "Was hast du gegessen?"
            : step === 0
              ? "Was spürst du gerade?"
              : "Wann ging es los?"
        }}
      </h2>
      <template v-if="meal">
        <RecipePicker
          v-model="form.recipe_id"
          :recipes="page.props.diary?.recipes || []"
          :meals="page.props.diary?.meals || []"
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
          <div class="symptom-choice-grid">
            <UiButton
              v-for="key in showAllSymptoms ? symptomKeys : commonSymptoms"
              :key="key"
              type="button"
              class="symptom-choice"
              :class="{ selected: selectedSymptom === key }"
              :aria-pressed="selectedSymptom === key"
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
          <div v-if="selectedSymptom" class="level-picker">
            <div class="picker-label">
              <span>Wie stark?</span><small>{{ selectedLevel }}/10</small>
            </div>
            <div class="level-choice-grid">
              <UiButton
                v-for="level in levelChoices"
                :key="level.value"
                type="button"
                class="level-choice"
                :class="{ selected: selectedLevel === level.value }"
                :aria-pressed="selectedLevel === level.value"
                @click="chooseLevel(level.value)"
                >{{ level.label }}</UiButton
              >
            </div>
          </div>
        </template>
      </template>
      <template v-else>
        <p class="entry-recap">
          {{ selectedSymptomName }} · {{ selectedLevel }}/10
          <UiButton type="button" class="text-button" @click="moveStep(0)"
            >Ändern</UiButton
          >
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
        <small>Zeit nach dem Essen; „Unsicher“ ist auch eine Antwort.</small>
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
            <label v-if="!form.symptom_free && recentMeals.length"
              >Mögliche Mahlzeit (optional)<select
                class="d-select"
                v-model="form.reference_meal_id"
              >
                <option value="">Nicht zuordnen</option>
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
