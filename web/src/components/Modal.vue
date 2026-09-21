<script setup>
import { ref, onMounted } from "vue";
import { X } from "lucide-vue-next";
defineProps({ title: String });
const emit = defineEmits(["close"]);
const dialog = ref(null);
onMounted(() => dialog.value.showModal());
</script>
<template>
  <dialog ref="dialog" class="modal" @cancel.prevent="emit('close')">
    <header>
      <h2>{{ title }}</h2>
      <button
        type="button"
        class="icon-button"
        aria-label="Schliessen"
        @click="emit('close')"
      >
        <X :size="20" />
      </button>
    </header>
    <slot />
  </dialog>
</template>
