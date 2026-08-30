import { type ManagementNumber, type UserId } from "./identifiers.js";
import { type Instant } from "./reservation-date-time.js";

export type EquipmentStatus = "available" | "suspended";

export interface EquipmentSuspended {
  readonly kind: "suspended";
  readonly managementNumber: ManagementNumber;
  readonly version: number;
  readonly reason: string;
  readonly performedBy: UserId;
  readonly occurredAt: Instant;
}

export interface EquipmentResumed {
  readonly kind: "resumed";
  readonly managementNumber: ManagementNumber;
  readonly version: number;
  readonly performedBy: UserId;
  readonly occurredAt: Instant;
}

export type EquipmentAvailabilityChange = EquipmentSuspended | EquipmentResumed;

interface ChangeAvailabilityRequest {
  performedBy: UserId;
  isAdministrator: boolean;
  occurredAt: Instant;
}

export interface SuspendEquipmentRequest extends ChangeAvailabilityRequest {
  reason: string;
}

export type EquipmentAvailabilityChangeFailureReason =
  | "executor-is-not-administrator"
  | "equipment-already-suspended"
  | "equipment-already-available"
  | "suspension-reason-is-empty"
  | "transition-time-before-previous";

export type EquipmentAvailabilityChangeResult<
  Change extends EquipmentAvailabilityChange = EquipmentAvailabilityChange,
  FailureReason extends EquipmentAvailabilityChangeFailureReason =
    EquipmentAvailabilityChangeFailureReason,
> =
  | {
      ok: true;
      equipment: Equipment;
      change: Change;
    }
  | { ok: false; reason: FailureReason };

type SuspendEquipmentResult = EquipmentAvailabilityChangeResult<
  EquipmentSuspended,
  Exclude<EquipmentAvailabilityChangeFailureReason, "equipment-already-available">
>;

type ResumeEquipmentResult = EquipmentAvailabilityChangeResult<
  EquipmentResumed,
  Exclude<
    EquipmentAvailabilityChangeFailureReason,
    "equipment-already-suspended" | "suspension-reason-is-empty"
  >
>;

export class Equipment {
  private constructor(
    readonly managementNumber: ManagementNumber,
    readonly status: EquipmentStatus,
    readonly version: number,
    readonly lastTransitionAt: Instant | undefined,
  ) {}

  static available(managementNumber: ManagementNumber): Equipment {
    return new Equipment(managementNumber, "available", 0, undefined);
  }

  static suspended(managementNumber: ManagementNumber): Equipment {
    return new Equipment(managementNumber, "suspended", 0, undefined);
  }

  static restore(properties: {
    managementNumber: ManagementNumber;
    status: EquipmentStatus;
    version: number;
    lastTransitionAt?: Instant;
  }): Equipment {
    return new Equipment(
      properties.managementNumber,
      properties.status,
      properties.version,
      properties.lastTransitionAt,
    );
  }

  get isSuspended(): boolean {
    return this.status === "suspended";
  }

  suspend(request: SuspendEquipmentRequest): SuspendEquipmentResult {
    if (!request.isAdministrator) {
      return { ok: false, reason: "executor-is-not-administrator" };
    }

    if (this.isSuspended) {
      return { ok: false, reason: "equipment-already-suspended" };
    }

    const reason = request.reason.trim();
    if (reason.length === 0) {
      return { ok: false, reason: "suspension-reason-is-empty" };
    }

    if (this.lastTransitionAt && request.occurredAt.isBefore(this.lastTransitionAt)) {
      return { ok: false, reason: "transition-time-before-previous" };
    }

    const version = this.version + 1;
    return {
      ok: true,
      equipment: new Equipment(this.managementNumber, "suspended", version, request.occurredAt),
      change: {
        kind: "suspended",
        managementNumber: this.managementNumber,
        version,
        reason,
        performedBy: request.performedBy,
        occurredAt: request.occurredAt,
      },
    };
  }

  resume(request: ChangeAvailabilityRequest): ResumeEquipmentResult {
    if (!request.isAdministrator) {
      return { ok: false, reason: "executor-is-not-administrator" };
    }

    if (!this.isSuspended) {
      return { ok: false, reason: "equipment-already-available" };
    }

    if (this.lastTransitionAt && request.occurredAt.isBefore(this.lastTransitionAt)) {
      return { ok: false, reason: "transition-time-before-previous" };
    }

    const version = this.version + 1;
    return {
      ok: true,
      equipment: new Equipment(this.managementNumber, "available", version, request.occurredAt),
      change: {
        kind: "resumed",
        managementNumber: this.managementNumber,
        version,
        performedBy: request.performedBy,
        occurredAt: request.occurredAt,
      },
    };
  }
}
