<script setup>
import { computed, ref } from "vue";
import { Head, Link } from "@inertiajs/vue3";
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  Heart,
  HeartPulse,
  Plus,
  Utensils,
  CalendarDays,
} from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import EntryModal from "../components/EntryModal.vue";
import StoolModal from "../components/StoolModal.vue";
import StressModal from "../components/StressModal.vue";
import { dateTime, dayOf, localDate, severity } from "../lib";
const props = defineProps({ diary: Object });
const entry = ref("");
const selectedRecipe = ref("");
const today = localDate();
const todayItems = computed(() =>
  [
    ...(props.diary.meals || []).map((x) => ({ ...x, kind: "meal" })),
    ...(props.diary.checkins || []).map((x) => ({ ...x, kind: "check" })),
    ...(props.diary.stools || []).map((x) => ({
      ...x,
      kind: "stool",
      occurred_at: x.observed_at,
    })),
    ...(props.diary.stress_observations || []).map((x) => ({
      ...x,
      kind: "stress",
      occurred_at: x.observed_at,
    })),
  ]
    .filter((x) => dayOf(x.occurred_at) === today)
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at)),
);
const todayMeals = computed(
  () => todayItems.value.filter((x) => x.kind === "meal").length,
);
const todayCheckins = computed(
  () => todayItems.value.filter((x) => x.kind === "check").length,
);
const latestCheckin = computed(() =>
  todayItems.value.find((x) => x.kind === "check"),
);
const recentRecipes = computed(() => {
  const lastUsed = new Map();
  for (const meal of props.diary.meals || [])
    if (
      !lastUsed.has(meal.recipe_id) ||
      meal.occurred_at > lastUsed.get(meal.recipe_id)
    )
      lastUsed.set(meal.recipe_id, meal.occurred_at);
  return [...(props.diary.recipes || [])]
    .sort((a, b) =>
      (lastUsed.get(b.id) || "").localeCompare(lastUsed.get(a.id) || ""),
    )
    .slice(0, 4);
});
const dateLabel = new Intl.DateTimeFormat("de-CH", {
  weekday: "long",
  day: "numeric",
  month: "long",
}).format(new Date());
function openMeal(id = "") {
  selectedRecipe.value = id;
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
    <div class="page-heading">
      <div>
        <p class="eyebrow">{{ dateLabel }}</p>
        <h1>Dein Tag, im Überblick.</h1>
        <p>Essen und Befinden festhalten. Schritt für Schritt.</p>
      </div>
      <Link href="/calendar" class="button secondary"
        ><CalendarDays :size="16" /> Kalender</Link
      >
    </div>
    <div class="dashboard-layout">
      <div class="dashboard-primary">
        <UiCard class="capture-card">
          <div class="section-heading">
            <h2>Was möchtest du festhalten?</h2>
            <span class="subtle-label">Neuer Eintrag</span>
          </div>
          <UiButton
            variant="primary"
            class="capture-primary"
            @click="openMeal()"
            ><Plus :size="20" /><span
              >Mahlzeit eintragen<small
                >Ein Rezept wählen und speichern</small
              ></span
            ><ArrowRight :size="18"
          /></UiButton>
          <div class="capture-secondary">
            <UiButton variant="secondary" @click="entry = 'check'"
              ><Heart :size="18" /> Befinden</UiButton
            >
            <UiButton variant="secondary" @click="entry = 'free'"
              ><Check :size="18" /> Gutes Befinden</UiButton
            >
          </div>
          <details class="additional-actions">
            <summary>Weitere Beobachtungen <Plus :size="15" /></summary>
            <div class="actions">
              <UiButton variant="ghost" @click="entry = 'stress'"
                ><HeartPulse :size="17" /> Stress manuell</UiButton
              ><UiButton variant="ghost" @click="entry = 'stool'"
                ><ClipboardCheck :size="17" /> Stuhl</UiButton
              >
            </div>
          </details>
        </UiCard>
        <section class="recipe-shortcuts" v-if="recentRecipes.length">
          <div class="section-heading">
            <h2>Zuletzt verwendet</h2>
            <Link href="/recipes">Alle Rezepte <ArrowRight :size="14" /></Link>
          </div>
          <div class="recipe-shortcut-list">
            <UiButton
              v-for="recipe in recentRecipes"
              :key="recipe.id"
              class="recipe-shortcut"
              @click="openMeal(recipe.id)"
              ><Utensils :size="17" /><strong>{{ recipe.title }}</strong
              ><Plus :size="16"
            /></UiButton>
          </div>
        </section>
        <UiCard v-else class="onboarding-card"
          ><h2>Starte mit deinem ersten Rezept</h2>
          <p>
            Einmal speichern, danach mit einem Tipp ins Tagebuch übernehmen.
          </p>
          <Link href="/recipes" class="button secondary"
            >Rezept hinzufügen <ArrowRight :size="16" /></Link
        ></UiCard>
        <UiCard class="today-list">
          <div class="section-heading">
            <div>
              <h2>Heute dokumentiert</h2>
              <small>{{ todayItems.length }} Einträge</small>
            </div>
            <Link href="/diary">Tagebuch <ArrowRight :size="14" /></Link>
          </div>
          <div v-if="!todayItems.length" class="empty-state compact-empty">
            <p>Heute noch keine Einträge.</p>
            <small>Ein kurzer Check-in genügt für den Anfang.</small>
          </div>
          <TransitionGroup name="list" tag="div">
            <div
              v-for="item in todayItems"
              :key="item.kind + item.id"
              class="timeline-row"
            >
              <span class="event-icon"
                ><Utensils
                  v-if="item.kind === 'meal'"
                  :size="17" /><ClipboardCheck
                  v-else-if="item.kind === 'stool'"
                  :size="17" /><HeartPulse
                  v-else-if="item.kind === 'stress'"
                  :size="17" /><Heart v-else :size="17"
              /></span>
              <div>
                <strong>{{
                  item.kind === "meal"
                    ? item.title
                    : item.kind === "stool"
                      ? "Stuhlbeobachtung"
                      : item.kind === "stress"
                        ? "Stress"
                        : item.symptom_free
                          ? "Gutes Befinden"
                          : "Beschwerden"
                }}</strong
                ><small
                  >{{ dateTime(item.occurred_at)
                  }}<span v-if="item.kind === 'check' && !item.symptom_free">
                    · {{ severity(item) }}/10</span
                  ></small
                >
              </div>
              <UiBadge
                :tone="
                  item.kind === 'check'
                    ? item.symptom_free
                      ? 'low'
                      : 'high'
                    : 'neutral'
                "
                >{{
                  item.kind === "meal"
                    ? "Mahlzeit"
                    : item.kind === "check"
                      ? item.symptom_free
                        ? "Gut"
                        : "Befinden"
                      : item.kind === "stool"
                        ? "Stuhl"
                        : "Stress"
                }}</UiBadge
              >
            </div>
          </TransitionGroup>
        </UiCard>
      </div>
      <aside class="day-summary">
        <p class="eyebrow">HEUTE</p>
        <h2>Deine Momentaufnahme</h2>
        <dl class="day-counts">
          <div>
            <dt>Mahlzeiten</dt>
            <dd>{{ todayMeals }}</dd>
          </div>
          <div>
            <dt>Befinden</dt>
            <dd>{{ todayCheckins }}</dd>
          </div>
        </dl>
        <div class="follow-up-note">
          <Heart :size="18" />
          <div>
            <strong>{{
              latestCheckin
                ? latestCheckin.symptom_free
                  ? "Zuletzt gutes Befinden"
                  : "Beschwerden festgehalten"
                : "Befinden noch offen"
            }}</strong>
            <p>
              {{
                latestCheckin
                  ? "Ein Check-in beschreibt diesen Zeitpunkt. Wie es später ist, kannst du separat festhalten."
                  : "Wie geht es dir gerade? Auch gute Momente helfen, Muster zu verstehen."
              }}
            </p>
            <UiButton class="text-button" @click="entry = 'check'"
              >Befinden ergänzen <ArrowRight :size="14"
            /></UiButton>
          </div>
        </div>
        <Link href="/insights" class="summary-link"
          >Deine Muster ansehen <ArrowRight :size="16"
        /></Link>
        <p class="small-disclaimer">
          Persönliche Beobachtungen. Keine Diagnose.
        </p>
      </aside>
    </div>
    <EntryModal
      v-if="['meal', 'check', 'free'].includes(entry)"
      :type="entry"
      :recipe-id="selectedRecipe"
      @close="closeEntry"
    />
    <StoolModal v-if="entry === 'stool'" @close="closeEntry" />
    <StressModal v-if="entry === 'stress'" @close="closeEntry" />
  </AppShell>
</template>
