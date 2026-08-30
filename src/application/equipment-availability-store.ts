import {
  type Equipment,
  type EquipmentAvailabilityChange,
  type EquipmentAvailabilityChangeResult,
} from "../domain/equipment";
import { type ManagementNumber } from "../domain/identifiers";
import { type Instant } from "../domain/reservation-date-time";

export interface EquipmentAvailabilitySnapshot {
  readonly equipment: Equipment;
  readonly history: readonly EquipmentAvailabilityChange[];
}

export type EquipmentAvailabilityCommitResult =
  | EquipmentAvailabilityChangeResult
  | { ok: false; reason: "equipment-not-found" };

export interface EquipmentAvailabilityStore {
  // 同じ確定時点の状態・版と、その版までの履歴を版の昇順で返す。
  read(managementNumber: ManagementNumber): Promise<EquipmentAvailabilitySnapshot | undefined>;

  // 予約・貸出と同じ管理番号の原子的な確定境界内で、最新の機材と成立時点の
  // システム日時を渡す。transition は副作用のない同期処理で、自動再試行しない。
  // 成功結果の状態・版・履歴を一括保存してから返す。拒否や保存失敗時は全て未変更。
  tryChange(
    managementNumber: ManagementNumber,
    transition: (equipment: Equipment, confirmedAt: Instant) => EquipmentAvailabilityChangeResult,
  ): Promise<EquipmentAvailabilityCommitResult>;
}
