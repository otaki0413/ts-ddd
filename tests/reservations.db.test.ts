import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { createServer } from "vite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { pushSchema } from "drizzle-kit/api";
import { Pool } from "pg";

import { app } from "../src/presentation/app";
import { createReservationServices } from "../src/composition-root";
import * as schema from "../src/infrastructure/postgres/schema";
import { PostgresEquipmentRepository } from "../src/infrastructure/postgres/equipment";
import { ManagementNumber, ReservationId } from "../src/domain/identifiers";
import { Instant } from "../src/domain/reservation-date-time";
import { ReserveEquipment } from "../src/application/reserve-equipment";
import { PostgresReservations } from "../src/infrastructure/postgres/reservations";
import { type ReservationServices } from "../src/composition-root";
import { installDatabaseClock, setDatabaseClock } from "./database-clock";

const testUrl = new URL(process.env.TEST_DATABASE_URL ?? "");
if (
  testUrl.hostname !== "127.0.0.1" ||
  testUrl.port !== "55433" ||
  testUrl.pathname !== "/ts_ddd_test" ||
  testUrl.username !== "ts_ddd_test" ||
  testUrl.search !== ""
) {
  throw new Error(
    "TEST_DATABASE_URL must point to the dedicated local ts_ddd_test database on port 55433",
  );
}
const connectionOptions = {
  connectionString: process.env.TEST_DATABASE_URL,
  max: 1,
  options: "-c search_path=test_clock,public,pg_catalog",
  connectionTimeoutMillis: 2000,
  statement_timeout: 10_000,
};
const pool = new Pool(connectionOptions);
const readerPool = new Pool(connectionOptions);
const controlPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
const db = drizzle(pool);
const { equipment } = schema;
const validCommand = {
  userId: "user-1",
  managementNumber: "EQ-001",
  startsAt: "2099-09-01T10:00",
  endsAt: "2099-09-01T11:00",
};

const post = async (command: unknown = validCommand, services = createReservationServices(db)) =>
  app.request(
    "/reservations",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    },
    { services },
  );

const servicesBeforeCommit = (
  connection: Pool,
  beforeCommit: () => Promise<void>,
  id = randomUUID(),
  applicationNow?: Instant,
): ReservationServices => {
  const database = drizzle(connection);
  const reservations = new PostgresReservations(database);
  return {
    reservationRepository: reservations,
    reserveEquipment: new ReserveEquipment({
      equipmentRepository: new PostgresEquipmentRepository(database),
      reservationQuery: reservations,
      reservationCommitter: {
        tryCommit: async (reservation) => {
          await beforeCommit();
          return reservations.tryCommit(reservation);
        },
      },
      clock: { now: () => applicationNow ?? Instant.from(Temporal.Now.instant().toString()) },
      reservationIdGenerator: { next: () => new ReservationId(id) },
    }),
  };
};

const expectLockWaits = async (pids: number[]) => {
  await expect
    .poll(
      async () => {
        const { rows } = await controlPool.query<{ pid: number }>(
          "SELECT pid FROM pg_stat_activity WHERE pid = ANY($1) AND wait_event_type = 'Lock' AND cardinality(pg_blocking_pids(pid)) > 0 ORDER BY pid",
          [pids],
        );
        return rows.map((row) => row.pid);
      },
      { timeout: 4000, interval: 20 },
    )
    .toEqual([...pids].sort((a, b) => a - b));
};

beforeAll(async () => {
  const push = await pushSchema(schema, drizzle(controlPool), ["public"]);
  if (push.hasDataLoss) throw new Error("Refusing schema push that may lose test data");
  await push.apply();
  await installDatabaseClock(controlPool);
});

beforeEach(async () => {
  await pool.query("TRUNCATE reservations, equipment");
  await setDatabaseClock(controlPool);
  await db
    .insert(equipment)
    .values([{ managementNumber: "EQ-001" }, { managementNumber: "EQ-002" }]);
});

