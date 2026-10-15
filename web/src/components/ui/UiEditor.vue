<script setup>
import {
  computed,
  nextTick,
  onMounted,
  onBeforeUnmount,
  ref,
  useId,
} from "vue";
import { ArrowLeft } from "@lucide/vue";
import { workspace } from "../../ui/workspace";
const props = defineProps({ title: String, busy: Boolean, tone: String });
const emit = defineEmits(["close"]);
const id = useId();
const heading = ref(null);
const active = computed(() => workspace.stack.at(-1) === id);
let trigger, scrollY;
onMounted(async () => {
  trigger = document.activeElement;
  scrollY = window.scrollY;
  workspace.stack.push(id);
  await nextTick();
  window.scrollTo({ top: 0, behavior: "instant" });
  heading.value?.focus({ preventScroll: true });
});
onBeforeUnmount(() => {
  workspace.stack = workspace.stack.filter((value) => value !== id);
  nextTick(() => {
    if (trigger?.isConnected) {
      trigger.focus({ preventScroll: true });
      window.scrollTo({ top: scrollY || 0, behavior: "instant" });
    }
  });
});
</script>
<template>
  <Teleport to="#entry-workspace">
    <section
      v-show="active"
      class="entry-workspace"
      :data-tone="tone"
      :aria-labelledby="id"
      :aria-busy="busy || undefined"
    >
      <button
        type="button"
        class="text-button editor-back"
        :disabled="busy"
        aria-label="Zurück zur Übersicht"
        @click="emit('close')"
      >
        <ArrowLeft :size="17" /> Zurück
      </button>
      <header class="editor-heading">
        <p class="eyebrow">TAGEBUCH</p>
        <h1 :id="id" ref="heading" tabindex="-1">{{ title }}</h1>
      </header>
      <div class="editor-content"><slot /></div>
    </section>
  </Teleport>
</template>
