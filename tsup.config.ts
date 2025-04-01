import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/shard-manager.ts", "src/runner.ts", "src/health-check.ts"],
  clean: true,
  publicDir: true,
  treeshake: "smallest",
});