it.each([
  ["domain policy", ["2099-09-01T01:00:00Z"], 201],
  ["domain policy", ["2099-09-01T01:00:00.001Z"], 400],
  ["domain policy", ["2099-09-01T01:00:00.000001Z"], 400],
  [
    "INSERT after the policy allowed it",
    ["2099-09-01T00:59:59.999999Z", "2099-09-01T01:00:00Z"],
    201,
  ],
  [
    "INSERT after the policy allowed it",
    ["2099-09-01T00:59:59.999999Z", "2099-09-01T01:00:00.001Z"],
    400,
  ],
  [
    "INSERT after the policy allowed it",
    ["2099-09-01T00:59:59.999999Z", "2099-09-01T01:00:00.000001Z"],
    400,
  ],
] as const)(
  "uses the database clock without rounding at %s: %j",
  async (_stage, moments, status) => {
    const id = randomUUID();
    const response = await post(
      validCommand,
      servicesBeforeCommit(
        pool,
        async () => {
          await setDatabaseClock(controlPool, ...moments);
        },
        id,
      ),
    );
    expect(response.status).toBe(status);
    if (status === 400) {
      expect(await response.json()).toEqual({ reason: "start-time-is-in-the-past" });
      const read = await app.request(
        `/reservations/${id}`,
        {},
        { services: createReservationServices(drizzle(readerPool)) },
      );
      expect(read.status).toBe(404);
    }
  },
);

