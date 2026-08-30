import { type Equipment } from "./equipment";
import { type Reservation } from "./reservation";
import { type Instant } from "./reservation-date-time";
import { type ReservationPeriod } from "./reservation-period";

export type ReservationAvailabilityResult =
  | { available: true }
  | {
      available: false;
      reason: "equipment-is-suspended" | "reservation-conflict";
    };

interface ReservationAvailabilityInput {
  equipment: Equipment;
  existingReservations: readonly Reservation[];
  requestedPeriod: ReservationPeriod;
  now: Instant;
}

export const evaluateReservationAvailability = (
  input: ReservationAvailabilityInput,
): ReservationAvailabilityResult => {
  if (input.equipment.isSuspended) {
    return { available: false, reason: "equipment-is-suspended" };
  }

  const hasConflict = input.existingReservations.some((reservation) =>
    reservation.blocksNewReservation(input.requestedPeriod, input.now),
  );

  if (hasConflict) {
    return { available: false, reason: "reservation-conflict" };
  }

  return { available: true };
};
