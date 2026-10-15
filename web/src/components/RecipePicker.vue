<script setup>
import { computed, nextTick, ref, useId, watch } from "vue";
import { Check, Search, X } from "@lucide/vue";
import { findRecipes, recipeIndex } from "../recipe-search";

const props = defineProps({
  modelValue: String,
  recipes: { type: Array, default: () => [] },
  meals: { type: Array, default: () => [] },
  // Deleted recipes can still be represented by the meal's historical snapshot.
  fallback: Object,
});
const emit = defineEmits(["update:modelValue"]);
const id = useId(),
  input = ref(null),
  changeButton = ref(null);
const query = ref(""),
  sort = ref("recent"),
  choosing = ref(!props.modelValue);
const browseAll = ref(false),
  page = ref(1);
const index = computed(() => recipeIndex(props.recipes, props.meals));
const results = computed(() =>
  findRecipes(index.value, query.value, sort.value),
);
const pageSize = computed(() =>
  query.value.trim() || browseAll.value ? 6 : 3,
);
const pages = computed(() =>
  Math.max(1, Math.ceil(results.value.length / pageSize.value)),
);
const visible = computed(() =>
  results.value.slice(
    (page.value - 1) * pageSize.value,
    page.value * pageSize.value,
  ),
);
const selected = computed(
  () =>
    (props.fallback?.id === props.modelValue ? props.fallback : null) ||
    props.recipes.find((r) => r.id === props.modelValue),
);
const preview = (recipe) =>
  (recipe.ingredients || [])
    .slice(0, 3)
    .map((i) => i.text)
    .join(" · ");
watch([query, sort, browseAll], () => {
  page.value = 1;
});
watch(pages, (value) => {
  page.value = Math.min(page.value, value);
});
watch(
  () => props.modelValue,
  (value) => {
    choosing.value = !value;
  },
);

async function open() {
  choosing.value = true;
  query.value = "";
  browseAll.value = false;
  await nextTick();
  input.value?.focus();
}
async function choose(recipe) {
  emit("update:modelValue", recipe.id);
  choosing.value = false;
  await nextTick();
  changeButton.value?.focus({ preventScroll: true });
}
async function keepSelection() {
  choosing.value = false;
  await nextTick();
  changeButton.value?.focus();
}
async function clearSearch() {
  query.value = "";
  await nextTick();
  input.value?.focus();
}
function enter(event) {
  // Enter must not accidentally submit the enclosing meal form or pick an
  // ambiguous match. Tab + Enter always works with the native result buttons.
  if (!event.isComposing && results.value.length === 1)
    choose(results.value[0].recipe);
}
</script>

<template>
  <section
    class="recipe-picker"
    data-tone="meal"
    :aria-labelledby="id + '-title'"
  >
    <span :id="id + '-title'" class="picker-label">Rezept</span>
    <div v-if="selected" class="recipe-selected" aria-live="polite">
      <Check :size="18" aria-hidden="true" />
      <div>
        <strong>{{ selected.title }}</strong
        ><small>{{ preview(selected) }}</small>
      </div>
      <button
        v-if="!choosing"
        ref="changeButton"
        type="button"
        class="text-button"
        @click="open"
      >
        Rezept ändern
      </button>
      <button v-else type="button" class="text-button" @click="keepSelection">
        Auswahl beibehalten
      </button>
    </div>
    <div v-if="choosing || !selected" class="recipe-picker-search">
      <div class="search-box">
        <Search :size="18" aria-hidden="true" />
        <input
          ref="input"
          class="d-input"
          type="search"
          aria-label="Rezept suchen"
          v-model="query"
          placeholder="Name oder Zutat, z. B. Reis …"
          autocomplete="off"
          :aria-describedby="id + '-hint'"
          @keydown.enter.prevent="enter"
          @keydown.esc.prevent="selected ? keepSelection() : clearSearch()"
        />
        <button
          v-if="query"
          type="button"
          class="icon-button"
          aria-label="Rezeptsuche leeren"
          @click="clearSearch"
        >
          <X :size="17" />
        </button>
      </div>
      <div class="recipe-picker-tools">
        <p :id="id + '-hint'" role="status">
          {{
            query.trim()
              ? `${results.length} Treffer`
              : `${recipes.length} gespeicherte Rezepte`
          }}
        </p>
        <label v-if="recipes.length > 3 && !query.trim()"
          >Sortierung<select
            class="d-select"
            v-model="sort"
            aria-label="Rezeptvorschläge sortieren"
          >
            <option value="recent">Zuletzt verwendet</option>
            <option value="frequent">Häufig gegessen</option>
            <option value="name">Name A–Z</option>
          </select></label
        >
      </div>
      <p v-if="!recipes.length" class="helper">
        Noch kein Rezept gespeichert. Du kannst es direkt hier hinzufügen.
      </p>
      <div v-else-if="!results.length" class="recipe-search-empty">
        <strong>Kein passendes Rezept</strong>
        <p>Versuche einen kürzeren Namen oder eine einzelne Zutat.</p>
        <button type="button" class="text-button" @click="clearSearch">
          Suche zurücksetzen
        </button>
      </div>
      <div v-else class="recipe-picker-results">
        <button
          v-for="item in visible"
          :key="item.recipe.id"
          type="button"
          class="recipe-result"
          :data-recipe-id="item.recipe.id"
          :aria-label="item.recipe.title + ' auswählen'"
          :aria-describedby="id + item.recipe.id"
          :aria-pressed="item.recipe.id === modelValue"
          @click="choose(item.recipe)"
        >
          <span
            ><strong>{{ item.recipe.title }}</strong
            ><small :id="id + item.recipe.id">{{
              preview(item.recipe)
            }}</small></span
          >
          <small v-if="item.count" class="recipe-use-count"
            >{{ item.count }}× gegessen</small
          >
        </button>
      </div>
      <button
        v-if="!query.trim() && !browseAll && results.length > 3"
        type="button"
        class="text-button"
        @click="browseAll = true"
      >
        Alle {{ recipes.length }} Rezepte durchsuchen
      </button>
      <nav
        v-if="(query.trim() || browseAll) && pages > 1"
        class="recipe-pagination"
        aria-label="Rezeptvorschläge blättern"
      >
        <button
          type="button"
          class="button secondary"
          :disabled="page === 1"
          @click="page--"
        >
          Zurück
        </button>
        <span role="status">{{ page }} / {{ pages }}</span>
        <button
          type="button"
          class="button secondary"
          :disabled="page === pages"
          @click="page++"
        >
          Weiter
        </button>
      </nav>
    </div>
  </section>
</template>
