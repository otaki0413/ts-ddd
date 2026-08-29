import { type ManagementNumber, type ReservationId, type UserId } from "./identifiers.js";
import { type Instant } from "./reservation-date-time.js";
import { type ReservationPeriod } from "./reservation-period.js";

export interface ReservationCancellation {
  cancelledBy: UserId;
  cancelledAt: Instant;
}

export interface CancelReservationRequest {
  cancelledBy: UserId;
  isAdministrator: boolean;
  now: Instant;
}

export type ReservationCancellationResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; reason: "canceller-not-permitted" | "already-cancelled" };

interface ReservationProperties {
  id: ReservationId;
  userId: UserId;
  managementNumber: ManagementNumber;
  period: ReservationPeriod;
  cancellation?: ReservationCancellation;
}

export class Reservation {
  readonly id: ReservationId;
  readonly userId: UserId;
  readonly managementNumber: ManagementNumber;
  readonly period: ReservationPeriod;
  readonly cancellation: ReservationCancellation | undefined;

  constructor(properties: ReservationProperties) {
    this.id = properties.id;
    this.userId = properties.userId;
    this.managementNumber = properties.managementNumber;
    this.period = properties.period;
    this.cancellation = properties.cancellation;
  }

  get isCancelled(): boolean {
    return this.cancellation !== undefined;
  }

  cancel(request: CancelReservationRequest): ReservationCancellationResult {
    if (!request.isAdministrator && !request.cancelledBy.equals(this.userId)) {
      return { ok: false, reason: "canceller-not-permitted" };
    }

    if (this.isCancelled) {
      return { ok: false, reason: "already-cancelled" };
    }

    // 予約失効は「返却予定日時までに貸出が生じなかった」ことが条件だが、集約は
    // 貸出を参照できない。失効と貸出済み(延滞)の区別は取消の最終確定に委ねる。
    return {
      ok: true,
      reservation: new Reservation({
        id: this.id,
        userId: this.userId,
        managementNumber: this.managementNumber,
        period: this.period,
        cancellation: { cancelledBy: request.cancelledBy, cancelledAt: request.now },
      }),
    };
  }

  blocksNewReservation(requestedPeriod: ReservationPeriod, now: Instant): boolean {
    return (
      !this.isCancelled && !this.period.hasEndedBy(now) && this.period.overlaps(requestedPeriod)
    );
  }
}
