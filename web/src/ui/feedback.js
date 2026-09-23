import { reactive } from "vue";

// Shared across Inertia visits; notification text is never persisted.
export const feedback = reactive({ items: [] });
let sequence = 0;
const timers = new Map();
export function dismiss(id) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  feedback.items = feedback.items.filter((item) => item.id !== id);
}
export function notify(message, tone = "success") {
  const id = ++sequence;
  if (feedback.items.length >= 3) dismiss(feedback.items[0].id);
  feedback.items.push({ id, message, tone });
  if (tone !== "error")
    timers.set(
      id,
      setTimeout(() => dismiss(id), 6500),
    );
  return id;
}
