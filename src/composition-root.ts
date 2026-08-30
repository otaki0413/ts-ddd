import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { type NodePgDatabase } from "drizzle-orm/node-postgres";
import { type ReservationRepository } from "./application/reservation-repository.js";
import { ReserveEquipment } from "./application/reserve-equipment.js";
import { ReservationId } from "./domain/identifiers.js";
import { Instant } from "./domain/reservation-date-time.js";
import { PostgresEquipmentRepository } from "./infrastructure/postgres/equipment.js";
import { PostgresReservations } from "./infrastructure/postgres/reservations.js";

export interface ReservationServices {
  reserveEquipment: ReserveEquipment;
  reservationRepository: ReservationRepository;
}

export const createReservationServices = (db: NodePgDatabase): ReservationServices => {
  const reservations = new PostgresReservations(db);
  return {
    reservationRepository: reservations,
    reserveEquipment: new ReserveEquipment({
      equipmentRepository: new PostgresEquipmentRepository(db),
      reservationQuery: reservations,
      reservationCommitter: reservations,
      reservationIdGenerator: { next: () => new ReservationId(randomUUID()) },
      clock: { now: () => Instant.from(Temporal.Now.instant().toString()) },
    }),
  };
};
