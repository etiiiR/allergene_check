<script setup>
defineProps({ label: { type: String, default: "Wird geladen …" } });
</script>
<template>
  <div
    class="skeleton-panel"
    role="status"
    :aria-label="label"
    aria-busy="true"
  >
    <span class="sr-only">{{ label }}</span>
    <div class="d-skeleton skeleton-line short" aria-hidden="true" />
    <div class="d-skeleton skeleton-line" aria-hidden="true" />
    <div class="d-skeleton skeleton-line" aria-hidden="true" />
  </div>
</template>
