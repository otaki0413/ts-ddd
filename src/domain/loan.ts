import { type ReservationId, type UserId } from "./identifiers.js";
import { type Instant } from "./reservation-date-time.js";

interface LoanProperties {
  reservationId: ReservationId;
  borrower: UserId;
  loanedAt: Instant;
  processedBy: UserId;
}

export class Loan {
  readonly reservationId: ReservationId;
  readonly borrower: UserId;
  readonly loanedAt: Instant;
  readonly processedBy: UserId;

  constructor(properties: LoanProperties) {
    this.reservationId = properties.reservationId;
    this.borrower = properties.borrower;
    this.loanedAt = properties.loanedAt;
    this.processedBy = properties.processedBy;
  }
}
