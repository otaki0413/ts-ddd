import { Temporal } from "@js-temporal/polyfill";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { type NodePgDatabase } from "drizzle-orm/node-postgres";

import { type ReservationRepository } from "../../application/cancel-reservation.js";
import {
  type ReservationCommitResult,
  type ReservationCommitter,
  type ReservationQuery,
} from "../../application/reserve-equipment.js";
import { ManagementNumber, ReservationId, UserId } from "../../domain/identifiers.js";
import { Reservation } from "../../domain/reservation.js";
import { Instant, type ReservationDateTime } from "../../domain/reservation-date-time.js";
import { evaluateReservationAvailability } from "../../domain/reservation-availability-policy.js";
import { ReservationPeriod } from "../../domain/reservation-period.js";
import { equipment, reservations } from "./schema.js";
import { restoreEquipment } from "./equipment.js";

const epochMilliseconds = (value: ReservationDateTime): bigint =>
  BigInt(
    Temporal.PlainDateTime.from(value.toString()).toZonedDateTime("Asia/Tokyo").epochMilliseconds,
  );

const tokyoMinute = (value: bigint): string =>
  Temporal.Instant.fromEpochNanoseconds(value * 1_000_000n)
    .toZonedDateTimeISO("Asia/Tokyo")
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });

const restoreReservation = (row: typeof reservations.$inferSelect): Reservation => {
  const result = ReservationPeriod.create(tokyoMinute(row.startsAt), tokyoMinute(row.endsAt));
  if (!result.ok) throw new Error("Invalid stored reservation period");
  return new Reservation({
    id: new ReservationId(row.id),
    userId: new UserId(row.userId),
    managementNumber: new ManagementNumber(row.managementNumber),
    period: result.period,
  });
};

export class PostgresReservations
  implements ReservationQuery, ReservationRepository, ReservationCommitter
{
  constructor(private readonly db: NodePgDatabase) {}

  async findById(id: ReservationId): Promise<Reservation | undefined> {
    const [row] = await this.db.select().from(reservations).where(eq(reservations.id, id.value));
    return row ? restoreReservation(row) : undefined;
  }

  async findOverlapping(
    managementNumber: ManagementNumber,
    period: ReservationPeriod,
  ): Promise<readonly Reservation[]> {
    const rows = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.managementNumber, managementNumber.value),
          lt(reservations.startsAt, epochMilliseconds(period.endsAt)),
          gt(reservations.endsAt, epochMilliseconds(period.startsAt)),
        ),
      );
    return rows.map(restoreReservation);
  }

  async tryCommit(reservation: Reservation): Promise<ReservationCommitResult> {
    return this.db.transaction(
      async (tx) => {
        const [row] = await tx
          .select()
          .from(equipment)
          .where(eq(equipment.managementNumber, reservation.managementNumber.value))
          .for("update");
        if (!row) throw new Error("Equipment disappeared before reservation commit");

        // READ COMMITTED takes a fresh snapshot for this statement after the lock wait.
        const existingReservations = await new PostgresReservations(tx).findOverlapping(
          reservation.managementNumber,
          reservation.period,
        );
        // PostgreSQL has microsecond precision: the nanosecond value is already integral.
        const {
          rows: [time],
        } = await tx.execute<{ nanoseconds: string }>(sql`
        SELECT trunc(extract(epoch from clock_timestamp()) * 1000000000)::text AS nanoseconds
      `);
        if (!time) throw new Error("Database clock unavailable");
        const now = Instant.from(
          Temporal.Instant.fromEpochNanoseconds(BigInt(time.nanoseconds)).toString(),
        );
        if (reservation.period.startsBefore(now)) return "start-time-is-in-the-past";
        const availability = evaluateReservationAvailability({
          equipment: restoreEquipment(row),
          existingReservations,
          requestedPeriod: reservation.period,
          now,
        });
        if (!availability.available) return availability.reason;
        const startsAt = epochMilliseconds(reservation.period.startsAt);
        // Do not round the database clock to the reservation's millisecond storage unit.
        const saved = await tx
          .insert(reservations)
          .select(sql`
        SELECT ${reservation.id.value}, ${reservation.userId.value},
          ${reservation.managementNumber.value}, ${startsAt}::bigint,
          ${epochMilliseconds(reservation.period.endsAt)}::bigint
        WHERE ${startsAt}::numeric >= extract(epoch from clock_timestamp()) * 1000
      `)
          .returning({ id: reservations.id });
        return saved.length === 1 ? "committed" : "start-time-is-in-the-past";
      },
      { isolationLevel: "read committed" },
    );
  }
}
