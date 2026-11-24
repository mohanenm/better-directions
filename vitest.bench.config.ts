import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["app/bench/**/*.bench.ts"], testTimeout: 600_000 },
});
