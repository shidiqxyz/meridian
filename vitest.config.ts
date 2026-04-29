import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules", "discord-listener"],
    maxConcurrency: 1,
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/core/utils/**", "src/core/state/**", "src/core/config/**"],
    },
  },
});
