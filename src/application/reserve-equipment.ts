import { type Equipment } from "../domain/equipment.js";
import { ManagementNumber, type ReservationId, UserId } from "../domain/identifiers.js";
import { Reservation } from "../domain/reservation.js";
import { evaluateReservationAvailability } from "../domain/reservation-availability-policy.js";
import { ReservationPeriod } from "../domain/reservation-period.js";
import { type Clock } from "./clock.js";

export interface EquipmentRepository {
  findByManagementNumber(managementNumber: ManagementNumber): Promise<Equipment | undefined>;
}

export interface ReservationQuery {
  findOverlapping(
    managementNumber: ManagementNumber,
    period: ReservationPeriod,
  ): Promise<readonly Reservation[]>;
}

export type ReservationCommitResult =
  | "committed"
  | "equipment-is-suspended"
  | "reservation-conflict"
  | "start-time-is-in-the-past";

export interface ReservationCommitter {
  tryCommit(reservation: Reservation): Promise<ReservationCommitResult>;
}

export interface ReservationIdGenerator {
  next(): ReservationId;
}

export interface ReserveEquipmentCommand {
  userId: string;
  managementNumber: string;
  startsAt: string;
  endsAt: string;
}

export type ReserveEquipmentFailureReason =
  | "invalid-reservation-period"
  | "start-time-is-in-the-past"
  | "equipment-not-found"
  | "equipment-is-suspended"
  | "reservation-conflict";

export type ReserveEquipmentResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; reason: ReserveEquipmentFailureReason };

interface ReserveEquipmentDependencies {
  equipmentRepository: EquipmentRepository;
  reservationQuery: ReservationQuery;
  reservationCommitter: ReservationCommitter;
  reservationIdGenerator: ReservationIdGenerator;
  clock: Clock;
}

export class ReserveEquipment {
  readonly #dependencies: ReserveEquipmentDependencies;

  constructor(dependencies: ReserveEquipmentDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(command: ReserveEquipmentCommand): Promise<ReserveEquipmentResult> {
    const periodResult = ReservationPeriod.create(command.startsAt, command.endsAt);

    if (!periodResult.ok) {
      return periodResult;
    }

    const now = this.#dependencies.clock.now();
    if (periodResult.period.startsBefore(now)) {
      return { ok: false, reason: "start-time-is-in-the-past" };
    }

    const managementNumber = new ManagementNumber(command.managementNumber);
    const equipment =
      await this.#dependencies.equipmentRepository.findByManagementNumber(managementNumber);

    if (!equipment) {
      return { ok: false, reason: "equipment-not-found" };
    }

    const existingReservations = await this.#dependencies.reservationQuery.findOverlapping(
      managementNumber,
      periodResult.period,
    );
    const availability = evaluateReservationAvailability({
      equipment,
      existingReservations,
      requestedPeriod: periodResult.period,
      now,
    });

    if (!availability.available) {
      return { ok: false, reason: availability.reason };
    }

    const reservation = new Reservation({
      id: this.#dependencies.reservationIdGenerator.next(),
      userId: new UserId(command.userId),
      managementNumber,
      period: periodResult.period,
    });
    const commitResult = await this.#dependencies.reservationCommitter.tryCommit(reservation);

    if (commitResult !== "committed") {
      return { ok: false, reason: commitResult };
    }

    return { ok: true, reservation };
  }
}
