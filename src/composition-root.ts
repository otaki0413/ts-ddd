import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { type NodePgDatabase } from "drizzle-orm/node-postgres";
import { type ReservationRepository } from "./application/reservation-repository";
import { ReserveEquipment } from "./application/reserve-equipment";
import { ReservationId } from "./domain/identifiers";
import { Instant } from "./domain/reservation-date-time";
import { PostgresEquipmentRepository } from "./infrastructure/postgres/equipment";
import { PostgresReservations } from "./infrastructure/postgres/reservations";

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
