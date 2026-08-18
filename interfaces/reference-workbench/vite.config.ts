import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The workbench imports the reference post-processor directly from
// machines/, outside this package's own root — same deterministic code
// used by the CLI and by tests/golden, not a duplicate. `fs.allow` opts
// the dev server in to serving files from the repository root so that
// import resolves; the production build has no such restriction.
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  server: {
    fs: {
      allow: ["../.."],
    },
  },
  build: {
    outDir: "dist",
  },
});
