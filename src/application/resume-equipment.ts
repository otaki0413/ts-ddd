import { type Equipment, type EquipmentResumed } from "../domain/equipment.js";
import { ManagementNumber, UserId } from "../domain/identifiers.js";
import { type Clock } from "./clock.js";
import { type EquipmentAvailabilityCommitter } from "./equipment-availability.js";

export interface ResumeEquipmentCommand {
  managementNumber: string;
  expectedVersion: number;
  performedBy: string;
  isAdministrator: boolean;
}

export type ResumeEquipmentFailureReason =
  | "equipment-not-found"
  | "equipment-state-changed"
  | "executor-is-not-administrator"
  | "equipment-already-available"
  | "transition-time-before-previous";

export type ResumeEquipmentResult =
  | {
      ok: true;
      equipment: Equipment;
      change: EquipmentResumed;
    }
  | { ok: false; reason: ResumeEquipmentFailureReason };

interface ResumeEquipmentDependencies {
  equipmentAvailabilityCommitter: EquipmentAvailabilityCommitter;
  clock: Clock;
}

export class ResumeEquipment {
  readonly #dependencies: ResumeEquipmentDependencies;

  constructor(dependencies: ResumeEquipmentDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(command: ResumeEquipmentCommand): Promise<ResumeEquipmentResult> {
    const result = await this.#dependencies.equipmentAvailabilityCommitter.tryCommit(
      new ManagementNumber(command.managementNumber),
      command.expectedVersion,
      (equipment) =>
        equipment.resume({
          performedBy: new UserId(command.performedBy),
          isAdministrator: command.isAdministrator,
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
