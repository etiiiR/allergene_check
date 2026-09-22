<script setup>
import { computed, ref } from "vue";
import { Head, Link } from "@inertiajs/vue3";
import {
  Activity,
  ArrowRight,
  Check,
  ClipboardCheck,
  Heart,
  HeartPulse,
  Plus,
  Sparkles,
  Utensils,
} from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import EntryModal from "../components/EntryModal.vue";
import StoolModal from "../components/StoolModal.vue";
import StressModal from "../components/StressModal.vue";
import { dateTime, dayOf, localDate, severity } from "../lib";

const props = defineProps({ diary: Object });
const entry = ref("");
const stoolEntry = ref(false);
const stressEntry = ref(false);
const selectedRecipe = ref("");
const today = localDate();
const todayItems = computed(() =>
  [
    ...(props.diary.meals || []).map((item) => ({ ...item, kind: "meal" })),
    ...(props.diary.checkins || []).map((item) => ({ ...item, kind: "check" })),
    ...(props.diary.stress_observations || []).map((item) => ({ ...item, kind: "stress", occurred_at: item.observed_at })),
  ]
    .filter((item) => dayOf(item.occurred_at) === today)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
);
const todayMeals = computed(
  () => todayItems.value.filter((item) => item.kind === "meal").length,
);
const todayCheckins = computed(
  () => todayItems.value.filter((item) => item.kind === "check").length,
);
const todayStress = computed(
  () => todayItems.value.filter((item) => item.kind === "stress").length,
);
const latestCheckin = computed(
  () =>
    [...(props.diary.checkins || [])].sort((a, b) =>
      b.occurred_at.localeCompare(a.occurred_at),
    )[0],
);
const recentRecipes = computed(() => {
  const recipes = props.diary.recipes || [];
  const lastUsed = new Map();
  for (const meal of props.diary.meals || []) {
    if (
      !lastUsed.has(meal.recipe_id) ||
      meal.occurred_at > lastUsed.get(meal.recipe_id)
    ) {
      lastUsed.set(meal.recipe_id, meal.occurred_at);
    }
  }
  return [...recipes]
    .sort((a, b) =>
      (lastUsed.get(b.id) || "").localeCompare(lastUsed.get(a.id) || ""),
    )
    .slice(0, 5);
});
const dayLabel = new Intl.DateTimeFormat("de-CH", {
  weekday: "long",
  day: "numeric",
  month: "long",
}).format(new Date());
const dayTitle = computed(() => {
  if (latestCheckin.value?.symptom_free) return "Der letzte Check-in war gut.";
  if (todayItems.value.length) return "Du bist heute gut dabei.";
  return "Ein kleiner Eintrag reicht.";
});
const daySubtitle = computed(() => {
  if (latestCheckin.value?.symptom_free)
    return "Ein guter Zeitpunkt — einzelne Beschwerden kannst du separat festhalten.";
  if (todayItems.value.length)
    return "Jede Mahlzeit und jedes Befinden macht dein Bild klarer.";
  return "Beginne mit einer Mahlzeit oder einem kurzen Befinden.";
});

function openMeal(recipeId = "") {
  selectedRecipe.value = recipeId;
  entry.value = "meal";
}

function closeEntry() {
  entry.value = "";
  selectedRecipe.value = "";
}
</script>

