import assert from "node:assert/strict";
import { beforeEach, describe, mock, test } from "node:test";
import request from "supertest";

class FakeApiError extends Error {
  constructor(status, message, code = "api_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const api = {};
mock.module(new URL("../../frontend/services/api-client.js", import.meta.url).href, {
  exports: { api, ApiError: FakeApiError },
});
const { app } = await import("../../frontend/app.js");

beforeEach(() => {
  api.getReaders = async () => [];
  api.getReader = async (id) => ({ id: Number(id), name: "Spike", color: "#123456" });
  api.createReader = async (values) => ({ id: 2, ...values });
  api.getLibrary = async (readerId, sort) => ({ reader: { id: readerId }, entries: [], sort });
  api.searchMedia = async () => [];
  api.getMedia = async (id, type) => ({ anilistId: Number(id), mediaType: type, title: "Bebop", creator: "Sunrise", creatorLabel: "Studio", synopsis: "Space", coverUrl: "" });
  api.createReview = async () => ({ entryId: 3 });
  api.getEntry = async () => ({ entry_id: 3, reader_id: 1, media_id: 8, title: "Bebop", reader_name: "Spike", media_type: "ANIME", anilist_id: 25, rating: 8, review: "Great" });
  api.updateEntry = async () => ({ entryId: 3 });
  api.deleteEntry = async () => null;
});

describe("frontend routes", () => {
  test("has its own health endpoint", async () => {
    const response = await request(app).get("/health");
    assert.deepEqual(response.body, { status: "ok", service: "anime-manga-frontend" });
  });

  test("renders empty and populated libraries from API data", async () => {
    const empty = await request(app).get("/");
    assert.equal(empty.status, 200);
    assert.match(empty.text, /Create your first reader/);

    api.getReaders = async () => [{ id: 1, name: "Spike", color: "#123456" }];
    api.getLibrary = async () => ({ entries: [{ entry_id: 3, title: "Bebop", media_type: "ANIME", rating: 9, review: "Great", studio: "Sunrise" }], sort: "rating" });
    const populated = await request(app).get("/?reader=1&sort=rating");
    assert.equal(populated.status, 200);
    assert.match(populated.text, /Bebop/);
  });

  test("creates readers through the API and preserves validation errors", async () => {
    const created = await request(app).post("/readers").type("form").send({ name: " Spike ", color: "#123456" });
    assert.equal(created.status, 302);
    assert.equal(created.headers.location, "/?reader=2");

    api.createReader = async () => { throw new FakeApiError(409, "Already exists"); };
    const duplicate = await request(app).post("/readers").type("form").send({ name: "Spike", color: "#123456" });
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.text, /Already exists/);
  });

  test("renders media search and review forms from API responses", async () => {
    api.searchMedia = async () => [{ anilistId: 25, mediaType: "ANIME", title: "Bebop", creator: "Sunrise", creatorLabel: "Studio", synopsis: "Space", coverUrl: "" }];
    const search = await request(app).get("/media/new?reader=1&type=ANIME&q=Bebop");
    assert.equal(search.status, 200);
    assert.match(search.text, /Bebop/);

    const review = await request(app).get("/media/review?reader=1&type=ANIME&id=25");
    assert.equal(review.status, 200);
    assert.match(review.text, /Review Bebop/);
  });

  test("submits a review through the API", async () => {
    const response = await request(app).post("/media").type("form").send({ readerId: 1, anilistId: 25, mediaType: "ANIME", rating: 9, review: "Great" });
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, "/?reader=1&sort=rating");
  });

  test("renders, edits, and deletes existing reviews", async () => {
    assert.equal((await request(app).get("/readers/1/media/3")).status, 200);
    assert.equal((await request(app).get("/readers/1/media/3/edit")).status, 200);

    const updated = await request(app).post("/readers/1/media/3/update").type("form").send({ rating: 10, review: "Perfect" });
    assert.equal(updated.status, 302);
    assert.equal(updated.headers.location, "/readers/1/media/3");

    const deleted = await request(app).post("/readers/1/media/3/delete");
    assert.equal(deleted.status, 302);
    assert.equal(deleted.headers.location, "/?reader=1");
  });

  test("renders API failures and unknown pages safely", async () => {
    api.getEntry = async () => { throw new FakeApiError(404, "Review missing"); };
    const missingReview = await request(app).get("/readers/1/media/404");
    assert.equal(missingReview.status, 404);
    assert.match(missingReview.text, /Review missing/);

    const missingPage = await request(app).get("/missing-page");
    assert.equal(missingPage.status, 404);
    assert.match(missingPage.text, /Page not found/);
  });
});
