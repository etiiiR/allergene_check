<script setup>
import { ref, computed } from "vue";
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
} from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import RecipeModal from "../components/RecipeModal.vue";
import EntryModal from "../components/EntryModal.vue";
import RecipeFlagModal from "../components/RecipeFlagModal.vue";
import EntryPanel from "../components/EntryPanel.vue";
import { api, foodName, useMutation, allergenLabels } from "../lib";
const props = defineProps({ diary: Object, foods: Array });
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
const list = computed(() =>
  props.diary.recipes.filter((r) =>
    (r.title + " " + r.ingredients.map((i) => i.text).join(" "))
      .toLowerCase()
      .includes(search.value.toLowerCase()),
  ),
);
function level(r) {
  const known = r.ingredients
    .flatMap((i) => i.food_ids)
    .map((id) => props.foods.find((f) => f.id === id));
  return known.some((f) => f?.level === "higher")
    ? "FODMAP-Hinweise"
    : "Zutaten prüfen";
}
function flagsFor(recipe) {
  return (props.diary.recipe_flags || []).filter(
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
    const ids = new Set(
      recipe.ingredients.flatMap((i) => [
        ...i.food_ids,
        ...i.allergens.map((a) => "allergen:" + a),
        ...(!i.food_ids.length
          ? ["custom:" + i.text.trim().toLowerCase().replace(/\s+/g, " ")]
          : []),
      ]),
    );
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
      <UiButton class="button primary tap-target" @click="creating = true">
        <Plus :size="18" />Rezept hinzufügen
      </UiButton>
    </div>
    <div class="search-box">
      <Search :size="18" /><input
        class="d-input"
        aria-label="Rezepte suchen"
        v-model="search"
        placeholder="Nach Rezept oder Zutat suchen …"
      /><span>{{ list.length }} Rezepte</span>
    </div>
    <div v-if="!list.length" class="panel empty-state">
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
    <div class="recipe-grid">
      <article class="panel recipe-card" v-for="(r, index) in list" :key="r.id">
        <div class="recipe-art" :class="'art-' + (index % 3)">
          <CookingPot :size="52" :stroke-width="1" /><span class="pill light"
            >{{ r.servings }} Portionen</span
          >
        </div>
        <div class="recipe-body">
          <span class="eyebrow">{{ r.ingredients.length }} ZUTATEN</span>
          <h2>{{ r.title }}</h2>
          <p class="recipe-excerpt">
            {{ r.ingredients.map((i) => i.text).join(" · ") }}
          </p>
          <span class="pill neutral">{{ level(r) }}</span>
          <span v-if="flagsFor(r).length" class="pill high recipe-flag-pill">
            <Flag :size="12" />{{ flagsFor(r).length }} persönliche Markierung{{
              flagsFor(r).length === 1 ? "" : "en"
            }}
          </span>
          <div class="recipe-actions">
            <UiButton class="text-button" @click="inspect(r)">
              Verträglichkeit ansehen <ArrowRight :size="14" />
            </UiButton>
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
          <UiButton class="button secondary full" @click="meal = r">
            <Plus :size="16" />Ins Tagebuch eintragen
          </UiButton>
        </div>
      </article>
    </div>
    <RecipeModal
      v-if="creating || editing"
      :recipe="editing"
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
      :meals="props.diary.meals"
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
