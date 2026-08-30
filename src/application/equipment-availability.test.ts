import { describe, expect, it, vi } from "vitest";

import {
  Equipment,
  type EquipmentAvailabilityChange,
  type EquipmentAvailabilityChangeFailureReason,
  type EquipmentAvailabilityChangeResult,
} from "../domain/equipment.js";
import { ManagementNumber, ReservationId, UserId } from "../domain/identifiers.js";
import { Reservation } from "../domain/reservation.js";
import { Instant } from "../domain/reservation-date-time.js";
import { ReservationPeriod } from "../domain/reservation-period.js";
import {
  type DecideEquipmentAvailabilityChange,
  type EquipmentAvailabilityCommitResult,
  type EquipmentAvailabilityCommitter,
  type EquipmentAvailabilitySnapshot,
  type EquipmentAvailabilitySnapshotReader,
} from "./equipment-availability.js";
import { GetEquipmentAvailability } from "./get-equipment-availability.js";
import { LoanEquipment } from "./loan-equipment.js";
import { ReserveEquipment } from "./reserve-equipment.js";
import { ResumeEquipment } from "./resume-equipment.js";
import { SuspendEquipment } from "./suspend-equipment.js";

interface StoredAvailability {
  equipment: Equipment;
  history: EquipmentAvailabilityChange[];
}

class InMemoryEquipmentAvailabilityStore
  implements EquipmentAvailabilityCommitter, EquipmentAvailabilitySnapshotReader
{
  readonly #records = new Map<string, StoredAvailability>();
  beforeDecision: (() => void) | undefined;
  afterSnapshot: (() => void) | undefined;
  failAfterDecision = false;

  add(equipment: Equipment): void {
    this.#records.set(equipment.managementNumber.value, { equipment, history: [] });
  }

  current(managementNumber: string): StoredAvailability | undefined {
    return this.#records.get(managementNumber);
  }

  apply(decision: EquipmentAvailabilityChangeResult): void {
    if (!decision.ok) {
      return;
    }

    const current = this.#records.get(decision.equipment.managementNumber.value);
    if (!current) {
      return;
    }

    this.#records.set(decision.equipment.managementNumber.value, {
      equipment: decision.equipment,
      history: [...current.history, decision.change],
    });
  }

  async tryCommit<
    Change extends EquipmentAvailabilityChange,
    FailureReason extends EquipmentAvailabilityChangeFailureReason,
  >(
    managementNumber: ManagementNumber,
    expectedVersion: number,
    decide: DecideEquipmentAvailabilityChange<Change, FailureReason>,
  ): Promise<EquipmentAvailabilityCommitResult<Change, FailureReason>> {
    const current = this.#records.get(managementNumber.value);

    if (!current) {
      return { kind: "equipment-not-found" };
    }

    if (current.equipment.version !== expectedVersion) {
      return { kind: "equipment-version-changed" };
    }

    this.beforeDecision?.();
    const decision = decide(current.equipment);
    if (!decision.ok) {
      return { kind: "rejected", reason: decision.reason };
    }

    if (this.failAfterDecision) {
      throw new Error("simulated commit failure");
    }

    this.#records.set(managementNumber.value, {
      equipment: decision.equipment,
      history: [...current.history, decision.change],
    });
    return { kind: "committed", equipment: decision.equipment, change: decision.change };
  }

  async findByManagementNumber(
    managementNumber: ManagementNumber,
  ): Promise<EquipmentAvailabilitySnapshot | undefined> {
    const current = this.#records.get(managementNumber.value);
    if (!current) {
      return undefined;
    }

    const snapshot = { equipment: current.equipment, history: [...current.history] };
    this.afterSnapshot?.();
    return snapshot;
  }
}

const managementNumber = new ManagementNumber("EQ-001");
const firstTime = Instant.from("2026-09-01T01:00:00.123456789Z");
const secondTime = Instant.from("2026-09-01T02:00:00.987654321Z");

const setup = () => {
  const store = new InMemoryEquipmentAvailabilityStore();
  store.add(Equipment.available(managementNumber));
  let now = firstTime;
  const clock = { now: () => now };

  return {
    store,
    suspend: new SuspendEquipment({ equipmentAvailabilityCommitter: store, clock }),
    resume: new ResumeEquipment({ equipmentAvailabilityCommitter: store, clock }),
    getAvailability: new GetEquipmentAvailability({
      equipmentAvailabilitySnapshotReader: store,
    }),
    setNow: (value: Instant) => {
      now = value;
    },
  };
};

const suspendCommand = {
  managementNumber: "EQ-001",
  expectedVersion: 0,
  performedBy: "admin-1",
  isAdministrator: true,
  reason: "  spindle failure\n",
};

