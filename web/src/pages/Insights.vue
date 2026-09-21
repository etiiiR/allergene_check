<script setup>
import { ref, computed, onMounted } from "vue";
import { Head } from "@inertiajs/vue3";
import {
  Sparkles,
  ArrowUpRight,
  Activity,
  SlidersHorizontal,
} from "lucide-vue-next";
import AppShell from "../components/AppShell.vue";
import { api, foodName } from "../lib";
const props = defineProps({ foods: Array, symptoms: Object });
const result = ref(null),
  error = ref(""),
  loading = ref(false),
  symptom = ref("any"),
  hours = ref(8),
  kind = ref("all"),
  sort = ref("difference");
async function load() {
  loading.value = true;
  error.value = "";
  try {
    result.value = await api(
      "/patterns?symptom=" + symptom.value + "&hours=" + hours.value,
    );
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
const rows = computed(() =>
  [...(result.value?.associations || [])]
    .filter(
      (a) =>
        kind.value === "all" ||
        (kind.value === "allergens") ===
          a.ingredient_id.startsWith("allergen:"),
    )
    .sort((a, b) =>
      sort.value === "count"
        ? b.exposed - a.exposed
        : (b.difference ?? -2) - (a.difference ?? -2),
    ),
);
</script>
<template>
  <Head title="Meine Muster" /><AppShell
    ><div class="page-heading">
      <div>
        <p class="eyebrow">BEOBACHTUNGEN VERBINDEN</p>
        <h1>Was tut mir gut?</h1>
        <p>
          Entdecke mögliche Zusammenhänge zwischen deinem Essen und deinem
          Befinden.
        </p>
      </div>
      <span class="pill low"
        ><Sparkles :size="14" />Deine persönlichen Muster</span
      >
    </div>
    <div class="toolbar">
      <label
        >Symptom<select v-model="symptom" @change="load" :disabled="loading">
          <option value="any">Alle Beschwerden</option>
          <option v-for="(n, k) in symptoms" :key="k" :value="k">
            {{ n }}
          </option>
        </select></label
      ><label
        >Nach einer Mahlzeit<select
          v-model.number="hours"
          @change="load"
          :disabled="loading"
        >
          <option :value="4">Bis zu 4 Stunden</option>
          <option :value="8">Bis zu 8 Stunden</option>
          <option :value="12">Bis zu 12 Stunden</option>
          <option :value="24">Bis zu 24 Stunden</option>
        </select></label
      ><label
        >Vergleichen<select v-model="kind">
          <option value="all">Alles</option>
          <option value="ingredients">Zutaten & Gewürze</option>
          <option value="allergens">Allergene</option>
        </select></label
      ><label
        >Sortieren<select v-model="sort">
          <option value="difference">Grösster Unterschied</option>
          <option value="count">Meiste Beobachtungen</option>
        </select></label
      >
    </div>
    <p v-if="error" role="alert" class="alert error">
      {{ error }} <button @click="load">Erneut versuchen</button>
    </p>
    <p v-if="loading" role="status" class="loading">
      Deine Beobachtungen werden verglichen …
    </p>
    <template v-if="result && !loading"
      ><div class="stats-grid">
        <article class="stat">
          <div>
            <p>Auswertbare Tage</p>
            <strong>{{ result.observations }}</strong
            ><small>Ein Check-in pro lokalem Kalendertag</small>
          </div>
        </article>
        <article class="stat">
          <div>
            <p>Mit ausgewählten Beschwerden</p>
            <strong>{{ result.symptomatic_days }}</strong
            ><small>Mindestens 3 von 10</small>
          </div>
        </article>
        <article class="stat">
          <div>
            <p>Vergleichstage</p>
            <strong>{{ result.comparison_days }}</strong
            ><small>Unter 3 von 10 dokumentiert</small>
          </div>
        </article>
      </div>
      <div class="notice">
        <strong>{{
          result.model_status === "insufficient_data"
            ? "Deine Datenbasis wächst."
            : "Exploratives ML-Modell aktiv."
        }}</strong>
        <p>
          {{
            result.model_status === "insufficient_data"
              ? "Für die logistische Regression brauchen wir mindestens 20 auswertbare Tage, davon je 5 mit und ohne relevante Beschwerden sowie vergleichbare Zutaten. Vorher zeigen wir nur Beobachtungen."
              : "Das Modell berücksichtigt mehrere Zutaten sowie protokollierten Stress und Schlaf. Seine Gewichte sind nicht klinisch validiert und keine Risikowahrscheinlichkeiten."
          }}
        </p>
      </div>
      <div v-if="!rows.length" class="panel empty-state">
        <Activity :size="34" />
        <h2>Jeder Eintrag macht das Bild klarer.</h2>
        <p>
          Dokumentiere Mahlzeiten und anschliessende Check-ins.<br />Auch
          symptomfreie Einträge liefern wertvolle Vergleichsdaten.
        </p>
      </div>
      <div v-for="a in rows" :key="a.ingredient_id" class="panel pattern-card">
        <div class="section-heading">
          <div>
            <span class="eyebrow">{{
              a.ingredient_id.startsWith("allergen:")
                ? "ALLERGEN-HINWEIS"
                : "ZUTAT / GEWÜRZ"
            }}</span>
            <h2>{{ foodName(a.ingredient_id, foods) }}</h2>
          </div>
          <span class="pill" :class="a.difference > 0 ? 'high' : 'neutral'">{{
            a.difference === null
              ? "Noch wenig Daten"
              : a.difference > 0
                ? "Häufiger Beschwerden"
                : "Kein erhöhter Zusammenhang"
          }}</span>
        </div>
        <div class="comparison-bars">
          <div>
            <span
              >Mit dieser Zutat
              <small
                >{{ a.symptomatic_exposed }} / {{ a.exposed }} Tage</small
              ></span
            >
            <div class="compare-track">
              <i :style="{ width: a.rate_exposed * 100 + '%' }" />
            </div>
            <b>{{ Math.round(a.rate_exposed * 100) }} %</b>
          </div>
          <div>
            <span
              >Ohne diese Zutat
              <small
                >{{ a.symptomatic_unexposed }} / {{ a.unexposed }} Tage</small
              ></span
            >
            <div class="compare-track baseline">
              <i :style="{ width: (a.rate_unexposed || 0) * 100 + '%' }" />
            </div>
            <b>{{
              a.rate_unexposed === null
                ? "–"
                : Math.round(a.rate_unexposed * 100) + " %"
            }}</b>
          </div>
        </div>
        <p v-if="a.co_occurring.length" class="helper">
          Gemeinsames Auftreten:
          {{ a.co_occurring.map((id) => foodName(id, foods)).join(", ") }}.
          Diese Einflüsse können nicht getrennt werden.
        </p>
        <p v-if="a.coefficient !== null" class="helper">
          Exploratives Modellgewicht: {{ a.coefficient }} · keine
          Wahrscheinlichkeit
        </p>
      </div>
      <details class="panel methodology">
        <summary>Wie entstehen diese Muster?</summary>
        <p>
          Wir verwenden den Check-in mit den stärksten ausgewählten Beschwerden
          pro lokalem Kalendertag (bei Gleichstand den letzten) und die davor
          gegessenen Mahlzeiten im gewählten Zeitfenster. Fehlende Einträge
          gelten niemals als symptomfrei. Beschwerden ab Stärke 3/10 zählen als
          beobachtetes Ereignis.
        </p>
        <p>
          Ein Vergleich braucht mindestens drei Tage mit und drei ohne die
          Zutat. Häufig gemeinsam gegessene Zutaten, Portionsgrössen,
          unvollständige Einträge, Medikamente und weitere Faktoren können das
          Bild verzerren. Das Zeitfenster ist eine Analyse-Einstellung und kein
          medizinisch bestätigtes Reaktionsfenster.
        </p>
        <p>
          Ein fehlender Zusammenhang beweist keine Verträglichkeit. Besprich
          wiederkehrende Beschwerden mit einer medizinischen Fachperson; starte
          eine restriktive Ernährung nicht allein aufgrund dieser Auswertung.
        </p>
      </details></template
    >
  </AppShell>
</template>
