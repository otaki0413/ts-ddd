import { type Equipment } from "./equipment.js";
import { type Loan } from "./loan.js";
import { type Reservation } from "./reservation.js";
import { type Instant } from "./reservation-date-time.js";

export type LoanAvailabilityResult =
  | { available: true }
  | {
      available: false;
      reason:
        | "already-cancelled"
        | "reservation-expired"
        | "before-planned-start"
        | "equipment-is-suspended"
        | "equipment-not-returned"
        | "already-loaned";
    };

interface LoanAvailabilityInput {
  reservation: Reservation;
  equipment: Equipment;
  unreturnedLoan: Loan | undefined;
  now: Instant;
}

export const evaluateLoanAvailability = (input: LoanAvailabilityInput): LoanAvailabilityResult => {
  if (input.reservation.isCancelled) {
    return { available: false, reason: "already-cancelled" };
  }

  if (input.unreturnedLoan?.reservationId.equals(input.reservation.id)) {
    // 予約失効は返却予定日時までに貸出が生じなかったことなので、この予約の貸出があるなら失効ではない。
    return { available: false, reason: "already-loaned" };
  }

  if (input.reservation.period.hasEndedBy(input.now)) {
    return { available: false, reason: "reservation-expired" };
  }

  if (!input.reservation.period.hasStartedBy(input.now)) {
    return { available: false, reason: "before-planned-start" };
  }

  if (input.equipment.isSuspended) {
    return { available: false, reason: "equipment-is-suspended" };
  }

  if (input.unreturnedLoan) {
    return { available: false, reason: "equipment-not-returned" };
  }

  return { available: true };
};
