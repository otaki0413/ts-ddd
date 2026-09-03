import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["tests/**/*.db.test.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
