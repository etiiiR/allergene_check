<script setup>
import { ref, reactive } from "vue";
import { usePage } from "@inertiajs/vue3";
import { Sparkles, Plus, Trash2 } from "lucide-vue-next";
import Modal from "./Modal.vue";
import { api, useMutation, allergenLabels } from "../lib";
const props = defineProps({ recipe: Object }),
  emit = defineEmits(["close"]);
const page = usePage(),
  { busy, error, save } = useMutation();
const form = reactive(
  props.recipe
    ? JSON.parse(JSON.stringify(props.recipe))
    : { title: "", servings: 2, instructions: "", ingredients: [] },
);
const raw = ref(""),
  analyzing = ref(false),
  parseError = ref("");
function manual() {
  form.ingredients.push({ text: "", food_ids: [], allergens: [] });
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
    form.ingredients.push(
      ...data.ingredients.map((x) => ({
        text: x.line,
        food_ids: x.needs_review ? [] : x.matches.map((m) => m.id),
        allergens: [],
        needs_review: x.needs_review,
      })),
    );
    raw.value = "";
  } catch (e) {
    parseError.value = e.message;
  } finally {
    analyzing.value = false;
  }
}
function submit() {
  save(
    props.recipe ? "/recipes/" + props.recipe.id : "/recipes",
    form,
    () => emit("close"),
    props.recipe ? "PUT" : "POST",
  );
}
</script>
<template>
  <Modal
    :title="recipe ? 'Rezept bearbeiten' : 'Ein neues Lieblingsrezept'"
    @close="emit('close')"
    ><form class="form recipe-form" @submit.prevent="submit">
      <div class="form-row">
        <label
          >Rezeptname<input
            v-model="form.title"
            required
            maxlength="160"
            placeholder="z. B. Ofengemüse mit Kräutern" /></label
        ><label class="short-field"
          >Portionen<input
            v-model.number="form.servings"
            required
            type="number"
            min="1"
            max="50"
        /></label>
      </div>
      <div class="recipe-import">
        <label
          >Zutaten aus deinem Rezept<textarea
            v-model="raw"
            rows="4"
            placeholder="Eine Zutat pro Zeile, z. B.&#10;2 Karotten&#10;1 Zwiebel&#10;1 TL Kreuzkümmel"
          /></label
        ><button
          type="button"
          class="button secondary"
          :disabled="analyzing || !raw.trim()"
          @click="analyze"
        >
          <Sparkles :size="16" />{{
            analyzing ? "Wird erkannt …" : "Zutaten erkennen"
          }}
        </button>
        <p class="helper">
          Textanalyse schlägt Zuordnungen vor. Prüfe Lebensmittel und Allergene
          vor dem Speichern.
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
            }}<input v-model="item.text" required maxlength="500" /></label
          ><button
            type="button"
            class="icon-button"
            aria-label="Zutat entfernen"
            @click="form.ingredients.splice(index, 1)"
          >
            <Trash2 :size="17" />
          </button>
        </div>
        <div class="form-row">
          <label
            >Lebensmittel-Zuordnung<select
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
      <button type="button" class="text-button" @click="manual">
        <Plus :size="16" />Zutat manuell hinzufügen
      </button>
      <label
        >Zubereitung <span class="optional">optional</span
        ><textarea v-model="form.instructions" rows="3" maxlength="15000" />
      </label>
      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <div class="form-actions">
        <button type="button" class="button secondary" @click="emit('close')">
          Abbrechen</button
        ><button
          class="button primary"
          :disabled="busy || !form.ingredients.length"
        >
          {{ busy ? "Wird gespeichert …" : "Rezept speichern" }}
        </button>
      </div>
    </form></Modal
  >
</template>
