export class ManagementNumber {
  constructor(readonly value: string) {}

  equals(other: ManagementNumber): boolean {
    return this.value === other.value;
  }
}

export class ReservationId {
  constructor(readonly value: string) {}
}

export class UserId {
  constructor(readonly value: string) {}
}
