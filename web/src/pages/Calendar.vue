<script setup>
import { computed, ref } from "vue";
import { Head } from "@inertiajs/vue3";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Heart,
  HeartPulse,
  Plus,
  Utensils,
} from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import EntryModal from "../components/EntryModal.vue";
import StoolModal from "../components/StoolModal.vue";
import StressModal from "../components/StressModal.vue";
import { dateTime, dayOf, localDate } from "../lib";

const props = defineProps({ diary: Object, symptoms: Object });
const today = localDate();
const selectedDay = ref(today);
const monthCursor = ref(new Date(`${today}T00:00:00`));
const entry = ref("");

const weekdayLabels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const monthLabel = computed(() =>
  new Intl.DateTimeFormat("de-CH", { month: "long", year: "numeric" }).format(
    monthCursor.value,
  ),
);

const allEvents = computed(() => [
  ...(props.diary?.meals || []).map((item) => ({
    ...item,
    kind: "meal",
    occurred_at: item.occurred_at,
  })),
  ...(props.diary?.checkins || []).map((item) => ({
    ...item,
    kind: "checkin",
    occurred_at: item.occurred_at,
  })),
  ...(props.diary?.stress_observations || []).map((item) => ({
    ...item,
    kind: "stress",
    occurred_at: item.observed_at,
  })),
  ...(props.diary?.stools || []).map((item) => ({
    ...item,
    kind: "stool",
    occurred_at: item.observed_at,
  })),
]);

const eventsByDay = computed(() => {
  const grouped = {};
  for (const item of allEvents.value) {
    const day = dayOf(item.occurred_at);
    (grouped[day] ||= []).push(item);
  }
  for (const items of Object.values(grouped)) {
    items.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }
  return grouped;
});

function dayStatus(items) {
  const hasSymptoms = items.some(
    (item) => item.kind === "checkin" && !item.symptom_free,
  );
  const hasGood = items.some(
    (item) => item.kind === "checkin" && item.symptom_free,
  );
  const hasMeal = items.some((item) => item.kind === "meal");
  if (hasSymptoms && hasGood) return "mixed";
  if (hasSymptoms) return "symptoms";
  if (hasGood) return "good";
  if (hasMeal) return "missing";
  return "empty";
}

const statusLabels = {
  empty: "Noch nichts dokumentiert",
  missing: "Befinden offen",
  good: "Gutes Befinden dokumentiert",
  symptoms: "Beschwerden dokumentiert",
  mixed: "Gutes Befinden und Beschwerden",
};
const statusLabel = (status) => statusLabels[status] || statusLabels.empty;

function dayLabel(day) {
  return new Intl.DateTimeFormat("de-CH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${day}T12:00:00`));
}

const calendarDays = computed(() => {
  const year = monthCursor.value.getFullYear();
  const month = monthCursor.value.getMonth();
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(year, month, index - offset + 1);
    const key = localDate(date);
    const items = eventsByDay.value[key] || [];
    return {
      key,
      day: date.getDate(),
      currentMonth: date.getMonth() === month,
      today: key === today,
      items,
      status: dayStatus(items),
      meals: items.filter((item) => item.kind === "meal").length,
      checkins: items.filter((item) => item.kind === "checkin").length,
      stress: items.filter((item) => item.kind === "stress").length,
      stools: items.filter((item) => item.kind === "stool").length,
    };
  });
});

const monthSummary = computed(() => {
  const days = calendarDays.value.filter((day) => day.currentMonth);
  return {
    missing: days.filter((day) => day.status === "missing").length,
    good: days.filter((day) => day.status === "good").length,
    symptoms: days.filter(
      (day) => day.status === "symptoms" || day.status === "mixed",
    ).length,
    documented: days.filter((day) => day.items.length > 0).length,
  };
});

const selectedItems = computed(
  () => eventsByDay.value[selectedDay.value] || [],
);
const selectedStatus = computed(() => dayStatus(selectedItems.value));
const selectedDateLabel = computed(() => dayLabel(selectedDay.value));

