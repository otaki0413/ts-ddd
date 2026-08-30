import { type ManagementNumber, type UserId } from "./identifiers.js";
import { type Instant } from "./reservation-date-time.js";

type EquipmentStatus = "available" | "suspended";

export type EquipmentAvailabilityChange = {
  readonly managementNumber: ManagementNumber;
  readonly version: bigint;
  readonly performedBy: UserId;
  readonly occurredAt: Instant;
} & ({ readonly kind: "suspended"; readonly reason: string } | { readonly kind: "resumed" });

export interface ResumeEquipmentRequest {
  expectedVersion: bigint;
  performedBy: UserId;
  isAdministrator: boolean;
  now: Instant;
}

export interface SuspendEquipmentRequest {
  expectedVersion: bigint;
  performedBy: UserId;
  isAdministrator: boolean;
  reason: string;
  now: Instant;
}

export type EquipmentAvailabilityChangeResult =
  | { ok: true; equipment: Equipment; change: EquipmentAvailabilityChange }
  | {
      ok: false;
      reason:
        | "executor-is-not-administrator"
        | "empty-suspension-reason"
        | "already-suspended"
        | "already-available"
        | "equipment-version-changed"
        | "transition-time-before-previous";
    };

export class Equipment {
  private constructor(
    readonly managementNumber: ManagementNumber,
    readonly status: EquipmentStatus,
    readonly lastAvailabilityChange?: EquipmentAvailabilityChange,
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

  get version(): bigint {
    return this.lastAvailabilityChange?.version ?? 0n;
  }

  resume(request: ResumeEquipmentRequest): EquipmentAvailabilityChangeResult {
    if (!request.isAdministrator) {
      return { ok: false, reason: "executor-is-not-administrator" };
    }

    if (request.expectedVersion !== this.version) {
      return { ok: false, reason: "equipment-version-changed" };
    }

    if (!this.isSuspended) {
      return { ok: false, reason: "already-available" };
    }

    if (
      this.lastAvailabilityChange &&
      request.now.isBefore(this.lastAvailabilityChange.occurredAt)
    ) {
      return { ok: false, reason: "transition-time-before-previous" };
    }

    const change: EquipmentAvailabilityChange = {
      kind: "resumed",
      managementNumber: this.managementNumber,
      version: this.version + 1n,
      performedBy: request.performedBy,
      occurredAt: request.now,
    };
    return {
      ok: true,
      equipment: new Equipment(this.managementNumber, "available", change),
      change,
    };
  }

  suspend(request: SuspendEquipmentRequest): EquipmentAvailabilityChangeResult {
    if (!request.isAdministrator) {
      return { ok: false, reason: "executor-is-not-administrator" };
    }

    if (request.expectedVersion !== this.version) {
      return { ok: false, reason: "equipment-version-changed" };
    }

    if (this.isSuspended) {
      return { ok: false, reason: "already-suspended" };
    }

    const reason = request.reason.trim();
    if (reason.length === 0) {
      return { ok: false, reason: "empty-suspension-reason" };
    }

    if (
      this.lastAvailabilityChange &&
      request.now.isBefore(this.lastAvailabilityChange.occurredAt)
    ) {
      return { ok: false, reason: "transition-time-before-previous" };
    }

    const change: EquipmentAvailabilityChange = {
      kind: "suspended",
      managementNumber: this.managementNumber,
      version: this.version + 1n,
      reason,
      performedBy: request.performedBy,
      occurredAt: request.now,
    };
    return {
      ok: true,
      equipment: new Equipment(this.managementNumber, "suspended", change),
      change,
    };
  }
}
