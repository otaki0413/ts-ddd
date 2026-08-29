import { type Instant, ReservationDateTime } from "./reservation-date-time.js";

export type ReservationPeriodCreationResult =
  | { ok: true; period: ReservationPeriod }
  | { ok: false; reason: "invalid-reservation-period" };

export class ReservationPeriod {
  private constructor(
    readonly startsAt: ReservationDateTime,
    readonly endsAt: ReservationDateTime,
  ) {}

  static create(startsAt: string, endsAt: string): ReservationPeriodCreationResult {
    const parsedStartsAt = ReservationDateTime.parse(startsAt);
    const parsedEndsAt = ReservationDateTime.parse(endsAt);

    if (!parsedStartsAt || !parsedEndsAt || !parsedStartsAt.isBefore(parsedEndsAt)) {
      return { ok: false, reason: "invalid-reservation-period" };
    }

    return {
      ok: true,
      period: new ReservationPeriod(parsedStartsAt, parsedEndsAt),
    };
  }

  overlaps(other: ReservationPeriod): boolean {
    return this.startsAt.isBefore(other.endsAt) && other.startsAt.isBefore(this.endsAt);
  }

  startsBefore(instant: Instant): boolean {
    return this.startsAt.isBeforeInstant(instant);
  }

  hasEndedBy(instant: Instant): boolean {
    return this.endsAt.isAtOrBeforeInstant(instant);
  }
}
