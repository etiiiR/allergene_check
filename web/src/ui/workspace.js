import { reactive } from "vue";
// Editors render in the app's main region, without an overlay or focus trap.
export const workspace = reactive({ stack: [] });
