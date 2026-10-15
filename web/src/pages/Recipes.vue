<script setup>
import { ref, computed, watch, nextTick } from "vue";
import { Head } from "@inertiajs/vue3";
import {
  Plus,
  Search,
  CookingPot,
  Pencil,
  Trash2,
  ArrowRight,
  Sparkles,
  Flag,
  X,
} from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import RecipeModal from "../components/RecipeModal.vue";
import EntryModal from "../components/EntryModal.vue";
import RecipeFlagModal from "../components/RecipeFlagModal.vue";
import EntryPanel from "../components/EntryPanel.vue";
import { useVaultDiary } from "../privacy/vault-session.js";
import { api, foodName, useMutation, allergenLabels } from "../lib";
import { recipeIndex, findRecipes } from "../recipe-search";
const props = defineProps({ foods: Array });
const diary = useVaultDiary();
const search = ref(""),
  editing = ref(null),
  creating = ref(false),
  meal = ref(null),
  pending = ref(null),
  detail = ref(null),
  analysis = ref(null),
  analysisError = ref(""),
  analysisBusy = ref(false),
  flagging = ref(null),
  flagKind = ref("suspected");
const { save, busy, error } = useMutation();
const sort = ref("recent"),
  currentPage = ref(1),
  resultsHeading = ref(null),
  searchInput = ref(null);
