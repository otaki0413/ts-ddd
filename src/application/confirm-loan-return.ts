import { ManagementNumber, ReservationId, UserId } from "../domain/identifiers.js";
import { type Loan } from "../domain/loan.js";
import { type Clock } from "./clock.js";
import { type EquipmentRepository } from "./reserve-equipment.js";

export interface LoanRepository {
  findByReservationId(reservationId: ReservationId): Promise<Loan | undefined>;
}

export type LoanReturnConfirmResult =
  | "confirmed"
  | "already-returned"
  | "equipment-not-on-loan"
  | "return-target-changed";

export interface LoanReturnConfirmer {
  tryConfirm(
    managementNumber: ManagementNumber,
    returnedLoan: Loan,
  ): Promise<LoanReturnConfirmResult>;
}

export interface ConfirmLoanReturnCommand {
  managementNumber: string;
  expectedReservationId: string;
  confirmedBy: string;
  isAdministrator: boolean;
}

export type ConfirmLoanReturnFailureReason =
  | "equipment-not-found"
  | "return-target-changed"
  | "executor-is-not-administrator"
  | "already-returned"
  | "return-time-before-loan"
  | "equipment-not-on-loan";

export type ConfirmLoanReturnResult =
  | { ok: true; loan: Loan }
  | { ok: false; reason: ConfirmLoanReturnFailureReason };

interface ConfirmLoanReturnDependencies {
  equipmentRepository: EquipmentRepository;
  loanRepository: LoanRepository;
  loanReturnConfirmer: LoanReturnConfirmer;
  clock: Clock;
}

export class ConfirmLoanReturn {
  readonly #dependencies: ConfirmLoanReturnDependencies;

  constructor(dependencies: ConfirmLoanReturnDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(command: ConfirmLoanReturnCommand): Promise<ConfirmLoanReturnResult> {
    const managementNumber = new ManagementNumber(command.managementNumber);
    const equipment =
      await this.#dependencies.equipmentRepository.findByManagementNumber(managementNumber);

    if (!equipment) {
      return { ok: false, reason: "equipment-not-found" };
    }

    const loan = await this.#dependencies.loanRepository.findByReservationId(
      new ReservationId(command.expectedReservationId),
    );

    if (!loan) {
      return { ok: false, reason: "return-target-changed" };
    }

    const confirmation = loan.confirmReturn({
      confirmedBy: new UserId(command.confirmedBy),
      isAdministrator: command.isAdministrator,
      returnedAt: this.#dependencies.clock.now(),
    });

    if (!confirmation.ok) {
      return confirmation;
    }

    const confirmResult = await this.#dependencies.loanReturnConfirmer.tryConfirm(
      managementNumber,
      confirmation.loan,
    );

    if (confirmResult !== "confirmed") {
      return { ok: false, reason: confirmResult };
    }

    return { ok: true, loan: confirmation.loan };
  }
}
