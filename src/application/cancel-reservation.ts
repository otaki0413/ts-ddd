import { ReservationId, UserId } from "../domain/identifiers";
import { type Reservation } from "../domain/reservation";
import { type Clock } from "./clock";
import { type ReservationRepository } from "./reservation-repository";

export type ReservationCancelCommitResult =
  | "cancelled"
  | "already-loaned"
  | "already-cancelled"
  | "reservation-expired";

export interface ReservationCanceller {
  tryCancel(reservation: Reservation): Promise<ReservationCancelCommitResult>;
}

export interface CancelReservationCommand {
  reservationId: string;
  cancelledBy: string;
  isAdministrator: boolean;
}

export type CancelReservationFailureReason =
  | "reservation-not-found"
  | "canceller-not-permitted"
  | "already-cancelled"
  | "reservation-expired"
  | "already-loaned";

export type CancelReservationResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; reason: CancelReservationFailureReason };

interface CancelReservationDependencies {
  reservationRepository: ReservationRepository;
  reservationCanceller: ReservationCanceller;
  clock: Clock;
}

export class CancelReservation {
  readonly #dependencies: CancelReservationDependencies;

  constructor(dependencies: CancelReservationDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(command: CancelReservationCommand): Promise<CancelReservationResult> {
    const reservation = await this.#dependencies.reservationRepository.findById(
      new ReservationId(command.reservationId),
    );

    if (!reservation) {
      return { ok: false, reason: "reservation-not-found" };
    }

    const cancellationResult = reservation.cancel({
      cancelledBy: new UserId(command.cancelledBy),
      isAdministrator: command.isAdministrator,
      now: this.#dependencies.clock.now(),
    });

    if (!cancellationResult.ok) {
      return cancellationResult;
    }

    const commitResult = await this.#dependencies.reservationCanceller.tryCancel(
      cancellationResult.reservation,
    );

    if (commitResult !== "cancelled") {
      return { ok: false, reason: commitResult };
    }

    return { ok: true, reservation: cancellationResult.reservation };
  }
}
