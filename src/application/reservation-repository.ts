import { type ReservationId } from "../domain/identifiers.js";
import { type Reservation } from "../domain/reservation.js";

export interface ReservationRepository {
  findById(reservationId: ReservationId): Promise<Reservation | undefined>;
}
