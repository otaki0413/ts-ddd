import { type ManagementNumber, ReservationId, UserId } from "../domain/identifiers.js";
import { Loan } from "../domain/loan.js";
import { evaluateLoanAvailability } from "../domain/loan-availability-policy.js";
import { type Clock } from "./clock.js";
import { type ReservationRepository } from "./reservation-repository.js";
import { type EquipmentRepository } from "./reserve-equipment.js";

export interface UnreturnedLoanQuery {
  findByManagementNumber(managementNumber: ManagementNumber): Promise<Loan | undefined>;
}

export type LoanCommitResult =
  | "loaned"
  | "already-cancelled"
  | "already-loaned"
  | "equipment-suspended"
  | "equipment-not-returned";

export interface LoanCommitter {
  tryCommit(loan: Loan): Promise<LoanCommitResult>;
}

export interface LoanEquipmentCommand {
  reservationId: string;
  processedBy: string;
  isAdministrator: boolean;
  recipientId: string;
}

export type LoanEquipmentFailureReason =
  | "reservation-not-found"
  | "executor-is-not-administrator"
  | "recipient-is-not-reserver"
  | "already-cancelled"
  | "reservation-expired"
  | "before-planned-start"
  | "equipment-is-suspended"
  | "equipment-not-returned"
  | "already-loaned";

export type LoanEquipmentResult =
  | { ok: true; loan: Loan }
  | { ok: false; reason: LoanEquipmentFailureReason };

interface LoanEquipmentDependencies {
  reservationRepository: ReservationRepository;
  equipmentRepository: EquipmentRepository;
  unreturnedLoanQuery: UnreturnedLoanQuery;
  loanCommitter: LoanCommitter;
  clock: Clock;
}

const commitFailureReason = (
  commitResult: Exclude<LoanCommitResult, "loaned">,
): LoanEquipmentFailureReason => {
  if (commitResult === "equipment-suspended") {
    return "equipment-is-suspended";
  }

  return commitResult;
};

export class LoanEquipment {
  readonly #dependencies: LoanEquipmentDependencies;

  constructor(dependencies: LoanEquipmentDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(command: LoanEquipmentCommand): Promise<LoanEquipmentResult> {
    const reservation = await this.#dependencies.reservationRepository.findById(
      new ReservationId(command.reservationId),
    );

    if (!reservation) {
      return { ok: false, reason: "reservation-not-found" };
    }

    if (!command.isAdministrator) {
      return { ok: false, reason: "executor-is-not-administrator" };
    }

    const recipientId = new UserId(command.recipientId);
    if (!reservation.userId.equals(recipientId)) {
      return { ok: false, reason: "recipient-is-not-reserver" };
    }

    const equipment = await this.#dependencies.equipmentRepository.findByManagementNumber(
      reservation.managementNumber,
    );

    if (!equipment) {
      throw new Error(
        `Equipment ${reservation.managementNumber.value} must exist for a reservation`,
      );
    }

    const unreturnedLoan = await this.#dependencies.unreturnedLoanQuery.findByManagementNumber(
      reservation.managementNumber,
    );
    const now = this.#dependencies.clock.now();
    const availability = evaluateLoanAvailability({
      reservation,
      equipment,
      unreturnedLoan,
      now,
    });

    if (!availability.available) {
      return { ok: false, reason: availability.reason };
    }

    const loan = new Loan({
      reservationId: reservation.id,
      borrower: reservation.userId,
      loanedAt: now,
      processedBy: new UserId(command.processedBy),
    });
    const commitResult = await this.#dependencies.loanCommitter.tryCommit(loan);

    if (commitResult !== "loaned") {
      return { ok: false, reason: commitFailureReason(commitResult) };
    }

    return { ok: true, loan };
  }
}
