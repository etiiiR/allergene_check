<script setup>
import { entryTone } from "../ui/entry-tones";
import { computed, ref } from "vue";
import { Head, Link } from "@inertiajs/vue3";
import {
  Plus,
  Heart,
  HeartPulse,
  Utensils,
  Trash2,
  Pencil,
  BookOpen,
  ClipboardCheck,
} from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import EntryModal from "../components/EntryModal.vue";
import EntryPanel from "../components/EntryPanel.vue";
import DiaryEntryEditor from "../components/DiaryEntryEditor.vue";
import StoolModal from "../components/StoolModal.vue";
import StressModal from "../components/StressModal.vue";
import {
  dayOf,
  localDate,
  severity,
  symptomIntensityFromScore,
  symptomIntensityLabels,
  dateTime,
  timingLabel,
  timingPhase,
  cyclePhaseLabel,
  stoolQualityLabel,
  useMutation,
  api,
} from "../lib";
const props = defineProps({ diary: Object, symptoms: Object });
const entry = ref(""),
  date = ref(localDate()),
  filter = ref("all"),
  sort = ref("time"),
  pending = ref(null),
  editing = ref(null),
  { save, busy, error } = useMutation();
const analysisState = ref("");
let analysisRequest = 0;
async function refreshAnalysis() {
  const request = ++analysisRequest;
  analysisState.value = "loading";
  try {
    await api("/patterns?symptom=any&hours=8");
    if (request === analysisRequest) analysisState.value = "ready";
  } catch {
    // The diary write has already succeeded. An ML outage must not invite
    // saving twice or discard the successfully persisted edit.
    if (request === analysisRequest) analysisState.value = "error";
  }
}
function edited(saved) {
  if (date.value) date.value = dayOf(saved.observed_at || saved.occurred_at);
  editing.value = null;
  refreshAnalysis();
}
const events = computed(() => {
  const all = [
    ...props.diary.meals.map((x) => ({ ...x, kind: "meals" })),
    ...props.diary.checkins.map((x) => ({ ...x, kind: "checkins" })),
    ...(props.diary.stools || []).map((x) => ({
      ...x,
      kind: "stools",
      occurred_at: x.observed_at,
    })),
    ...(props.diary.stress_observations || []).map((x) => ({
      ...x,
      kind: "stress",
      occurred_at: x.observed_at,
    })),
  ];
  return all
    .filter(
      (x) =>
        (!date.value || dayOf(x.occurred_at) === date.value) &&
        (filter.value === "all" ||
          (filter.value === "meals" && x.kind === "meals") ||
          (filter.value === "stools" && x.kind === "stools") ||
          (filter.value === "stress" && x.kind === "stress") ||
          (filter.value === "free" &&
            x.kind === "checkins" &&
            x.symptom_free) ||
          (filter.value === "symptoms" &&
            x.kind === "checkins" &&
            !x.symptom_free) ||
          x.symptoms?.[filter.value] > 0),
    )
    .sort((a, b) =>
      sort.value === "severity"
        ? severity(b) - severity(a)
        : b.occurred_at.localeCompare(a.occurred_at),
    );
});
const groups = computed(() => {
  if (sort.value === "severity")
    return [{ label: "Nach Beschwerdestärke", items: events.value }];
  const days = new Map();
  for (const item of events.value) {
    const key = dayOf(item.occurred_at);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(item);
  }
  return [...days].map(([key, items]) => ({
    label: new Intl.DateTimeFormat("de-CH", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(key + "T12:00:00")),
    items,
  }));
});
</script>
<template>
  <Head title="Mein Tagebuch" /><AppShell
    ><div class="page-heading">
      <div>
        <p class="eyebrow">VERLAUF</p>
        <h1>Mein Tagebuch</h1>
        <p>Mahlzeiten und Beobachtungen, nach Zeitpunkt geordnet.</p>
      </div>
      <div class="actions">
        <UiButton
          class="button secondary"
          data-tone="symptom"
          @click="entry = 'check'"
        >
          <Heart :size="17" />Check-in</UiButton
        ><UiButton
          class="button primary"
          data-tone="meal"
          @click="entry = 'meal'"
        >
          <Plus :size="17" />Mahlzeit </UiButton
        ><UiButton
          class="button secondary"
          data-tone="stool"
          @click="entry = 'stool'"
        >
          <ClipboardCheck :size="17" />Stuhl </UiButton
        ><UiButton
          class="button secondary"
          data-tone="stress"
          @click="entry = 'stress'"
        >
          <HeartPulse :size="17" />Stress manuell
        </UiButton>
      </div>
    </div>
    <div
      v-if="analysisState"
      class="panel edit-analysis-status"
      role="status"
      aria-live="polite"
    >
      <p>
        {{
          analysisState === "loading"
            ? "Änderungen gespeichert. Auswertung wird neu berechnet …"
            : analysisState === "ready"
              ? "Änderungen gespeichert. Auswertung mit den aktuellen Daten neu berechnet."
              : "Änderungen gespeichert. Die Auswertung ist gerade nicht erreichbar. Deine Änderungen bleiben erhalten."
        }}
      </p>
      <UiButton
        v-if="analysisState === 'error'"
        class="text-button"
        @click="refreshAnalysis"
        >Auswertung erneut versuchen</UiButton
      >
      <Link
        v-else-if="analysisState === 'ready'"
        href="/insights"
        class="text-button"
        >Aktuelle Muster ansehen</Link
      >
    </div>
    <div class="toolbar">
      <label>Datum<input class="d-input" type="date" v-model="date" /></label
      ><UiButton class="text-button" @click="date = ''">Alle Tage</UiButton
      ><label
        >Anzeigen<select class="d-select" v-model="filter">
          <option value="all">Alle Einträge</option>
          <option value="meals">Mahlzeiten</option>
          <option value="stools">Stuhlbeobachtungen</option>
          <option value="stress">Stressmessungen</option>
          <option value="free">Symptomfrei</option>
          <option value="symptoms">Mit Beschwerden</option>
          <option v-for="(name, key) in symptoms" :value="key" :key="key">
            {{ name }}
          </option>
        </select></label
      ><label
        >Sortieren<select class="d-select" v-model="sort">
          <option value="time">Neueste zuerst</option>
          <option value="severity">Stärkste Symptome</option>
        </select></label
      ><span class="result-count">{{ events.length }} Einträge</span>
    </div>
    <section v-if="!events.length" class="panel empty-state">
      <BookOpen :size="32" />
      <h2>Noch ganz unbeschrieben.</h2>
      <p>
        Für diese Auswahl gibt es keine Einträge.<br />Eine Mahlzeit oder ein
        Check-in ist ein guter Anfang.
      </p>
      <UiButton class="button primary" @click="entry = 'check'">
        Befinden eintragen
      </UiButton>
    </section>
    <div class="diary-list">
      <section v-for="group in groups" :key="group.label" class="diary-group">
        <h2>{{ group.label }}</h2>
        <div class="diary-list">
          <article
            v-for="item in group.items"
            :key="item.kind + item.id"
            :data-entry-id="item.id"
            class="panel diary-entry"
            :data-tone="entryTone(item)"
          >
            <div class="entry-time">
              {{ dateTime(item.occurred_at)
              }}<span class="event-icon"
                ><Utensils
                  v-if="item.kind === 'meals'"
                  :size="19" /><ClipboardCheck
                  v-else-if="item.kind === 'stools'"
                  :size="19" /><HeartPulse
                  v-else-if="item.kind === 'stress'"
                  :size="19" /><Heart v-else :size="19"
              /></span>
            </div>
            <div class="entry-content">
              <div class="entry-title">
                <h2>
                  {{
                    item.kind === "meals"
                      ? item.title
                      : item.kind === "stools"
                        ? "Stuhlbeobachtung"
                        : item.kind === "stress"
                          ? item.source === "generic" &&
                            !item.external_id &&
                            item.metric === "stress_score"
                            ? "Stress manuell"
                            : "Health-Messung"
                          : item.symptom_free
                            ? item.meal_baseline
                              ? "Gut beim Essen"
                              : "Ein gutes Bauchgefühl"
                            : "So ging es meinem Bauch"
                  }}
                </h2>
                <span
                  class="pill"
                  :class="
                    item.kind === 'meals'
                      ? 'neutral'
                      : item.kind === 'stools'
                        ? 'neutral'
                        : item.kind === 'stress'
                          ? 'neutral'
                          : item.symptom_free
                            ? 'low'
                            : 'high'
                  "
                  >{{
                    item.kind === "meals"
                      ? "Mahlzeit"
                      : item.kind === "stools"
                        ? "Stuhl"
                        : item.kind === "stress"
                          ? "Stress"
                          : item.symptom_free
                            ? "Symptomfrei"
                            : "Beschwerden"
                  }}</span
                >
              </div>
              <template v-if="item.kind === 'meals'"
                ><p class="helper">{{ item.portions }} Portion(en)</p>
                <div class="tags">
                  <span
                    class="ingredient-tag"
                    v-for="(i, n) in item.ingredients"
                    :key="n"
                    >{{ i.text }}</span
                  >
                </div></template
              ><template v-else-if="item.kind === 'stools'"
                ><p class="helper">Für {{ item.observed_for_date }}</p>
                <div class="tags">
                  <span class="stool-tag">{{
                    stoolQualityLabel(item.quality)
                  }}</span>
                </div> </template
              ><template v-else-if="item.kind === 'stress'"
                ><div class="tags">
                  <span class="stress-tag"
                    >{{ item.value }}
                    {{
                      item.metric === "stress_score" &&
                      item.unit === "score_0_10"
                        ? "/10"
                        : item.unit
                    }}</span
                  >
                </div>
                <p class="helper">
                  {{
                    item.source === "generic" &&
                    !item.external_id &&
                    item.metric === "stress_score"
                      ? "Persönlicher Stress-Score."
                      : item.metric + " · " + item.source
                  }}
                </p> </template
              ><template v-else
                ><div class="tags">
                  <span
                    v-for="(value, key) in item.symptoms"
                    v-show="value > 0"
                    :key="key"
                    class="symptom-tag"
                    >{{ symptoms[key] }}
                    <b>{{
                      symptomIntensityLabels[symptomIntensityFromScore(value)]
                    }}</b></span
                  >
                </div>
                <div v-if="!item.symptom_free" class="timing-tag">
                  <span>{{ timingLabel(item.timing_bucket) }}</span>
                  <small>{{ timingPhase(item.timing_bucket) }}</small>
                </div>
                <div
                  v-if="item.cycle_phase && item.cycle_phase !== 'unknown'"
                  class="cycle-tag"
                >
                  {{ cyclePhaseLabel(item.cycle_phase)
                  }}<span v-if="item.cycle_day">
                    · Tag {{ item.cycle_day }}</span
                  >
                </div>
                <p v-if="!item.meal_baseline" class="helper">
                  Stress {{ item.stress }}/10 · Schlaf
                  {{ item.sleep_hours }} Stunden
                </p></template
              >
              <details v-if="item.notes" class="entry-note">
                <summary>Notiz ansehen</summary>
                <p>{{ item.notes }}</p>
              </details>
            </div>
            <div class="diary-entry-actions">
              <UiButton
                class="icon-button"
                aria-label="Eintrag bearbeiten"
                @click="editing = item"
              >
                <Pencil :size="17" />
              </UiButton>
              <UiButton
                class="icon-button delete"
                aria-label="Eintrag löschen"
                @click="pending = item"
              >
                <Trash2 :size="17" />
              </UiButton>
            </div>
          </article>
        </div>
      </section>
    </div>
    <UiButton v-if="date" class="text-button" @click="entry = 'free'">
      <Heart :size="16" />Gutes Befinden für diesen Zeitpunkt eintragen
    </UiButton>
    <DiaryEntryEditor
      v-if="editing"
      :key="editing.id"
      :entry="editing"
      @close="editing = null"
      @saved="edited"
    />
    <EntryModal
      v-if="entry === 'meal' || entry === 'check' || entry === 'free'"
      :type="entry"
      :day="date"
      @close="entry = ''"
    /><StoolModal
      v-if="entry === 'stool'"
      :day="date === localDate() ? '' : date"
      @close="entry = ''"
    /><StressModal
      v-if="entry === 'stress'"
      :day="date === localDate() ? '' : date"
      @close="entry = ''"
    /><EntryPanel
      v-if="pending"
      title="Eintrag löschen?"
      @close="pending = null"
      ><p>
        Dieser Eintrag wird dauerhaft aus deinem Tagebuch entfernt. Deine Muster
        werden danach neu berechnet.
      </p>
      <p v-if="error" role="alert" class="alert error">{{ error }}</p>
      <div class="form-actions">
        <UiButton class="button secondary" @click="pending = null">
          Behalten</UiButton
        ><UiButton
          class="button danger"
          :disabled="busy"
          @click="
            save(
              '/' + pending.kind + '/' + pending.id,
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
