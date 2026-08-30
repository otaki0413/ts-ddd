import { describe, expect, it } from "vitest";

import { Equipment } from "../domain/equipment.js";
import { ManagementNumber, ReservationId, UserId } from "../domain/identifiers.js";
import { Loan } from "../domain/loan.js";
import { Instant } from "../domain/reservation-date-time.js";
import { ConfirmLoanReturn, type LoanReturnConfirmResult } from "./confirm-loan-return.js";

const managementNumber = new ManagementNumber("EQ-001");

const createLoan = (): Loan =>
  new Loan({
    reservationId: new ReservationId("reservation-1"),
    borrower: new UserId("user-1"),
    loanedAt: Instant.from("2026-09-01T01:00:00Z"),
    processedBy: new UserId("admin-1"),
  });

const createReturnedLoan = (): Loan => {
  const returned = createLoan().confirmReturn({
    confirmedBy: new UserId("admin-2"),
    isAdministrator: true,
    returnedAt: Instant.from("2026-09-01T02:00:00Z"),
  });

  if (!returned.ok) {
    throw new Error("Expected the loan to already be returned");
  }

  return returned.loan;
};

interface SetupOptions {
  equipment?: Equipment | null;
  loan?: Loan | null;
  now?: Instant;
  confirmResult?: LoanReturnConfirmResult;
}

const setup = (options: SetupOptions = {}) => {
  const loan = options.loan === undefined ? createLoan() : options.loan;
  const equipment =
    options.equipment === undefined ? Equipment.available(managementNumber) : options.equipment;
  // 2026-09-01T11:00:00.123 Asia/Tokyo: after the loaned time, not on a minute boundary.
  const now = options.now ?? Instant.from("2026-09-01T02:00:00.123Z");

  const service = new ConfirmLoanReturn({
    equipmentRepository: {
      findByManagementNumber: async () => equipment ?? undefined,
    },
    loanRepository: {
      findByReservationId: async (reservationId) =>
        loan?.reservationId.equals(reservationId) ? loan : undefined,
    },
    loanReturnConfirmer: {
      tryConfirm: async () => options.confirmResult ?? "confirmed",
    },
    clock: { now: () => now },
  });

  return { service, now };
};

const validCommand = {
  managementNumber: "EQ-001",
  expectedReservationId: "reservation-1",
  confirmedBy: "admin-2",
  isAdministrator: true,
};

describe("ConfirmLoanReturn", () => {
  it("confirms return and records the clock time and confirming administrator", async () => {
    const { service, now } = setup();

    const result = await service.execute(validCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.loan.reservationId.value).toBe("reservation-1");
    expect(result.loan.returnConfirmation?.returnedAt).toBe(now);
    expect(result.loan.returnConfirmation?.confirmedBy.value).toBe("admin-2");
  });

  it("rejects an unknown equipment", async () => {
    const { service } = setup({ equipment: null });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason: "equipment-not-found" });
  });

  it("rejects a missing expected loan as return-target-changed", async () => {
    const { service } = setup({ loan: null });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason: "return-target-changed" });
  });

  it("rejects an executor who is not an administrator", async () => {
    const { service } = setup();

    const result = await service.execute({
      ...validCommand,
      confirmedBy: "user-1",
      isAdministrator: false,
    });

    expect(result).toEqual({ ok: false, reason: "executor-is-not-administrator" });
  });

  it("rejects a loan that is already returned", async () => {
    const { service } = setup({ loan: createReturnedLoan() });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason: "already-returned" });
  });

  it("rejects a clock time before the loaned time", async () => {
    const { service } = setup({
      now: Instant.from("2026-09-01T00:59:59.999Z"),
    });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason: "return-time-before-loan" });
  });

  it.each([
    ["already-returned", "already-returned"],
    ["equipment-not-on-loan", "equipment-not-on-loan"],
    ["return-target-changed", "return-target-changed"],
  ] as const)(
    "maps a %s confirm conflict to the use case result",
    async (confirmResult, reason) => {
      const { service } = setup({ confirmResult });

      const result = await service.execute(validCommand);

      expect(result).toEqual({ ok: false, reason });
    },
  );

  it("prefers equipment-not-found over a missing loan and a non-administrator", async () => {
    const { service } = setup({ equipment: null, loan: null });

    const result = await service.execute({
      ...validCommand,
      isAdministrator: false,
    });

    expect(result).toEqual({ ok: false, reason: "equipment-not-found" });
  });

  it("prefers return-target-changed over a non-administrator", async () => {
    const { service } = setup({ loan: null });

    const result = await service.execute({
      ...validCommand,
      isAdministrator: false,
    });

    expect(result).toEqual({ ok: false, reason: "return-target-changed" });
  });

  it("prefers executor-is-not-administrator over already-returned", async () => {
    const { service } = setup({ loan: createReturnedLoan() });

    const result = await service.execute({
      ...validCommand,
      isAdministrator: false,
    });

    expect(result).toEqual({ ok: false, reason: "executor-is-not-administrator" });
  });

  it("prefers already-returned over a return time before the loan", async () => {
    const { service } = setup({
      loan: createReturnedLoan(),
      now: Instant.from("2026-09-01T00:59:59.999Z"),
    });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason: "already-returned" });
  });

  it("does not mark a different current loan as returned when the expected reservation is stale", async () => {
    const expectedLoan = createLoan();
    const currentLoan = new Loan({
      reservationId: new ReservationId("reservation-2"),
      borrower: new UserId("user-2"),
      loanedAt: Instant.from("2026-09-01T01:30:00Z"),
      processedBy: new UserId("admin-1"),
    });
    const unreturnedByManagementNumber = new Map<string, Loan>([["EQ-001", currentLoan]]);

    const service = new ConfirmLoanReturn({
      equipmentRepository: {
        findByManagementNumber: async () => Equipment.available(managementNumber),
      },
      loanRepository: {
        findByReservationId: async (reservationId) =>
          expectedLoan.reservationId.equals(reservationId) ? expectedLoan : undefined,
      },
      loanReturnConfirmer: {
        tryConfirm: async (requestedManagementNumber, returnedLoan) => {
          const current = unreturnedByManagementNumber.get(requestedManagementNumber.value);

          if (!current) {
            return "equipment-not-on-loan";
          }

          if (!current.reservationId.equals(returnedLoan.reservationId)) {
            return "return-target-changed";
          }

          unreturnedByManagementNumber.delete(requestedManagementNumber.value);
          return "confirmed";
        },
      },
      clock: { now: () => Instant.from("2026-09-01T02:00:00.123Z") },
    });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason: "return-target-changed" });
    expect(unreturnedByManagementNumber.get("EQ-001")).toBe(currentLoan);
  });

  it("confirms return for suspended equipment and leaves it suspended", async () => {
    const suspended = Equipment.available(managementNumber).suspend({
      expectedVersion: 0n,
      performedBy: new UserId("admin-1"),
      isAdministrator: true,
      reason: "点検",
      now: Instant.from("2026-09-01T01:30:00Z"),
    });
    if (!suspended.ok) {
      throw new Error("Expected the suspension to succeed");
    }
    const equipment = suspended.equipment;
    const { service } = setup({ equipment });

    const result = await service.execute(validCommand);

    expect(result.ok).toBe(true);
    expect(equipment.isSuspended).toBe(true);
  });
});
