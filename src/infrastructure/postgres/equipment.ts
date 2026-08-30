import { Temporal } from "@js-temporal/polyfill";
import { eq } from "drizzle-orm";
import { type NodePgDatabase } from "drizzle-orm/node-postgres";
import { type EquipmentRepository } from "../../application/reserve-equipment.js";
import { Equipment } from "../../domain/equipment.js";
import { ManagementNumber, UserId } from "../../domain/identifiers.js";
import { Instant } from "../../domain/reservation-date-time.js";
import { equipment } from "./schema.js";

export const restoreEquipment = (row: typeof equipment.$inferSelect): Equipment => {
  const managementNumber = new ManagementNumber(row.managementNumber);
  if (row.version === 0n) return Equipment.restore({ managementNumber, status: row.status });
  if (row.lastPerformedBy === null || row.lastOccurredAtNs === null)
    throw new Error("Incomplete equipment snapshot");
  const change = {
    managementNumber,
    version: row.version,
    performedBy: new UserId(row.lastPerformedBy),
    occurredAt: Instant.from(
      Temporal.Instant.fromEpochNanoseconds(row.lastOccurredAtNs).toString(),
    ),
  };
  if (row.status === "suspended") {
    if (row.suspensionReason === null) throw new Error("Missing suspension reason");
    return Equipment.restore({
      managementNumber,
      status: row.status,
      lastAvailabilityChange: { ...change, kind: "suspended", reason: row.suspensionReason },
    });
  }
  return Equipment.restore({
    managementNumber,
    status: row.status,
    lastAvailabilityChange: { ...change, kind: "resumed" },
  });
};

export class PostgresEquipmentRepository implements EquipmentRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async findByManagementNumber(number: ManagementNumber): Promise<Equipment | undefined> {
    const [row] = await this.db
      .select()
      .from(equipment)
      .where(eq(equipment.managementNumber, number.value));
    return row ? restoreEquipment(row) : undefined;
  }
}
