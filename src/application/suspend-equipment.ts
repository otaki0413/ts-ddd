import { type Equipment, type EquipmentSuspended } from "../domain/equipment.js";
import { ManagementNumber, UserId } from "../domain/identifiers.js";
import { type Clock } from "./clock.js";
import { type EquipmentAvailabilityCommitter } from "./equipment-availability.js";

export interface SuspendEquipmentCommand {
  managementNumber: string;
  expectedVersion: number;
  performedBy: string;
  isAdministrator: boolean;
  reason: string;
}

export type SuspendEquipmentFailureReason =
  | "equipment-not-found"
  | "equipment-state-changed"
  | "executor-is-not-administrator"
  | "equipment-already-suspended"
  | "suspension-reason-is-empty"
  | "transition-time-before-previous";

export type SuspendEquipmentResult =
  | {
      ok: true;
      equipment: Equipment;
      change: EquipmentSuspended;
    }
  | { ok: false; reason: SuspendEquipmentFailureReason };

interface SuspendEquipmentDependencies {
  equipmentAvailabilityCommitter: EquipmentAvailabilityCommitter;
  clock: Clock;
}

export class SuspendEquipment {
  readonly #dependencies: SuspendEquipmentDependencies;

  constructor(dependencies: SuspendEquipmentDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(command: SuspendEquipmentCommand): Promise<SuspendEquipmentResult> {
    const result = await this.#dependencies.equipmentAvailabilityCommitter.tryCommit(
      new ManagementNumber(command.managementNumber),
      command.expectedVersion,
      (equipment) =>
        equipment.suspend({
          performedBy: new UserId(command.performedBy),
          isAdministrator: command.isAdministrator,
          reason: command.reason,
          occurredAt: this.#dependencies.clock.now(),
        }),
    );

    if (result.kind === "committed") {
      return { ok: true, equipment: result.equipment, change: result.change };
    }

    if (result.kind === "equipment-not-found") {
      return { ok: false, reason: "equipment-not-found" };
    }

    if (result.kind === "equipment-version-changed") {
      return { ok: false, reason: "equipment-state-changed" };
    }

    return { ok: false, reason: result.reason };
  }
}
