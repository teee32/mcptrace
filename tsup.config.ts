import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  outDir: "dist",
  format: ["esm"],
  target: "node18",
  clean: true,
  sourcemap: false,
  splitting: false,
  shims: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
