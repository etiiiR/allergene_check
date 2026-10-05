<script setup>
import { computed } from "vue";
import { symptomIcons } from "../lib";

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  symptomKey: { type: String, required: true },
  symptomLabel: { type: String, required: true },
});
const emit = defineEmits(["update:modelValue"]);
const levels = [0, 1, 2, 3];
const buttons = [];
const icon = computed(() => symptomIcons[props.symptomKey] || "😣");
const labels = ["Keine", "Leicht", "Mittel", "Stark"];

function handleKeydown(event, level) {
  const next = {
    ArrowRight: Math.min(3, level + 1),
    ArrowUp: Math.min(3, level + 1),
    ArrowLeft: Math.max(0, level - 1),
    ArrowDown: Math.max(0, level - 1),
    Home: 0,
    End: 3,
  }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  emit("update:modelValue", next);
  buttons[next]?.focus();
}
</script>

<template>
  <div
    class="symptom-rating"
    role="radiogroup"
    :aria-label="`Stärke bei ${symptomLabel}`"
  >
    <button
      v-for="level in levels"
      :key="level"
      type="button"
      role="radio"
      :ref="(element) => (buttons[level] = element)"
      class="symptom-rating-button"
      :class="[`level-${level}`, { current: level === modelValue }]"
      :aria-checked="modelValue === level"
      :tabindex="modelValue === level ? 0 : -1"
      :aria-label="`${symptomLabel}: ${labels[level]}`"
      @click="emit('update:modelValue', level)"
      @keydown="handleKeydown($event, level)"
    >
      <span class="symptom-rating-glyph" aria-hidden="true">{{ icon }}</span>
      <span class="symptom-rating-label">{{ labels[level] }}</span>
    </button>
  </div>
</template>
