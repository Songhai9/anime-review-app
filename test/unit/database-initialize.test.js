import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";

class FakePool {
  constructor() { this.statements = []; }
  on() {}
  async query(sql) { this.statements.push(sql); return { rows: [] }; }
}

mock.module("pg", { exports: { default: { Pool: FakePool } } });

const { db } = await import("../../api/db.js");
const { initializeDatabase } = await import("../../api/database/initialize.js");

afterEach(() => {
  db.statements.length = 0;
  delete process.env.DATABASE_SEED;
});

describe("database initialization", () => {
  test("always applies the idempotent application schema", async () => {
    await initializeDatabase();

    assert.equal(db.statements.length, 1);
    assert.match(db.statements[0], /CREATE TABLE IF NOT EXISTS readers/);
    assert.match(db.statements[0], /CREATE TABLE IF NOT EXISTS reader_media/);
  });

  test("loads demo data only when explicitly enabled", async () => {
    process.env.DATABASE_SEED = "true";
    await initializeDatabase();

    assert.equal(db.statements.length, 2);
    assert.match(db.statements[1], /INSERT INTO readers/);
    assert.match(db.statements[1], /ON CONFLICT/);
  });
});
