import { ManagementNumber, UserId } from "../domain/identifiers.js";
import {
  type EquipmentAvailabilityCommitResult,
  type EquipmentAvailabilityStore,
} from "./equipment-availability-store.js";

export interface ResumeEquipmentCommand {
  managementNumber: string;
  expectedVersion: bigint;
  performedBy: string;
  isAdministrator: boolean;
}

interface ResumeEquipmentDependencies {
  store: EquipmentAvailabilityStore;
}

export class ResumeEquipment {
  readonly #dependencies: ResumeEquipmentDependencies;

  constructor(dependencies: ResumeEquipmentDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(command: ResumeEquipmentCommand): Promise<EquipmentAvailabilityCommitResult> {
    return this.#dependencies.store.tryChange(
      new ManagementNumber(command.managementNumber),
      (equipment, confirmedAt) =>
        equipment.resume({
          expectedVersion: command.expectedVersion,
          performedBy: new UserId(command.performedBy),
          isAdministrator: command.isAdministrator,
          now: confirmedAt,
        }),
    );
  }
}
