<script setup>
import { Check, CircleAlert, X } from "@lucide/vue";
import { feedback, dismiss } from "../../ui/feedback";
</script>
<template>
  <div
    class="toast-host no-print"
    aria-live="polite"
    aria-relevant="additions text"
    aria-atomic="false"
  >
    <TransitionGroup name="toast">
      <div
        v-for="item in feedback.items"
        :key="item.id"
        class="feedback-toast d-alert"
        :class="item.tone"
        :role="item.tone === 'error' ? 'alert' : 'status'"
      >
        <CircleAlert
          v-if="item.tone === 'error'"
          :size="18"
          aria-hidden="true"
        />
        <Check v-else :size="18" aria-hidden="true" />
        <span>{{ item.message }}</span>
        <button
          type="button"
          class="icon-button"
          aria-label="Meldung schliessen"
          @click="dismiss(item.id)"
        >
          <X :size="16" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
