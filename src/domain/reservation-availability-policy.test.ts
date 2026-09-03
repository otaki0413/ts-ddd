import { describe, expect, it } from "vite-plus/test";

import { Equipment } from "./equipment";
import { ManagementNumber, ReservationId, UserId } from "./identifiers";
import { Reservation } from "./reservation";
import { evaluateReservationAvailability } from "./reservation-availability-policy";
import { Instant } from "./reservation-date-time";
import { ReservationPeriod } from "./reservation-period";

const managementNumber = new ManagementNumber("EQ-001");
const now = Instant.from("2026-09-01T00:00:00Z");

const createPeriod = (startsAt: string, endsAt: string): ReservationPeriod => {
  const result = ReservationPeriod.create(startsAt, endsAt);

  if (!result.ok) {
    throw new Error("Expected a valid reservation period");
  }

  return result.period;
};

const createReservation = (period: ReservationPeriod): Reservation =>
  new Reservation({
    id: new ReservationId("reservation-1"),
    userId: new UserId("user-1"),
    managementNumber,
    period,
  });

describe("evaluateReservationAvailability", () => {
  it("allows an available equipment without an overlapping reservation", () => {
    const result = evaluateReservationAvailability({
      equipment: Equipment.available(managementNumber),
      existingReservations: [],
      requestedPeriod: createPeriod("2026-09-01T10:00", "2026-09-01T11:00"),
      now,
    });

    expect(result).toEqual({ available: true });
  });

  it("rejects a suspended equipment", () => {
    const suspended = Equipment.available(managementNumber).suspend({
      expectedVersion: 0n,
      performedBy: new UserId("admin-1"),
      isAdministrator: true,
      reason: "点検",
      now,
    });
    if (!suspended.ok) {
      throw new Error("Expected the suspension to succeed");
    }
    const result = evaluateReservationAvailability({
      equipment: suspended.equipment,
      existingReservations: [],
      requestedPeriod: createPeriod("2026-09-01T10:00", "2026-09-01T11:00"),
      now,
    });

    expect(result).toEqual({ available: false, reason: "equipment-is-suspended" });
  });

  it("rejects an overlapping reservation", () => {
    const result = evaluateReservationAvailability({
      equipment: Equipment.available(managementNumber),
      existingReservations: [
        createReservation(createPeriod("2026-09-01T10:00", "2026-09-01T11:00")),
      ],
      requestedPeriod: createPeriod("2026-09-01T10:30", "2026-09-01T11:30"),
      now,
    });

    expect(result).toEqual({ available: false, reason: "reservation-conflict" });
  });

  it("allows a reservation that starts at an existing reservation's end boundary", () => {
    const result = evaluateReservationAvailability({
      equipment: Equipment.available(managementNumber),
      existingReservations: [
        createReservation(createPeriod("2026-09-01T10:00", "2026-09-01T11:00")),
      ],
      requestedPeriod: createPeriod("2026-09-01T11:00", "2026-09-01T12:00"),
      now,
    });

    expect(result).toEqual({ available: true });
  });
});