const resumeCommand = {
  managementNumber: "EQ-001",
  expectedVersion: 1,
  performedBy: "admin-2",
  isAdministrator: true,
};

const getCommand = {
  managementNumber: "EQ-001",
  isAdministrator: true,
};

const expectSnapshot = async (
  getAvailability: GetEquipmentAvailability,
  status: "available" | "suspended",
  version: number,
  historyLength: number,
) => {
  const result = await getAvailability.execute(getCommand);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("Expected availability lookup to succeed");
  }

  expect(result.availability.status).toBe(status);
  expect(result.availability.version).toBe(version);
  expect(result.availability.history).toHaveLength(historyLength);
  return result.availability;
};

describe("equipment availability use cases", () => {
  it("suspends and resumes equipment while preserving the full ordered history", async () => {
    const { suspend, resume, getAvailability, setNow } = setup();

    const suspended = await suspend.execute(suspendCommand);
    expect(suspended.ok).toBe(true);

    setNow(secondTime);
    const resumed = await resume.execute(resumeCommand);
    expect(resumed.ok).toBe(true);

    const availability = await expectSnapshot(getAvailability, "available", 2, 2);
    expect(availability.history.map((change) => change.kind)).toEqual(["suspended", "resumed"]);
    expect(availability.history.map((change) => change.version)).toEqual([1, 2]);
    expect(availability.history[0]).toMatchObject({
      kind: "suspended",
      reason: "spindle failure",
      performedBy: new UserId("admin-1"),
      occurredAt: firstTime,
    });
    expect(availability.history[1]).toMatchObject({
      kind: "resumed",
      performedBy: new UserId("admin-2"),
      occurredAt: secondTime,
    });
  });

  it("accepts long free-text reasons without changing internal whitespace", async () => {
    const { suspend } = setup();
    const longReason = `first line\n\t${"x".repeat(10_000)}  final`;

    const result = await suspend.execute({ ...suspendCommand, reason: ` \n${longReason}\t ` });

    expect(result.ok).toBe(true);
    if (!result.ok || result.change.kind !== "suspended") {
      throw new Error("Expected suspension to succeed");
    }
    expect(result.change.reason).toBe(longReason);
  });

  it.each(["", "   ", "\t\n "])("rejects an empty reason %j without a change", async (reason) => {
    const { suspend, getAvailability } = setup();

    const result = await suspend.execute({ ...suspendCommand, reason });

    expect(result).toEqual({ ok: false, reason: "suspension-reason-is-empty" });
    await expectSnapshot(getAvailability, "available", 0, 0);
  });

  it("rejects non-administrators and unknown equipment", async () => {
    const { suspend, resume, getAvailability } = setup();

    await expect(suspend.execute({ ...suspendCommand, isAdministrator: false })).resolves.toEqual({
      ok: false,
      reason: "executor-is-not-administrator",
    });
    await expect(
      resume.execute({ ...resumeCommand, expectedVersion: 0, isAdministrator: false }),
    ).resolves.toEqual({ ok: false, reason: "executor-is-not-administrator" });
    await expect(
      getAvailability.execute({ ...getCommand, isAdministrator: false }),
    ).resolves.toEqual({ ok: false, reason: "executor-is-not-administrator" });
    await expect(
      suspend.execute({ ...suspendCommand, managementNumber: "missing" }),
    ).resolves.toEqual({ ok: false, reason: "equipment-not-found" });
    await expect(
      getAvailability.execute({ ...getCommand, managementNumber: "missing" }),
    ).resolves.toEqual({ ok: false, reason: "equipment-not-found" });
    await expectSnapshot(getAvailability, "available", 0, 0);
  });

  it("rejects repeated transitions without overwriting the original history", async () => {
    const { suspend, resume, getAvailability } = setup();

    await suspend.execute(suspendCommand);
    await expect(
      suspend.execute({ ...suspendCommand, expectedVersion: 1, reason: "different reason" }),
    ).resolves.toEqual({ ok: false, reason: "equipment-already-suspended" });
    let availability = await expectSnapshot(getAvailability, "suspended", 1, 1);
    expect(availability.history[0]).toMatchObject({ reason: "spindle failure" });

    await resume.execute(resumeCommand);
    await expect(resume.execute({ ...resumeCommand, expectedVersion: 2 })).resolves.toEqual({
      ok: false,
      reason: "equipment-already-available",
    });
    availability = await expectSnapshot(getAvailability, "available", 2, 2);
    expect(availability.history.map((change) => change.version)).toEqual([1, 2]);
  });

  it("allows equal transition times and orders them by version", async () => {
    const { suspend, resume, getAvailability } = setup();

    await suspend.execute(suspendCommand);
    await resume.execute(resumeCommand);

    const availability = await expectSnapshot(getAvailability, "available", 2, 2);
    expect(availability.history[0]?.occurredAt).toBe(firstTime);
    expect(availability.history[1]?.occurredAt).toBe(firstTime);
    expect(availability.history.map((change) => change.version)).toEqual([1, 2]);
  });

  it("rejects suspension and resumption times before the previous transition", async () => {
    const { suspend, resume, getAvailability, setNow } = setup();

    await suspend.execute(suspendCommand);
    setNow(Instant.from("2026-09-01T01:00:00.123456788Z"));
    await expect(resume.execute(resumeCommand)).resolves.toEqual({
      ok: false,
      reason: "transition-time-before-previous",
    });
    await expectSnapshot(getAvailability, "suspended", 1, 1);

    setNow(secondTime);
    await resume.execute(resumeCommand);
    setNow(firstTime);
    await expect(suspend.execute({ ...suspendCommand, expectedVersion: 2 })).resolves.toEqual({
      ok: false,
      reason: "transition-time-before-previous",
    });
    await expectSnapshot(getAvailability, "available", 2, 2);
  });

  it("records the clock value obtained inside the atomic decision", async () => {
    const { store, suspend, getAvailability, setNow } = setup();
    store.beforeDecision = () => setNow(secondTime);

    await suspend.execute(suspendCommand);

    const availability = await expectSnapshot(getAvailability, "suspended", 1, 1);
    expect(availability.history[0]?.occurredAt).toBe(secondTime);
  });

  it("prefers a stale version over the current-state rejection", async () => {
    const { suspend, resume, getAvailability } = setup();

    await suspend.execute(suspendCommand);
    await resume.execute(resumeCommand);

    await expect(suspend.execute(suspendCommand)).resolves.toEqual({
      ok: false,
      reason: "equipment-state-changed",
    });
    await expect(resume.execute(resumeCommand)).resolves.toEqual({
      ok: false,
      reason: "equipment-state-changed",
    });
    await expectSnapshot(getAvailability, "available", 2, 2);
  });

  it("does not let an old resume request undo a newer suspension", async () => {
    const { suspend, resume, getAvailability } = setup();

    await suspend.execute(suspendCommand);
    await resume.execute(resumeCommand);
    await suspend.execute({ ...suspendCommand, expectedVersion: 2, reason: "inspection" });

    await expect(resume.execute(resumeCommand)).resolves.toEqual({
      ok: false,
      reason: "equipment-state-changed",
    });
    const availability = await expectSnapshot(getAvailability, "suspended", 3, 3);
    expect(availability.history[2]).toMatchObject({ kind: "suspended", reason: "inspection" });
  });

  it("commits only the first of two requests based on the same version", async () => {
    const { suspend, getAvailability } = setup();

    const first = await suspend.execute(suspendCommand);
    const second = await suspend.execute({ ...suspendCommand, performedBy: "admin-2" });

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "equipment-state-changed" });
    const availability = await expectSnapshot(getAvailability, "suspended", 1, 1);
    expect(availability.history[0]).toMatchObject({ performedBy: new UserId("admin-1") });
  });

  it("leaves state, version, and history unchanged when the atomic commit fails", async () => {
    const { store, suspend, getAvailability } = setup();
    store.failAfterDecision = true;

    await expect(suspend.execute(suspendCommand)).rejects.toThrow("simulated commit failure");

    await expectSnapshot(getAvailability, "available", 0, 0);
  });

  it("returns state and history from one snapshot even if an update follows the read", async () => {
    const { store, getAvailability } = setup();
    store.afterSnapshot = () => {
      const current = store.current("EQ-001");
      if (!current) {
        return;
      }

      const decision: EquipmentAvailabilityChangeResult = current.equipment.suspend({
        performedBy: new UserId("admin-1"),
        isAdministrator: true,
        reason: "updated during read",
        occurredAt: firstTime,
      });
      store.apply(decision);
    };

    const result = await getAvailability.execute(getCommand);

    expect(result).toEqual({
      ok: true,
      availability: {
        managementNumber: "EQ-001",
        status: "available",
        version: 0,
        history: [],
      },
    });
    expect(store.current("EQ-001")?.equipment.isSuspended).toBe(true);
  });

  it("rejects a reservation when suspension wins during its final commit", async () => {
    const { store, suspend, getAvailability } = setup();
    const tryCommit = vi.fn(async () => {
      await suspend.execute(suspendCommand);
      return store.current("EQ-001")?.equipment.isSuspended
        ? ("equipment-is-suspended" as const)
        : ("committed" as const);
    });
    const reserveEquipment = new ReserveEquipment({
      equipmentRepository: {
        findByManagementNumber: async () => store.current("EQ-001")?.equipment,
      },
      reservationQuery: { findOverlapping: async () => [] },
      reservationCommitter: { tryCommit },
      reservationIdGenerator: { next: () => new ReservationId("reservation-new") },
      clock: { now: () => Instant.from("2026-09-01T00:59:59.999Z") },
    });

    const result = await reserveEquipment.execute({
      userId: "user-1",
      managementNumber: "EQ-001",
      startsAt: "2026-09-01T10:00",
      endsAt: "2026-09-01T11:00",
    });

    expect(result).toEqual({ ok: false, reason: "equipment-is-suspended" });
    expect(tryCommit).toHaveBeenCalledOnce();
    await expectSnapshot(getAvailability, "suspended", 1, 1);
  });

  it("rejects a loan when suspension wins during its final commit", async () => {
    const { store, suspend, getAvailability } = setup();
    const periodResult = ReservationPeriod.create("2026-09-01T10:00", "2026-09-01T11:00");
    if (!periodResult.ok) {
      throw new Error("Expected a valid reservation period");
    }
    const reservation = new Reservation({
      id: new ReservationId("reservation-1"),
      userId: new UserId("user-1"),
      managementNumber,
      period: periodResult.period,
    });
    const tryCommit = vi.fn(async () => {
      await suspend.execute(suspendCommand);
      return store.current("EQ-001")?.equipment.isSuspended
        ? ("equipment-suspended" as const)
        : ("loaned" as const);
    });
    const loanEquipment = new LoanEquipment({
      reservationRepository: { findById: async () => reservation },
      equipmentRepository: {
        findByManagementNumber: async () => store.current("EQ-001")?.equipment,
      },
      unreturnedLoanQuery: { findByManagementNumber: async () => undefined },
      loanCommitter: { tryCommit },
      clock: { now: () => firstTime },
    });

    const result = await loanEquipment.execute({
      reservationId: "reservation-1",
      processedBy: "admin-1",
      isAdministrator: true,
      recipientId: "user-1",
    });

    expect(result).toEqual({ ok: false, reason: "equipment-is-suspended" });
    expect(tryCommit).toHaveBeenCalledOnce();
    await expectSnapshot(getAvailability, "suspended", 1, 1);
  });

  it("makes suspension and resumption visible to reservation and loan use cases", async () => {
    const { store, suspend, resume, setNow } = setup();
    await suspend.execute(suspendCommand);
    const periodResult = ReservationPeriod.create("2026-09-01T10:00", "2026-09-01T11:00");
    if (!periodResult.ok) {
      throw new Error("Expected a valid reservation period");
    }
    const reservation = new Reservation({
      id: new ReservationId("reservation-1"),
      userId: new UserId("user-1"),
      managementNumber,
      period: periodResult.period,
    });
    const equipmentRepository = {
      findByManagementNumber: async () => store.current("EQ-001")?.equipment,
    };
    const reservationCommitter = { tryCommit: vi.fn().mockResolvedValue("committed") };
    const reserveEquipment = new ReserveEquipment({
      equipmentRepository,
      reservationQuery: { findOverlapping: async () => [] },
      reservationCommitter,
      reservationIdGenerator: { next: () => new ReservationId("reservation-new") },
      clock: { now: () => Instant.from("2026-09-01T00:59:59.999Z") },
    });
    const loanCommitter = { tryCommit: vi.fn().mockResolvedValue("loaned") };
    const loanEquipment = new LoanEquipment({
      reservationRepository: { findById: async () => reservation },
      equipmentRepository,
      unreturnedLoanQuery: { findByManagementNumber: async () => undefined },
      loanCommitter,
      clock: { now: () => firstTime },
    });

    await expect(
      reserveEquipment.execute({
        userId: "user-2",
        managementNumber: "EQ-001",
        startsAt: "2026-09-01T10:00",
        endsAt: "2026-09-01T11:00",
      }),
    ).resolves.toEqual({ ok: false, reason: "equipment-is-suspended" });
    await expect(
      loanEquipment.execute({
        reservationId: "reservation-1",
        processedBy: "admin-1",
        isAdministrator: true,
        recipientId: "user-1",
      }),
    ).resolves.toEqual({ ok: false, reason: "equipment-is-suspended" });
    expect(reservationCommitter.tryCommit).not.toHaveBeenCalled();
    expect(loanCommitter.tryCommit).not.toHaveBeenCalled();

    setNow(secondTime);
    await resume.execute(resumeCommand);
    expect(
      (
        await reserveEquipment.execute({
          userId: "user-2",
          managementNumber: "EQ-001",
          startsAt: "2026-09-01T10:00",
          endsAt: "2026-09-01T11:00",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await loanEquipment.execute({
          reservationId: "reservation-1",
          processedBy: "admin-1",
          isAdministrator: true,
          recipientId: "user-1",
        })
      ).ok,
    ).toBe(true);
  });
});
