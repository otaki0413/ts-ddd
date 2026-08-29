import { type ReservationId, type UserId } from "./identifiers.js";
import { type Instant } from "./reservation-date-time.js";

export interface LoanReturnConfirmation {
  readonly returnedAt: Instant;
  readonly confirmedBy: UserId;
}

export interface ConfirmReturnRequest {
  confirmedBy: UserId;
  isAdministrator: boolean;
  returnedAt: Instant;
}

export type ConfirmReturnResult =
  | { ok: true; loan: Loan }
  | {
      ok: false;
      reason: "executor-is-not-administrator" | "already-returned" | "return-time-before-loan";
    };

interface LoanProperties {
  reservationId: ReservationId;
  borrower: UserId;
  loanedAt: Instant;
  processedBy: UserId;
  returnConfirmation?: LoanReturnConfirmation;
}

export class Loan {
  readonly reservationId: ReservationId;
  readonly borrower: UserId;
  readonly loanedAt: Instant;
  readonly processedBy: UserId;
  readonly returnConfirmation: LoanReturnConfirmation | undefined;

  constructor(properties: LoanProperties) {
    this.reservationId = properties.reservationId;
    this.borrower = properties.borrower;
    this.loanedAt = properties.loanedAt;
    this.processedBy = properties.processedBy;
    this.returnConfirmation = properties.returnConfirmation;
  }

  confirmReturn(request: ConfirmReturnRequest): ConfirmReturnResult {
    if (!request.isAdministrator) {
      return { ok: false, reason: "executor-is-not-administrator" };
    }

    if (this.returnConfirmation !== undefined) {
      return { ok: false, reason: "already-returned" };
    }

    if (request.returnedAt.epochNanoseconds < this.loanedAt.epochNanoseconds) {
      return { ok: false, reason: "return-time-before-loan" };
    }

    return {
      ok: true,
      loan: new Loan({
        reservationId: this.reservationId,
        borrower: this.borrower,
        loanedAt: this.loanedAt,
        processedBy: this.processedBy,
        returnConfirmation: {
          returnedAt: request.returnedAt,
          confirmedBy: request.confirmedBy,
        },
      }),
    };
  }
}
