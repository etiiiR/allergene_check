<script setup>
defineProps({
  labels: { type: Array, required: true },
  current: { type: Number, required: true },
});
</script>
<template>
  <ol class="guided-steps" aria-label="Fortschritt">
    <li
      v-for="(label, index) in labels"
      :key="label"
      :aria-current="index === current ? 'step' : undefined"
      :class="{ complete: index < current }"
    >
      <span aria-hidden="true">{{ index < current ? "✓" : index + 1 }}</span
      >{{ label }}
    </li>
  </ol>
</template>
