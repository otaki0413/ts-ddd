import { describe, expect, it } from "vitest";

import { Equipment } from "./equipment";
import { ManagementNumber, ReservationId, UserId } from "./identifiers";
import { Loan } from "./loan";
import { evaluateLoanAvailability } from "./loan-availability-policy";
import { Reservation } from "./reservation";
import { Instant } from "./reservation-date-time";
import { ReservationPeriod } from "./reservation-period";

const managementNumber = new ManagementNumber("EQ-001");
const reservationId = new ReservationId("reservation-1");

const createPeriod = (startsAt: string, endsAt: string): ReservationPeriod => {
  const result = ReservationPeriod.create(startsAt, endsAt);

  if (!result.ok) {
    throw new Error("Expected a valid reservation period");
  }

  return result.period;
};

const createReservation = (): Reservation =>
  new Reservation({
    id: reservationId,
    userId: new UserId("user-1"),
    managementNumber,
    period: createPeriod("2026-09-01T10:00", "2026-09-01T11:00"),
  });

describe("evaluateLoanAvailability", () => {
  it("allows a loan during the reservation period for available equipment with no unreturned loan", () => {
    const result = evaluateLoanAvailability({
      reservation: createReservation(),
      equipment: Equipment.available(managementNumber),
      unreturnedLoan: undefined,
      // 2026-09-01T10:00 Asia/Tokyo: exactly the planned start.
      now: Instant.from("2026-09-01T01:00:00Z"),
    });

    expect(result).toEqual({ available: true });
  });

  it("rejects a cancelled reservation", () => {
    const cancelled = createReservation().cancel({
      cancelledBy: new UserId("user-1"),
      isAdministrator: false,
      now: Instant.from("2026-09-01T00:00:00Z"),
    });

    if (!cancelled.ok) {
      throw new Error("Expected the cancellation to succeed");
    }

    const result = evaluateLoanAvailability({
      reservation: cancelled.reservation,
      equipment: Equipment.available(managementNumber),
      unreturnedLoan: undefined,
      now: Instant.from("2026-09-01T01:00:00Z"),
    });

    expect(result).toEqual({ available: false, reason: "already-cancelled" });
  });

  it("rejects an expired reservation at the planned return time", () => {
    const result = evaluateLoanAvailability({
      reservation: createReservation(),
      equipment: Equipment.available(managementNumber),
      unreturnedLoan: undefined,
      // 2026-09-01T11:00 Asia/Tokyo: exactly the planned return time.
      now: Instant.from("2026-09-01T02:00:00Z"),
    });

    expect(result).toEqual({ available: false, reason: "reservation-expired" });
  });

  it("rejects a loan before the planned start", () => {
    const result = evaluateLoanAvailability({
      reservation: createReservation(),
      equipment: Equipment.available(managementNumber),
      unreturnedLoan: undefined,
      // 2026-09-01T09:59:59.999 Asia/Tokyo: still before the planned start.
      now: Instant.from("2026-09-01T00:59:59.999Z"),
    });

    expect(result).toEqual({ available: false, reason: "before-planned-start" });
  });

  it("rejects a suspended equipment", () => {
    const suspended = Equipment.available(managementNumber).suspend({
      expectedVersion: 0n,
      performedBy: new UserId("admin-1"),
      isAdministrator: true,
      reason: "点検",
      now: Instant.from("2026-09-01T00:00:00Z"),
    });
    if (!suspended.ok) {
      throw new Error("Expected the suspension to succeed");
    }
    const result = evaluateLoanAvailability({
      reservation: createReservation(),
      equipment: suspended.equipment,
      unreturnedLoan: undefined,
      now: Instant.from("2026-09-01T01:00:00Z"),
    });

    expect(result).toEqual({ available: false, reason: "equipment-is-suspended" });
  });

  it("rejects a loan when another reservation's equipment has not been returned", () => {
    const unreturnedLoan = new Loan({
      reservationId: new ReservationId("reservation-other"),
      borrower: new UserId("user-2"),
      loanedAt: Instant.from("2026-09-01T00:00:00Z"),
      processedBy: new UserId("admin-1"),
    });

    const result = evaluateLoanAvailability({
      reservation: createReservation(),
      equipment: Equipment.available(managementNumber),
      unreturnedLoan,
      now: Instant.from("2026-09-01T01:00:00Z"),
    });

    expect(result).toEqual({ available: false, reason: "equipment-not-returned" });
  });

  it("rejects a reservation that already has an unreturned loan", () => {
    const unreturnedLoan = new Loan({
      reservationId,
      borrower: new UserId("user-1"),
      loanedAt: Instant.from("2026-09-01T01:00:00Z"),
      processedBy: new UserId("admin-1"),
    });

    const result = evaluateLoanAvailability({
      reservation: createReservation(),
      equipment: Equipment.available(managementNumber),
      unreturnedLoan,
      now: Instant.from("2026-09-01T01:30:00Z"),
    });

    expect(result).toEqual({ available: false, reason: "already-loaned" });
  });

  it("rejects an overdue unreturned loan as already-loaned, not expired", () => {
    const unreturnedLoan = new Loan({
      reservationId,
      borrower: new UserId("user-1"),
      loanedAt: Instant.from("2026-09-01T01:00:00Z"),
      processedBy: new UserId("admin-1"),
    });

    const result = evaluateLoanAvailability({
      reservation: createReservation(),
      equipment: Equipment.available(managementNumber),
      unreturnedLoan,
      // 2026-09-01T11:00 Asia/Tokyo: planned return has passed, but a loan already exists.
      now: Instant.from("2026-09-01T02:00:00Z"),
    });

    expect(result).toEqual({ available: false, reason: "already-loaned" });
  });
});
