import { describe, expect, it, vi } from "vitest";

import { Equipment } from "../domain/equipment.js";
import { ManagementNumber, ReservationId, UserId } from "../domain/identifiers.js";
import { Reservation } from "../domain/reservation.js";
import { Instant } from "../domain/reservation-date-time.js";
import { ReservationPeriod } from "../domain/reservation-period.js";
import { type ReservationCommitResult, ReserveEquipment } from "./reserve-equipment.js";

const managementNumber = new ManagementNumber("EQ-001");

const createPeriod = (startsAt: string, endsAt: string): ReservationPeriod => {
  const result = ReservationPeriod.create(startsAt, endsAt);

  if (!result.ok) {
    throw new Error("Expected a valid reservation period");
  }

  return result.period;
};

interface SetupOptions {
  equipment?: Equipment | null;
  existingReservations?: readonly Reservation[];
  commitResult?: ReservationCommitResult;
  now?: Instant;
}

const setup = (options: SetupOptions = {}) => {
  const equipment =
    options.equipment === undefined ? Equipment.available(managementNumber) : options.equipment;
  const existingReservations = options.existingReservations ?? [];
  const commitResult = options.commitResult ?? "committed";
  const now = options.now ?? Instant.from("2026-09-01T01:00:00Z");

  const findByManagementNumber = vi.fn().mockResolvedValue(equipment ?? undefined);
  const findOverlapping = vi.fn().mockResolvedValue(existingReservations);
  const tryCommit = vi.fn().mockResolvedValue(commitResult);
  const nextReservationId = vi.fn().mockReturnValue(new ReservationId("reservation-new"));

  const service = new ReserveEquipment({
    equipmentRepository: { findByManagementNumber },
    reservationQuery: { findOverlapping },
    reservationCommitter: { tryCommit },
    reservationIdGenerator: { next: nextReservationId },
    clock: { now: () => now },
  });

  return {
    service,
    findByManagementNumber,
    findOverlapping,
    tryCommit,
    nextReservationId,
  };
};

const validCommand = {
  userId: "user-1",
  managementNumber: "EQ-001",
  startsAt: "2026-09-01T10:00",
  endsAt: "2026-09-01T11:00",
};

describe("ReserveEquipment", () => {
  it("creates and commits a reservation", async () => {
    const { service, tryCommit } = setup();

    const result = await service.execute(validCommand);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.reservation.id.value).toBe("reservation-new");
    expect(result.reservation.userId.value).toBe("user-1");
    expect(result.reservation.managementNumber.value).toBe("EQ-001");
    expect(tryCommit).toHaveBeenCalledWith(result.reservation);
  });

  it("rejects an invalid reservation period before loading equipment", async () => {
    const { service, findByManagementNumber } = setup();

    const result = await service.execute({
      ...validCommand,
      endsAt: validCommand.startsAt,
    });

    expect(result).toEqual({ ok: false, reason: "invalid-reservation-period" });
    expect(findByManagementNumber).not.toHaveBeenCalled();
  });

  it("rejects a start in the past before loading equipment", async () => {
    const { service, findByManagementNumber } = setup({
      now: Instant.from("2026-09-01T01:00:00.001Z"),
    });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason: "start-time-is-in-the-past" });
    expect(findByManagementNumber).not.toHaveBeenCalled();
  });

  it("rejects an unknown equipment", async () => {
    const { service } = setup({ equipment: null });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason: "equipment-not-found" });
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

  it("rejects an overlapping reservation", async () => {
    const existingReservation = new Reservation({
      id: new ReservationId("reservation-existing"),
      userId: new UserId("user-2"),
      managementNumber,
      period: createPeriod("2026-09-01T10:30", "2026-09-01T11:30"),
    });
    const { service } = setup({ existingReservations: [existingReservation] });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason: "reservation-conflict" });
  });

  it.each([
    ["reservation-conflict", "reservation-conflict"],
    ["equipment-is-suspended", "equipment-is-suspended"],
    ["start-time-is-in-the-past", "start-time-is-in-the-past"],
  ] as const)("maps a %s commit failure to the use case result", async (commitResult, reason) => {
    const { service } = setup({ commitResult });

    const result = await service.execute(validCommand);

    expect(result).toEqual({ ok: false, reason });
  });
});
