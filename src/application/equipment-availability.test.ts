import { describe, expect, it } from "vitest";

import { Equipment } from "../domain/equipment.js";
import { ManagementNumber, ReservationId, UserId } from "../domain/identifiers.js";
import { type Reservation } from "../domain/reservation.js";
import { type Loan } from "../domain/loan.js";
import { evaluateReservationAvailability } from "../domain/reservation-availability-policy.js";
import { Instant } from "../domain/reservation-date-time.js";
import {
  type EquipmentAvailabilitySnapshot,
  type EquipmentAvailabilityStore,
} from "./equipment-availability-store.js";
import { GetEquipmentAvailability } from "./get-equipment-availability.js";
import { SuspendEquipment } from "./suspend-equipment.js";
import { ResumeEquipment } from "./resume-equipment.js";
import { ReserveEquipment } from "./reserve-equipment.js";
import { LoanEquipment } from "./loan-equipment.js";
import { ConfirmLoanReturn } from "./confirm-loan-return.js";
import { CancelReservation } from "./cancel-reservation.js";

const managementNumber = new ManagementNumber("EQ-001");
const now = Instant.from("2026-09-01T01:00:00.123456789Z");
const suspensionCommand = {
  managementNumber: "EQ-001",
  expectedVersion: 0n,
  performedBy: "admin-1",
  isAdministrator: true,
  reason: "電源が入らない",
};
const query = { managementNumber: "EQ-001", isAdministrator: true };
const resumptionCommand = {
  managementNumber: "EQ-001",
  expectedVersion: 1n,
  performedBy: "admin-2",
  isAdministrator: true,
};
const reservationCommand = {
  managementNumber: "EQ-001",
  userId: "user-1",
  startsAt: "2026-09-01T10:01",
  endsAt: "2026-09-01T11:00",
};
const loanCommand = {
  reservationId: "reservation-1",
  processedBy: "admin-1",
  isAdministrator: true,
  recipientId: "user-1",
};

