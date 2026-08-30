import { sql } from "drizzle-orm";
import { bigint, check, index, numeric, pgTable, text } from "drizzle-orm/pg-core";

export const equipment = pgTable(
  "equipment",
  {
    managementNumber: text("management_number").primaryKey(),
    status: text("status", { enum: ["available", "suspended"] })
      .notNull()
      .default("available"),
    version: numeric("version", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    lastPerformedBy: text("last_performed_by"),
    lastOccurredAtNs: numeric("last_occurred_at_ns", { mode: "bigint" }),
    suspensionReason: text("suspension_reason"),
  },
  (table) => [
    check(
      "consistent_equipment_snapshot",
      sql`(
    ${table.status} = 'available' AND ${table.version} = 0
    AND ${table.lastPerformedBy} IS NULL AND ${table.lastOccurredAtNs} IS NULL
    AND ${table.suspensionReason} IS NULL
  ) OR (
    ${table.version} > 0 AND ${table.version} = trunc(${table.version})
    AND ${table.lastPerformedBy} IS NOT NULL AND ${table.lastOccurredAtNs} IS NOT NULL
    AND ${table.lastOccurredAtNs} = trunc(${table.lastOccurredAtNs})
    AND ((${table.status} = 'available' AND ${table.suspensionReason} IS NULL)
      OR (${table.status} = 'suspended' AND ${table.suspensionReason} IS NOT NULL
        AND length(btrim(${table.suspensionReason})) > 0))
  )`,
    ),
  ],
);

export const reservations = pgTable(
  "reservations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    managementNumber: text("management_number")
      .notNull()
      .references(() => equipment.managementNumber),
    startsAt: bigint("starts_at", { mode: "bigint" }).notNull(),
    endsAt: bigint("ends_at", { mode: "bigint" }).notNull(),
  },
  (table) => [
    check("positive_reservation_period", sql`${table.startsAt} < ${table.endsAt}`),
    index("reservation_overlap_candidates").on(
      table.managementNumber,
      table.startsAt,
      table.endsAt,
    ),
  ],
);