const index = computed(() =>
  recipeIndex(diary.value.recipes, diary.value.meals),
);
const list = computed(() => findRecipes(index.value, search.value, sort.value));
const pageSize = 12;
const pages = computed(() =>
  Math.max(1, Math.ceil(list.value.length / pageSize)),
);
const visibleRecipes = computed(() =>
  list.value
    .slice((currentPage.value - 1) * pageSize, currentPage.value * pageSize)
    .map((item) => item.recipe),
);
watch([search, sort], () => {
  currentPage.value = 1;
});
watch(pages, (value) => {
  currentPage.value = Math.min(value, currentPage.value);
});
async function changePage(value) {
  currentPage.value = value;
  await nextTick();
  resultsHeading.value?.focus({ preventScroll: true });
  resultsHeading.value?.scrollIntoView({ block: "start", behavior: "instant" });
}
async function clearSearch() {
  search.value = "";
  await nextTick();
  searchInput.value?.focus();
}
function level(r) {
  const known = r.ingredients
    .flatMap((i) => i.food_ids)
    .map((id) => props.foods.find((f) => f.id === id));
  return known.some((f) => f?.level === "higher")
    ? "FODMAP-Hinweise"
    : "Zutaten prüfen";
}
function flagsFor(recipe) {
  return (diary.value.recipe_flags || []).filter(
    (flag) => flag.recipe_id === recipe.id,
  );
}
function openFlag(recipe, kind) {
  flagging.value = recipe;
  flagKind.value = kind;
}
function removeFlag(flag) {
  save("/recipe_flags/" + flag.id, undefined, () => {}, "DELETE");
}
async function inspect(recipe) {
  detail.value = recipe;
  analysis.value = null;
  analysisError.value = "";
  analysisBusy.value = true;
  try {
    const data = await api("/patterns");
    // Reuse the same local ingredient identities used by meal history.
    const ids = new Set(recipe.analysis_ingredient_ids || []);
    analysis.value = {
      ...data,
      associations: data.associations.filter((a) => ids.has(a.ingredient_id)),
    };
  } catch (e) {
    analysisError.value = e.message;
  } finally {
    analysisBusy.value = false;
  }
}
</script>
<template>
  <Head title="Meine Rezepte" /><AppShell
    ><div class="page-heading mb-6">
      <div>
        <p class="eyebrow">REZEPTSAMMLUNG</p>
        <h1 class="font-display text-bauch-ink">Meine Rezepte</h1>
        <p class="max-w-prose">
          Einmal speichern. Schnell wieder als Mahlzeit eintragen.
        </p>
      </div>
      <UiButton
        class="button primary tap-target"
        data-tone="meal"
        @click="creating = true"
      >
        <Plus :size="18" />Rezept hinzufügen
      </UiButton>
    </div>
    <div class="recipe-library-tools">
      <div class="search-box">
        <Search :size="18" /><input
          class="d-input"
          aria-label="Rezepte suchen"
          ref="searchInput"
          type="search"
          v-model="search"
          placeholder="Nach Rezept oder Zutat suchen …"
        /><button
          v-if="search"
          type="button"
          class="icon-button"
          aria-label="Rezeptsuche leeren"
          @click="clearSearch"
        >
          <X :size="17" />
        </button>
      </div>
      <label
        >Sortierung<select
          class="d-select"
          v-model="sort"
          aria-label="Rezeptsammlung sortieren"
        >
          <option value="recent">Zuletzt verwendet</option>
          <option value="frequent">Häufig gegessen</option>
          <option value="name">Name A–Z</option>
        </select></label
      >
    </div>
    <p
      ref="resultsHeading"
      tabindex="-1"
      class="recipe-result-count"
      role="status"
    >
      {{
        search.trim()
          ? `${list.length} Treffer für „${search.trim()}“`
          : `${list.length} Rezepte`
      }}<span v-if="list.length">
        · {{ (currentPage - 1) * pageSize + 1 }}–{{
          Math.min(currentPage * pageSize, list.length)
        }}
        angezeigt</span
      >
    </p>
    <div v-if="!diary.recipes.length" class="panel empty-state">
      <CookingPot :size="34" />
      <h2>Hier ist Platz für deine Lieblingsgerichte.</h2>
      <p>
        Füge ein Rezept hinzu. Die Textanalyse hilft dir,<br />Zutaten zu
        erkennen und später Muster zu entdecken.
      </p>
      <UiButton class="button primary" @click="creating = true">
        Mein erstes Rezept
      </UiButton>
    </div>
    <div v-else-if="!list.length" class="panel empty-state">
      <Search :size="28" />
      <h2>Kein passendes Rezept gefunden.</h2>
      <p>
        Suche nach einem kürzeren Namen oder einer Zutat. Deine gespeicherten
        Rezepte sind weiterhin da.
      </p>
      <UiButton class="button secondary" @click="clearSearch"
        >Suche zurücksetzen</UiButton
      >
    </div>
    <div class="recipe-library-list">
      <article
        class="panel recipe-card"
        data-tone="meal"
        v-for="r in visibleRecipes"
        :key="r.id"
        :data-recipe-id="r.id"
        data-testid="recipe-card"
      >
        <div class="recipe-body">
          <span class="eyebrow"
            >{{ r.ingredients.length }} ZUTATEN ·
            {{ r.servings }} PORTIONEN</span
          >
          <h2>{{ r.title }}</h2>
          <p class="recipe-excerpt">
            {{ r.ingredients.map((i) => i.text).join(" · ") }}
          </p>
          <span v-if="flagsFor(r).length" class="pill high recipe-flag-pill">
            <Flag :size="12" />{{ flagsFor(r).length }} persönliche Markierung{{
              flagsFor(r).length === 1 ? "" : "en"
            }}
          </span>
          <div class="recipe-library-actions">
            <UiButton
              class="button secondary"
              aria-label="Ins Tagebuch eintragen"
              @click="meal = r"
            >
              <Plus :size="16" />Eintragen
            </UiButton>
            <UiButton
              class="text-button"
              aria-label="Details und Verträglichkeit ansehen"
              @click="inspect(r)"
            >
              Details <ArrowRight :size="14" />
            </UiButton>
          </div>
          <details class="recipe-options">
            <summary>Bearbeiten & weitere Optionen</summary>
            <div class="recipe-actions">
              <span class="pill neutral">{{ level(r) }}</span>
              <div>
                <UiButton
                  class="icon-button"
                  @click="editing = r"
                  aria-label="Rezept bearbeiten"
                >
                  <Pencil :size="16" /></UiButton
                ><UiButton
                  class="icon-button"
                  @click="pending = r"
                  aria-label="Rezept löschen"
                >
                  <Trash2 :size="16" />
                </UiButton>
              </div>
            </div>
            <div class="recipe-flag-actions">
              <UiButton class="text-button" @click="openFlag(r, 'suspected')">
                <Flag :size="14" />Verdächtig markieren
              </UiButton>
              <UiButton class="text-button" @click="openFlag(r, 'reaction')">
                <Sparkles :size="14" />Reaktion markieren
              </UiButton>
            </div>
          </details>
        </div>
      </article>
    </div>
    <nav
      v-if="pages > 1"
      class="recipe-pagination library-pagination"
      aria-label="Rezeptsammlung blättern"
    >
      <UiButton
        class="button secondary"
        :disabled="currentPage === 1"
        @click="changePage(currentPage - 1)"
        >Zurück</UiButton
      >
      <span>Seite {{ currentPage }} / {{ pages }}</span>
      <UiButton
        class="button secondary"
        :disabled="currentPage === pages"
        @click="changePage(currentPage + 1)"
        >Weiter</UiButton
      >
    </nav>
    <RecipeModal
      v-if="creating || editing"
      :recipe="editing"
      @saved="
        (recipe) => {
          if (creating) search = recipe.title;
        }
      "
      @close="
        creating = false;
        editing = null;
      "
    /><EntryModal
      v-if="meal"
      type="meal"
      :recipe-id="meal.id"
      @close="meal = null"
    />
    <EntryPanel v-if="detail" :title="detail.title" @close="detail = null"
      ><div class="detail-section">
        <h3>Zutaten & Hinweise</h3>
        <div class="food-detail" v-for="(i, n) in detail.ingredients" :key="n">
          <strong>{{ i.text }}</strong>
          <div class="tags">
            <span
              v-for="id in i.food_ids"
              :key="id"
              class="pill"
              :class="
                foods.find((f) => f.id === id)?.level === 'higher'
                  ? 'high'
                  : 'neutral'
              "
              >{{ foodName(id, foods) }} ·
              {{
                foods.find((f) => f.id === id)?.level === "higher"
                  ? "eher FODMAP-reich"
                  : foods.find((f) => f.id === id)?.level === "lower"
                    ? "eher FODMAP-arm"
                    : "nicht bewertet"
              }}</span
            ><span v-if="!i.food_ids.length" class="pill neutral"
              >FODMAP-Gehalt unbekannt</span
            ><span v-for="a in i.allergens" class="pill allergen" :key="a">{{
              allergenLabels[a]
            }}</span>
          </div>
        </div>
        <p class="helper">
          Eine Referenz, keine Bewertung deiner gegessenen Portion. Nicht
          markierte Allergene sind nicht ausgeschlossen.
        </p>
        <div v-if="flagsFor(detail).length" class="existing-flag-list">
          <strong>Deine Markierungen</strong>
          <div
            v-for="flag in flagsFor(detail)"
            :key="flag.id"
            class="existing-flag"
          >
            <span>{{
              flag.kind === "reaction"
                ? "Als Reaktion markiert"
                : "Als verdächtig markiert"
            }}</span>
            <UiButton class="text-button" @click="removeFlag(flag)"
              >Entfernen</UiButton
            >
          </div>
        </div>
        <div class="recipe-flag-actions detail-flag-actions">
          <UiButton class="text-button" @click="openFlag(detail, 'suspected')"
            ><Flag :size="14" />Verdacht ergänzen</UiButton
          >
          <UiButton class="text-button" @click="openFlag(detail, 'reaction')"
            ><Sparkles :size="14" />Reaktion ergänzen</UiButton
          >
        </div>
      </div>
      <div class="detail-section">
        <h3>
          <Sparkles :size="18" /> Passt dieses Rezept zu meinen Beobachtungen?
        </h3>
        <UiSkeleton
          v-if="analysisBusy"
          label="Dein Tagebuch wird verglichen …"
        />
        <p v-if="analysisError" role="alert" class="alert error">
          {{ analysisError }}
        </p>
        <template v-if="analysis"
          ><p v-if="!analysis.associations.length" class="helper">
            Für diese Zutaten gibt es noch keine vergleichbaren Beobachtungen.
            Regelmässige Mahlzeiten und Check-ins helfen.
          </p>
          <div
            v-for="a in analysis.associations"
            :key="a.ingredient_id"
            class="pattern-mini"
          >
            <strong>{{ foodName(a.ingredient_id, foods) }}</strong>
            <p v-if="a.difference !== null && a.difference > 0">
              Nach Mahlzeiten mit dieser Zutat hast du häufiger Beschwerden
              dokumentiert: {{ Math.round(a.rate_exposed * 100) }} % gegenüber
              {{ Math.round(a.rate_unexposed * 100) }} % ohne diese Zutat.
            </p>
            <p v-else-if="a.difference !== null">
              Bisher kein erhöhtes Auftreten von Beschwerden in deinem Tagebuch.
              Das beweist keine Verträglichkeit.
            </p>
            <p v-else>Noch zu wenig Vergleichsdaten für eine Einschätzung.</p>
            <small
              >{{ a.exposed }} beobachtete Momente mit · {{ a.unexposed }} ohne
              diese Zutat</small
            >
            <p v-if="a.co_occurring.length" class="helper">
              Gemeinsam dokumentiert mit
              {{ a.co_occurring.map((id) => foodName(id, foods)).join(", ") }}.
              Einzelne Auslöser lassen sich nicht trennen.
            </p>
          </div></template
        >
      </div>
      <div v-if="detail.instructions" class="detail-section">
        <h3>Zubereitung</h3>
        <p class="preserve-lines">{{ detail.instructions }}</p>
      </div>
      <p class="notice">
        Mögliche Zusammenhänge, keine Diagnose. FODMAPs und Allergien sind
        unterschiedliche Themen.
      </p>
    </EntryPanel>
    <RecipeFlagModal
      v-if="flagging"
      :recipe="flagging"
      :kind="flagKind"
      :meals="diary.meals"
      @close="flagging = null"
    />
    <EntryPanel v-if="pending" title="Rezept löschen?" @close="pending = null"
      ><p>
        Das Rezept wird entfernt. Bereits gespeicherte Mahlzeiten behalten ihre
        ursprünglichen Zutaten.
      </p>
      <p v-if="error" class="alert error">{{ error }}</p>
      <div class="form-actions">
        <UiButton class="button secondary" @click="pending = null">
          Behalten</UiButton
        ><UiButton
          class="button danger"
          :disabled="busy"
          @click="
            save(
              '/recipes/' + pending.id,
              undefined,
              () => (pending = null),
              'DELETE',
            )
          "
        >
          Löschen
        </UiButton>
      </div></EntryPanel
    >
  </AppShell>
</template>
