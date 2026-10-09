import { createApp, h } from "vue";
import { createInertiaApp } from "@inertiajs/vue3";
import "./tailwind.css";
import "./style.css";
import "./colors.css";
import UiButton from "./components/ui/UiButton.vue";
import UiCard from "./components/ui/UiCard.vue";
import UiBadge from "./components/ui/UiBadge.vue";
import UiSkeleton from "./components/ui/UiSkeleton.vue";
import VaultGate from "./components/VaultGate.vue";
import AccountSessionGate from "./components/AccountSessionGate.vue";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
// Load only the current Inertia page. The former eager glob put every screen
// and its icon imports in the first mobile request.
const pages = import.meta.glob("./pages/*.vue");
createInertiaApp({
  title: (title) => (title ? title + " · Bauchgefühl" : "Bauchgefühl"),
  resolve: async (name) => {
    const loadPage = pages[`./pages/${name}.vue`];
    if (!loadPage) throw new Error(`Unknown Inertia page: ${name}`);
    return (await loadPage()).default;
  },
  setup({ el, App, props, plugin }) {
    createApp({
      setup() {
        return () =>
          h(
            AccountSessionGate,
            {
              initialAuthenticated:
                props.initialPage?.props?.accountAuthenticated ?? true,
              initialAccountConfigured:
                props.initialPage?.props?.accountConfigured ?? false,
            },
            {
              default: () =>
                h(
                  VaultGate,
                  {
                    initialVault: props.initialPage?.props?.vault ?? null,
                    initialLoadError: props.initialPage?.props?.loadError ?? "",
                  },
                  { default: () => h(App, props) },
                ),
            },
          );
      },
    })
      .use(plugin)
      .component("UiButton", UiButton)
      .component("UiCard", UiCard)
      .component("UiBadge", UiBadge)
      .component("UiSkeleton", UiSkeleton)
      .mount(el);
  },
  progress: { color: "#4338ca" },
});
