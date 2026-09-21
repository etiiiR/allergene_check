<script setup>
import { computed, ref } from "vue";
import { Head, Link } from "@inertiajs/vue3";
import {
  Plus,
  ArrowRight,
  Sun,
  BookOpen,
  Utensils,
  Activity,
  Leaf,
  Heart,
  CalendarDays,
  Sparkles,
} from "lucide-vue-next";
import AppShell from "../components/AppShell.vue";
import EntryModal from "../components/EntryModal.vue";
import { localDate, dayOf, severity, dateTime } from "../lib";
const props = defineProps({ diary: Object, symptoms: Object }),
  entry = ref("");
const today = localDate();
const meals = computed(() =>
  props.diary.meals.filter((x) => dayOf(x.occurred_at) === today),
);
const checks = computed(() =>
  props.diary.checkins.filter((x) => dayOf(x.occurred_at) === today),
);
const free = computed(
  () =>
    new Set(
      props.diary.checkins
        .filter(
          (x) =>
            x.symptom_free &&
            !props.diary.checkins.some(
              (y) =>
                dayOf(y.occurred_at) === dayOf(x.occurred_at) &&
                severity(y) > 0,
            ),
        )
        .map((x) => dayOf(x.occurred_at)),
    ).size,
);
const week = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + i);
    const key = localDate(d),
      entries = props.diary.checkins.filter(
        (x) => dayOf(x.occurred_at) === key,
      );
    return {
      label: new Intl.DateTimeFormat("de", { weekday: "short" }).format(d),
      has: entries.length > 0,
      value: Math.max(0, ...entries.map(severity)),
      today: key === today,
    };
  }),
);
const recent = computed(() =>
  [
    ...meals.value.map((x) => ({ ...x, type: "meal" })),
    ...checks.value.map((x) => ({ ...x, type: "check" })),
  ].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
);
</script>
<template>
  <Head title="Übersicht" /><AppShell
    ><div class="page-heading">
      <div>
        <p class="eyebrow"><Sun :size="15" /> DEIN TAG IM BLICK</p>
        <h1>Hör auf dein Bauchgefühl.</h1>
        <p>Entdecke, was dir guttut. Eine Mahlzeit nach der anderen.</p>
      </div>
      <button class="button primary" @click="entry = 'meal'">
        <Plus :size="18" />Mahlzeit eintragen
      </button>
    </div>
    <section class="welcome-banner">
      <div>
        <span class="pill light"
          ><Leaf :size="13" /> DEIN WEG ZU MEHR WOHLBEFINDEN</span
        >
        <h2>Verstehen beginnt<br />mit Beobachten.</h2>
        <p>
          Dein Essen, deine Symptome, deine Zusammenhänge.<br />Alles an einem
          Ort – ganz in deinem Tempo.
        </p>
        <button class="button cream" @click="entry = 'check'">
          Wie geht es dir heute?<ArrowRight :size="16" />
        </button>
      </div>
      <div class="botanical" aria-hidden="true">
        <div class="orbit o1" />
        <div class="orbit o2" />
        <div class="leaf leaf1" />
        <div class="leaf leaf2" />
        <div class="leaf leaf3" />
        <div class="leaf leaf4" />
        <div class="stem" />
        <div class="floating-note">
          <Heart :size="18" /> Gut zu dir. Gut für deinen Bauch.
        </div>
      </div>
    </section>
    <div class="stats-grid">
      <article class="stat">
        <span class="stat-icon"><Utensils :size="19" /></span>
        <div>
          <p>Mahlzeiten heute</p>
          <strong>{{ meals.length }}</strong
          ><small>Bewusst festgehalten</small>
        </div>
      </article>
      <article class="stat">
        <span class="stat-icon peach"><Activity :size="19" /></span>
        <div>
          <p>Check-ins heute</p>
          <strong>{{ checks.length }}</strong
          ><small>Auch symptomfrei zählt</small>
        </div>
      </article>
      <article class="stat">
        <span class="stat-icon yellow"><Sun :size="19" /></span>
        <div>
          <p>Symptomfreie Tage</p>
          <strong>{{ free }} <em>Tage</em></strong
          ><small>Ohne dokumentierte Beschwerden</small>
        </div>
      </article>
    </div>
    <div class="dashboard-grid">
      <section class="panel">
        <div class="section-heading">
          <h2>Dein heutiges Tagebuch</h2>
          <Link href="/diary">Alle Einträge <ArrowRight :size="15" /></Link>
        </div>
        <div v-if="!recent.length" class="empty-state">
          <span class="empty-icon"><BookOpen :size="26" /></span>
          <h3>Ein guter Tag zum Anfangen.</h3>
          <p>
            Trage deine erste Mahlzeit ein oder halte fest,<br />wie du dich
            gerade fühlst.
          </p>
          <button class="text-button" @click="entry = 'check'">
            Ersten Check-in hinzufügen <ArrowRight :size="15" />
          </button>
        </div>
        <div
          v-for="item in recent.slice(0, 5)"
          :key="item.id"
          class="timeline-row"
        >
          <span class="event-icon"
            ><Utensils v-if="item.type === 'meal'" :size="18" /><Heart
              v-else
              :size="18"
          /></span>
          <div>
            <strong>{{
              item.type === "meal"
                ? item.title
                : item.symptom_free
                  ? "Mir geht es gut"
                  : "Symptom-Check-in"
            }}</strong
            ><small
              >{{ dateTime(item.occurred_at)
              }}<span v-if="item.type === 'check' && !item.symptom_free">
                · Intensität {{ severity(item) }}/10</span
              ></small
            >
          </div>
          <span
            class="pill"
            :class="
              item.type === 'meal'
                ? 'neutral'
                : item.symptom_free
                  ? 'low'
                  : 'high'
            "
            >{{
              item.type === "meal"
                ? "Mahlzeit"
                : item.symptom_free
                  ? "Symptomfrei"
                  : "Beschwerden"
            }}</span
          >
        </div>
      </section>
      <section class="panel">
        <div class="section-heading">
          <h2>Deine letzten 7 Tage</h2>
          <CalendarDays :size="18" class="muted" />
        </div>
        <p class="helper">Stärkste dokumentierte Beschwerden pro Tag</p>
        <div class="week-chart">
          <div v-for="d in week" :key="d.label" class="day-column">
            <div class="bar-track">
              <div
                v-if="d.has"
                class="bar"
                :class="{ zero: !d.value }"
                :style="{ height: Math.max(5, d.value * 10) + '%' }"
              />
              <span v-else class="no-data">–</span>
            </div>
            <span :class="{ today: d.today }">{{ d.label }}</span>
          </div>
        </div>
        <div class="chart-legend">
          <span><i class="green-dot" />Symptomfrei</span
          ><span><i class="sage-dot" />Beschwerden (0–10)</span
          ><span>– Kein Eintrag</span>
        </div>
      </section>
    </div>
    <Link href="/insights" class="insight-callout"
      ><span class="stat-icon"><Sparkles :size="21" /></span>
      <div>
        <h3>Aus kleinen Beobachtungen werden Muster.</h3>
        <p>
          Regelmässige Einträge helfen dir, mögliche Zusammenhänge mit Zutaten
          zu entdecken.
        </p>
      </div>
      <ArrowRight :size="21"
    /></Link>
    <EntryModal v-if="entry" :type="entry" @close="entry = ''" />
  </AppShell>
</template>
