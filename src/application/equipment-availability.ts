import {
  type Equipment,
  type EquipmentAvailabilityChange,
  type EquipmentAvailabilityChangeFailureReason,
  type EquipmentAvailabilityChangeResult,
} from "../domain/equipment.js";
import { type ManagementNumber } from "../domain/identifiers.js";

export type DecideEquipmentAvailabilityChange<
  Change extends EquipmentAvailabilityChange = EquipmentAvailabilityChange,
  FailureReason extends EquipmentAvailabilityChangeFailureReason =
    EquipmentAvailabilityChangeFailureReason,
> = (equipment: Equipment) => EquipmentAvailabilityChangeResult<Change, FailureReason>;

export type EquipmentAvailabilityCommitResult<
  Change extends EquipmentAvailabilityChange = EquipmentAvailabilityChange,
  FailureReason extends EquipmentAvailabilityChangeFailureReason =
    EquipmentAvailabilityChangeFailureReason,
> =
  | {
      kind: "committed";
      equipment: Equipment;
      change: Change;
    }
  | { kind: "equipment-not-found" }
  | { kind: "equipment-version-changed" }
  | {
      kind: "rejected";
      reason: FailureReason;
    };

export interface EquipmentAvailabilityCommitter {
  tryCommit<
    Change extends EquipmentAvailabilityChange,
    FailureReason extends EquipmentAvailabilityChangeFailureReason,
  >(
    managementNumber: ManagementNumber,
    expectedVersion: number,
    decide: DecideEquipmentAvailabilityChange<Change, FailureReason>,
  ): Promise<EquipmentAvailabilityCommitResult<Change, FailureReason>>;
}

export interface EquipmentAvailabilitySnapshot {
  readonly equipment: Equipment;
  readonly history: readonly EquipmentAvailabilityChange[];
}

export interface EquipmentAvailabilitySnapshotReader {
  findByManagementNumber(
    managementNumber: ManagementNumber,
  ): Promise<EquipmentAvailabilitySnapshot | undefined>;
}
