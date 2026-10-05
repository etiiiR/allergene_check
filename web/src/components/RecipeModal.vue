<script setup>
import { ref, reactive } from "vue";
import { usePage } from "@inertiajs/vue3";
import { Globe, Sparkles, Plus, Trash2 } from "@lucide/vue";
import EntryPanel from "./EntryPanel.vue";
import { api, useMutation, allergenLabels } from "../lib";
const props = defineProps({ recipe: Object, inline: Boolean }),
  emit = defineEmits(["close", "saved"]);
const page = usePage(),
  { busy, error, save } = useMutation();
const form = reactive(
  props.recipe
    ? JSON.parse(JSON.stringify(props.recipe))
    : {
        title: "",
        servings: 2,
        instructions: "",
        ingredients: [],
        source_url: "",
      },
);
const raw = ref(""),
  analyzing = ref(false),
  importing = ref(false),
  sourceURL = ref(""),
  parseError = ref("");
function manual() {
  form.ingredients.push({ text: "", food_ids: [], allergens: [] });
}
// Keep original amounts for the recipe; canonical IDs are only for comparisons.
function recognizedIngredient(item) {
  return {
    text: item.line,
    food_ids: item.needs_review ? [] : item.matches.map((match) => match.id),
    allergens: [],
    needs_review: item.needs_review,
    normalized_name: item.normalized_name,
    suggestions: item.needs_review ? item.matches : [],
  };
}
async function analyze() {
  analyzing.value = true;
  parseError.value = "";
  const lines = raw.value
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  try {
    const data = await api("/ingredients/analyze", {
      method: "POST",
      body: JSON.stringify({ lines }),
    });
    form.ingredients.push(...data.ingredients.map(recognizedIngredient));
    raw.value = "";
  } catch (e) {
    parseError.value = e.message;
  } finally {
    analyzing.value = false;
  }
}
async function importRecipe() {
  importing.value = true;
  parseError.value = "";
  try {
    const data = await api("/recipes/import", {
      method: "POST",
      body: JSON.stringify({ url: sourceURL.value.trim() }),
    });
    form.title = data.title || form.title;
    form.instructions = data.instructions || form.instructions;
    if (
      Number.isInteger(data.servings) &&
      data.servings >= 1 &&
      data.servings <= 50
    )
      form.servings = data.servings;
    else form.servings = ""; // Never silently keep the default for piece/loaf yields.
    form.source_url = data.source_url || sourceURL.value.trim();
    form.ingredients = (data.ingredients || []).map((text) => ({
      text,
      food_ids: [],
      allergens: [],
    }));
    // A failed resolver must not discard the imported recipe preview.
    if (form.ingredients.length) {
      try {
        const recognized = await api("/ingredients/analyze", {
          method: "POST",
          body: JSON.stringify({
            lines: form.ingredients.map((item) => item.text),
          }),
        });
        form.ingredients = recognized.ingredients.map(recognizedIngredient);
      } catch {
        parseError.value =
          "Rezept geladen. Die Zutaten-Zuordnung ist gerade nicht verfügbar; bitte manuell prüfen.";
      }
    }
    sourceURL.value = "";
    parseError.value = [parseError.value, ...(data.warnings || [])]
      .filter(Boolean)
      .join(" ");
  } catch (e) {
    parseError.value = e.message;
  } finally {
    importing.value = false;
  }
}
function submit() {
  save(
    props.recipe ? "/recipes/" + props.recipe.id : "/recipes",
    form,
    (recipe) => {
      emit("saved", recipe);
      emit("close");
    },
    props.recipe ? "PUT" : "POST",
  );
}
</script>
<template>
  <component
    :is="inline ? 'section' : EntryPanel"
    tone="meal"
    :busy="busy"
    :title="recipe ? 'Rezept bearbeiten' : 'Ein neues Lieblingsrezept'"
    @close="emit('close')"
    ><h2 v-if="inline">Neues Rezept für diese Mahlzeit</h2>
    <form class="form recipe-form" data-tone="meal" @submit.prevent="submit">
      <div class="form-row">
        <label
          >Rezeptname<input
            class="d-input"
            v-model="form.title"
            required
            maxlength="160"
            placeholder="z. B. Ofengemüse mit Kräutern" /></label
        ><label class="short-field"
          >Portionen<input
            class="d-input"
            v-model.number="form.servings"
            required
            type="number"
            min="1"
            max="50"
        /></label>
      </div>
      <div class="recipe-source-import">
        <label
          >Rezept von URL übernehmen<input
            class="d-input"
            v-model="sourceURL"
            type="url"
            maxlength="2048"
            placeholder="https://beispiel.de/rezept"
        /></label>
        <UiButton
          type="button"
          class="button secondary"
          :loading="importing"
          :disabled="importing || !sourceURL.trim()"
          @click="importRecipe"
        >
          <Globe :size="16" />{{
            importing ? "Wird importiert …" : "Vorschau laden"
          }}
        </UiButton>
        <p class="helper">
          Wir lesen das HTML öffentlicher Rezeptseiten: strukturierte
          Rezeptdaten oder erkennbare Zutaten- und Zubereitungsblöcke. Bitte
          Zutaten und Allergene vor dem Speichern prüfen.
        </p>
      </div>
      <div class="recipe-import">
        <label
          >Zutaten aus deinem Rezept<textarea
            class="d-textarea"
            v-model="raw"
            rows="4"
            placeholder="Eine Zutat pro Zeile, z. B.&#10;2 Karotten&#10;1 Zwiebel&#10;1 TL Kreuzkümmel"
          /></label
        ><UiButton
          type="button"
          class="button secondary"
          :loading="analyzing"
          :disabled="analyzing || !raw.trim()"
          @click="analyze"
        >
          <Sparkles :size="16" />{{
            analyzing ? "Wird erkannt …" : "Zutaten erkennen"
          }}
        </UiButton>
        <p class="helper">
          Mengen werden getrennt: „1 Prise Salz“ wird als Salz verglichen.
          Unsichere Vorschläge bitte bestätigen. Allergene separat prüfen.
        </p>
        <p class="alert error" v-if="parseError" role="alert">
          {{ parseError }} Du kannst Zutaten auch manuell hinzufügen.
        </p>
      </div>
      <div
        v-for="(item, index) in form.ingredients"
        :key="index"
        class="ingredient-editor"
      >
        <div class="ingredient-top">
          <label
            >Zutat {{ index + 1
            }}<input
              class="d-input"
              v-model="item.text"
              @input="
                item.food_ids = [];
                item.normalized_name = '';
                item.suggestions = [];
                item.needs_review = true;
              "
              required
              maxlength="500" /></label
          ><UiButton
            type="button"
            class="icon-button"
            aria-label="Zutat entfernen"
            @click="form.ingredients.splice(index, 1)"
          >
            <Trash2 :size="17" />
          </UiButton>
        </div>
        <p v-if="item.normalized_name" class="helper">
          {{ item.needs_review ? "Bereinigter Name" : "Erkannt als" }}:
          <strong>{{ item.normalized_name }}</strong
          >. Originalangabe bleibt erhalten.
        </p>
        <div
          v-if="item.suggestions?.length && !item.food_ids.length"
          class="actions"
        >
          <span class="helper">Meintest du:</span>
          <UiButton
            v-for="suggestion in item.suggestions"
            :key="suggestion.id"
            type="button"
            class="button secondary"
            @click="
              item.food_ids = [suggestion.id];
              item.normalized_name = suggestion.name;
              item.needs_review = false;
            "
            >{{ suggestion.name }} übernehmen</UiButton
          >
        </div>
        <div class="form-row">
          <label
            >Lebensmittel-Zuordnung<select
              class="d-select"
              :value="item.food_ids[0] || ''"
              @change="
                item.food_ids = $event.target.value ? [$event.target.value] : []
              "
            >
              <option value="">Eigene Zutat / nicht zugeordnet</option>
              <option v-for="f in page.props.foods" :key="f.id" :value="f.id">
                {{ f.name }}
              </option>
            </select></label
          ><label
            >Enthaltene Allergene<select
              class="d-select"
              v-model="item.allergens"
              multiple
              size="3"
              aria-label="Allergene dieser Zutat"
            >
              <option v-for="a in page.props.allergens" :value="a" :key="a">
                {{ allergenLabels[a] }}
              </option>
            </select></label
          >
        </div>
        <p class="helper">
          Allergene anhand der Verpackung bestätigen. Mehrfachauswahl mit
          Cmd/Strg. Nicht aufgeführt bedeutet nicht allergenfrei.
        </p>
      </div>
      <UiButton type="button" class="text-button" @click="manual">
        <Plus :size="16" />Zutat manuell hinzufügen
      </UiButton>
      <label
        >Zubereitung <span class="optional">optional</span
        ><textarea
          class="d-textarea"
          v-model="form.instructions"
          rows="3"
          maxlength="15000"
        />
      </label>
      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <div class="form-actions">
        <UiButton type="button" class="button secondary" @click="emit('close')">
          Abbrechen</UiButton
        ><UiButton
          class="button primary"
          :loading="busy"
          :disabled="busy || !form.ingredients.length"
        >
          {{ busy ? "Wird gespeichert …" : "Rezept speichern" }}
        </UiButton>
      </div>
    </form></component
  >
</template>
