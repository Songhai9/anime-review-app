import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import request from "supertest";

class FakePool { on() {} }

let searchHandler = async () => [];
let mediaHandler = async () => null;

mock.module("pg", { exports: { default: { Pool: FakePool } } });
mock.module(new URL("../../api/services/anilist.js", import.meta.url).href, {
  exports: {
    searchMedia: (...args) => searchHandler(...args),
    getMediaById: (...args) => mediaHandler(...args),
  },
});

const { db } = await import("../../api/db.js");
const { app } = await import("../../api/app.js");
const originalQuery = db.query;
const originalConnect = db.connect;

afterEach(() => {
  db.query = originalQuery;
  db.connect = originalConnect;
  searchHandler = async () => [];
  mediaHandler = async () => null;
});

describe("API probes", () => {
  test("GET /health does not touch PostgreSQL", async () => {
    db.query = async () => assert.fail("health must not query the database");
    const response = await request(app).get("/health");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: "ok", service: "anime-manga-api" });
  });

  test("GET /ready reports connected and unavailable states", async (context) => {
    db.query = async () => ({ rows: [] });
    assert.equal((await request(app).get("/ready")).status, 200);
    context.mock.method(console, "error", () => {});
    db.query = async () => { throw new Error("offline"); };
    const unavailable = await request(app).get("/ready");
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.body.database, "unavailable");
  });
});

describe("reader API", () => {
  test("lists readers", async () => {
    db.query = async () => ({ rows: [{ id: 1, name: "Amina", color: "#123456" }] });
    const response = await request(app).get("/api/readers");
    assert.equal(response.status, 200);
    assert.equal(response.body.readers[0].name, "Amina");
  });

  test("validates, creates, and detects duplicate readers", async () => {
    assert.equal((await request(app).post("/api/readers").send({ name: "", color: "red" })).status, 400);
    db.query = async (_sql, params) => ({ rows: [{ id: 2, name: params[0], color: params[1] }] });
    const created = await request(app).post("/api/readers").send({ name: "  Spike  ", color: "#abcdef" });
    assert.equal(created.status, 201);
    assert.equal(created.body.reader.name, "Spike");
    db.query = async () => { const error = new Error("duplicate"); error.code = "23505"; throw error; };
    assert.equal((await request(app).post("/api/readers").send({ name: "Spike", color: "#abcdef" })).status, 409);
  });

  test("returns a library with a safe server-side sort", async () => {
    const calls = [];
    db.query = async (sql, params) => {
      calls.push({ sql, params });
      if (calls.length === 1) return { rows: [{ id: 7, name: "Reader", color: "#123456" }] };
      return { rows: [{ title: "Berserk", rating: 10 }] };
    };
    const response = await request(app).get("/api/readers/7/library?sort=title");
    assert.equal(response.status, 200);
    assert.equal(response.body.sort, "title");
    assert.match(calls[1].sql, /ORDER BY media\.title ASC/);
    assert.deepEqual(calls[1].params, [7]);
  });

  test("returns 404 for an unknown reader", async () => {
    db.query = async () => ({ rows: [] });
    const response = await request(app).get("/api/readers/404");
    assert.equal(response.status, 404);
    assert.equal(response.body.error, "reader_not_found");
  });
});

describe("catalog API", () => {
  test("validates media types and delegates searches to AniList", async () => {
    assert.equal((await request(app).get("/api/media/search?type=NOVEL&q=Dune")).status, 400);
    searchHandler = async (query, type) => [{ title: `${query}:${type}` }];
    const response = await request(app).get("/api/media/search?type=manga&q=Berserk");
    assert.equal(response.status, 200);
    assert.equal(response.body.results[0].title, "Berserk:MANGA");
  });

  test("returns exact media and a not-found response", async () => {
    mediaHandler = async (id, type) => ({ anilistId: id, mediaType: type, title: "Bebop" });
    const found = await request(app).get("/api/media/anime/25");
    assert.equal(found.status, 200);
    assert.equal(found.body.media.anilistId, 25);
    mediaHandler = async () => null;
    assert.equal((await request(app).get("/api/media/anime/999")).status, 404);
  });
});

describe("review API", () => {
  test("rejects invalid reviews before querying dependencies", async () => {
    db.query = async () => assert.fail("invalid reviews must not query PostgreSQL");
    assert.equal((await request(app).post("/api/readers/1/media").send({ rating: 11 })).status, 400);
  });

  test("creates a review in one transaction", async () => {
    db.query = async () => ({ rows: [{ id: 1, name: "Spike", color: "#123456" }] });
    mediaHandler = async () => ({ anilistId: 25, mediaType: "ANIME", title: "Bebop", author: null, studio: "Sunrise", synopsis: "Space", coverUrl: "cover.jpg" });
    const statements = [];
    db.connect = async () => ({
      async query(sql) {
        statements.push(sql);
        if (sql.includes("INSERT INTO media")) return { rows: [{ id: 8 }] };
        if (sql.includes("INSERT INTO reader_media")) return { rows: [{ id: 9 }] };
        return { rows: [] };
      },
      release() { statements.push("RELEASE"); },
    });
    const response = await request(app).post("/api/readers/1/media").send({ anilistId: 25, mediaType: "ANIME", rating: 9, review: "Great" });
    assert.equal(response.status, 201);
    assert.equal(response.body.entryId, 9);
    assert.deepEqual(statements.filter((sql) => ["BEGIN", "COMMIT", "RELEASE"].includes(sql)), ["BEGIN", "COMMIT", "RELEASE"]);
  });

  test("reads, updates, and rejects missing reviews", async () => {
    db.query = async (sql) => sql.startsWith("SELECT")
      ? { rows: [{ entry_id: 3, title: "Bebop" }] }
      : { rowCount: 1, rows: [{ id: 3 }] };
    assert.equal((await request(app).get("/api/readers/1/media/3")).body.entry.title, "Bebop");
    assert.equal((await request(app).put("/api/readers/1/media/3").send({ rating: 8, review: "Updated" })).status, 200);
    assert.equal((await request(app).put("/api/readers/1/media/3").send({ rating: 0, review: "" })).status, 400);
    db.query = async () => ({ rows: [], rowCount: 0 });
    assert.equal((await request(app).get("/api/readers/1/media/3")).status, 404);
  });

  test("deletes a review and its orphaned media transactionally", async () => {
    db.query = async () => ({ rows: [{ entry_id: 3, media_id: 8 }] });
    const statements = [];
    db.connect = async () => ({
      async query(sql) { statements.push(sql); return { rows: [] }; },
      release() { statements.push("RELEASE"); },
    });
    const response = await request(app).delete("/api/readers/1/media/3");
    assert.equal(response.status, 204);
    assert.ok(statements.some((sql) => sql.includes("DELETE FROM reader_media")));
    assert.ok(statements.some((sql) => sql.includes("DELETE FROM media")));
    assert.ok(statements.includes("COMMIT"));
  });
});

describe("API errors", () => {
  test("returns JSON 404 and safe 500 responses", async (context) => {
    assert.equal((await request(app).get("/api/missing")).body.error, "not_found");
    context.mock.method(console, "error", () => {});
    db.query = async () => { throw new Error("secret database detail"); };
    const response = await request(app).get("/api/readers");
    assert.equal(response.status, 500);
    assert.equal(response.body.error, "internal_error");
    assert.doesNotMatch(JSON.stringify(response.body), /secret database detail/);
  });
});
