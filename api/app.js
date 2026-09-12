import express from "express";
import { rateLimit } from "express-rate-limit";
import { db } from "./db.js";
import { getMediaById, searchMedia } from "./services/anilist.js";

export const app = express();

app.set("trust proxy", 1);
app.use(express.json());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 200,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => req.path === "/health" || req.path === "/ready",
  }),
);

const mediaSorts = {
  rating: "reader_media.rating DESC, media.title ASC",
  title: "media.title ASC",
};

function positiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function mediaType(value) {
  const type = value?.toUpperCase();
  return type === "ANIME" || type === "MANGA" ? type : null;
}

function problem(res, status, code, message) {
  return res.status(status).json({ error: code, message });
}

async function findReader(id) {
  if (!id) return null;
  const result = await db.query("SELECT id, name, color FROM readers WHERE id = $1", [id]);
  return result.rows[0] || null;
}

async function findEntry(readerId, entryId) {
  if (!readerId || !entryId) return null;
  const result = await db.query(
    `SELECT
      reader_media.id AS entry_id,
      reader_media.reader_id,
      reader_media.media_id,
      reader_media.rating,
      reader_media.review,
      media.anilist_id,
      media.media_type,
      media.title,
      media.author,
      media.studio,
      media.synopsis,
      media.cover_url,
      readers.name AS reader_name,
      readers.color AS reader_color
    FROM reader_media
    JOIN media ON media.id = reader_media.media_id
    JOIN readers ON readers.id = reader_media.reader_id
    WHERE reader_media.reader_id = $1 AND reader_media.id = $2`,
    [readerId, entryId],
  );
  return result.rows[0] || null;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "anime-manga-api" });
});

app.get("/ready", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ status: "ready", database: "connected" });
  } catch (error) {
    console.error("PostgreSQL readiness check failed:", error.message);
    res.status(503).json({ status: "not ready", database: "unavailable" });
  }
});

