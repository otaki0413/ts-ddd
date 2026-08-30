import { ManagementNumber } from "../domain/identifiers";
import {
  type EquipmentAvailabilitySnapshot,
  type EquipmentAvailabilityStore,
} from "./equipment-availability-store";

export interface GetEquipmentAvailabilityQuery {
  managementNumber: string;
  isAdministrator: boolean;
}

export type GetEquipmentAvailabilityResult =
  | ({ ok: true } & EquipmentAvailabilitySnapshot)
  | { ok: false; reason: "equipment-not-found" | "executor-is-not-administrator" };

interface GetEquipmentAvailabilityDependencies {
  store: EquipmentAvailabilityStore;
}

export class GetEquipmentAvailability {
  readonly #dependencies: GetEquipmentAvailabilityDependencies;

  constructor(dependencies: GetEquipmentAvailabilityDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(query: GetEquipmentAvailabilityQuery): Promise<GetEquipmentAvailabilityResult> {
    if (!query.isAdministrator) {
      return { ok: false, reason: "executor-is-not-administrator" };
    }

    const snapshot = await this.#dependencies.store.read(
      new ManagementNumber(query.managementNumber),
    );
    if (!snapshot) {
      return { ok: false, reason: "equipment-not-found" };
    }
    return { ok: true, ...snapshot };
  }
}
