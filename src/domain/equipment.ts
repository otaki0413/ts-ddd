import { type ManagementNumber } from "./identifiers.js";

type EquipmentStatus = "available" | "suspended";

export class Equipment {
  private constructor(
    readonly managementNumber: ManagementNumber,
    readonly status: EquipmentStatus,
  ) {}

  static available(managementNumber: ManagementNumber): Equipment {
    return new Equipment(managementNumber, "available");
  }

  static suspended(managementNumber: ManagementNumber): Equipment {
    return new Equipment(managementNumber, "suspended");
  }

  get isSuspended(): boolean {
    return this.status === "suspended";
  }
}
