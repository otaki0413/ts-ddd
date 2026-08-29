import { describe, expect, it, vi } from "vitest";

import { ManagementNumber, ReservationId, UserId } from "../domain/identifiers.js";
import { Reservation } from "../domain/reservation.js";
import { Instant } from "../domain/reservation-date-time.js";
import { ReservationPeriod } from "../domain/reservation-period.js";
import { CancelReservation, type ReservationCancelCommitResult } from "./cancel-reservation.js";

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
  managementNumber: new ManagementNumber("EQ-001"),
  period: createPeriod("2026-09-01T10:00", "2026-09-01T11:00"),
});

interface SetupOptions {
  reservation?: Reservation | null;
  cancelCommitResult?: ReservationCancelCommitResult;
  now?: Instant;
}

const setup = (options: SetupOptions = {}) => {
  const reservation = options.reservation === undefined ? existingReservation : options.reservation;
  const cancelCommitResult = options.cancelCommitResult ?? "cancelled";
  // 2026-09-01T09:00 Asia/Tokyo: before the planned start.
  const now = options.now ?? Instant.from("2026-09-01T00:00:00Z");

  const findById = vi.fn().mockResolvedValue(reservation ?? undefined);
  const tryCancel = vi.fn().mockResolvedValue(cancelCommitResult);

  const service = new CancelReservation({
    reservationRepository: { findById },
    reservationCanceller: { tryCancel },
    clock: { now: () => now },
  });

  return { service, findById, tryCancel };
};

const validCommand = {
  reservationId: "reservation-1",
  cancelledBy: "user-1",
  isAdministrator: false,
};

describe("CancelReservation", () => {
  it("cancels a reservation and commits the cancellation", async () => {
    const { service, tryCancel } = setup();

    const result = await service.execute(validCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.reservation.isCancelled).toBe(true);
    expect(result.reservation.cancellation?.cancelledBy.value).toBe("user-1");
    expect(tryCancel).toHaveBeenCalledWith(result.reservation);
  });

  it("rejects an unknown reservation", async () => {
    const { service, tryCancel } = setup({ reservation: null });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason: "reservation-not-found" });
    expect(tryCancel).not.toHaveBeenCalled();
  });

  it("rejects a canceller who is not permitted, without committing", async () => {
    const { service, tryCancel } = setup();

    const result = await service.execute({
      ...validCommand,
      cancelledBy: "user-2",
    });

    expect(result).toEqual({ ok: false, reason: "canceller-not-permitted" });
    expect(tryCancel).not.toHaveBeenCalled();
  });

  it("asks the canceller to distinguish expired from loaned after the planned return time", async () => {
    // An overdue loaned reservation must surface as already-loaned, which only
    // the canceller can observe, so the use case must not fail from the clock alone.
    const { service, tryCancel } = setup({
      // 2026-09-01T11:00 Asia/Tokyo: the planned return time has passed.
      now: Instant.from("2026-09-01T02:00:00Z"),
      cancelCommitResult: "already-loaned",
    });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason: "already-loaned" });
    expect(tryCancel).toHaveBeenCalled();
  });

  it.each([
    ["already-loaned", "already-loaned"],
    ["already-cancelled", "already-cancelled"],
    ["reservation-expired", "reservation-expired"],
  ] as const)(
    "maps an %s cancel commit failure to the use case result",
    async (cancelCommitResult, reason) => {
      const { service } = setup({ cancelCommitResult });

      const result = await service.execute(validCommand);

      expect(result).toEqual({ ok: false, reason });
    },
  );
});
