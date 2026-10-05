import { ref } from "vue";
import { router } from "@inertiajs/vue3";
import { notify } from "./ui/feedback";
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
export const timingWindows = {
  immediate: { label: "Direkt nach dem Essen", phase: "Frühes Fenster" },
  early: { label: "30 Minuten bis 2 Stunden", phase: "Frühes Fenster" },
  mid: { label: "2 bis 6 Stunden", phase: "Dünndarm-orientiertes Fenster" },
  late: { label: "6 bis 24 Stunden / Folgetag", phase: "Spätes Fenster" },
  unknown: { label: "Zeitpunkt unklar", phase: "Nicht zugeordnet" },
};
export const timingLabel = (bucket) =>
  timingWindows[bucket]?.label || timingWindows.unknown.label;
export const timingPhase = (bucket) =>
  timingWindows[bucket]?.phase || timingWindows.unknown.phase;
export const cyclePhases = {
  menstruation: "Menstruation",
  follicular: "Follikelphase",
  ovulation: "Ovulationsfenster",
  luteal: "Lutealphase",
  unknown: "Nicht zugeordnet",
};
export const cyclePhaseLabel = (phase) =>
  cyclePhases[phase] || cyclePhases.unknown;
export const stoolQualities = {
  formed: "Gut geformt",
  hard: "Hart / schwer",
  soft: "Weich",
  watery: "Wässrig",
  mixed: "Unterschiedlich",
  no_stool: "Kein Stuhl",
  unknown: "Nicht sicher",
};
export const stoolQualityLabel = (quality) =>
  stoolQualities[quality] || stoolQualities.unknown;
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
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    try {
      const result = await api(path, {
        method,
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      const labels = {
        meals: "Mahlzeit gespeichert.",
        checkins: "Befinden gespeichert.",
        stools: "Beobachtung gespeichert.",
        stress: "Stress gespeichert.",
        recipes: "Rezept gespeichert.",
        "recipe-flags": "Markierung gespeichert.",
      };
      notify(
        method === "DELETE"
          ? "Eintrag gelöscht."
          : labels[path.split("/")[1]] || "Gespeichert.",
      );
      router.reload({
        onError: () =>
          notify(
            "Gespeichert. Die Ansicht konnte nicht aktualisiert werden. Bitte neu laden.",
            "error",
          ),
        onFinish: () => {
          busy.value = false;
          done(result);
        },
      });
    } catch (e) {
      error.value = e.message;
      notify(e.message, "error");
      busy.value = false;
    }
  }
  return { busy, error, save };
}