const setup = () => {
  const clock = { now: () => now };
  const hooks: {
    beforeChange?: () => Promise<void>;
    beforePublish?: () => void;
    afterRead?: () => Promise<void>;
    beforeReservationCommit?: () => Promise<void>;
    beforeLoanCommit?: () => Promise<void>;
  } = {};
  const snapshots = new Map<string, EquipmentAvailabilitySnapshot>(
    ["EQ-001", "EQ-002"].map((number) => [
      number,
      {
        equipment: Equipment.available(new ManagementNumber(number)),
        history: [],
      },
    ]),
  );
  const store: EquipmentAvailabilityStore = {
    read: async (number) => {
      const result = snapshots.get(number.value);
      await hooks.afterRead?.();
      return result;
    },
    tryChange: async (number, transition) => {
      await hooks.beforeChange?.();
      const snapshot = snapshots.get(number.value);
      if (!snapshot) {
        return { ok: false, reason: "equipment-not-found" };
      }

      const result = transition(snapshot.equipment, clock.now());
      if (result.ok) {
        hooks.beforePublish?.();
        snapshots.set(number.value, {
          equipment: result.equipment,
          history: [...snapshot.history, result.change],
        });
      }
      return result;
    },
  };
  const reservations = new Map<string, Reservation>();
  const loans = new Map<string, Loan>();
  const relatedReservations = (number: ManagementNumber) =>
    [...reservations.values()].filter(
      (reservation) =>
        reservation.managementNumber.equals(number) && !loans.get(reservation.id.value)?.isReturned,
    );
  const unreturnedLoan = (number: ManagementNumber) =>
    [...loans.values()].find(
      (loan) =>
        !loan.isReturned &&
        reservations.get(loan.reservationId.value)?.managementNumber.equals(number),
    );
  const reservationRepository = {
    findById: async (id: ReservationId) => reservations.get(id.value),
  };
  let nextReservationId = 0;
  const equipmentRepository = {
    findByManagementNumber: async (number: ManagementNumber) =>
      snapshots.get(number.value)?.equipment,
  };
  const reserve = new ReserveEquipment({
    equipmentRepository,
    reservationQuery: {
      findOverlapping: async (number, period) =>
        relatedReservations(number).filter((reservation) => reservation.period.overlaps(period)),
    },
    reservationIdGenerator: { next: () => new ReservationId(`reservation-${++nextReservationId}`) },
    clock,
    reservationCommitter: {
      tryCommit: async (reservation) => {
        await hooks.beforeReservationCommit?.();
        const equipment = snapshots.get(reservation.managementNumber.value)?.equipment;
        if (!equipment) {
          throw new Error("Expected existing equipment at reservation confirmation");
        }
        if (reservation.period.startsBefore(clock.now())) {
          return "start-time-is-in-the-past";
        }
        const availability = evaluateReservationAvailability({
          equipment,
          existingReservations: relatedReservations(reservation.managementNumber),
          requestedPeriod: reservation.period,
          now: clock.now(),
        });
        if (!availability.available) {
          return availability.reason;
        }
        reservations.set(reservation.id.value, reservation);
        return "committed";
      },
    },
  });
  const loan = new LoanEquipment({
    equipmentRepository,
    reservationRepository,
    clock,
    unreturnedLoanQuery: { findByManagementNumber: async (number) => unreturnedLoan(number) },
    loanCommitter: {
      tryCommit: async (newLoan) => {
        await hooks.beforeLoanCommit?.();
        const reservation = reservations.get(newLoan.reservationId.value);
        if (!reservation) {
          throw new Error("Expected an existing reservation at loan confirmation");
        }
        if (reservation.isCancelled) {
          return "already-cancelled";
        }
        if (loans.has(newLoan.reservationId.value)) {
          return "already-loaned";
        }
        if (snapshots.get(reservation.managementNumber.value)?.equipment.isSuspended) {
          return "equipment-suspended";
        }
        if (unreturnedLoan(reservation.managementNumber)) {
          return "equipment-not-returned";
        }
        loans.set(newLoan.reservationId.value, newLoan);
        return "loaned";
      },
    },
  });
  const confirmReturn = new ConfirmLoanReturn({
    equipmentRepository,
    clock,
    loanRepository: { findByReservationId: async (id) => loans.get(id.value) },
    loanReturnConfirmer: {
      tryConfirm: async (number, returnedLoan) => {
        if (loans.get(returnedLoan.reservationId.value)?.isReturned) {
          return "already-returned";
        }
        const current = unreturnedLoan(number);
        if (!current) {
          return "equipment-not-on-loan";
        }
        if (!current.reservationId.equals(returnedLoan.reservationId)) {
          return "return-target-changed";
        }
        loans.set(returnedLoan.reservationId.value, returnedLoan);
        return "confirmed";
      },
    },
  });
  const cancel = new CancelReservation({
    reservationRepository,
    clock,
    reservationCanceller: {
      tryCancel: async (reservation) => {
        const current = reservations.get(reservation.id.value);
        if (!current) {
          throw new Error("Expected an existing reservation at cancellation");
        }
        if (loans.has(reservation.id.value)) {
          return "already-loaned";
        }
        if (current.isCancelled) {
          return "already-cancelled";
        }
        if (current.period.hasEndedBy(clock.now())) {
          return "reservation-expired";
        }
        reservations.set(reservation.id.value, reservation);
        return "cancelled";
      },
    },
  });

  return {
    clock,
    hooks,
    reserve,
    loan,
    confirmReturn,
    cancel,
    suspend: new SuspendEquipment({ store }),
    resume: new ResumeEquipment({ store }),
    get: new GetEquipmentAvailability({ store }),
  };
};

