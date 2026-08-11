import { defineConfig } from "vite";

// The app is self contained and lives at /explore/. Jekyll knows nothing about
// it, 'make' just copies the build output into _site after jekyll runs.
export default defineConfig({
  root: "explore",
  base: "/explore/",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: true,
    // HACK: disable hashing, because _layouts/base.html preloads the bundle by name.
    rollupOptions: {
      output: {
        entryFileNames: "bundle.js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});
