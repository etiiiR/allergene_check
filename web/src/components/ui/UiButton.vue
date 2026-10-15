<script setup>
import { computed } from "vue";
import { LoaderCircle } from "@lucide/vue";
defineOptions({ inheritAttrs: false });
const props = defineProps({
  variant: String,
  loading: Boolean,
  disabled: Boolean,
});
// Preserve native button types during the migration, including form submit.
const variantClass = computed(
  () =>
    ({
      primary: "d-btn-primary",
      secondary: "d-btn-outline",
      ghost: "d-btn-ghost",
      destructive: "d-btn-error",
    })[props.variant],
);
</script>
<template>
  <button
    v-bind="$attrs"
    :class="[variant && 'd-btn button', variantClass]"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    data-slot="button"
  >
    <LoaderCircle
      v-if="loading"
      class="loading-spinner"
      :size="16"
      aria-hidden="true"
    />
    <slot />
  </button>
</template>
