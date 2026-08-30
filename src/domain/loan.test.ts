import { describe, expect, it } from "vitest";

import { ReservationId, UserId } from "./identifiers";
import { Loan } from "./loan";
import { Instant } from "./reservation-date-time";

const createLoan = (): Loan =>
  new Loan({
    reservationId: new ReservationId("reservation-1"),
    borrower: new UserId("user-1"),
    loanedAt: Instant.from("2026-09-01T01:00:00Z"),
    processedBy: new UserId("admin-1"),
  });

describe("Loan.confirmReturn", () => {
  it("records the return time and confirming administrator on an unreturned loan", () => {
    const loan = createLoan();
    const returnedAt = Instant.from("2026-09-01T02:00:00.123Z");

    const result = loan.confirmReturn({
      confirmedBy: new UserId("admin-2"),
      isAdministrator: true,
      returnedAt,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.loan.reservationId.value).toBe("reservation-1");
    expect(result.loan.borrower.value).toBe("user-1");
    expect(result.loan.loanedAt).toBe(loan.loanedAt);
    expect(result.loan.processedBy.value).toBe("admin-1");
    expect(result.loan.returnConfirmation?.returnedAt).toBe(returnedAt);
    expect(result.loan.returnConfirmation?.confirmedBy.value).toBe("admin-2");
  });

  it("rejects an executor who is not an administrator", () => {
    const loan = createLoan();

    const result = loan.confirmReturn({
      confirmedBy: new UserId("user-1"),
      isAdministrator: false,
      returnedAt: Instant.from("2026-09-01T02:00:00Z"),
    });

    expect(result).toEqual({ ok: false, reason: "executor-is-not-administrator" });
  });

  it("rejects a second return confirmation as already-returned", () => {
    const loan = createLoan();
    const first = loan.confirmReturn({
      confirmedBy: new UserId("admin-2"),
      isAdministrator: true,
      returnedAt: Instant.from("2026-09-01T02:00:00Z"),
    });

    if (!first.ok) {
      throw new Error("Expected the first return confirmation to succeed");
    }

    const result = first.loan.confirmReturn({
      confirmedBy: new UserId("admin-3"),
      isAdministrator: true,
      returnedAt: Instant.from("2026-09-01T02:05:00Z"),
    });

    expect(result).toEqual({ ok: false, reason: "already-returned" });
  });

  it("rejects a return time before the loaned time", () => {
    const loan = createLoan();

    const result = loan.confirmReturn({
      confirmedBy: new UserId("admin-2"),
      isAdministrator: true,
      returnedAt: Instant.from("2026-09-01T00:59:59.999Z"),
    });

    expect(result).toEqual({ ok: false, reason: "return-time-before-loan" });
  });

  it("allows a return time equal to the loaned time", () => {
    const loan = createLoan();

    const result = loan.confirmReturn({
      confirmedBy: new UserId("admin-2"),
      isAdministrator: true,
      returnedAt: loan.loanedAt,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.loan.returnConfirmation?.returnedAt).toBe(loan.loanedAt);
  });

  it("leaves the original loan unchanged when confirmation fails", () => {
    const loan = createLoan();

    loan.confirmReturn({
      confirmedBy: new UserId("user-1"),
      isAdministrator: false,
      returnedAt: Instant.from("2026-09-01T02:00:00Z"),
    });

    expect(loan.returnConfirmation).toBeUndefined();
  });
});
