<script setup>
defineProps({ tone: { type: String, default: "neutral" } });
</script>
<template>
  <span class="d-badge pill" :class="tone" data-slot="badge"><slot /></span>
</template>