function selectDay(day) {
  selectedDay.value = day.key;
  if (!day.currentMonth) {
    monthCursor.value = new Date(`${day.key}T00:00:00`);
  }
}

function changeMonth(delta) {
  monthCursor.value = new Date(
    monthCursor.value.getFullYear(),
    monthCursor.value.getMonth() + delta,
    1,
  );
  selectedDay.value = localDate(monthCursor.value);
}

function goToday() {
  monthCursor.value = new Date(`${today}T00:00:00`);
  selectedDay.value = today;
}

function openEntry(kind) {
  entry.value = kind;
}

function closeEntry() {
  entry.value = "";
}

function itemTitle(item) {
  if (item.kind === "meal") return item.title;
  if (item.kind === "stress") return "Stressmessung";
  if (item.kind === "stool") return "Stuhlbeobachtung";
  return item.symptom_free ? "Gutes Befinden" : "Beschwerden";
}
</script>

<template>
  <Head title="Kalender" />
  <AppShell>
    <div class="calendar-page">
      <div class="page-heading calendar-heading">
        <div>
          <p class="eyebrow"><CalendarDays :size="14" /> KALENDER</p>
          <h1>Dein Kalender</h1>
          <p>
            Sieh auf einen Blick, wann Essen und Befinden zusammen dokumentiert
            sind.
          </p>
        </div>
        <UiButton class="button secondary" @click="goToday">Heute</UiButton>
      </div>

      <section class="panel calendar-panel">
        <div class="calendar-toolbar">
          <UiButton
            class="icon-button"
            aria-label="Vorheriger Monat"
            @click="changeMonth(-1)"
          >
            <ChevronLeft :size="19" />
          </UiButton>
          <h2>{{ monthLabel }}</h2>
          <UiButton
            class="icon-button"
            aria-label="Nächster Monat"
            @click="changeMonth(1)"
          >
            <ChevronRight :size="19" />
          </UiButton>
        </div>
        <div class="calendar-weekdays" aria-hidden="true">
          <span v-for="weekday in weekdayLabels" :key="weekday">{{
            weekday
          }}</span>
        </div>
        <div class="calendar-grid" role="group" aria-label="Tagebuchkalender">
          <UiButton
            v-for="day in calendarDays"
            :key="day.key"
            type="button"
            class="calendar-day"
            :class="[
              `calendar-day-${day.status}`,
              {
                outside: !day.currentMonth,
                today: day.today,
                selected: selectedDay === day.key,
              },
            ]"
            :aria-pressed="selectedDay === day.key"
            :aria-label="`${dayLabel(day.key)}: ${statusLabel(day.status)}, ${day.meals} Mahlzeiten, ${day.checkins} Check-ins`"
            @click="selectDay(day)"
          >
            <span class="calendar-day-number">{{ day.day }}</span>
            <span class="calendar-day-icons" aria-hidden="true"
              ><span
                v-if="day.meals"
                class="calendar-dot meal-dot"
                :aria-label="`${day.meals} Mahlzeiten`"
                ><Utensils :size="11"
              /></span>
              <span
                v-if="day.checkins"
                class="calendar-dot checkin-dot"
                :aria-label="`${day.checkins} Check-ins`"
                ><Heart :size="11"
              /></span>
              <span
                v-if="day.stress"
                class="calendar-dot stress-dot"
                :aria-label="`${day.stress} Stressmessungen`"
                ><HeartPulse :size="11"
              /></span>
              <span
                v-if="day.stools"
                class="calendar-dot stool-dot"
                :aria-label="`${day.stools} Stuhlbeobachtungen`"
                ><ClipboardCheck :size="11"
              /></span> </span
            ><small v-if="day.status === 'missing'">offen</small>
            <small v-else-if="day.status === 'good'" class="calendar-good"
              ><Check :size="10" /> gut</small
            >
          </UiButton>
        </div>
        <div class="calendar-legend" aria-label="Kalenderlegende">
          <span><i class="legend-mark missing-mark" /> Befinden offen</span>
          <span><i class="legend-mark good-mark" /> guter Moment</span>
          <span><i class="legend-mark symptom-mark" /> Beschwerden</span>
        </div>
      </section>

      <section class="calendar-month-summary">
        <span
          ><strong>{{ monthSummary.documented }}</strong> dokumentierte
          Tage</span
        >
        <span class="calendar-summary-open"
          ><strong>{{ monthSummary.missing }}</strong> Tage mit offenem
          Befinden</span
        >
        <span class="calendar-summary-good"
          ><strong>{{ monthSummary.good }}</strong> Tage mit gutem
          Befinden</span
        >
        <span class="calendar-summary-symptoms"
          ><strong>{{ monthSummary.symptoms }}</strong> Tage mit
          Beschwerden</span
        >
      </section>

      <section class="panel selected-day-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">AUSGEWÄHLTER TAG</p>
            <h2>{{ selectedDateLabel }}</h2>
            <small>{{ statusLabel(selectedStatus) }}</small>
          </div>
          <span
            class="pill"
            :class="
              selectedStatus === 'missing'
                ? 'high'
                : selectedStatus === 'good'
                  ? 'low'
                  : 'neutral'
            "
          >
            {{
              selectedStatus === "missing"
                ? "Offen"
                : selectedStatus === "good"
                  ? "Gut"
                  : selectedStatus === "empty"
                    ? "Leer"
                    : "Dokumentiert"
            }}
          </span>
        </div>

        <div v-if="selectedItems.length" class="calendar-event-list">
          <div
            v-for="item in selectedItems"
            :key="item.kind + item.id"
            class="calendar-event-row"
          >
            <span class="event-icon">
              <Utensils v-if="item.kind === 'meal'" :size="16" />
              <HeartPulse v-else-if="item.kind === 'stress'" :size="16" />
              <ClipboardCheck v-else-if="item.kind === 'stool'" :size="16" />
              <Heart v-else :size="16" />
            </span>
            <span
              ><strong>{{ itemTitle(item) }}</strong
              ><small>{{ dateTime(item.occurred_at) }}</small></span
            >
            <small v-if="item.kind === 'checkin' && !item.symptom_free"
              >{{
                Math.max(...Object.values(item.symptoms || {}), 0)
              }}/10</small
            >
            <small v-else-if="item.kind === 'stress'"
              >{{ item.normalized_stress ?? item.value }}/10</small
            >
          </div>
        </div>
        <p v-else class="calendar-empty-day">
          Für diesen Tag ist noch nichts dokumentiert.
        </p>

        <div v-if="selectedDay <= today" class="calendar-add-actions">
          <UiButton class="button primary" @click="openEntry('meal')"
            ><Plus :size="15" /> Mahlzeit</UiButton
          >
          <UiButton class="button secondary" @click="openEntry('check')"
            ><Heart :size="15" /> Beschwerden</UiButton
          >
          <UiButton class="button secondary" @click="openEntry('free')"
            ><Check :size="15" /> Gutes Befinden</UiButton
          >
          <UiButton class="button secondary" @click="openEntry('stress')"
            ><HeartPulse :size="15" /> Stress</UiButton
          >
          <UiButton class="button secondary" @click="openEntry('stool')"
            ><ClipboardCheck :size="15" /> Stuhl</UiButton
          >
        </div>
        <p v-if="selectedDay > today" class="helper">
          Beobachtungen kannst du für heute oder vergangene Tage eintragen.
        </p>
        <p class="helper">
          Ein guter Check-in beschreibt einen Zeitpunkt, nicht den ganzen Tag.
          Ein Tag mit Mahlzeit, aber ohne Check-in bleibt als „Befinden offen“
          markiert. Das ist keine Annahme über deine Gesundheit — nur eine
          Erinnerung zum Nachtragen.
        </p>
      </section>

      <EntryModal
        v-if="entry === 'meal' || entry === 'check' || entry === 'free'"
        :type="entry"
        :day="selectedDay"
        @close="closeEntry"
      />
      <StressModal
        v-if="entry === 'stress'"
        :day="selectedDay"
        @close="closeEntry"
      />
      <StoolModal
        v-if="entry === 'stool'"
        :day="selectedDay"
        @close="closeEntry"
      />
    </div>
  </AppShell>
</template>