<template>
  <Head title="Heute" />
  <AppShell>
    <div class="page-heading compact-heading dashboard-heading mb-5 md:mb-7">
      <div>
        <p class="eyebrow">{{ dayLabel }}</p>
        <h1 class="font-display text-bauch-ink">Hör auf dein Bauchgefühl.</h1>
        <p class="tracking-[0.01em]">Dein persönlicher Tagesüberblick.</p>
      </div>
      <div class="actions">
        <button class="button secondary" @click="entry = 'check'">
          <Heart :size="16" /> Befinden
        </button>
        <button class="button primary" @click="openMeal()">
          <Plus :size="16" /> Mahlzeit
        </button>
      </div>
    </div>

    <section class="day-overview quiet-ring pressable rounded-[1.15rem]">
      <div class="day-overview-top">
        <span class="today-label">DEIN HEUTE</span>
        <span
          >{{ todayItems.length }}
          {{ todayItems.length === 1 ? "Eintrag" : "Einträge" }}</span
        >
      </div>
      <div class="day-overview-main">
        <div>
          <h2>{{ dayTitle }}</h2>
          <p>{{ daySubtitle }}</p>
        </div>
        <div
          class="day-check quiet-ring"
          :class="{ done: latestCheckin?.symptom_free }"
        >
          <Check v-if="latestCheckin?.symptom_free" :size="21" />
          <Activity v-else :size="31" />
        </div>
      </div>
      <div class="day-progress" aria-label="Tagesfortschritt">
        <span :class="{ active: todayMeals }"></span>
        <span :class="{ active: todayCheckins }"></span>
        <span :class="{ active: todayItems.length >= 3 }"></span>
      </div>
      <div class="day-stats">
        <span><Utensils :size="14" /> {{ todayMeals }} Mahlzeiten</span>
        <span><Heart :size="14" /> {{ todayCheckins }} Befinden</span>
        <span><HeartPulse :size="14" /> {{ todayStress }} Stress</span>
        <span v-if="latestCheckin?.symptom_free" class="good-stat"
          ><Check :size="14" /> symptomfrei</span
        >
      </div>
    </section>

    <section
      class="quick-actions quick-actions-complete"
      aria-label="Schnelle Aktionen"
    >
      <button
        class="action-tile action-tile-meal pressable rounded-xl shadow-sm hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
        @click="openMeal()"
      >
        <span class="action-tile-icon"><Utensils :size="20" /></span>
        <span
          ><strong>Mahlzeit</strong
          ><small>{{
            recentRecipes.length ? "Rezept auswählen" : "Rezept anlegen"
          }}</small></span
        >
        <ArrowRight :size="17" />
      </button>
      <button
        class="action-tile pressable rounded-xl shadow-sm hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
        @click="entry = 'check'"
      >
        <span class="action-tile-icon"><Heart :size="20" /></span>
        <span
          ><strong>Befinden</strong
          ><small>Mit einem Tipp festhalten</small></span
        >
        <ArrowRight :size="17" />
      </button>
      <button
        class="action-tile pressable rounded-xl shadow-sm hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
        @click="entry = 'free'"
      >
        <span class="action-tile-icon"><Check :size="20" /></span>
        <span
          ><strong>Gutes Befinden</strong><small>Diesen Zeitpunkt markieren</small></span
        >
        <ArrowRight :size="17" />
      </button>
      <button
        class="action-tile pressable rounded-xl shadow-sm hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
        @click="stoolEntry = true"
      >
        <span class="action-tile-icon"><ClipboardCheck :size="20" /></span>
        <span><strong>Stuhl</strong><small>Folgetag beobachten</small></span>
        <ArrowRight :size="17" />
      </button>
      <button
        class="action-tile pressable rounded-xl shadow-sm hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
        aria-label="Stress manuell"
        @click="stressEntry = true"
      >
        <span class="action-tile-icon"><HeartPulse :size="20" /></span>
        <span><strong>Stress manuell</strong><small>Wenn keine Watch misst</small></span>
        <ArrowRight :size="17" />
      </button>
    </section>

    <section v-if="recentRecipes.length" class="recipe-shortcuts rounded-xl">
      <div class="section-heading">
        <div>
          <h2>Zuletzt gekocht</h2>
          <small>Mit einem Tipp protokollieren</small>
        </div>
        <Link href="/recipes">Alle Rezepte <ArrowRight :size="14" /></Link>
      </div>
      <div class="recipe-shortcut-list">
        <button
          v-for="recipe in recentRecipes"
          :key="recipe.id"
          class="recipe-shortcut pressable rounded-xl hover:-translate-y-0.5 hover:shadow-sm active:translate-y-0"
          @click="openMeal(recipe.id)"
        >
          <span class="recipe-shortcut-icon"><Utensils :size="17" /></span>
          <strong>{{ recipe.title }}</strong>
          <Plus :size="15" />
        </button>
      </div>
    </section>
    <section v-else class="onboarding-card quiet-ring rounded-xl">
      <span class="onboarding-icon"><Sparkles :size="18" /></span>
      <div>
        <strong>Dein erstes Lieblingsrezept?</strong>
        <p>
          Speichere es einmal — danach protokollierst du Mahlzeiten mit einem
          Tipp.
        </p>
      </div>
      <Link href="/recipes" class="text-button"
        >Anlegen <ArrowRight :size="14"
      /></Link>
    </section>

    <section class="panel today-list quiet-ring rounded-xl">
      <div class="section-heading">
        <div>
          <h2>Dein Tag</h2>
          <small>Alles, was du heute festgehalten hast</small>
        </div>
        <Link href="/diary">Alles ansehen <ArrowRight :size="14" /></Link>
      </div>
      <div v-if="!todayItems.length" class="empty-state compact-empty">
        <p>Noch nichts festgehalten.</p>
        <button class="text-button" @click="entry = 'check'">
          Ersten Check-in machen <ArrowRight :size="14" />
        </button>
      </div>
      <div v-for="item in todayItems" :key="item.id" class="timeline-row">
        <span class="event-icon"
          ><Utensils v-if="item.kind === 'meal'" :size="17" /><HeartPulse
            v-else-if="item.kind === 'stress'"
            :size="17"
          /><Heart v-else :size="17" /></span>
        <div>
          <strong>{{
            item.kind === "meal"
              ? item.title
              : item.kind === "stress"
                ? "Stress manuell"
              : item.symptom_free
                ? "Symptomfrei"
                : "Beschwerden"
          }}</strong>
          <small
            >{{ dateTime(item.occurred_at)
            }}<span v-if="item.kind === 'check' && !item.symptom_free">
              · {{ severity(item) }}/10</span
            ><span v-else-if="item.kind === 'stress'"> · {{ item.normalized_stress ?? item.value }}/10</span></small
          >
        </div>
        <span
          class="pill"
          :class="
            item.kind === 'meal'
              ? 'neutral'
              : item.kind === 'stress'
                ? 'neutral'
              : item.symptom_free
                ? 'low'
                : 'high'
          "
          >{{
            item.kind === "meal"
              ? "Mahlzeit"
              : item.kind === "stress"
                ? "Stress"
              : item.symptom_free
                ? "Gut"
                : "Check-in"
          }}</span
        >
      </div>
    </section>
    <p class="small-disclaimer">
      Muster sind Beobachtungen und keine Diagnose.
    </p>
    <EntryModal
      v-if="entry"
      :type="entry"
      :recipe-id="selectedRecipe"
      @close="closeEntry"
    />
    <StoolModal v-if="stoolEntry" @close="stoolEntry = false" />
    <StressModal v-if="stressEntry" @close="stressEntry = false" />
  </AppShell>
</template>
