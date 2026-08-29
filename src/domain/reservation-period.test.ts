import { describe, expect, it } from "vitest";

import { Instant } from "./reservation-date-time.js";
import { ReservationPeriod } from "./reservation-period.js";

const createPeriod = (startsAt: string, endsAt: string): ReservationPeriod => {
  const result = ReservationPeriod.create(startsAt, endsAt);

  if (!result.ok) {
    throw new Error(`Expected a valid reservation period: ${startsAt} - ${endsAt}`);
  }

  return result.period;
};

describe("ReservationPeriod", () => {
  it("creates a positive, minute-precision period in Asia/Tokyo", () => {
    const result = ReservationPeriod.create("2026-09-01T10:00", "2026-09-01T11:00");

    expect(result.ok).toBe(true);
  });

  it.each([
    ["2026-09-01T10:00", "2026-09-01T10:00"],
    ["2026-09-01T11:00", "2026-09-01T10:00"],
    ["2026-09-01T10:00:00", "2026-09-01T11:00"],
    ["2026-09-01T10:00", "2026-09-01T11:00:00.000"],
    ["2026-02-30T10:00", "2026-02-30T11:00"],
  ])("rejects an invalid period from %s to %s", (startsAt, endsAt) => {
    expect(ReservationPeriod.create(startsAt, endsAt)).toEqual({
      ok: false,
      reason: "invalid-reservation-period",
    });
  });

  it("does not overlap a period that starts at its end boundary", () => {
    const first = createPeriod("2026-09-01T10:00", "2026-09-01T11:00");
    const second = createPeriod("2026-09-01T11:00", "2026-09-01T12:00");

    expect(first.overlaps(second)).toBe(false);
  });

  it("overlaps a period with a shared minute", () => {
    const first = createPeriod("2026-09-01T10:00", "2026-09-01T11:00");
    const second = createPeriod("2026-09-01T10:59", "2026-09-01T12:00");

    expect(first.overlaps(second)).toBe(true);
  });

  it("allows a start exactly at the current instant", () => {
    const period = createPeriod("2026-09-01T10:00", "2026-09-01T11:00");

    expect(period.startsBefore(Instant.from("2026-09-01T01:00:00Z"))).toBe(false);
  });

  it("treats a start earlier than the current instant as past", () => {
    const period = createPeriod("2026-09-01T10:00", "2026-09-01T11:00");

    expect(period.startsBefore(Instant.from("2026-09-01T01:00:00.001Z"))).toBe(true);
  });

  it("has ended exactly at the planned return instant", () => {
    const period = createPeriod("2026-09-01T10:00", "2026-09-01T11:00");

    expect(period.hasEndedBy(Instant.from("2026-09-01T02:00:00Z"))).toBe(true);
  });
});