describe("Equipment availability", () => {
  it("does not revive a cancelled reservation when equipment is resumed", async () => {
    const { reserve, cancel, loan, suspend, resume, clock } = setup();
    await reserve.execute(reservationCommand);
    await suspend.execute(suspensionCommand);
    expect(
      (
        await cancel.execute({
          reservationId: "reservation-1",
          cancelledBy: "admin-1",
          isAdministrator: true,
        })
      ).ok,
    ).toBe(true);
    await resume.execute(resumptionCommand);
    clock.now = () => Instant.from("2026-09-01T01:01:00Z");

    expect(await loan.execute(loanCommand)).toEqual({ ok: false, reason: "already-cancelled" });
  });

  it.each([
    ["2026-09-01T01:00:30Z", "before-planned-start"],
    ["2026-09-01T02:00:00Z", "reservation-expired"],
  ])("still applies the reservation period after resumption at %s", async (time, reason) => {
    const { reserve, loan, suspend, resume, get, clock } = setup();
    await reserve.execute(reservationCommand);
    await suspend.execute(suspensionCommand);
    await resume.execute(resumptionCommand);
    const before = await get.execute(query);
    clock.now = () => Instant.from(time);

    expect(await loan.execute(loanCommand)).toEqual({ ok: false, reason });
    expect(await get.execute(query)).toEqual(before);
  });

  it("still blocks the next borrower while an overdue loan is unreturned after resumption", async () => {
    const { reserve, loan, suspend, resume, confirmReturn, get, clock } = setup();
    await reserve.execute(reservationCommand);
    await reserve.execute({
      ...reservationCommand,
      startsAt: "2026-09-01T11:00",
      endsAt: "2026-09-01T12:00",
    });
    clock.now = () => Instant.from("2026-09-01T01:01:00Z");
    await loan.execute(loanCommand);
    clock.now = () => Instant.from("2026-09-01T02:00:00Z");

    expect((await suspend.execute(suspensionCommand)).ok).toBe(true);
    expect((await resume.execute(resumptionCommand)).ok).toBe(true);
    const before = await get.execute(query);
    expect(await loan.execute({ ...loanCommand, reservationId: "reservation-2" })).toEqual({
      ok: false,
      reason: "equipment-not-returned",
    });
    expect(await get.execute(query)).toEqual(before);

    await confirmReturn.execute({
      managementNumber: "EQ-001",
      expectedReservationId: "reservation-1",
      confirmedBy: "admin-1",
      isAdministrator: true,
    });
    expect((await loan.execute({ ...loanCommand, reservationId: "reservation-2" })).ok).toBe(true);
  });

  it("preserves a loan committed first and keeps suspension after its return is confirmed", async () => {
    const { reserve, loan, suspend, confirmReturn, get, clock, hooks } = setup();
    await reserve.execute(reservationCommand);
    clock.now = () => Instant.from("2026-09-01T01:01:00.123Z");
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    hooks.beforeChange = () => {
      entered.resolve();
      return release.promise;
    };
    const pending = suspend.execute(suspensionCommand);
    await entered.promise;
    expect((await loan.execute(loanCommand)).ok).toBe(true);
    release.resolve();
    expect((await pending).ok).toBe(true);
    const stopped = await get.execute(query);

    const command = {
      managementNumber: "EQ-001",
      expectedReservationId: "reservation-1",
      confirmedBy: "admin-2",
      isAdministrator: true,
    };
    expect(await confirmReturn.execute(command)).toMatchObject({
      ok: true,
      loan: { isReturned: true },
    });
    expect(await get.execute(query)).toEqual(stopped);
    expect(stopped).toMatchObject({
      equipment: { status: "suspended", version: 1n },
      history: [{ kind: "suspended", version: 1n }],
    });
    expect(await confirmReturn.execute(command)).toEqual({ ok: false, reason: "already-returned" });
  });

  it("rejects a loan when suspension commits first and permits it after resumption", async () => {
    const { reserve, loan, suspend, resume, get, clock, hooks } = setup();
    await reserve.execute(reservationCommand);
    clock.now = () => Instant.from("2026-09-01T01:01:00.123Z");
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    hooks.beforeLoanCommit = () => {
      entered.resolve();
      return release.promise;
    };
    const pending = loan.execute(loanCommand);
    await entered.promise;
    await suspend.execute(suspensionCommand);
    const stopped = await get.execute(query);
    release.resolve();

    expect(await pending).toEqual({ ok: false, reason: "equipment-is-suspended" });
    expect(await get.execute(query)).toEqual(stopped);
    await resume.execute(resumptionCommand);
    expect(await loan.execute(loanCommand)).toMatchObject({
      ok: true,
      loan: { reservationId: new ReservationId("reservation-1"), borrower: new UserId("user-1") },
    });
  });

  it("preserves a reservation that commits before suspension and still checks overlap after resumption", async () => {
    const { reserve, suspend, resume, get, hooks } = setup();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    hooks.beforeChange = () => {
      entered.resolve();
      return release.promise;
    };
    const pending = suspend.execute(suspensionCommand);
    await entered.promise;
    expect((await reserve.execute(reservationCommand)).ok).toBe(true);
    release.resolve();
    expect((await pending).ok).toBe(true);
    expect(await get.execute(query)).toMatchObject({
      equipment: { status: "suspended", version: 1n },
    });

    await resume.execute(resumptionCommand);
    expect(await reserve.execute(reservationCommand)).toEqual({
      ok: false,
      reason: "reservation-conflict",
    });
  });

  it("rejects a reservation when suspension commits while the reservation is waiting", async () => {
    const { reserve, suspend, resume, get, hooks } = setup();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    hooks.beforeReservationCommit = () => {
      entered.resolve();
      return release.promise;
    };
    const pending = reserve.execute(reservationCommand);
    await entered.promise;
    await suspend.execute(suspensionCommand);
    const stopped = await get.execute(query);
    release.resolve();

    expect(await pending).toEqual({ ok: false, reason: "equipment-is-suspended" });
    expect(await get.execute(query)).toEqual(stopped);
    await resume.execute(resumptionCommand);
    expect((await reserve.execute(reservationCommand)).ok).toBe(true);
  });

  it("only queries and changes the equipment selected by management number", async () => {
    const { suspend, get } = setup();
    await suspend.execute({ ...suspensionCommand, managementNumber: "EQ-002", reason: "点検" });

    const first = await get.execute(query);
    expect(first).toMatchObject({
      equipment: {
        managementNumber: new ManagementNumber("EQ-001"),
        status: "available",
        version: 0n,
      },
      history: [],
    });
    expect(await get.execute({ ...query, managementNumber: "EQ-002" })).toMatchObject({
      equipment: {
        managementNumber: new ManagementNumber("EQ-002"),
        status: "suspended",
        version: 1n,
      },
      history: [{ managementNumber: new ManagementNumber("EQ-002"), reason: "点検", version: 1n }],
    });
    expect(await get.execute(query)).toEqual(first);
  });

  it("rejects unknown equipment for all three operations without changing another equipment", async () => {
    const { suspend, resume, get } = setup();
    const before = await get.execute(query);
    const expected = { ok: false, reason: "equipment-not-found" };

    expect(await suspend.execute({ ...suspensionCommand, managementNumber: "EQ-404" })).toEqual(
      expected,
    );
    expect(await resume.execute({ ...resumptionCommand, managementNumber: "EQ-404" })).toEqual(
      expected,
    );
    expect(await get.execute({ ...query, managementNumber: "EQ-404" })).toEqual(expected);
    expect(await get.execute(query)).toEqual(before);
  });

  it("returns a consistent version of state and history even when updated during a read", async () => {
    const { suspend, resume, get, hooks } = setup();
    await suspend.execute(suspensionCommand);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    hooks.afterRead = () => {
      entered.resolve();
      return release.promise;
    };

    const pending = get.execute(query);
    await entered.promise;
    await resume.execute(resumptionCommand);
    delete hooks.afterRead;
    release.resolve();

    expect(await pending).toMatchObject({
      equipment: { status: "suspended", version: 1n },
      history: [{ kind: "suspended", version: 1n }],
    });
    expect(await get.execute(query)).toMatchObject({
      equipment: { status: "available", version: 2n },
      history: [
        { kind: "suspended", version: 1n },
        { kind: "resumed", version: 2n },
      ],
    });
  });

  it.each(["suspend", "resume"] as const)(
    "leaves no partial %s when the history append fails and does not retry",
    async (operation) => {
      const { suspend, resume, get, hooks } = setup();
      if (operation === "resume") {
        await suspend.execute(suspensionCommand);
      }
      const before = await get.execute(query);
      hooks.beforePublish = () => {
        delete hooks.beforePublish;
        throw new Error("History append failed");
      };
      const execute = () =>
        operation === "suspend"
          ? suspend.execute(suspensionCommand)
          : resume.execute(resumptionCommand);

      await expect(execute()).rejects.toThrow("History append failed");
      expect(await get.execute(query)).toEqual(before);
      expect((await execute()).ok).toBe(true);
    },
  );

  it.each(["suspend", "resume"] as const)(
    "only commits one competing %s request from the same version",
    async (operation) => {
      const { suspend, resume, get } = setup();
      if (operation === "resume") {
        await suspend.execute(suspensionCommand);
      }

      const execute = () =>
        operation === "suspend"
          ? suspend.execute(suspensionCommand)
          : resume.execute(resumptionCommand);
      const results = await Promise.all([execute(), execute()]);

      expect(results[0]?.ok).toBe(true);
      expect(results[1]).toEqual({ ok: false, reason: "equipment-version-changed" });
      expect(await get.execute(query)).toMatchObject({
        equipment: { version: operation === "suspend" ? 1n : 2n },
        history:
          operation === "suspend"
            ? [{ kind: "suspended", version: 1n }]
            : [
                { kind: "suspended", version: 1n },
                { kind: "resumed", version: 2n },
              ],
      });
    },
  );

  it("detects a new suspension after an old resumption request has already started", async () => {
    const { suspend, resume, get, hooks } = setup();
    await suspend.execute(suspensionCommand);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    hooks.beforeChange = () => {
      entered.resolve();
      return release.promise;
    };
    const pending = resume.execute(resumptionCommand);
    await entered.promise;
    delete hooks.beforeChange;
    await resume.execute(resumptionCommand);
    await suspend.execute({ ...suspensionCommand, expectedVersion: 2n, reason: "新たな異音" });
    const before = await get.execute(query);
    release.resolve();

    expect(await pending).toEqual({ ok: false, reason: "equipment-version-changed" });
    expect(await get.execute(query)).toEqual(before);
  });

  it.each(["suspend", "resume"] as const)(
    "records confirmation time after a %s request has waited",
    async (operation) => {
      const { suspend, resume, get, clock, hooks } = setup();
      if (operation === "resume") {
        await suspend.execute(suspensionCommand);
      }
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      hooks.beforeChange = () => {
        entered.resolve();
        return release.promise;
      };

      const pending =
        operation === "suspend"
          ? suspend.execute(suspensionCommand)
          : resume.execute(resumptionCommand);
      await entered.promise;
      const confirmedAt = Instant.from("2026-09-01T02:00:00.987654321Z");
      clock.now = () => confirmedAt;
      release.resolve();

      expect((await pending).ok).toBe(true);
      const observed = await get.execute(query);
      expect(observed.ok).toBe(true);
      if (observed.ok) {
        expect(observed.history.at(-1)?.occurredAt.epochNanoseconds).toBe(
          confirmedAt.epochNanoseconds,
        );
      }
    },
  );

  it("does not impose a business length limit on the reason", async () => {
    const { suspend, get } = setup();
    const reason = "故障の詳細".repeat(10_000);

    expect((await suspend.execute({ ...suspensionCommand, reason })).ok).toBe(true);
    expect(await get.execute(query)).toMatchObject({ history: [{ reason }] });
  });

  it("rejects stale requests even when availability cycles back to the same state", async () => {
    const { suspend, resume, get } = setup();
    await suspend.execute(suspensionCommand);
    await resume.execute(resumptionCommand);
    const availableAgain = await get.execute(query);

    expect(await suspend.execute(suspensionCommand)).toEqual({
      ok: false,
      reason: "equipment-version-changed",
    });
    expect(await get.execute(query)).toEqual(availableAgain);

    await suspend.execute({ ...suspensionCommand, expectedVersion: 2n, reason: "異音" });
    const suspendedAgain = await get.execute(query);
    expect(await resume.execute(resumptionCommand)).toEqual({
      ok: false,
      reason: "equipment-version-changed",
    });
    expect(await get.execute(query)).toEqual(suspendedAgain);
    expect(suspendedAgain).toMatchObject({
      equipment: { status: "suspended", version: 3n },
      history: [
        { kind: "suspended", version: 1n, reason: "電源が入らない" },
        { kind: "resumed", version: 2n },
        { kind: "suspended", version: 3n, reason: "異音" },
      ],
    });
  });

  it("rejects a new suspension before the preceding resumption", async () => {
    const { suspend, resume, get, clock } = setup();
    await suspend.execute(suspensionCommand);
    clock.now = () => Instant.from("2026-09-01T02:00:00Z");
    await resume.execute(resumptionCommand);
    const before = await get.execute(query);
    clock.now = () => now;

    expect(await suspend.execute({ ...suspensionCommand, expectedVersion: 2n })).toEqual({
      ok: false,
      reason: "transition-time-before-previous",
    });
    expect(await get.execute(query)).toEqual(before);
  });

  it("rejects resumption one nanosecond before the preceding suspension", async () => {
    const { suspend, resume, get, clock } = setup();
    await suspend.execute(suspensionCommand);
    const before = await get.execute(query);
    clock.now = () => Instant.from("2026-09-01T01:00:00.123456788Z");

    expect(await resume.execute(resumptionCommand)).toEqual({
      ok: false,
      reason: "transition-time-before-previous",
    });
    expect(await get.execute(query)).toEqual(before);
  });

  it("prefers a changed version over already available on a repeated resumption", async () => {
    const { suspend, resume, get } = setup();
    await suspend.execute(suspensionCommand);
    await resume.execute(resumptionCommand);
    const before = await get.execute(query);

    expect(await resume.execute(resumptionCommand)).toEqual({
      ok: false,
      reason: "equipment-version-changed",
    });
    expect(await resume.execute({ ...resumptionCommand, expectedVersion: 2n })).toEqual({
      ok: false,
      reason: "already-available",
    });
    expect(await get.execute(query)).toEqual(before);
  });

  it("rejects resumption of available equipment with no fabricated history", async () => {
    const { resume, get } = setup();

    expect(await resume.execute({ ...resumptionCommand, expectedVersion: 0n })).toEqual({
      ok: false,
      reason: "already-available",
    });
    expect(await get.execute(query)).toMatchObject({
      ok: true,
      equipment: { status: "available", version: 0n },
      history: [],
    });
  });

  it("rejects resumption by a non-administrator without changing the snapshot", async () => {
    const { suspend, resume, get } = setup();
    await suspend.execute(suspensionCommand);
    const before = await get.execute(query);

    expect(await resume.execute({ ...resumptionCommand, isAdministrator: false })).toEqual({
      ok: false,
      reason: "executor-is-not-administrator",
    });
    expect(await get.execute(query)).toEqual(before);
  });

  it("allows another administrator to resume at the same time while retaining both transitions", async () => {
    const { suspend, resume, get } = setup();
    await suspend.execute(suspensionCommand);

    expect((await resume.execute(resumptionCommand)).ok).toBe(true);
    const observed = await get.execute(query);

    expect(observed).toMatchObject({
      ok: true,
      equipment: { status: "available", version: 2n },
      history: [
        {
          kind: "suspended",
          version: 1n,
          reason: "電源が入らない",
          performedBy: new UserId("admin-1"),
        },
        { kind: "resumed", version: 2n, performedBy: new UserId("admin-2") },
      ],
    });
    if (!observed.ok) {
      return;
    }
    expect(observed.history.map((change) => change.occurredAt.epochNanoseconds)).toEqual([
      now.epochNanoseconds,
      now.epochNanoseconds,
    ]);
  });

  it("prefers a changed version over already suspended and leaves the snapshot unchanged", async () => {
    const { suspend, get } = setup();
    await suspend.execute(suspensionCommand);
    const before = await get.execute(query);

    expect(await suspend.execute(suspensionCommand)).toEqual({
      ok: false,
      reason: "equipment-version-changed",
    });
    expect(await get.execute(query)).toEqual(before);
  });

  it("rejects re-suspension without overwriting the existing reason", async () => {
    const { suspend, get } = setup();
    await suspend.execute(suspensionCommand);
    const before = await get.execute(query);

    expect(
      await suspend.execute({ ...suspensionCommand, expectedVersion: 1n, reason: "異音" }),
    ).toEqual({
      ok: false,
      reason: "already-suspended",
    });
    expect(await get.execute(query)).toEqual(before);
  });

  it.each(["", " ", "\t\r\n", "　 \u00a0"])(
    "rejects an empty trimmed reason: %j",
    async (reason) => {
      const { suspend, get } = setup();
      const before = await get.execute(query);

      expect(await suspend.execute({ ...suspensionCommand, reason })).toEqual({
        ok: false,
        reason: "empty-suspension-reason",
      });
      expect(await get.execute(query)).toEqual(before);
    },
  );

  it("trims only the edges of a suspension reason", async () => {
    const { suspend, get } = setup();

    await suspend.execute({ ...suspensionCommand, reason: " \t電源が  入らない\n要確認　\n" });

    expect(await get.execute(query)).toMatchObject({
      history: [{ reason: "電源が  入らない\n要確認" }],
    });
  });

  it("only allows administrators to query availability and history", async () => {
    const { get } = setup();
    const before = await get.execute(query);

    expect(await get.execute({ ...query, isAdministrator: false })).toEqual({
      ok: false,
      reason: "executor-is-not-administrator",
    });
    expect(await get.execute(query)).toEqual(before);
  });

  it("rejects suspension by a non-administrator without changing the observable snapshot", async () => {
    const { suspend, get } = setup();
    const before = await get.execute(query);

    const result = await suspend.execute({ ...suspensionCommand, isAdministrator: false });

    expect(result).toEqual({ ok: false, reason: "executor-is-not-administrator" });
    expect(await get.execute(query)).toEqual(before);
  });

  it("makes a suspension and its reason, actor, exact time and version retrievable", async () => {
    const { suspend, get } = setup();

    const result = await suspend.execute(suspensionCommand);
    const observed = await get.execute(query);

    expect(result.ok).toBe(true);
    expect(observed).toMatchObject({
      ok: true,
      equipment: { managementNumber, status: "suspended", version: 1n },
      history: [
        {
          kind: "suspended",
          managementNumber,
          version: 1n,
          reason: "電源が入らない",
          performedBy: new UserId("admin-1"),
        },
      ],
    });
    if (!observed.ok) {
      return;
    }
    expect(observed.history[0]?.occurredAt.epochNanoseconds).toBe(now.epochNanoseconds);
  });
});
