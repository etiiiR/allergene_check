<script setup>
import { computed, ref } from "vue";
import { symptomIcons } from "../lib";

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  symptomKey: { type: String, required: true },
  symptomLabel: { type: String, required: true },
});
const emit = defineEmits(["update:modelValue"]);
const levels = [0, 1, 2, 3, 4, 5];
const buttons = [];
const hoveredLevel = ref(null);
const icon = computed(() => symptomIcons[props.symptomKey] || "😣");
const labels = [
  "Keine",
  "Sehr leicht",
  "Leicht",
  "Mittel",
  "Stark",
  "Sehr stark",
];
const visibleLevel = computed(() => hoveredLevel.value ?? props.modelValue);

function handleKeydown(event, level) {
  const next = {
    ArrowRight: Math.min(5, level + 1),
    ArrowUp: Math.min(5, level + 1),
    ArrowLeft: Math.max(0, level - 1),
    ArrowDown: Math.max(0, level - 1),
    Home: 0,
    End: 5,
  }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  emit("update:modelValue", next);
  buttons[next]?.focus();
}
</script>

<template>
  <div class="symptom-rating-control">
    <div class="symptom-rating-heading">
      <span class="symptom-rating-symptom-icon" aria-hidden="true">{{
        icon
      }}</span>
      <strong>{{ symptomLabel }}</strong>
      <span class="symptom-rating-value">
        {{ labels[visibleLevel] }} · {{ visibleLevel }}/5
      </span>
    </div>
    <div
      class="symptom-rating"
      role="radiogroup"
      :aria-label="`Stärke bei ${symptomLabel}`"
      @mouseleave="hoveredLevel = null"
    >
      <button
        v-for="level in levels"
        :key="level"
        type="button"
        role="radio"
        :ref="(element) => (buttons[level] = element)"
        class="symptom-rating-button"
        :class="{
          zero: level === 0,
          filled: level > 0 && level <= visibleLevel,
          current: level === modelValue,
        }"
        :aria-checked="modelValue === level"
        :tabindex="
          modelValue === level ? 0 : modelValue === 0 && level === 0 ? 0 : -1
        "
        :aria-label="`${symptomLabel}: ${labels[level]}, ${level} von 5`"
        @mouseenter="hoveredLevel = level"
        @focus="hoveredLevel = null"
        @blur="hoveredLevel = null"
        @click="emit('update:modelValue', level)"
        @keydown="handleKeydown($event, level)"
      >
        <span v-if="level === 0" class="symptom-rating-zero" aria-hidden="true"
          >0</span
        >
        <span v-else class="symptom-rating-star" aria-hidden="true">★</span>
      </button>
    </div>
    <div class="symptom-rating-scale" aria-hidden="true">
      <span>0 · keine Beschwerden</span>
      <span>5 · sehr stark</span>
    </div>
  </div>
</template>
