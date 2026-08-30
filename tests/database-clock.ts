import { type Pool } from "pg";

// Only test connections put this schema before pg_catalog in search_path.
// SQL and transactions stay real; each clock read consumes the next controlled instant.
export const installDatabaseClock = async (pool: Pool): Promise<void> => {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS test_clock;
    CREATE TABLE IF NOT EXISTS test_clock.moments (values timestamptz[] NOT NULL);
    CREATE SEQUENCE IF NOT EXISTS test_clock.tick;
    CREATE OR REPLACE FUNCTION test_clock.clock_timestamp() RETURNS timestamptz
    LANGUAGE plpgsql VOLATILE AS $$
    DECLARE moments timestamptz[];
    BEGIN
      SELECT values INTO moments FROM test_clock.moments LIMIT 1;
      IF moments IS NULL THEN RETURN pg_catalog.clock_timestamp(); END IF;
      RETURN moments[least(nextval('test_clock.tick'), cardinality(moments))];
    END;
    $$;
  `);
};

export const setDatabaseClock = async (pool: Pool, ...moments: string[]): Promise<void> => {
  await pool.query("TRUNCATE test_clock.moments");
  await pool.query("ALTER SEQUENCE test_clock.tick RESTART WITH 1");
  if (moments.length > 0) {
    await pool.query("INSERT INTO test_clock.moments VALUES ($1::timestamptz[])", [moments]);
  }
};
