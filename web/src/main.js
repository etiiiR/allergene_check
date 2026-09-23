import { createApp, h } from "vue";
import { createInertiaApp } from "@inertiajs/vue3";
import "./tailwind.css";
import "./style.css";
import UiButton from "./components/ui/UiButton.vue";
import UiCard from "./components/ui/UiCard.vue";
import UiBadge from "./components/ui/UiBadge.vue";
import UiSkeleton from "./components/ui/UiSkeleton.vue";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
const pages = import.meta.glob("./pages/*.vue", { eager: true });
createInertiaApp({
  title: (title) => (title ? title + " · Bauchgefühl" : "Bauchgefühl"),
  resolve: (name) => pages["./pages/" + name + ".vue"].default,
  setup({ el, App, props, plugin }) {
    createApp({ render: () => h(App, props) })
      .use(plugin)
      .component("UiButton", UiButton)
      .component("UiCard", UiCard)
      .component("UiBadge", UiBadge)
      .component("UiSkeleton", UiSkeleton)
      .mount(el);
  },
  progress: { color: "#0f766e" },
});
