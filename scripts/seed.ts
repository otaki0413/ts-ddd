import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { equipment } from "../src/infrastructure/postgres/schema";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await drizzle(pool)
    .insert(equipment)
    .values([{ managementNumber: "EQ-001" }, { managementNumber: "EQ-002" }])
    .onConflictDoNothing();
  console.log("Seeded EQ-001 and EQ-002; existing equipment unchanged");
} finally {
  await pool.end();
}
