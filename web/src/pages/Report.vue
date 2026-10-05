<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { Head } from "@inertiajs/vue3";
import {
  Activity,
  CalendarDays,
  CircleAlert,
  FileText,
  HeartPulse,
  Printer,
  Share2,
  ShieldCheck,
  Utensils,
} from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import { api, foodName } from "../lib";
import { notify } from "../ui/feedback";

const props = defineProps({ diary: Object, foods: Array, symptoms: Object });
const result = ref(null);
const loading = ref(false);
const error = ref("");
const shareStatus = ref("");
const reportLabel = ref(props.diary?.profile?.display_name || "");

const checkins = computed(() => props.diary?.checkins || []);
const meals = computed(() => props.diary?.meals || []);
const profile = computed(() => props.diary?.profile || {});

function dateValue(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function formatDate(value) {
  const date = dateValue(value);
  return date
    ? new Intl.DateTimeFormat("de-CH", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(date)
    : "–";
}

function formatPercent(value) {
  return value === null || value === undefined
    ? "Noch zu wenig Daten"
    : `${value >= 0 ? "+" : ""}${Math.round(value * 100)} %-Punkte`;
}

function differenceLabel(item) {
  if (item.difference === null || item.difference === undefined) {
    return "Noch zu wenig Vergleichsdaten";
  }
  return `${item.difference >= 0 ? "+" : ""}${Math.round(item.difference * 100)} %-Punkte`;
}

const periodLabel = computed(() => {
  const values = [
    ...meals.value.map((item) => item.occurred_at),
    ...checkins.value.map((item) => item.occurred_at),
    ...(props.diary?.stools || []).map((item) => item.observed_at),
    ...(props.diary?.stress_observations || []).map((item) => item.observed_at),
  ]
    .map(dateValue)
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (!values.length) return "Noch keine dokumentierten Daten";
  return `${formatDate(values[0].toISOString())} – ${formatDate(values.at(-1).toISOString())}`;
});

const symptomRows = computed(() =>
  Object.entries(props.symptoms || {})
    .map(([key, label]) => {
      const entries = checkins.value
        .map((item) => item.symptoms?.[key] || 0)
        .filter((value) => value > 0);
      return {
        key,
        label,
        moments: entries.length,
        maximum: Math.max(0, ...entries),
        average: entries.length
          ? entries.reduce((sum, value) => sum + value, 0) / entries.length
          : 0,
      };
    })
    .filter((item) => item.moments > 0)
    .sort((a, b) => b.moments - a.moments || b.average - a.average),
);

const associations = computed(() =>
  [...(result.value?.associations || [])]
    .filter((item) => item.exposed > 0)
    .sort((a, b) => (b.difference ?? -2) - (a.difference ?? -2))
    .slice(0, 6),
);

const overlapRows = computed(() =>
  associations.value.filter((item) => item.co_occurring?.length).slice(0, 4),
);

const timingRows = computed(() =>
  (result.value?.timing_summary || []).filter((item) => item.count > 0),
);

const stoolRows = computed(() =>
  (result.value?.stool_summary || []).filter((item) => item.count > 0),
);

const dataQualityLabel = computed(() =>
  result.value?.model_status === "exploratory"
    ? "Explorative Vergleichsdaten vorhanden"
    : "Datenbasis noch im Aufbau",
);

const profileLabel = computed(() => {
  const labels = {
    male: "Männlicher Körperkontext",
    female: "Weiblicher Körperkontext",
    other: "Anderer Körperkontext",
    unspecified: "Körperkontext nicht angegeben",
  };
  return labels[profile.value.body_group] || labels.unspecified;
});

async function load() {
  loading.value = true;
  error.value = "";
  try {
    result.value = await api("/patterns?symptom=any&hours=24");
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function buildShareText() {
  const stress = result.value?.stress_assessment;
  const lines = [
    "Bauchgefühl – persönliche Gesundheitsübersicht",
    reportLabel.value ? `Person/Initialen: ${reportLabel.value}` : "",
    `Zeitraum: ${periodLabel.value}`,
    `Datenbasis: ${meals.value.length} Mahlzeiten, ${checkins.value.length} Check-ins, ${props.diary?.stools?.length || 0} Stuhlbeobachtungen`,
    "",
    "Häufig dokumentierte Beschwerden:",
    ...symptomRows.value
      .slice(0, 5)
      .map(
        (item) =>
          `- ${item.label}: ${item.moments} Momente, maximal ${item.maximum}/10`,
      ),
    "",
    "Mögliche Zutatenmuster:",
    ...associations.value
      .slice(0, 5)
      .map(
        (item) =>
          `- ${foodName(item.ingredient_id, props.foods)}: ${differenceLabel(item)}, ${item.exposed} exponierte Momente`,
      ),
    stress
      ? `Stress: ${stress.label}; hoch ${stress.high_stress_rate === null ? "–" : Math.round(stress.high_stress_rate * 100) + "%"}, niedriger ${stress.lower_stress_rate === null ? "–" : Math.round(stress.lower_stress_rate * 100) + "%"}`
      : "Stress: keine auswertbaren Check-in-Werte",
    result.value?.non_food_assessment
      ? `Nicht-Essens-Hinweis: ${result.value.non_food_assessment.label}`
      : "",
    "",
    "Hinweis: Explorative persönliche Beobachtung, keine Diagnose und kein Beweis für Allergie oder Unverträglichkeit.",
  ];
  return lines.filter(Boolean).join("\n");
}

function printReport() {
  window.print();
}

async function copyReport() {
  const text = buildShareText();
  try {
    await navigator.clipboard.writeText(text);
    shareStatus.value = "Zusammenfassung in die Zwischenablage kopiert.";
    notify(shareStatus.value);
  } catch {
    shareStatus.value = "Kopieren ist in diesem Browser nicht verfügbar.";
  }
}

async function shareReport() {
  shareStatus.value = "";
  const text = buildShareText();
  if (navigator.share) {
    try {
      await navigator.share({
        title: "Bauchgefühl – Gesundheitsübersicht",
        text,
      });
      shareStatus.value = "Zusammenfassung geteilt.";
      notify(shareStatus.value);
      return;
    } catch (e) {
      if (e?.name === "AbortError") return;
    }
  }
  await copyReport();
}

onMounted(() => {
  try {
    // Honour an explicit local report alias (including a blank one for privacy).
    // A fresh browser starts with the persisted personal profile name.
    reportLabel.value =
      localStorage.getItem("bauchgefuehl-report-label") ??
      props.diary?.profile?.display_name ??
      "";
  } catch {
    // Private browsing may disable localStorage; the report still works.
  }
  load();
});
watch(reportLabel, (value) => {
  try {
    localStorage.setItem("bauchgefuehl-report-label", value);
  } catch {
    // The label is optional and never blocks report generation.
  }
});
</script>

<template>
  <Head title="Arztbericht" />
  <AppShell>
    <div class="report-page">
      <div class="report-actions no-print">
        <div>
          <p class="eyebrow"><FileText :size="14" /> GESUNDHEITSÜBERSICHT</p>
          <h1>Arztbericht vorbereiten</h1>
          <p>
            Eine kompakte Zusammenfassung für dein Gespräch mit einer
            Fachperson.
          </p>
        </div>
        <div class="report-action-buttons">
          <UiButton
            class="button secondary"
            :disabled="!result"
            @click="printReport"
          >
            <Printer :size="16" /> Drucken / PDF
          </UiButton>
          <UiButton
            class="button primary"
            :disabled="!result"
            @click="shareReport"
          >
            <Share2 :size="16" /> Teilen / senden
          </UiButton>
        </div>
      </div>

      <div class="report-label-field no-print">
        <label>
          Name oder Initialen
          <span class="optional"
            >aus deinem Profil; abweichende Angabe nur in diesem Browser</span
          >
          <input
            class="d-input"
            v-model="reportLabel"
            maxlength="80"
            placeholder="z. B. M. M."
          />
        </label>
        <UiButton class="text-button" :disabled="!result" @click="copyReport"
          >Text kopieren</UiButton
        >
      </div>
      <p v-if="shareStatus" class="alert success no-print" role="status">
        {{ shareStatus }}
      </p>
      <p v-if="error" class="alert error no-print" role="alert">
        {{ error }} <UiButton @click="load">Erneut versuchen</UiButton>
      </p>
      <UiSkeleton
        v-if="loading"
        label="Bericht wird vorbereitet …"
        class="no-print"
      />

      <article
        v-if="result && !loading"
        class="patient-report"
        id="patient-report"
      >
        <header class="report-document-header">
          <div>
            <p class="eyebrow">BAUCHGEFÜHL · PERSÖNLICHE DATENÜBERSICHT</p>
            <h2>Zusammenfassung für das Arztgespräch</h2>
            <p v-if="reportLabel" class="report-person">{{ reportLabel }}</p>
          </div>
          <div class="report-generated">
            <strong>{{ formatDate(new Date().toISOString()) }}</strong>
            <small>Erstellt am</small>
          </div>
        </header>

        <div class="report-meta-row">
          <span
            ><CalendarDays :size="14" /> Zeitraum:
            <strong>{{ periodLabel }}</strong></span
          >
          <span><Activity :size="14" /> {{ profileLabel }}</span>
          <span><ShieldCheck :size="14" /> {{ dataQualityLabel }}</span>
        </div>

        <section class="report-kpis">
          <div>
            <strong>{{ meals.length }}</strong
            ><span>Mahlzeiten</span>
          </div>
          <div>
            <strong>{{ checkins.length }}</strong
            ><span>Check-ins</span>
          </div>
          <div>
            <strong>{{ props.diary?.stools?.length || 0 }}</strong
            ><span>Stuhlbeobachtungen</span>
          </div>
          <div>
            <strong>{{ props.diary?.stress_observations?.length || 0 }}</strong
            ><span>Health-Messungen</span>
          </div>
        </section>

        <div class="report-grid">
          <section class="report-section">
            <h3>Dokumentierte Beschwerden</h3>
            <div v-if="symptomRows.length" class="report-list">
              <div v-for="item in symptomRows.slice(0, 6)" :key="item.key">
                <strong>{{ item.label }}</strong>
                <span
                  >{{ item.moments }} Momente · max. {{ item.maximum }}/10 · Ø
                  {{ item.average.toFixed(1) }}/10</span
                >
              </div>
            </div>
            <p v-else class="report-muted">
              Noch keine Beschwerden dokumentiert.
            </p>
          </section>

          <section class="report-section">
            <h3>Zutatenmuster</h3>
            <div v-if="associations.length" class="report-list">
              <div v-for="item in associations" :key="item.ingredient_id">
                <strong>{{ foodName(item.ingredient_id, foods) }}</strong>
                <span
                  >{{ differenceLabel(item) }} · {{ item.exposed }} exponiert /
                  {{ item.unexposed }} verglichen</span
                >
                <small v-if="item.co_occurring?.length"
                  >Überschneidet sich mit:
                  {{
                    item.co_occurring
                      .map((id) => foodName(id, foods))
                      .join(", ")
                  }}</small
                >
              </div>
            </div>
            <p v-else class="report-muted">
              Noch keine vergleichbaren Zutatenmuster.
            </p>
          </section>

          <section class="report-section">
            <h3>Überlappende Zutaten</h3>
            <div v-if="overlapRows.length" class="report-list compact">
              <div v-for="item in overlapRows" :key="item.ingredient_id">
                <strong>{{ foodName(item.ingredient_id, foods) }}</strong>
                <span
                  >Gemeinsam dokumentiert mit
                  {{
                    item.co_occurring
                      .map((id) => foodName(id, foods))
                      .join(", ")
                  }}</span
                >
              </div>
            </div>
            <p v-else class="report-muted">
              Keine klaren Überlappungen erkannt.
            </p>
            <p class="report-note">
              Gemeinsam gegessene Zutaten lassen sich statistisch oft nicht
              voneinander trennen.
            </p>
          </section>

          <section class="report-section">
            <h3>Stress und andere Faktoren</h3>
            <template v-if="result.stress_assessment?.moments">
              <strong>{{ result.stress_assessment.label }}</strong>
              <p>
                {{ result.stress_assessment.high_stress_symptomatic }}/{{
                  result.stress_assessment.high_stress_moments
                }}
                bei Stress ab 6/10 gegenüber
                {{ result.stress_assessment.lower_stress_symptomatic }}/{{
                  result.stress_assessment.lower_stress_moments
                }}
                unter 6/10.
              </p>
              <small
                >Durchschnitt: {{ result.stress_assessment.average_stress }}/10
                · {{ result.stress_assessment.moments }} Momente</small
              >
            </template>
            <p v-else class="report-muted">Keine auswertbaren Stresswerte.</p>
            <p v-if="result.non_food_assessment" class="report-note">
              <strong>{{ result.non_food_assessment.label }}.</strong>
              {{ result.non_food_assessment.explanation }}
            </p>
          </section>

          <section class="report-section">
            <h3>Beschwerde-Zeitfenster</h3>
            <div v-if="timingRows.length" class="report-list compact">
              <div v-for="item in timingRows" :key="item.bucket">
                <strong>{{ item.label }}</strong
                ><span>{{ item.count }} Momente · {{ item.range }}</span>
              </div>
            </div>
            <p v-else class="report-muted">Keine Zeitfenster dokumentiert.</p>
          </section>

          <section class="report-section">
            <h3>Stuhlbeobachtungen</h3>
            <div v-if="stoolRows.length" class="report-tags">
              <span v-for="item in stoolRows" :key="item.quality"
                >{{ item.count }}× {{ item.label }}</span
              >
            </div>
            <p v-else class="report-muted">
              Keine Stuhlbeobachtungen dokumentiert.
            </p>
          </section>
        </div>

        <section class="report-bottom-note">
          <CircleAlert :size="16" />
          <div>
            <strong>Einordnung für die Fachperson</strong>
            <p>
              Die Übersicht fasst persönliche Beobachtungen zusammen. Sie ist
              keine Diagnose, kein Allergietest und kein Beweis für eine
              Unverträglichkeit. Unprotokollierte Mahlzeiten, Schlaf, Stress,
              Medikamente und andere gesundheitliche Faktoren können die Muster
              beeinflussen. Gute Momentaufnahmen direkt beim Essen zählen in der
              Analyse nicht als spätere Verträglichkeitsbelege.
            </p>
          </div>
        </section>
        <footer class="report-footer">
          Bauchgefühl · Private lokale Zusammenfassung · Bitte gemeinsam mit
          einer medizinischen Fachperson besprechen
        </footer>
      </article>
    </div>
  </AppShell>
</template>
