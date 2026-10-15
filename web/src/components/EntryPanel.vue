<script setup>
import UiEditor from "./ui/UiEditor.vue";
// Shared boundary for entry and detail views within the app's main region.
defineProps({ title: String, busy: Boolean, tone: String });
defineEmits(["close"]);
</script>
<template>
  <UiEditor :title="title" :busy="busy" :tone="tone" @close="$emit('close')"
    ><slot
  /></UiEditor>
</template>
