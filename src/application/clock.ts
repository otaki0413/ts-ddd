import { type Instant } from "../domain/reservation-date-time";

export interface Clock {
  now(): Instant;
}
