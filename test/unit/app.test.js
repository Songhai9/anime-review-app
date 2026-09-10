import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import request from "supertest";

class FakePool {
  on() {}
}

mock.module("pg", { exports: { default: { Pool: FakePool } } });

const { db } = await import("../../db.js");
const { app } = await import("../../index.js");

const originalQuery = db.query;

afterEach(() => {
  db.query = originalQuery;
});

describe("service probes", () => {
  test("GET /health reports a healthy service without querying PostgreSQL", async () => {
    db.query = async () => assert.fail("health must not query the database");

    const response = await request(app).get("/health");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      status: "ok",
      service: "anime-manga-notes",
    });
  });

  test("GET /ready reports a connected database", async () => {
    db.query = async (sql) => {
      assert.equal(sql, "SELECT 1");
      return { rows: [{ "?column?": 1 }] };
    };

    const response = await request(app).get("/ready");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      status: "ready",
      database: "connected",
    });
  });

  test("GET /ready reports an unavailable database", async (context) => {
    db.query = async () => {
      throw new Error("connection refused");
    };
    context.mock.method(console, "error", () => {});

    const response = await request(app).get("/ready");

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      status: "not ready",
      database: "unavailable",
    });
  });
});

describe("reader pages", () => {
  test("GET / renders the empty state when there are no readers", async () => {
    db.query = async (sql) => {
      assert.match(sql, /FROM readers ORDER BY id/);
      return { rows: [] };
    };

    const response = await request(app).get("/");

    assert.equal(response.status, 200);
    assert.match(response.text, /Anime &amp; Manga Notes/);
    assert.match(response.text, /Create your first reader/);
  });

  test("GET / selects the requested reader and title sort", async () => {
    const queries = [];
    db.query = async (sql, params) => {
      queries.push({ sql, params });
      if (queries.length === 1) {
        return {
          rows: [
            { id: 1, name: "Amina", color: "#112233" },
            { id: 2, name: "Oumar", color: "#445566" },
          ],
        };
      }
      return { rows: [] };
    };

    const response = await request(app).get("/?reader=2&sort=title");

    assert.equal(response.status, 200);
    assert.deepEqual(queries[1].params, [2]);
    assert.match(queries[1].sql, /ORDER BY media\.title ASC/);
    assert.match(response.text, /Oumar/);
  });

  test("GET / falls back to the first reader and rating sort", async () => {
    const queries = [];
    db.query = async (sql, params) => {
      queries.push({ sql, params });
      if (queries.length === 1) {
        return { rows: [{ id: 7, name: "First", color: "#123456" }] };
      }
      return { rows: [] };
    };

    const response = await request(app).get("/?reader=invalid&sort=unknown");

    assert.equal(response.status, 200);
    assert.deepEqual(queries[1].params, [7]);
    assert.match(queries[1].sql, /ORDER BY reader_media\.rating DESC/);
  });

  test("GET /readers/new renders the new-reader form", async () => {
    const response = await request(app).get("/readers/new");

    assert.equal(response.status, 200);
    assert.match(response.text, /Add a reader/);
    assert.match(response.text, /#7b4a2d/);
  });

  test("POST /readers rejects invalid input without querying PostgreSQL", async () => {
    db.query = async () => assert.fail("invalid input must not query the database");

    const response = await request(app)
      .post("/readers")
      .type("form")
      .send({ name: "", color: "red" });

    assert.equal(response.status, 400);
    assert.match(response.text, /Enter a name and choose a valid profile color/);
  });

  test("POST /readers trims valid input and redirects to the new reader", async () => {
    db.query = async (sql, params) => {
      assert.match(sql, /INSERT INTO readers/);
      assert.deepEqual(params, ["Spike", "#abcdef"]);
      return { rows: [{ id: 42 }] };
    };

    const response = await request(app)
      .post("/readers")
      .type("form")
      .send({ name: "  Spike  ", color: "#abcdef" });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, "/?reader=42");
  });

  test("POST /readers renders a conflict for duplicate names", async () => {
    db.query = async () => {
      const error = new Error("duplicate key");
      error.code = "23505";
      throw error;
    };

    const response = await request(app)
      .post("/readers")
      .type("form")
      .send({ name: "Spike", color: "#abcdef" });

    assert.equal(response.status, 409);
    assert.match(response.text, /already exists/);
  });
});

describe("error handling", () => {
  test("unknown routes render the application 404 page", async () => {
    const response = await request(app).get("/does-not-exist");

    assert.equal(response.status, 404);
    assert.match(response.text, /Page not found/);
  });

  test("unexpected route errors render the safe 500 page", async (context) => {
    db.query = async () => {
      throw new Error("database details that must not leak");
    };
    context.mock.method(console, "error", () => {});

    const response = await request(app).get("/");

    assert.equal(response.status, 500);
    assert.match(response.text, /Application error/);
    assert.doesNotMatch(response.text, /database details that must not leak/);
  });
});