app.get("/api/readers", async (_req, res, next) => {
  try {
    const result = await db.query("SELECT id, name, color FROM readers ORDER BY id");
    res.json({ readers: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post("/api/readers", async (req, res, next) => {
  const name = req.body.name?.trim();
  const color = req.body.color?.trim();
  if (!name || name.length > 80 || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    return problem(res, 400, "invalid_reader", "Enter a name and choose a valid profile color.");
  }
  try {
    const result = await db.query(
      "INSERT INTO readers (name, color) VALUES ($1, $2) RETURNING id, name, color",
      [name, color],
    );
    res.status(201).json({ reader: result.rows[0] });
  } catch (error) {
    if (error.code === "23505") {
      return problem(res, 409, "reader_exists", "A reader with this name already exists.");
    }
    next(error);
  }
});

app.get("/api/readers/:readerId", async (req, res, next) => {
  try {
    const reader = await findReader(positiveInt(req.params.readerId));
    if (!reader) return problem(res, 404, "reader_not_found", "The selected reader does not exist.");
    res.json({ reader });
  } catch (error) {
    next(error);
  }
});

app.get("/api/readers/:readerId/library", async (req, res, next) => {
  try {
    const reader = await findReader(positiveInt(req.params.readerId));
    if (!reader) return problem(res, 404, "reader_not_found", "The selected reader does not exist.");
    const sort = Object.hasOwn(mediaSorts, req.query.sort) ? req.query.sort : "rating";
    const result = await db.query(
      `SELECT
        reader_media.id AS entry_id,
        media.id AS media_id,
        media.anilist_id,
        media.media_type,
        media.title,
        media.author,
        media.studio,
        media.synopsis,
        media.cover_url,
        reader_media.rating,
        reader_media.review
      FROM reader_media
      JOIN media ON media.id = reader_media.media_id
      WHERE reader_media.reader_id = $1
      ORDER BY ${mediaSorts[sort]}`,
      [reader.id],
    );
    res.json({ reader, entries: result.rows, sort });
  } catch (error) {
    next(error);
  }
});

app.get("/api/media/search", async (req, res, next) => {
  const query = req.query.q?.trim() || "";
  const type = mediaType(req.query.type || "ANIME");
  if (!type) return problem(res, 400, "invalid_media_type", "Choose Anime or Manga.");
  try {
    const results = query ? await searchMedia(query, type) : [];
    res.json({ query, mediaType: type, results });
  } catch (error) {
    next(error);
  }
});

app.get("/api/media/:type/:anilistId", async (req, res, next) => {
  const id = positiveInt(req.params.anilistId);
  const type = mediaType(req.params.type);
  if (!id || !type) return problem(res, 400, "invalid_media", "Choose a valid AniList result.");
  try {
    const media = await getMediaById(id, type);
    if (!media) return problem(res, 404, "media_not_found", "AniList could not find this title.");
    res.json({ media });
  } catch (error) {
    next(error);
  }
});

app.post("/api/readers/:readerId/media", async (req, res, next) => {
  const readerId = positiveInt(req.params.readerId);
  const anilistId = positiveInt(req.body.anilistId);
  const type = mediaType(req.body.mediaType);
  const rating = Number.parseInt(req.body.rating, 10);
  const review = req.body.review?.trim() || "";

  if (!readerId || !anilistId || !type || !Number.isInteger(rating) || rating < 1 || rating > 10 || !review) {
    return problem(res, 400, "invalid_review", "Choose a valid title, rate it from 1 to 10, and write a review.");
  }

  try {
    const reader = await findReader(readerId);
    if (!reader) return problem(res, 404, "reader_not_found", "The selected reader does not exist.");

    let selectedMedia;
    try {
      selectedMedia = await getMediaById(anilistId, type);
    } catch (error) {
      console.error("AniList media lookup failed:", error.message);
      return problem(res, 502, "anilist_unavailable", "Could not verify this AniList entry.");
    }
    if (!selectedMedia) return problem(res, 404, "media_not_found", "AniList could not find this title.");

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const mediaResult = await client.query(
        `INSERT INTO media (anilist_id, media_type, title, author, studio, synopsis, cover_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (anilist_id) DO UPDATE SET
           media_type = EXCLUDED.media_type,
           title = EXCLUDED.title,
           author = EXCLUDED.author,
           studio = EXCLUDED.studio,
           synopsis = EXCLUDED.synopsis,
           cover_url = EXCLUDED.cover_url
         RETURNING id`,
        [selectedMedia.anilistId, selectedMedia.mediaType, selectedMedia.title,
          selectedMedia.author, selectedMedia.studio, selectedMedia.synopsis,
          selectedMedia.coverUrl || null],
      );
      const entryResult = await client.query(
        `INSERT INTO reader_media (reader_id, media_id, rating, review)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [reader.id, mediaResult.rows[0].id, rating, review],
      );
      await client.query("COMMIT");
      res.status(201).json({ entryId: entryResult.rows[0].id });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        return problem(res, 409, "review_exists", `${reader.name} has already reviewed this title.`);
      }
      next(error);
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

app.get("/api/readers/:readerId/media/:entryId", async (req, res, next) => {
  try {
    const entry = await findEntry(positiveInt(req.params.readerId), positiveInt(req.params.entryId));
    if (!entry) return problem(res, 404, "review_not_found", "This review does not exist.");
    res.json({ entry });
  } catch (error) {
    next(error);
  }
});

app.put("/api/readers/:readerId/media/:entryId", async (req, res, next) => {
  const readerId = positiveInt(req.params.readerId);
  const entryId = positiveInt(req.params.entryId);
  const rating = Number.parseInt(req.body.rating, 10);
  const review = req.body.review?.trim() || "";
  if (!readerId || !entryId || !Number.isInteger(rating) || rating < 1 || rating > 10 || !review) {
    return problem(res, 400, "invalid_review", "Enter a rating between 1 and 10 and write your review.");
  }
  try {
    const result = await db.query(
      `UPDATE reader_media SET rating = $1, review = $2
       WHERE reader_id = $3 AND id = $4 RETURNING id`,
      [rating, review, readerId, entryId],
    );
    if (!result.rowCount) return problem(res, 404, "review_not_found", "This review does not exist.");
    res.json({ entryId });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/readers/:readerId/media/:entryId", async (req, res, next) => {
  const readerId = positiveInt(req.params.readerId);
  const entryId = positiveInt(req.params.entryId);
  if (!readerId || !entryId) return problem(res, 404, "review_not_found", "This review does not exist.");
  let client;
  try {
    const entry = await findEntry(readerId, entryId);
    if (!entry) return problem(res, 404, "review_not_found", "This review does not exist.");
    client = await db.connect();
    await client.query("BEGIN");
    await client.query("DELETE FROM reader_media WHERE reader_id = $1 AND id = $2", [readerId, entryId]);
    await client.query(
      "DELETE FROM media WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM reader_media WHERE media_id = $1)",
      [entry.media_id],
    );
    await client.query("COMMIT");
    res.status(204).end();
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
});

app.use((req, res) => problem(res, 404, "not_found", "The API endpoint does not exist."));

app.use((error, _req, res, _next) => {
  console.error("Unexpected API error:", error);
  problem(res, 500, "internal_error", "Something went wrong. Please try again.");
});
