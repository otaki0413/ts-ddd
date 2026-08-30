import { type ReservationId } from "../domain/identifiers";
import { type Reservation } from "../domain/reservation";

export interface ReservationRepository {
  findById(reservationId: ReservationId): Promise<Reservation | undefined>;
}
