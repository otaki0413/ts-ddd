import devServer from "@hono/vite-dev-server";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { defineConfig, lazyPlugins, type PluginOption } from "vite-plus";
import { createReservationServices } from "./src/composition-root";

export default defineConfig((env) => {
  const plugins =
    env.mode === "test"
      ? []
      : lazyPlugins(() => {
          if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; run pnpm dev");
          // Vite owns this pool. The application entry can be re-evaluated without opening a new one.
          const pool = new Pool({ connectionString: process.env.DATABASE_URL });
          pool.on("error", () => console.error("Unexpected idle database connection error"));
          return [
            devServer({
              entry: "src/main.ts",
              injectClientScript: false,
              // This server exposes only the API; file-like reservation IDs must reach Hono too.
              exclude: [],
              adapter: {
                env: { services: createReservationServices(drizzle(pool)) },
                onServerClose: () => pool.end(),
              },
            }),
          ];
        });
  return {
    test: {
      include: ["src/**/*.test.ts"],
    },
    lint: {
      jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
      rules: { "vite-plus/prefer-vite-plus-imports": "error" },
      options: { typeAware: true, typeCheck: true },
    },
    fmt: {
      ignorePatterns: [".agents"],
    },
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
    plugins: plugins as unknown as PluginOption[],
  };
});
