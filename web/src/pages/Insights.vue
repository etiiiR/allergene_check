<script setup>
import { ref, computed, onMounted } from "vue";
import { Head, Link } from "@inertiajs/vue3";
import {
  Sparkles,
  ArrowUpRight,
  Activity,
  SlidersHorizontal,
  CircleAlert,
  CalendarDays,
  HeartPulse,
} from "@lucide/vue";
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
const healthSourceLabels = {
  apple_healthkit: "Apple Health / HealthKit",
  android_health_connect: "Android Health Connect",
  oura: "Oura / Ring",
  ring: "Ring",
  watch: "Watch",
  generic: "Andere Quelle",
};
const healthMetricLabels = {
  stress_score: "Stress-Score",
  hrv: "HRV",
  heart_rate: "Herzfrequenz",
  resting_heart_rate: "Ruhepuls",
  sleep_score: "Schlaf-Score",
  readiness_score: "Readiness-Score",
};
const healthSourceLabel = (source) => healthSourceLabels[source] || source;
const healthMetricLabel = (metric) => healthMetricLabels[metric] || metric;
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
const showAll = ref(false);
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
      <div class="report-heading-actions">
        <Link href="/report" class="button secondary report-link">
          Arztbericht
        </Link>
      </div>
    </div>
    <div class="toolbar">
      <label
        >Symptom<select
          class="d-select"
          v-model="symptom"
          @change="load"
          :disabled="loading"
        >
          <option value="any">Alle Beschwerden</option>
          <option v-for="(n, k) in symptoms" :key="k" :value="k">
            {{ n }}
          </option>
        </select></label
      ><label
        >Allgemeines Fenster<select
          class="d-select"
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
        >Vergleichen<select class="d-select" v-model="kind">
          <option value="all">Alles</option>
          <option value="ingredients">Zutaten & Gewürze</option>
          <option value="allergens">Allergene</option>
        </select></label
      ><label
        >Sortieren<select class="d-select" v-model="sort">
          <option value="difference">Grösster Unterschied</option>
          <option value="count">Meiste Beobachtungen</option>
        </select></label
      >
    </div>
    <p v-if="error" role="alert" class="alert error">
      {{ error }} <UiButton @click="load">Erneut versuchen</UiButton>
    </p>
    <UiSkeleton
      v-if="loading"
      label="Deine Beobachtungen werden verglichen …"
    />
    <template v-if="result && !loading"
      ><div class="stats-grid">
        <article class="stat">
          <div>
            <p>Auswertbare Momente</p>
            <strong>{{ result.observations }}</strong
            ><small>Jeder dokumentierte Check-in zählt</small>
          </div>
        </article>
        <article class="stat">
          <div>
            <p>Als Beschwerden gezählt</p>
            <strong>{{
              result.symptomatic_moments ?? result.symptomatic_days
            }}</strong
            ><small>Ab „Sehr leicht“ (ab 1 Stern)</small>
          </div>
        </article>
        <article class="stat">
          <div>
            <p>Vergleichsmomente</p>
            <strong>{{
              result.comparison_moments ?? result.comparison_days
            }}</strong
            ><small>Unter der Auswertungsschwelle</small>
          </div>
        </article>
      </div>
      <div class="notice">
        <strong>{{
          result.model_status === "insufficient_data"
            ? "Für den Mehrfaktorenvergleich fehlen noch Einträge."
            : "Vergleich mit mehreren Faktoren verfügbar."
        }}</strong>
        <p>
          {{
            result.model_status === "insufficient_data"
              ? "Dafür braucht es mindestens 20 passende Check-ins: mindestens fünf mit und fünf ohne ausgewertete Beschwerden sowie Zutaten, die sich vergleichen lassen. Bis dahin zeigen wir einfache Beobachtungen."
              : "Zutaten stehen im Vordergrund. Stress und Schlaf fliessen nur ein, wenn genug ausdrücklich erfasste Werte vorliegen; leere Felder gelten nicht als Messung. Die Muster beweisen keine Ursache, Allergie oder Unverträglichkeit."
          }}
        </p>
        <small class="helper">
          „Unter der Auswertungsschwelle“ bedeutet nicht automatisch
          symptomfrei.
        </small>
      </div>
      <div v-if="!rows.length" class="panel empty-state">
        <Activity :size="34" />
        <h2>Jeder Eintrag macht das Bild klarer.</h2>
        <p>
          Dokumentiere Mahlzeiten und einzelne Befindens-Momente.<br />Auch
          symptomfreie Zeitpunkte liefern wertvolle Vergleichsdaten.
        </p>
      </div>
      <div
        v-for="a in showAll ? rows : rows.slice(0, 3)"
        :key="a.ingredient_id"
        class="panel pattern-card"
      >
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
                >{{ a.symptomatic_exposed }} / {{ a.exposed }} Momente</small
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
                >{{ a.symptomatic_unexposed }} /
                {{ a.unexposed }} Momente</small
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
      <UiButton
        v-if="rows.length > 3"
        class="button secondary"
        @click="showAll = !showAll"
        >{{
          showAll
            ? "Weniger Muster anzeigen"
            : `Alle ${rows.length} Muster ansehen`
        }}</UiButton
      >
      <section
        v-if="result.non_food_assessment"
        class="panel non-food-card"
        :class="{
          possible:
            result.non_food_assessment.status === 'possible_other_driver',
        }"
      >
        <div class="section-heading">
          <div>
            <h2>{{ result.non_food_assessment.label }}</h2>
            <small>Hinweis aus deinen dokumentierten Momenten</small>
          </div>
          <CircleAlert :size="19" />
        </div>
        <p>{{ result.non_food_assessment.explanation }}</p>
        <div class="non-food-stats">
          <span>
            <strong>{{
              result.non_food_assessment.moments_with_food_window
            }}</strong>
            mit Essensfenster
          </span>
          <span>
            <strong>{{
              result.non_food_assessment.moments_without_food_window
            }}</strong>
            ohne passenden Bezug
          </span>
        </div>
        <p class="helper">
          Ohne passenden Bezug kann auch ein nicht protokolliertes Essen,
          Stress, Schlaf, Medikamente oder ein anderes gesundheitliches Thema
          dahinterliegen. Das ist kein Ausschluss und keine Diagnose.
        </p>
      </section>
      <section
        v-if="result.stress_assessment?.moments"
        class="panel stress-analysis-card"
        :class="{
          elevated:
            result.stress_assessment.status ===
            'more_symptoms_at_higher_stress',
        }"
      >
        <div class="section-heading">
          <div>
            <h2>Stress im Beschwerdemuster</h2>
            <small
              >Manuelle und importierte Werte pro Check-in
              zusammengeführt</small
            >
          </div>
          <HeartPulse :size="19" class="muted" />
        </div>
        <div class="stress-assessment-copy">
          <strong>{{ result.stress_assessment.label }}</strong>
          <p>{{ result.stress_assessment.explanation }}</p>
        </div>
        <div class="stress-comparison-grid">
          <div>
            <span>Stress ab 6/10</span>
            <strong
              >{{ result.stress_assessment.high_stress_symptomatic }} /
              {{ result.stress_assessment.high_stress_moments }}</strong
            >
            <small>{{
              result.stress_assessment.high_stress_rate === null
                ? "Noch offen"
                : Math.round(result.stress_assessment.high_stress_rate * 100) +
                  "% mit Beschwerden"
            }}</small>
          </div>
          <div>
            <span>Stress unter 6/10</span>
            <strong
              >{{ result.stress_assessment.lower_stress_symptomatic }} /
              {{ result.stress_assessment.lower_stress_moments }}</strong
            >
            <small>{{
              result.stress_assessment.lower_stress_rate === null
                ? "Noch offen"
                : Math.round(result.stress_assessment.lower_stress_rate * 100) +
                  "% mit Beschwerden"
            }}</small>
          </div>
          <div>
            <span>Durchschnitt</span>
            <strong>{{ result.stress_assessment.average_stress }}/10</strong>
            <small>{{ result.stress_assessment.moments }} Stress-Momente</small>
          </div>
        </div>
        <p class="helper">
          Das vergleicht nur deine dokumentierten Situationen. Stress kann mit
          Schlaf, Alltag, Medikamenten und anderen Faktoren zusammenhängen und
          beweist keine Ursache für Beschwerden.
        </p>
      </section>
      <details class="insight-details">
        <summary>
          Weitere Zusammenhänge<small
            >Zeitfenster, Zyklus, Stuhl und Health-Daten</small
          >
        </summary>
        <section v-if="result.timing_summary" class="panel timing-overview">
          <div class="section-heading">
            <div>
              <h2>Digestive Timeline</h2>
              <small>Wann beginnen deine Beschwerden typischerweise?</small>
            </div>
            <Sparkles :size="18" class="muted" />
          </div>
          <div class="digestive-map" aria-label="Grobe Verdauungsabschnitte">
            <span>Magen</span><span>Dünndarm</span><span>Dickdarm</span>
          </div>
          <div class="digestive-track" aria-label="Beschwerde-Zeitfenster">
            <div
              v-for="item in result.timing_summary.filter(
                (x) => x.bucket !== 'unknown',
              )"
              :key="item.bucket"
              class="digestive-step"
            >
              <span
                class="digestive-dot"
                :class="'timing-' + item.bucket"
              ></span>
              <strong>{{ item.range }}</strong>
              <small
                >{{ item.count }}
                {{ item.count === 1 ? "Moment" : "Momente" }}</small
              >
              <span>{{ item.phase }}</span>
            </div>
          </div>
          <p class="helper">
            Die Abschnitte oben sind nur eine grobe Orientierung. Ein
            Zeitfenster beweist nicht, dass Beschwerden sicher aus einem
            bestimmten Verdauungsabschnitt stammen.
          </p>
        </section>

        <section
          v-if="result.cycle_summary?.some((item) => item.moments > 0)"
          class="panel cycle-overview"
        >
          <div class="section-heading">
            <div>
              <h2>Zyklus-Kontext</h2>
              <small>Separat vom allgemeinen Essensmuster betrachtet</small>
            </div>
            <CalendarDays :size="19" class="muted" />
          </div>
          <div class="cycle-summary-grid">
            <div
              v-for="item in result.cycle_summary.filter((x) => x.moments > 0)"
              :key="item.phase"
              class="cycle-summary-item"
            >
              <strong>{{ item.label }}</strong>
              <span
                >{{ item.symptomatic_moments }} / {{ item.moments }} mit
                Beschwerden</span
              >
              <div class="cycle-bar">
                <i :style="{ width: (item.rate || 0) * 100 + '%' }" />
              </div>
            </div>
          </div>
          <p class="helper">
            Die Phasen sind grob aus den hinterlegten Angaben abgeleitet und
            werden nicht mit einem männlichen oder anderen Kontext
            zusammengelegt.
          </p>
        </section>
        <section
          v-if="result.possible_ingredients?.length"
          class="panel candidate-overview"
        >
          <div class="section-heading">
            <div>
              <h2>Zutaten zum Weiterbeobachten</h2>
              <small
                >Deine Markierungen, Stuhlbeobachtungen und Essensmuster</small
              >
            </div>
            <Sparkles :size="19" class="muted" />
          </div>
          <div class="candidate-list">
            <div
              v-for="item in result.possible_ingredients"
              :key="item.ingredient_id"
              class="candidate-item"
            >
              <div>
                <strong>{{ foodName(item.ingredient_id, foods) }}</strong>
                <small>{{ item.reasons.join(" · ") }}</small>
              </div>
            </div>
          </div>
          <p class="helper">
            Das sind persönliche Hinweise und zeitliche Überschneidungen, kein
            Unverträglichkeitstest. Mehrere Zutaten oder andere Faktoren können
            gleichzeitig eine Rolle spielen.
          </p>
        </section>
        <section
          v-if="result.stool_summary?.some((item) => item.count > 0)"
          class="panel stool-overview"
        >
          <div class="section-heading">
            <div>
              <h2>Stuhlbeobachtungen</h2>
              <small>Am Folgetag deiner dokumentierten Mahlzeiten</small>
            </div>
          </div>
          <div class="stool-summary-row">
            <span
              v-for="item in result.stool_summary.filter((x) => x.count > 0)"
              :key="item.quality"
            >
              <strong>{{ item.count }}</strong
              >{{ item.label }}
            </span>
          </div>
          <p class="helper">
            Auffällige Beobachtungen werden nur als zusätzlicher persönlicher
            Hinweis in der Zutatenliste verwendet, nicht als Diagnose.
          </p>
        </section>
        <section
          v-if="result.stress_summary?.total"
          class="panel health-insights-card"
        >
          <div class="section-heading">
            <div>
              <h2>Stress & Health-Daten</h2>
              <small>Importierte Messungen rund um deine Check-ins</small>
            </div>
            <HeartPulse :size="19" class="muted" />
          </div>
          <div class="health-insights-stats">
            <span>
              <strong>{{ result.stress_summary.normalized_count }}</strong>
              normalisierte Scores
            </span>
            <span>
              <strong>{{ result.stress_summary.raw_metric_count }}</strong>
              Rohwerte separat
            </span>
            <span>
              <strong>{{
                result.stress_summary.last_normalized_score ?? "—"
              }}</strong>
              letzter Score / 10
            </span>
          </div>
          <div class="health-source-list">
            <span
              v-for="item in result.stress_summary.by_source"
              :key="item.source"
            >
              {{ healthSourceLabel(item.source) }} · {{ item.count }}
            </span>
          </div>
          <p class="helper">
            Verwendet wird nur ein vom Anbieter ausdrücklich gelieferter
            Stress-Score. HRV, Puls, Schlaf- und Readiness-Werte werden nicht
            automatisch in Stress umgerechnet; Bedeutung und Verfügbarkeit
            hängen von Watch, Ring und Anbieter ab.
          </p>
          <small
            v-if="result.stress_summary.by_metric?.length"
            class="health-metric-note"
          >
            Messarten:
            {{
              result.stress_summary.by_metric
                .map(
                  (item) => `${healthMetricLabel(item.metric)} (${item.count})`,
                )
                .join(" · ")
            }}
          </small>
        </section>
      </details>
      <details class="panel methodology">
        <summary>Wie entstehen diese Muster?</summary>
        <p>
          Jeder Check-in ist ein eigener Beobachtungsmoment — mehrere am selben
          Tag bleiben erhalten. Die davor gegessenen Mahlzeiten werden anhand
          des gewählten Zeitfensters und optional der zugeordneten Mahlzeit
          verglichen. Fehlende Einträge gelten niemals als symptomfrei.
          Die Symptomstärke wird mit der gewählten Sternestufe ausgewertet;
          „Sehr leicht“ und stärkere Stufen zählen als Beschwerden.
        </p>
        <p>
          Ein Vergleich braucht mindestens drei Momente mit und drei ohne die
          Zutat. Häufig gemeinsam gegessene Zutaten, Portionsgrössen,
          unvollständige Einträge, Medikamente und weitere Faktoren können das
          Bild verzerren. Das Zeitfenster ist eine Analyse-Einstellung und kein
          medizinisch bestätigtes Reaktionsfenster.
        </p>
        <p>
          Stress und Schlaf sind freiwillig. Nur eingetragene, bestätigte oder
          separat normalisierte Stresswerte werden berücksichtigt. Rohwerte
          wie HRV oder Puls werden nicht als Stress ausgegeben. Ältere,
          unbestätigte Angaben kannst du im Tagebuch prüfen; fehlende Angaben
          gelten nicht als Messwerte.
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
