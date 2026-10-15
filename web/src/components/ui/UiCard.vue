<script setup>
defineProps({ as: { type: String, default: "section" } });
</script>
<template>
  <component :is="as" class="d-card panel" data-slot="card"><slot /></component>
</template>
