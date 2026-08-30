import { type EquipmentAvailabilityChange, type EquipmentStatus } from "../domain/equipment.js";
import { ManagementNumber } from "../domain/identifiers.js";
import { type EquipmentAvailabilitySnapshotReader } from "./equipment-availability.js";

export interface GetEquipmentAvailabilityCommand {
  managementNumber: string;
  isAdministrator: boolean;
}

export interface EquipmentAvailabilityView {
  readonly managementNumber: string;
  readonly status: EquipmentStatus;
  readonly version: number;
  readonly history: readonly EquipmentAvailabilityChange[];
}

export type GetEquipmentAvailabilityResult =
  | { ok: true; availability: EquipmentAvailabilityView }
  | {
      ok: false;
      reason: "executor-is-not-administrator" | "equipment-not-found";
    };

interface GetEquipmentAvailabilityDependencies {
  equipmentAvailabilitySnapshotReader: EquipmentAvailabilitySnapshotReader;
}

export class GetEquipmentAvailability {
  readonly #dependencies: GetEquipmentAvailabilityDependencies;

  constructor(dependencies: GetEquipmentAvailabilityDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(command: GetEquipmentAvailabilityCommand): Promise<GetEquipmentAvailabilityResult> {
    if (!command.isAdministrator) {
      return { ok: false, reason: "executor-is-not-administrator" };
    }

    const snapshot =
      await this.#dependencies.equipmentAvailabilitySnapshotReader.findByManagementNumber(
        new ManagementNumber(command.managementNumber),
      );

    if (!snapshot) {
      return { ok: false, reason: "equipment-not-found" };
    }

    return {
      ok: true,
      availability: {
        managementNumber: snapshot.equipment.managementNumber.value,
        status: snapshot.equipment.status,
        version: snapshot.equipment.version,
        history: [...snapshot.history].sort((left, right) => left.version - right.version),
      },
    };
  }
}
