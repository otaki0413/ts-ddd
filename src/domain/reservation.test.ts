import { describe, expect, it } from "vitest";

import { ManagementNumber, ReservationId, UserId } from "./identifiers";
import { Reservation } from "./reservation";
import { Instant } from "./reservation-date-time";
import { ReservationPeriod } from "./reservation-period";

const createPeriod = (startsAt: string, endsAt: string): ReservationPeriod => {
  const result = ReservationPeriod.create(startsAt, endsAt);

  if (!result.ok) {
    throw new Error("Expected a valid reservation period");
  }

  return result.period;
};

const createReservation = (): Reservation =>
  new Reservation({
    id: new ReservationId("reservation-1"),
    userId: new UserId("user-1"),
    managementNumber: new ManagementNumber("EQ-001"),
    period: createPeriod("2026-09-01T10:00", "2026-09-01T11:00"),
  });

// 2026-09-01T09:00 Asia/Tokyo: before the planned start.
const beforeStart = Instant.from("2026-09-01T00:00:00Z");

describe("Reservation.cancel", () => {
  it("lets the reserving user cancel and records the canceller and time", () => {
    const reservation = createReservation();

    const result = reservation.cancel({
      cancelledBy: new UserId("user-1"),
      isAdministrator: false,
      now: beforeStart,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.reservation.isCancelled).toBe(true);
    expect(result.reservation.cancellation?.cancelledBy.value).toBe("user-1");
    expect(result.reservation.cancellation?.cancelledAt).toBe(beforeStart);
  });

  it("lets an administrator cancel another user's reservation", () => {
    const reservation = createReservation();

    const result = reservation.cancel({
      cancelledBy: new UserId("admin-1"),
      isAdministrator: true,
      now: beforeStart,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.reservation.cancellation?.cancelledBy.value).toBe("admin-1");
  });

  it("rejects a canceller who is neither the reserving user nor an administrator", () => {
    const reservation = createReservation();

    const result = reservation.cancel({
      cancelledBy: new UserId("user-2"),
      isAdministrator: false,
      now: beforeStart,
    });

    expect(result).toEqual({ ok: false, reason: "canceller-not-permitted" });
  });

  it("rejects cancelling an already cancelled reservation", () => {
    const reservation = createReservation();
    const cancelled = reservation.cancel({
      cancelledBy: new UserId("user-1"),
      isAdministrator: false,
      now: beforeStart,
    });

    if (!cancelled.ok) {
      throw new Error("Expected the first cancellation to succeed");
    }

    const result = cancelled.reservation.cancel({
      cancelledBy: new UserId("user-1"),
      isAdministrator: false,
      now: beforeStart,
    });

    expect(result).toEqual({ ok: false, reason: "already-cancelled" });
  });

  it("leaves the expired-or-loaned distinction to the cancellation commit after the planned return time", () => {
    // The aggregate cannot see loans, so it must not classify a reached return
    // time as expiry by itself: the reservation may be loaned and overdue.
    const reservation = createReservation();
    // 2026-09-01T11:00 Asia/Tokyo: exactly the planned return time.
    const atPlannedReturn = Instant.from("2026-09-01T02:00:00Z");

    const result = reservation.cancel({
      cancelledBy: new UserId("user-1"),
      isAdministrator: false,
      now: atPlannedReturn,
    });

    expect(result.ok).toBe(true);
  });

  it("allows cancelling after the planned start as long as the reservation has not expired", () => {
    const reservation = createReservation();
    // 2026-09-01T10:30 Asia/Tokyo: past the planned start, before the planned return.
    const duringPeriod = Instant.from("2026-09-01T01:30:00Z");

    const result = reservation.cancel({
      cancelledBy: new UserId("user-1"),
      isAdministrator: false,
      now: duringPeriod,
    });

    expect(result.ok).toBe(true);
  });
});

describe("Reservation.blocksNewReservation", () => {
  it("does not block a new reservation once cancelled", () => {
    const reservation = createReservation();
    const cancelled = reservation.cancel({
      cancelledBy: new UserId("user-1"),
      isAdministrator: false,
      now: beforeStart,
    });

    if (!cancelled.ok) {
      throw new Error("Expected the cancellation to succeed");
    }

    const samePeriod = createPeriod("2026-09-01T10:00", "2026-09-01T11:00");

    expect(reservation.blocksNewReservation(samePeriod, beforeStart)).toBe(true);
    expect(cancelled.reservation.blocksNewReservation(samePeriod, beforeStart)).toBe(false);
  });
});
