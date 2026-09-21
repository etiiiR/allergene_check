import { ref } from "vue";
import { router } from "@inertiajs/vue3";
export const allergenLabels = {
  gluten: "Glutenhaltiges Getreide",
  milk: "Milch",
  egg: "Ei",
  peanut: "Erdnüsse",
  tree_nuts: "Schalenfrüchte",
  soy: "Soja",
  sesame: "Sesam",
  mustard: "Senf",
  celery: "Sellerie",
  fish: "Fisch",
  crustaceans: "Krebstiere",
  molluscs: "Weichtiere",
  lupin: "Lupinen",
  sulphites: "Sulfite",
};
export const localDate = (date = new Date()) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
export const localTime = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export const dateTime = (v) =>
  new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(v));
export const dayOf = (v) => localDate(new Date(v));
export const severity = (c) => Math.max(0, ...Object.values(c.symptoms || {}));
export function foodName(id, foods) {
  return id.startsWith("allergen:")
    ? "Allergen: " + (allergenLabels[id.slice(9)] || id.slice(9))
    : id.startsWith("custom:")
      ? id.slice(7)
      : foods.find((f) => f.id === id)?.name || id;
}
export async function api(path, options = {}) {
  if (path.startsWith("/patterns"))
    path +=
      (path.includes("?") ? "&" : "?") +
      "timezone=" +
      encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const response = await fetch("/api" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Diary-Request": "1",
      ...options.headers,
    },
  });
  if (!response.ok) {
    let data;
    try {
      data = await response.json();
    } catch {}
    throw new Error(
      data?.error?.message || "Die Anfrage konnte nicht abgeschlossen werden.",
    );
  }
  return response.status === 204 ? null : response.json();
}
export function useMutation() {
  const busy = ref(false),
    error = ref("");
  async function save(path, data, done = () => {}, method = "POST") {
    busy.value = true;
    error.value = "";
    try {
      await api(path, {
        method,
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      router.reload({
        onFinish: () => {
          busy.value = false;
          done();
        },
      });
    } catch (e) {
      error.value = e.message;
      busy.value = false;
    }
  }
  return { busy, error, save };
}