it("serves reservation creation, readback, and JSON errors through the actual Vite configuration", async () => {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const server = await createServer({
    configFile: "./vite.config.ts",
    server: { port: 0 },
    logLevel: "silent",
  }).finally(() => {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  });
  try {
    await server.listen();
    const base = server.resolvedUrls?.local[0];
    expect(base).toMatch(/^http:\/\/127\.0\.0\.1:/);
    const created = await fetch(`${base}reservations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validCommand),
    });
    expect(created.status).toBe(201);
    const read = await fetch(new URL(created.headers.get("Location")!, base));
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(await created.json());
    for (const id of ["missing", "missing.js", "missing.ts", "missing.css"]) {
      const response = await fetch(`${base}reservations/${id}`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ reason: "reservation-not-found" });
    }
  } finally {
    await server.close();
  }
});

it.each([
  "{",
  "null",
  "[]",
  "{}",
  '{"userId":1,"managementNumber":"EQ-001","startsAt":"2099-09-01T10:00","endsAt":"2099-09-01T11:00"}',
])("rejects malformed JSON or a structurally invalid request: %s", async (body) => {
  const response = await app.request(
    "/reservations",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    },
    { services: createReservationServices(db) },
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ reason: "invalid-request" });
});

afterAll(async () => {
  await Promise.all([pool.end(), readerPool.end(), controlPool.end()]);
});

it("commits only one overlapping reservation after both prechecks, with two independent connections actually waiting on row locks", async () => {
  const pids = await Promise.all(
    [pool, readerPool].map(async (connection) => {
      const { rows } = await connection.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      return rows[0]!.pid;
    }),
  );
  expect(new Set(pids).size).toBe(2);
  const blocker = await controlPool.connect();
  const gate = Promise.withResolvers<void>();
  let arrivals = 0;
  const beforeCommit = async () => {
    arrivals++;
    await gate.promise;
  };
  const requests: Promise<Response>[] = [];
  try {
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT management_number FROM equipment WHERE management_number = 'EQ-001' FOR UPDATE",
    );
    requests.push(post(validCommand, servicesBeforeCommit(pool, beforeCommit)));
    requests.push(
      post({ ...validCommand, userId: "user-2" }, servicesBeforeCommit(readerPool, beforeCommit)),
    );
    await expect.poll(() => arrivals, { timeout: 4000 }).toBe(2);
    gate.resolve();
    await expectLockWaits(pids);
    await blocker.query("COMMIT");
    const responses = await Promise.all(requests);
    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
    expect(await responses.find((response) => response.status === 409)!.json()).toEqual({
      reason: "reservation-conflict",
    });
    const stored = await controlPool.query(
      "SELECT id FROM reservations WHERE management_number = 'EQ-001'",
    );
    expect(stored.rowCount).toBe(1);
  } finally {
    gate.resolve();
    await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled(requests);
  }
});

it.each([undefined, "text/plain", "application/jsonp"])(
  "rejects a non-JSON Content-Type: %s",
  async (contentType) => {
    const response = await app.request(
      "/reservations",
      {
        method: "POST",
        headers: contentType ? { "Content-Type": contentType } : {},
        body: JSON.stringify(validCommand),
      },
      { services: createReservationServices(db) },
    );
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ reason: "unsupported-media-type" });
  },
);

it.each([
  [{ managementNumber: "unknown" }, 404, "equipment-not-found"],
  [{ startsAt: "2000-01-01T10:00", endsAt: "2000-01-01T11:00" }, 400, "start-time-is-in-the-past"],
  [{ endsAt: "2099-09-01T10:00" }, 400, "invalid-reservation-period"],
  [{ endsAt: "2099-09-01T09:00" }, 400, "invalid-reservation-period"],
  [{ startsAt: "2099-02-29T10:00" }, 400, "invalid-reservation-period"],
  [{ startsAt: "2099-09-01T24:00" }, 400, "invalid-reservation-period"],
  [{ startsAt: "2099-09-01T10:00:00" }, 400, "invalid-reservation-period"],
  [{ startsAt: "2099-09-01T10:00:00.001" }, 400, "invalid-reservation-period"],
  [{ startsAt: "2099-09-01T10:00+09:00" }, 400, "invalid-reservation-period"],
] as const)("maps a domain refusal to the HTTP contract: %j", async (overrides, status, reason) => {
  const response = await post({ ...validCommand, ...overrides });
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ reason });
});

it("rejects a reservation overlapping an existing reservation", async () => {
  expect((await post()).status).toBe(201);
  const response = await post({ ...validCommand, startsAt: "2099-09-01T10:30" });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ reason: "reservation-conflict" });
});

it.each([
  { startsAt: "2099-09-01T09:00", endsAt: "2099-09-01T10:00" },
  { startsAt: "2099-09-01T11:00", endsAt: "2099-09-01T12:00" },
  { startsAt: "2099-09-02T10:00", endsAt: "2099-09-02T11:00" },
  { managementNumber: "EQ-002" },
])("allows touching boundaries, separate periods, and other equipment: %j", async (overrides) => {
  expect((await post()).status).toBe(201);
  const response = await post({ ...validCommand, ...overrides });
  expect(response.status).toBe(201);
  const read = await app.request(
    response.headers.get("Location")!,
    {},
    { services: createReservationServices(drizzle(readerPool)) },
  );
  expect(await read.json()).toEqual(await response.json());
});

it("rejects a suspension committed after the precheck and before final confirmation", async () => {
  const id = randomUUID();
  const services = servicesBeforeCommit(
    pool,
    async () => {
      await controlPool.query(`UPDATE equipment SET status = 'suspended', version = 1,
      last_performed_by = 'admin-1', last_occurred_at_ns = 1780000000123456789,
      suspension_reason = '点検' WHERE management_number = 'EQ-001'`);
    },
    id,
  );
  const response = await post(validCommand, services);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ reason: "equipment-is-suspended" });
  const read = await app.request(
    `/reservations/${id}`,
    {},
    { services: createReservationServices(drizzle(readerPool)) },
  );
  expect(read.status).toBe(404);
});

it("does not confuse a reservation ID collision with a reservation conflict or expose SQL details", async () => {
  const id = randomUUID();
  const services = servicesBeforeCommit(pool, async () => {}, id);
  const first = await post(validCommand, services);
  expect(first.status).toBe(201);
  const failed = await post({ ...validCommand, managementNumber: "EQ-002" }, services);
  expect(failed.status).toBe(500);
  expect(await failed.json()).toEqual({ reason: "internal-error" });
  const read = await app.request(
    `/reservations/${id}`,
    {},
    { services: createReservationServices(drizzle(readerPool)) },
  );
  expect(await read.json()).toEqual(await first.json());
});

it("rolls back an inserted row when a deferred SQL constraint fails before commit completes", async () => {
  const first = await post();
  expect(first.status).toBe(201);
  // Fault injection exists only in this test database; INSERT succeeds, then COMMIT rejects it.
  await controlPool.query(
    "ALTER TABLE reservations ADD CONSTRAINT test_commit_failure UNIQUE (user_id) DEFERRABLE INITIALLY DEFERRED",
  );
  const id = randomUUID();
  try {
    const response = await post(
      { ...validCommand, managementNumber: "EQ-002" },
      servicesBeforeCommit(pool, async () => {}, id),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ reason: "internal-error" });
    const services = createReservationServices(drizzle(readerPool));
    expect((await app.request(`/reservations/${id}`, {}, { services })).status).toBe(404);
    const retained = await app.request(first.headers.get("Location")!, {}, { services });
    expect(await retained.json()).toEqual(await first.json());
  } finally {
    await controlPool.query("ALTER TABLE reservations DROP CONSTRAINT test_commit_failure");
  }
});

it("treats equipment disappearing after precheck as an internal error", async () => {
  const id = randomUUID();
  const response = await post(
    validCommand,
    servicesBeforeCommit(
      pool,
      async () => {
        await controlPool.query("DELETE FROM equipment WHERE management_number = 'EQ-001'");
      },
      id,
    ),
  );
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ reason: "internal-error" });
  expect(
    (
      await app.request(
        `/reservations/${id}`,
        {},
        { services: createReservationServices(drizzle(readerPool)) },
      )
    ).status,
  ).toBe(404);
});

it.each([
  ["2099-09-01T01:00:00.000001Z", 400, "start-time-is-in-the-past"],
  ["2099-09-01T00:59:00Z", 409, "equipment-is-suspended"],
] as const)(
  "prioritizes past start, suspension, then overlap at final confirmation: %s",
  async (now, status, reason) => {
    const id = randomUUID();
    const response = await post(
      validCommand,
      servicesBeforeCommit(
        pool,
        async () => {
          expect(
            (await post(validCommand, createReservationServices(drizzle(readerPool)))).status,
          ).toBe(201);
          await controlPool.query(`UPDATE equipment SET status = 'suspended', version = 1,
      last_performed_by = 'admin-1', last_occurred_at_ns = 1780000000000000000,
      suspension_reason = '点検' WHERE management_number = 'EQ-001'`);
          await setDatabaseClock(controlPool, now);
        },
        id,
      ),
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ reason });
    expect(
      (
        await app.request(
          `/reservations/${id}`,
          {},
          { services: createReservationServices(drizzle(readerPool)) },
        )
      ).status,
    ).toBe(404);
  },
);

it("refuses a start that passes while a separate database connection holds the equipment lock", async () => {
  await setDatabaseClock(controlPool, "2099-09-01T00:59:59Z");
  const {
    rows: [{ pid } = { pid: 0 }],
  } = await pool.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const blocker = await controlPool.connect();
  const gate = Promise.withResolvers<void>();
  let arrived = false;
  let request: Promise<Response> | undefined;
  const id = randomUUID();
  try {
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT management_number FROM equipment WHERE management_number = 'EQ-001' FOR UPDATE",
    );
    request = post(
      validCommand,
      servicesBeforeCommit(
        pool,
        async () => {
          arrived = true;
          await gate.promise;
        },
        id,
      ),
    );
    await expect.poll(() => arrived).toBe(true);
    gate.resolve();
    await expectLockWaits([pid]);
    await setDatabaseClock(controlPool, "2099-09-01T01:00:00.001Z");
    await blocker.query("COMMIT");
    const response = await request;
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ reason: "start-time-is-in-the-past" });
    expect(
      (
        await app.request(
          `/reservations/${id}`,
          {},
          { services: createReservationServices(drizzle(readerPool)) },
        )
      ).status,
    ).toBe(404);
  } finally {
    gate.resolve();
    await blocker.query("ROLLBACK");
    blocker.release();
    await request;
  }
});

it("reports a database lock timeout as an internal error without saving", async () => {
  const blocker = await controlPool.connect();
  const id = randomUUID();
  try {
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT management_number FROM equipment WHERE management_number = 'EQ-001' FOR UPDATE",
    );
    await pool.query("SET lock_timeout = '100ms'");
    const response = await post(
      validCommand,
      servicesBeforeCommit(pool, async () => {}, id),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ reason: "internal-error" });
    expect(
      (
        await app.request(
          `/reservations/${id}`,
          {},
          { services: createReservationServices(drizzle(readerPool)) },
        )
      ).status,
    ).toBe(404);
  } finally {
    await pool.query("SET lock_timeout = 0");
    await blocker.query("ROLLBACK");
    blocker.release();
  }
});

it.each([
  ["0000-01-01T10:00", "0000-01-01T11:00", "-62167216739000"],
  ["9999-12-31T22:00", "9999-12-31T23:59", "253402261200000"],
] as const)(
  "preserves the four-digit year range and Tokyo meaning in a different database timezone: %s",
  async (startsAt, endsAt, storedStart) => {
    await pool.query("SET TIME ZONE 'America/New_York'");
    await readerPool.query("SET TIME ZONE 'Pacific/Honolulu'");
    try {
      await setDatabaseClock(controlPool, "0002-01-01 00:00:00+00 BC");
      const id = randomUUID();
      const command = { ...validCommand, startsAt, endsAt };
      const response = await post(
        command,
        servicesBeforeCommit(pool, async () => {}, id, Instant.from("-000001-01-01T00:00:00Z")),
      );
      expect(response.status).toBe(201);
      const read = await app.request(
        `/reservations/${id}`,
        {},
        { services: createReservationServices(drizzle(readerPool)) },
      );
      expect(await read.json()).toEqual({ ...command, id });
      const { rows } = await controlPool.query<{ starts_at: string }>(
        "SELECT starts_at::text FROM reservations WHERE id = $1",
        [id],
      );
      expect(rows[0]?.starts_at).toBe(storedStart);
    } finally {
      await pool.query("RESET TIME ZONE");
      await readerPool.query("RESET TIME ZONE");
    }
  },
);

it.each(["missing", "00000000-0000-4000-8000-000000000000"])(
  "returns a JSON 404 for an unknown reservation: %s",
  async (id) => {
    const response = await app.request(
      `/reservations/${id}`,
      {},
      { services: createReservationServices(db) },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ reason: "reservation-not-found" });
  },
);

it("rejects an untrimmed suspension reason before it becomes a stored equipment snapshot", async () => {
  await expect(
    pool.query(
      `UPDATE equipment SET status = 'suspended', version = 1,
        last_performed_by = 'admin-1', last_occurred_at_ns = 1780000000123456789,
        suspension_reason = $1 WHERE management_number = 'EQ-001'`,
      [" 点検 "],
    ),
  ).rejects.toMatchObject({ code: "23514", constraint: "consistent_equipment_snapshot" });
  expect((await post()).status).toBe(201);
});

it.each(["suspended", "available"] as const)(
  "restores %s equipment without losing the last change or replaying transitions",
  async (status) => {
    const occurredAt = Instant.from("2026-08-01T01:02:03.123456789Z");
    await pool.query(
      `UPDATE equipment SET status = $1, version = $2,
    last_performed_by = $3, last_occurred_at_ns = $4, suspension_reason = $5
    WHERE management_number = 'EQ-001'`,
      [
        status,
        "98765432109876543210",
        "admin-original",
        occurredAt.epochNanoseconds.toString(),
        status === "suspended" ? "精度確認の点検" : null,
      ],
    );
    const restored = await new PostgresEquipmentRepository(
      drizzle(readerPool),
    ).findByManagementNumber(new ManagementNumber("EQ-001"));
    expect(restored?.status).toBe(status);
    expect(restored?.version).toBe(98765432109876543210n);
    expect(restored?.lastAvailabilityChange).toMatchObject({
      kind: status === "suspended" ? "suspended" : "resumed",
      managementNumber: new ManagementNumber("EQ-001"),
      performedBy: { value: "admin-original" },
    });
    expect(restored?.lastAvailabilityChange?.occurredAt.epochNanoseconds).toBe(
      occurredAt.epochNanoseconds,
    );
    if (status === "suspended") {
      expect(restored?.lastAvailabilityChange).toMatchObject({ reason: "精度確認の点検" });
      const response = await post();
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ reason: "equipment-is-suspended" });
    } else {
      expect((await post()).status).toBe(201);
    }
  },
);

it("creates a reservation and reads it back through a newly composed application on another connection", async () => {
  const command = {
    userId: "user-1",
    managementNumber: "EQ-001",
    startsAt: "2099-09-01T10:00",
    endsAt: "2099-09-01T11:00",
  };
  const response = await app.request(
    "/reservations",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    },
    { services: createReservationServices(db) },
  );

  expect(response.status).toBe(201);
  const created = await response.json();
  expect(created).toEqual({ ...command, id: expect.any(String) });
  const location = response.headers.get("Location");
  expect(location).toMatch(/^\/reservations\/[0-9a-f-]{36}$/);
  const read = await app.request(
    location!,
    {},
    {
      services: createReservationServices(drizzle(readerPool)),
    },
  );
  expect(read.status).toBe(200);
  expect(await read.json()).toEqual(created);
});
