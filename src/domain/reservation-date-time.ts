import { Temporal } from "@js-temporal/polyfill";

const TIME_ZONE = "Asia/Tokyo";
const MINUTE_PRECISION_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export class Instant {
  readonly #value: Temporal.Instant;

  private constructor(value: Temporal.Instant) {
    this.#value = value;
  }

  static from(value: string): Instant {
    return new Instant(Temporal.Instant.from(value));
  }

  get epochNanoseconds(): bigint {
    return this.#value.epochNanoseconds;
  }
}

export class ReservationDateTime {
  readonly #value: Temporal.ZonedDateTime;

  private constructor(value: Temporal.ZonedDateTime) {
    this.#value = value;
  }

  static parse(value: string): ReservationDateTime | undefined {
    if (!MINUTE_PRECISION_DATE_TIME.test(value)) {
      return undefined;
    }

    try {
      const dateTime = Temporal.PlainDateTime.from(value, { overflow: "reject" });
      return new ReservationDateTime(dateTime.toZonedDateTime(TIME_ZONE));
    } catch {
      return undefined;
    }
  }

  isBefore(other: ReservationDateTime): boolean {
    return Temporal.ZonedDateTime.compare(this.#value, other.#value) < 0;
  }

  isBeforeInstant(instant: Instant): boolean {
    return this.#value.epochNanoseconds < instant.epochNanoseconds;
  }

  isAtOrBeforeInstant(instant: Instant): boolean {
    return this.#value.epochNanoseconds <= instant.epochNanoseconds;
  }

  toString(): string {
    return this.#value.toPlainDateTime().toString({ smallestUnit: "minute" });
  }
}
