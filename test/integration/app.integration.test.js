import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import request from "supertest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe("PostgreSQL application integration", { skip: !testDatabaseUrl }, () => {
  let app;
  let db;

  before(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DATABASE_SSL = "false";

    ({ db } = await import("../../db.js"));
    ({ app } = await import("../../index.js"));

    const schemaUrl = new URL("../../sql/schema.sql", import.meta.url);
    const schema = await readFile(schemaUrl, "utf8");
    await db.query(schema);
  });

  beforeEach(async () => {
    await db.query("TRUNCATE reader_media, media, readers RESTART IDENTITY CASCADE");
    await db.query(
      `INSERT INTO readers (name, color)
       VALUES ('Integration Reader', '#315f72')`,
    );
  });

  after(async () => {
    if (db) await db.end();
  });

  test("readiness checks the real PostgreSQL connection", async () => {
    const response = await request(app).get("/ready");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      status: "ready",
      database: "connected",
    });
  });

  test("creating a reader persists it and enforces unique names", async () => {
    const created = await request(app)
      .post("/readers")
      .type("form")
      .send({ name: "New Reader", color: "#abcdef" });

    assert.equal(created.status, 302);

    const result = await db.query(
      "SELECT name, color FROM readers WHERE name = $1",
      ["New Reader"],
    );
    assert.deepEqual(result.rows, [{ name: "New Reader", color: "#abcdef" }]);

    const duplicate = await request(app)
      .post("/readers")
      .type("form")
      .send({ name: "New Reader", color: "#123456" });

    assert.equal(duplicate.status, 409);
    assert.match(duplicate.text, /already exists/);
  });

  test("the library page renders reviews loaded through the real joins", async () => {
    const readerResult = await db.query(
      "SELECT id FROM readers WHERE name = 'Integration Reader'",
    );
    const mediaResult = await db.query(
      `INSERT INTO media (
         anilist_id, media_type, title, author, synopsis, cover_url
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [101, "MANGA", "Integration Manga", "Test Author", "Synopsis", null],
    );
    await db.query(
      `INSERT INTO reader_media (reader_id, media_id, rating, review)
       VALUES ($1, $2, $3, $4)`,
      [readerResult.rows[0].id, mediaResult.rows[0].id, 9, "Excellent."],
    );

    const response = await request(app).get(
      `/?reader=${readerResult.rows[0].id}&sort=rating`,
    );

    assert.equal(response.status, 200);
    assert.match(response.text, /Integration Manga/);
    assert.match(response.text, /9\/10/);
  });

  test("updating and deleting a review changes the database", async () => {
    const readerResult = await db.query(
      "SELECT id FROM readers WHERE name = 'Integration Reader'",
    );
    const readerId = readerResult.rows[0].id;
    const mediaResult = await db.query(
      `INSERT INTO media (anilist_id, media_type, title)
       VALUES (202, 'ANIME', 'Disposable Anime')
       RETURNING id`,
    );
    const mediaId = mediaResult.rows[0].id;
    const entryResult = await db.query(
      `INSERT INTO reader_media (reader_id, media_id, rating, review)
       VALUES ($1, $2, 5, 'Original review')
       RETURNING id`,
      [readerId, mediaId],
    );
    const entryId = entryResult.rows[0].id;

    const updated = await request(app)
      .post(`/readers/${readerId}/media/${entryId}/update`)
      .type("form")
      .send({ rating: "8", review: "Updated review" });

    assert.equal(updated.status, 302);
    const saved = await db.query(
      "SELECT rating, review FROM reader_media WHERE id = $1",
      [entryId],
    );
    assert.deepEqual(saved.rows, [{ rating: 8, review: "Updated review" }]);

    const deleted = await request(app).post(
      `/readers/${readerId}/media/${entryId}/delete`,
    );

    assert.equal(deleted.status, 302);
    const remainingEntries = await db.query(
      "SELECT id FROM reader_media WHERE id = $1",
      [entryId],
    );
    const remainingMedia = await db.query("SELECT id FROM media WHERE id = $1", [mediaId]);
    assert.equal(remainingEntries.rowCount, 0);
    assert.equal(remainingMedia.rowCount, 0);
  });
});
