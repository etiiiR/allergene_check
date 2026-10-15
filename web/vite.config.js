import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  // Compile the E2E-only browser bridge out of normal production builds.
  define: {
    __GUTFEELING_E2E__: JSON.stringify(process.env.VITE_E2E_TESTS === "true"),
  },
  plugins: [vue(), tailwindcss()],
  build: {
    manifest: true,
    rollupOptions: {
      input: "src/main.js",
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (asset) =>
          asset.names?.some((n) => n.endsWith(".css"))
            ? "assets/app.css"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
});
