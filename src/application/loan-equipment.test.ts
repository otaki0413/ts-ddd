import { describe, expect, it, vi } from "vitest";

import { Equipment } from "../domain/equipment.js";
import { ManagementNumber, ReservationId, UserId } from "../domain/identifiers.js";
import { Loan } from "../domain/loan.js";
import { Reservation } from "../domain/reservation.js";
import { Instant } from "../domain/reservation-date-time.js";
import { ReservationPeriod } from "../domain/reservation-period.js";
import { type LoanCommitResult, LoanEquipment } from "./loan-equipment.js";

const managementNumber = new ManagementNumber("EQ-001");

const createPeriod = (startsAt: string, endsAt: string): ReservationPeriod => {
  const result = ReservationPeriod.create(startsAt, endsAt);

  if (!result.ok) {
    throw new Error("Expected a valid reservation period");
  }

  return result.period;
};

const existingReservation = new Reservation({
  id: new ReservationId("reservation-1"),
  userId: new UserId("user-1"),
  managementNumber,
  period: createPeriod("2026-09-01T10:00", "2026-09-01T11:00"),
});

interface SetupOptions {
  reservation?: Reservation | null;
  equipment?: Equipment;
  unreturnedLoan?: Loan;
  commitResult?: LoanCommitResult;
  now?: Instant;
}

const setup = (options: SetupOptions = {}) => {
  const reservation = options.reservation === undefined ? existingReservation : options.reservation;
  const equipment = options.equipment ?? Equipment.available(managementNumber);
  const commitResult = options.commitResult ?? "loaned";
  // 2026-09-01T10:00:00.123 Asia/Tokyo: during the period, not on a minute boundary.
  const now = options.now ?? Instant.from("2026-09-01T01:00:00.123Z");

  const findById = vi.fn().mockResolvedValue(reservation ?? undefined);
  const findEquipmentByManagementNumber = vi.fn().mockResolvedValue(equipment);
  const findUnreturnedByManagementNumber = vi.fn().mockResolvedValue(options.unreturnedLoan);
  const tryCommit = vi.fn().mockResolvedValue(commitResult);

  const service = new LoanEquipment({
    reservationRepository: { findById },
    equipmentRepository: { findByManagementNumber: findEquipmentByManagementNumber },
    unreturnedLoanQuery: { findByManagementNumber: findUnreturnedByManagementNumber },
    loanCommitter: { tryCommit },
    clock: { now: () => now },
  });

  return { service, now };
};

const validCommand = {
  reservationId: "reservation-1",
  processedBy: "admin-1",
  isAdministrator: true,
  recipientId: "user-1",
};

describe("LoanEquipment", () => {
  it("creates and commits a loan with the borrower, loaned time, and processing administrator", async () => {
    const { service, now } = setup();

    const result = await service.execute(validCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.loan.reservationId.value).toBe("reservation-1");
    expect(result.loan.borrower.value).toBe("user-1");
    expect(result.loan.loanedAt).toBe(now);
    expect(result.loan.processedBy.value).toBe("admin-1");
  });

  it("rejects an unknown reservation", async () => {
    const { service } = setup({ reservation: null });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason: "reservation-not-found" });
  });

  it("rejects an executor who is not an administrator", async () => {
    const { service } = setup();

    const result = await service.execute({
      ...validCommand,
      processedBy: "user-1",
      isAdministrator: false,
    });

    expect(result).toEqual({ ok: false, reason: "executor-is-not-administrator" });
  });

  it("rejects a recipient who is not the reserving user", async () => {
    const { service } = setup();

    const result = await service.execute({
      ...validCommand,
      recipientId: "user-2",
    });

    expect(result).toEqual({ ok: false, reason: "recipient-is-not-reserver" });
  });

  it("rejects a cancelled reservation", async () => {
    const cancelled = existingReservation.cancel({
      cancelledBy: new UserId("user-1"),
      isAdministrator: false,
      now: Instant.from("2026-09-01T00:00:00Z"),
    });

    if (!cancelled.ok) {
      throw new Error("Expected the cancellation to succeed");
    }

    const { service } = setup({ reservation: cancelled.reservation });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason: "already-cancelled" });
  });

  it("rejects an expired reservation", async () => {
    const { service } = setup({
      // 2026-09-01T11:00 Asia/Tokyo: exactly the planned return time.
      now: Instant.from("2026-09-01T02:00:00Z"),
    });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason: "reservation-expired" });
  });

  it("rejects a loan before the planned start", async () => {
    const { service } = setup({
      // 2026-09-01T09:59 Asia/Tokyo: before the planned start.
      now: Instant.from("2026-09-01T00:59:00Z"),
    });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason: "before-planned-start" });
  });

  it("rejects a suspended equipment", async () => {
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
    const { service } = setup({ equipment: suspended.equipment });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason: "equipment-is-suspended" });
  });

  it("rejects a loan when the equipment has not been returned", async () => {
    const unreturnedLoan = new Loan({
      reservationId: new ReservationId("reservation-other"),
      borrower: new UserId("user-2"),
      loanedAt: Instant.from("2026-09-01T00:00:00Z"),
      processedBy: new UserId("admin-1"),
    });
    const { service } = setup({ unreturnedLoan });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason: "equipment-not-returned" });
  });

  it("rejects a reservation that is already loaned", async () => {
    const unreturnedLoan = new Loan({
      reservationId: existingReservation.id,
      borrower: new UserId("user-1"),
      loanedAt: Instant.from("2026-09-01T01:00:00Z"),
      processedBy: new UserId("admin-1"),
    });
    const { service } = setup({ unreturnedLoan });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason: "already-loaned" });
  });

  it("rejects an overdue loaned reservation as already-loaned, not expired", async () => {
    const unreturnedLoan = new Loan({
      reservationId: existingReservation.id,
      borrower: new UserId("user-1"),
      loanedAt: Instant.from("2026-09-01T01:00:00Z"),
      processedBy: new UserId("admin-1"),
    });
    const { service } = setup({
      unreturnedLoan,
      // 2026-09-01T11:00 Asia/Tokyo: planned return has passed.
      now: Instant.from("2026-09-01T02:00:00Z"),
    });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason: "already-loaned" });
  });

  it.each([
    ["already-cancelled", "already-cancelled"],
    ["already-loaned", "already-loaned"],
    ["equipment-suspended", "equipment-is-suspended"],
    ["equipment-not-returned", "equipment-not-returned"],
  ] as const)("maps a %s commit failure to the use case result", async (commitResult, reason) => {
    const { service } = setup({ commitResult });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason });
  });
});
