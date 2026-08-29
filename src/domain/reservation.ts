import { type ManagementNumber, type ReservationId, type UserId } from "./identifiers.js";
import { type Instant } from "./reservation-date-time.js";
import { type ReservationPeriod } from "./reservation-period.js";

interface ReservationProperties {
  id: ReservationId;
  userId: UserId;
  managementNumber: ManagementNumber;
  period: ReservationPeriod;
}

export class Reservation {
  readonly id: ReservationId;
  readonly userId: UserId;
  readonly managementNumber: ManagementNumber;
  readonly period: ReservationPeriod;

  constructor(properties: ReservationProperties) {
    this.id = properties.id;
    this.userId = properties.userId;
    this.managementNumber = properties.managementNumber;
    this.period = properties.period;
  }

  blocksNewReservation(requestedPeriod: ReservationPeriod, now: Instant): boolean {
    return !this.period.hasEndedBy(now) && this.period.overlaps(requestedPeriod);
  }
}
