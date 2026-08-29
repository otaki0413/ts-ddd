import { type Instant } from "../domain/reservation-date-time.js";

export interface Clock {
  now(): Instant;
}
