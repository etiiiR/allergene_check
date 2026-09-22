<script setup>
import { computed, reactive, ref } from "vue";
import { Link, usePage } from "@inertiajs/vue3";
import { Check, ChevronDown, Clock3, Heart, Plus, Utensils } from "@lucide/vue";
import Modal from "./Modal.vue";
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
const meal = computed(() => props.type === "meal");
const showDetails = ref(false);
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

const recentRecipes = computed(() => {
  const recipes = page.props.diary?.recipes || [];
  const lastUsed = new Map();
  for (const item of page.props.diary?.meals || []) {
    if (
      !lastUsed.has(item.recipe_id) ||
      item.occurred_at > lastUsed.get(item.recipe_id)
    ) {
      lastUsed.set(item.recipe_id, item.occurred_at);
    }
  }
  return [...recipes]
    .sort((a, b) =>
      (lastUsed.get(b.id) || "").localeCompare(lastUsed.get(a.id) || ""),
    )
    .slice(0, 6);
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

function chooseRecipe(id) {
  form.recipe_id = id;
}

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

function chooseReferenceMeal(id) {
  form.reference_meal_id = form.reference_meal_id === id ? "" : id;
}

function chooseCyclePhase(phase) {
  form.cycle_phase = phase;
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
  const data = {
    ...form,
    occurred_at: new Date(form.occurred_at).toISOString(),
    symptoms: form.symptom_free
      ? Object.fromEntries(symptomKeys.value.map((key) => [key, 0]))
      : form.symptoms,
  };
  save(meal.value ? "/meals" : "/checkins", data, () => emit("close"));
}
</script>

<template>
  <Modal
    :title="meal ? 'Mahlzeit eintragen' : 'Wie geht es deinem Bauch?'"
    @close="emit('close')"
  >
    <form class="form quick-entry-form text-bauch-ink" @submit.prevent="submit">
      <template v-if="meal">
        <div class="entry-intro">
          <span class="entry-step"><Utensils :size="17" /></span>
          <div>
            <strong>Was hast du gegessen?</strong>
            <small>Ein Tipp genügt — Details kannst du später ergänzen.</small>
          </div>
        </div>

        <div v-if="recentRecipes.length" class="quick-recipe-grid">
          <button
            v-for="recipe in recentRecipes"
            :key="recipe.id"
            type="button"
            class="quick-recipe pressable rounded-xl hover:shadow-sm"
            :class="{ selected: form.recipe_id === recipe.id }"
            @click="chooseRecipe(recipe.id)"
          >
            <span class="quick-recipe-icon"><Utensils :size="16" /></span>
            <span>
              <strong>{{ recipe.title }}</strong>
              <small>{{ recipe.ingredients.length }} Zutaten</small>
            </span>
            <Check v-if="form.recipe_id === recipe.id" :size="17" />
          </button>
        </div>
        <Link
          v-else
          href="/recipes"
          class="entry-empty-link pressable rounded-xl hover:shadow-sm"
        >
          <span class="quick-recipe-icon"><Plus :size="17" /></span>
          <span
            ><strong>Noch kein Rezept gespeichert</strong
            ><small>Jetzt ein Lieblingsrezept anlegen</small></span
          >
          <ChevronDown :size="17" class="rotate-link" />
        </Link>

        <div v-if="recentRecipes.length" class="portion-picker">
          <div class="picker-label">
            <span>Portionen</span><small>Standard: 1</small>
          </div>
          <div class="choice-row">
            <button
              v-for="portion in portionChoices"
              :key="portion"
              type="button"
              class="choice-button pressable rounded-lg"
              :class="{ selected: form.portions === portion }"
              @click="form.portions = portion"
            >
              {{ portion }}
            </button>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="entry-intro">
          <span class="entry-step"><Heart :size="17" /></span>
          <div>
            <strong>Wie fühlt es sich gerade an?</strong>
            <small>Wähle nur das, was heute am besten passt.</small>
          </div>
        </div>

        <button
          type="button"
          class="feeling-good pressable rounded-xl hover:shadow-sm"
          :class="{ selected: form.symptom_free }"
          @click="chooseFree"
        >
          <span class="feeling-icon"><Check :size="18" /></span>
          <span
            ><strong>Heute geht es gut</strong
            ><small>Symptomfrei markieren</small></span
          >
          <Check v-if="form.symptom_free" :size="18" />
        </button>

        <div v-if="!form.symptom_free" class="symptom-picker">
          <div class="picker-label">
            <span>Was spürst du?</span><small>Eine Auswahl reicht</small>
          </div>
          <div class="symptom-choice-grid">
            <button
              v-for="key in showAllSymptoms ? symptomKeys : commonSymptoms"
              :key="key"
              type="button"
              class="symptom-choice pressable rounded-lg"
              :class="{ selected: selectedSymptom === key }"
              @click="chooseSymptom(key)"
            >
              {{ symptoms[key] }}
            </button>
          </div>
          <button
            v-if="symptomKeys.length > commonSymptoms.length"
            type="button"
            class="more-button"
            @click="showAllSymptoms = !showAllSymptoms"
          >
            {{ showAllSymptoms ? "Weniger anzeigen" : "Weitere Beschwerden" }}
            <ChevronDown :size="15" :class="{ rotated: showAllSymptoms }" />
          </button>
        </div>

        <div v-if="selectedSymptom" class="level-picker">
          <div class="picker-label">
            <span>{{ selectedSymptomName }} — wie stark?</span
            ><small>{{ selectedLevel }}/10</small>
          </div>
          <div class="level-choice-grid">
            <button
              v-for="level in levelChoices"
              :key="level.value"
              type="button"
              class="level-choice pressable rounded-lg"
              :class="{ selected: selectedLevel === level.value }"
              @click="chooseLevel(level.value)"
            >
              <strong>{{ level.label }}</strong
              ><small>{{ level.hint }}</small>
            </button>
          </div>
        </div>

        <div v-if="selectedSymptom" class="timing-picker">
          <div class="picker-label">
            <span>Wann haben die Beschwerden begonnen?</span
            ><small>Ungefähres Fenster reicht</small>
          </div>
          <div class="timing-choice-grid">
            <button
              v-for="choice in timingChoices"
              :key="choice.value"
              type="button"
              class="timing-choice pressable rounded-lg"
              :class="{ selected: form.timing_bucket === choice.value }"
              @click="chooseTiming(choice.value)"
            >
              <strong>{{ choice.label }}</strong><small>{{ choice.hint }}</small>
            </button>
          </div>
          <div v-if="recentMeals.length" class="reference-meal-picker">
            <div class="picker-label">
              <span>Welche Mahlzeit könnte dazugehören?</span
              ><small>Optional</small>
            </div>
            <div class="reference-meal-list">
              <button
                v-for="meal in recentMeals"
                :key="meal.id"
                type="button"
                class="reference-meal pressable rounded-lg"
                :class="{ selected: form.reference_meal_id === meal.id }"
                @click="chooseReferenceMeal(meal.id)"
              >
                <Utensils :size="14" /><span>{{ meal.title }}</span
                ><Check v-if="form.reference_meal_id === meal.id" :size="14" />
              </button>
            </div>
          </div>
        </div>

        <div v-if="cycleEnabled" class="cycle-checkin-picker">
          <div class="picker-label">
            <span>Zyklus-Kontext</span>
            <small>{{ form.cycle_day ? `Tag ${form.cycle_day}` : "optional" }}</small>
          </div>
          <div class="cycle-choice-grid">
            <button
              v-for="choice in cycleChoices"
              :key="choice.value"
              type="button"
              class="cycle-choice pressable rounded-lg"
              :class="{ selected: form.cycle_phase === choice.value }"
              @click="chooseCyclePhase(choice.value)"
            >
              {{ choice.label }}
            </button>
          </div>
          <small class="cycle-note"
            >Grobe Kalender-Schätzung — keine medizinische oder
            verhütungsbezogene Aussage.</small
          >
        </div>
      </template>

      <button
        type="button"
        class="details-toggle pressable"
        @click="showDetails = !showDetails"
      >
        <span
          ><Clock3 :size="16" />
          {{
            showDetails
              ? "Details ausblenden"
              : "Zeit, Stress, Schlaf oder Notiz ergänzen"
          }}</span
        >
        <ChevronDown :size="16" :class="{ rotated: showDetails }" />
      </button>

      <div v-if="showDetails" class="entry-details">
        <label>
          Zeitpunkt
          <input v-model="form.occurred_at" type="datetime-local" required />
        </label>
        <div v-if="!meal" class="form-row">
          <label
            >Stress (manuell)<input
              v-model.number="form.stress"
              type="number"
              min="0"
              max="10"
          /></label>
          <label
            >Schlaf<input
              v-model.number="form.sleep_hours"
              type="number"
              min="0"
              max="24"
              step=".5"
          /></label>
        </div>
        <small v-if="!meal" class="manual-stress-note">
          Falls keine Watch- oder Ringmessung vorliegt, kannst du dein
          persönliches Stresslevel hier direkt mit dem Check-in speichern.
        </small>
        <label>
          Notiz <span class="optional">optional</span>
          <textarea
            v-model="form.notes"
            maxlength="3000"
            rows="3"
            placeholder="Was möchtest du noch festhalten?"
          />
        </label>
      </div>

      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <p v-if="!canSubmit" class="entry-hint">
        {{
          meal
            ? "Wähle ein Rezept, um es zu speichern."
            : "Wähle symptomfrei oder eine Beschwerde aus."
        }}
      </p>
      <div class="form-actions">
        <button
          type="button"
          class="button secondary"
          @click="emit('close')"
          :disabled="busy"
        >
          Abbrechen
        </button>
        <button class="button primary" :disabled="busy || !canSubmit">
          {{
            busy
              ? "Wird gespeichert …"
              : meal
                ? "Mahlzeit speichern"
                : "Eintrag speichern"
          }}
        </button>
      </div>
    </form>
  </Modal>
</template>
