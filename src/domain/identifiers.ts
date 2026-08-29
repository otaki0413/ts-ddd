export class ManagementNumber {
  constructor(readonly value: string) {}

  equals(other: ManagementNumber): boolean {
    return this.value === other.value;
  }
}

export class ReservationId {
  constructor(readonly value: string) {}

  equals(other: ReservationId): boolean {
    return this.value === other.value;
  }
}

export class UserId {
  constructor(readonly value: string) {}

  equals(other: UserId): boolean {
    return this.value === other.value;
  }
}
