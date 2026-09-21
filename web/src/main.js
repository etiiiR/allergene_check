import { createApp, h } from "vue";
import { createInertiaApp } from "@inertiajs/vue3";
import "./style.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
const pages = import.meta.glob("./pages/*.vue", { eager: true });
createInertiaApp({
  title: (title) => (title ? title + " · Bauchgefühl" : "Bauchgefühl"),
  resolve: (name) => pages["./pages/" + name + ".vue"].default,
  setup({ el, App, props, plugin }) {
    createApp({ render: () => h(App, props) })
      .use(plugin)
      .mount(el);
  },
  progress: { color: "#426c55" },
});
