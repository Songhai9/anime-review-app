import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { getMediaById, searchMedia } from "../../api/services/anilist.js";

const originalFetch = globalThis.fetch;

function jsonResponse(payload, { status = 200 } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function animeFixture(overrides = {}) {
  return {
    id: 1,
    type: "ANIME",
    title: {
      english: "Cowboy Bebop",
      romaji: "Cowboy Bebop",
      native: "カウボーイビバップ",
    },
    description: "Space &amp; bounty hunters.<br><b>See you, space cowboy.</b>",
    coverImage: { extraLarge: "https://images.example/anime.jpg", large: null },
    siteUrl: "https://anilist.co/anime/1",
    studios: { nodes: [{ name: "Sunrise" }] },
    staff: { edges: [] },
    ...overrides,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("searchMedia", () => {
  test("returns no results without making a request for blank searches", async () => {
    let requestCount = 0;
    globalThis.fetch = async () => {
      requestCount += 1;
      return jsonResponse({ data: {} });
    };

    assert.deepEqual(await searchMedia("   ", "anime"), []);
    assert.equal(requestCount, 0);
  });

  test("normalizes AniList anime results", async () => {
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.variables, { search: "Bebop", type: "ANIME" });
      return jsonResponse({ data: { Page: { media: [animeFixture()] } } });
    };

    const [media] = await searchMedia("  Bebop  ", "anime");

    assert.deepEqual(media, {
      anilistId: 1,
      mediaType: "ANIME",
      title: "Cowboy Bebop",
      romajiTitle: "Cowboy Bebop",
      nativeTitle: "カウボーイビバップ",
      author: null,
      studio: "Sunrise",
      creator: "Sunrise",
      creatorLabel: "Studio",
      synopsis: "Space & bounty hunters.\nSee you, space cowboy.",
      coverUrl: "https://images.example/anime.jpg",
      siteUrl: "https://anilist.co/anime/1",
    });
  });

  test("uses the preferred credited manga author and fallback title", async () => {
    const manga = animeFixture({
      id: 2,
      type: "MANGA",
      title: { english: null, romaji: "Berserk", native: "ベルセルク" },
      studios: { nodes: [] },
      staff: {
        edges: [
          { role: "Translator", node: { name: { full: "Someone Else" } } },
          { role: "Story & Art", node: { name: { full: "Kentaro Miura" } } },
        ],
      },
      coverImage: { extraLarge: null, large: "https://images.example/manga.jpg" },
    });
    globalThis.fetch = async () =>
      jsonResponse({ data: { Page: { media: [manga] } } });

    const [media] = await searchMedia("Berserk", "MANGA");

    assert.equal(media.title, "Berserk");
    assert.equal(media.author, "Kentaro Miura");
    assert.equal(media.studio, null);
    assert.equal(media.creator, "Kentaro Miura");
    assert.equal(media.creatorLabel, "Author");
    assert.equal(media.coverUrl, "https://images.example/manga.jpg");
  });

  test("rejects unsupported media types before making a request", async () => {
    await assert.rejects(searchMedia("Dune", "NOVEL"), {
      message: "Media type must be ANIME or MANGA.",
    });
  });

  test("surfaces AniList GraphQL errors", async () => {
    globalThis.fetch = async () =>
      jsonResponse({ errors: [{ message: "Too many requests" }] });

    await assert.rejects(searchMedia("Naruto", "ANIME"), {
      message: "Too many requests",
    });
  });

  test("surfaces HTTP errors even when the response is not JSON", async () => {
    globalThis.fetch = async () =>
      new Response("gateway unavailable", { status: 502 });

    await assert.rejects(searchMedia("Naruto", "ANIME"), {
      message: "AniList returned HTTP 502",
    });
  });
});

describe("getMediaById", () => {
  test("returns null for invalid positive ids without making a request", async () => {
    let requestCount = 0;
    globalThis.fetch = async () => {
      requestCount += 1;
      return jsonResponse({ data: {} });
    };

    assert.equal(await getMediaById("not-an-id", "ANIME"), null);
    assert.equal(await getMediaById(0, "MANGA"), null);
    assert.equal(requestCount, 0);
  });

  test("requests and normalizes one exact media entry", async () => {
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.variables, { id: 25, type: "ANIME" });
      return jsonResponse({ data: { Media: animeFixture({ id: 25 }) } });
    };

    const media = await getMediaById("25", "anime");

    assert.equal(media.anilistId, 25);
    assert.equal(media.title, "Cowboy Bebop");
  });

  test("returns null when AniList has no matching media", async () => {
    globalThis.fetch = async () => jsonResponse({ data: { Media: null } });

    assert.equal(await getMediaById(999999, "ANIME"), null);
  });
});
