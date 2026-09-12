import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { api, ApiError } from "../../frontend/services/api-client.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("frontend API client", () => {
  test("reads the reader collection from the API", async () => {
    globalThis.fetch = async (url) => {
      assert.equal(url, "http://localhost:3001/api/readers");
      return new Response(JSON.stringify({ readers: [{ id: 1 }] }), { status: 200 });
    };
    assert.deepEqual(await api.getReaders(), [{ id: 1 }]);
  });

  test("serializes writes as JSON", async () => {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.method, "POST");
      assert.equal(options.headers["Content-Type"], "application/json");
      assert.deepEqual(JSON.parse(options.body), { name: "Kana", color: "#123456" });
      return new Response(JSON.stringify({ reader: { id: 2, name: "Kana" } }), { status: 201 });
    };
    assert.equal((await api.createReader({ name: "Kana", color: "#123456" })).id, 2);
  });

  test("turns API problem responses into typed errors", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "reader_exists", message: "Already exists" }), { status: 409 });
    await assert.rejects(api.createReader({ name: "Kana", color: "#123456" }), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "reader_exists");
      return true;
    });
  });
});
