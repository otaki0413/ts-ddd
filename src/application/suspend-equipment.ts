import { ManagementNumber, UserId } from "../domain/identifiers.js";
import {
  type EquipmentAvailabilityCommitResult,
  type EquipmentAvailabilityStore,
} from "./equipment-availability-store.js";

export interface SuspendEquipmentCommand {
  managementNumber: string;
  expectedVersion: bigint;
  performedBy: string;
  isAdministrator: boolean;
  reason: string;
}

interface SuspendEquipmentDependencies {
  store: EquipmentAvailabilityStore;
}

export class SuspendEquipment {
  readonly #dependencies: SuspendEquipmentDependencies;

  constructor(dependencies: SuspendEquipmentDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(command: SuspendEquipmentCommand): Promise<EquipmentAvailabilityCommitResult> {
    return this.#dependencies.store.tryChange(
      new ManagementNumber(command.managementNumber),
      (equipment, confirmedAt) =>
        equipment.suspend({
          expectedVersion: command.expectedVersion,
          performedBy: new UserId(command.performedBy),
          isAdministrator: command.isAdministrator,
          reason: command.reason,
          now: confirmedAt,
        }),
    );
  }
}
