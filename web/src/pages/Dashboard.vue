<script setup>
import { entryTone } from "../ui/entry-tones";
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
import { dayOf, localDate, severity } from "../lib";
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
    .slice(0, 2);
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
    <section class="home-compact">
      <header class="home-heading">
        <div>
          <p class="eyebrow">
            {{ dateLabel
            }}<span v-if="diary.profile?.display_name">
              · {{ diary.profile.display_name }}</span
            >
          </p>
          <h1>Dein Tag, im Überblick.</h1>
        </div>
        <Link href="/calendar" class="icon-button" aria-label="Kalender öffnen"
          ><CalendarDays :size="19"
        /></Link>
      </header>
      <Link
        v-if="!diary.profile?.onboarding_completed"
        href="/onboarding"
        class="setup-nudge"
      >
        <span
          ><strong>{{
            diary.profile?.display_name
              ? "Einrichtung abschliessen"
              : "Dein persönliches Tagebuch"
          }}</strong
          ><small>Person anlegen · drei kurze Schritte</small></span
        ><ArrowRight :size="18" />
      </Link>
      <section class="compact-capture" aria-label="Schnell erfassen">
        <UiButton variant="primary" data-tone="meal" @click="openMeal()"
          ><Utensils :size="20" /><span>Mahlzeit eintragen</span></UiButton
        >
        <UiButton
          variant="secondary"
          data-tone="symptom"
          @click="entry = 'check'"
          ><Heart :size="20" /><span>Befinden</span></UiButton
        >
        <UiButton variant="secondary" data-tone="well" @click="entry = 'free'"
          ><Check :size="18" />Gutes Befinden</UiButton
        >
        <details class="compact-more">
          <summary>Weitere Beobachtungen</summary>
          <div class="actions">
            <UiButton
              class="text-button"
              data-tone="stress"
              @click="entry = 'stress'"
              >Stress manuell</UiButton
            ><UiButton
              class="text-button"
              data-tone="stool"
              @click="entry = 'stool'"
              >Stuhl</UiButton
            >
          </div>
        </details>
      </section>
      <div v-if="recentRecipes.length" class="compact-repeats">
        <span class="subtle-label">Noch einmal</span>
        <UiButton
          v-for="recipe in recentRecipes"
          :key="recipe.id"
          class="repeat-chip"
          data-tone="meal"
          @click="openMeal(recipe.id)"
          ><Plus :size="15" /><span>{{ recipe.title }}</span></UiButton
        >
      </div>
      <Link v-else href="/recipes" class="compact-recipe-start"
        ><Plus :size="17" />Erstes Rezept hinzufügen<ArrowRight :size="16"
      /></Link>
      <section class="compact-today">
        <div class="section-heading">
          <h2>
            Heute <small>{{ todayItems.length }} Einträge</small>
          </h2>
          <Link href="/diary">Alle ansehen <ArrowRight :size="14" /></Link>
        </div>
        <div v-if="!todayItems.length" class="compact-empty">
          <p>Noch nichts eingetragen.</p>
          <small>Starte mit Essen oder deinem Befinden.</small>
        </div>
        <div
          v-for="item in todayItems.slice(0, 3)"
          :key="item.kind + item.id"
          class="compact-event"
          :data-tone="entryTone(item)"
        >
          <Utensils v-if="item.kind === 'meal'" :size="17" /><ClipboardCheck
            v-else-if="item.kind === 'stool'"
            :size="17"
          /><HeartPulse v-else-if="item.kind === 'stress'" :size="17" /><Heart
            v-else
            :size="17"
          />
          <strong>{{
            item.kind === "meal"
              ? item.title
              : item.kind === "stool"
                ? "Stuhlbeobachtung"
                : item.kind === "stress"
                  ? "Stress"
                  : item.symptom_free
                    ? "Gutes Befinden"
                    : "Beschwerden · " + severity(item) + "/10"
          }}</strong>
          <time :datetime="item.occurred_at">{{
            new Date(item.occurred_at).toLocaleTimeString("de-CH", {
              hour: "2-digit",
              minute: "2-digit",
            })
          }}</time>
        </div>
        <p v-if="!latestCheckin && todayMeals" class="compact-reminder">
          Befinden noch offen. Ein guter Moment zählt auch.
        </p>
      </section>
      <footer class="home-footer">
        <span>Beobachtungen, keine Diagnose.</span
        ><Link href="/insights">Muster ansehen <ArrowRight :size="14" /></Link>
      </footer>
    </section>
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
