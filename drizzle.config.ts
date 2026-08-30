import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/infrastructure/postgres/schema.ts",
  schemaFilter: ["public"],
  dbCredentials: { url },
  verbose: true,
});
