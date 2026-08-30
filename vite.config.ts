import devServer from "@hono/vite-dev-server";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { defineConfig } from "vite";
import { createReservationServices } from "./src/composition-root";

export default defineConfig(() => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; run pnpm dev");
  // Vite owns this pool. The application entry can be re-evaluated without opening a new one.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool.on("error", () => console.error("Unexpected idle database connection error"));
  return {
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
    plugins: [
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
    ],
  };
});
