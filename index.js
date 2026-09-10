import express from "express";
import { rateLimit } from "express-rate-limit";
import { pathToFileURL } from "node:url";
import { db } from "./db.js";
import { getMediaById, searchMedia } from "./services/anilist.js";

export const app = express();
const port = Number(process.env.PORT) || 3000;

app.set("view engine", "ejs");
app.set("trust proxy", 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => req.path === "/health" || req.path === "/ready",
  }),
);

const mediaSorts = {
  rating: "reader_media.rating DESC, media.title ASC",
  title: "media.title ASC",
};

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isValidMediaType(type) {
  return type === "ANIME" || type === "MANGA";
}

async function getReader(readerId) {
  if (!readerId) return null;

  const result = await db.query(
    "SELECT id, name, color FROM readers WHERE id = $1",
    [readerId],
  );

  return result.rows[0] || null;
}

async function getReaderMediaEntry(readerId, entryId) {
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

function renderError(res, statusCode, pageTitle, message) {
  return res.status(statusCode).render("error.ejs", {
    pageTitle,
    statusCode,
    message,
  });
}

app.get("/", async (req, res, next) => {
  try {
    const readersResult = await db.query(
      "SELECT id, name, color FROM readers ORDER BY id",
    );
    const readers = readersResult.rows;

    if (readers.length === 0) {
      return res.render("index.ejs", {
        pageTitle: "Anime & Manga Notes",
        readers: [],
        currentReader: null,
        entries: [],
        currentSort: "rating",
      });
    }

    const requestedReaderId = parsePositiveInt(req.query.reader);
    const currentReader =
      readers.find((reader) => reader.id === requestedReaderId) || readers[0];
    const currentSort = Object.hasOwn(mediaSorts, req.query.sort)
      ? req.query.sort
      : "rating";

    const entriesResult = await db.query(
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
      ORDER BY ${mediaSorts[currentSort]}`,
      [currentReader.id],
    );

    res.render("index.ejs", {
      pageTitle: `${currentReader.name}'s Anime & Manga Notes`,
      readers,
      currentReader,
      entries: entriesResult.rows,
      currentSort,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/readers/new", (req, res) => {
  res.render("new-reader.ejs", {
    pageTitle: "Add a reader",
    errorMessage: null,
    values: { name: "", color: "#7b4a2d" },
  });
});

app.post("/readers", async (req, res, next) => {
  const name = req.body.name?.trim();
  const color = req.body.color?.trim();
  const colorPattern = /^#[0-9A-Fa-f]{6}$/;

  if (!name || name.length > 80 || !colorPattern.test(color)) {
    return res.status(400).render("new-reader.ejs", {
      pageTitle: "Add a reader",
      errorMessage: "Enter a name and choose a valid profile color.",
      values: { name: name || "", color: color || "#7b4a2d" },
    });
  }

  try {
    const result = await db.query(
      "INSERT INTO readers (name, color) VALUES ($1, $2) RETURNING id",
      [name, color],
    );

    res.redirect(`/?reader=${result.rows[0].id}`);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).render("new-reader.ejs", {
        pageTitle: "Add a reader",
        errorMessage: "A reader with this name already exists.",
        values: { name, color },
      });
    }

    next(error);
  }
});

// Search page: choose ANIME/MANGA, enter a title, then show AniList results.
app.get("/media/new", async (req, res, next) => {
  const readerId = parsePositiveInt(req.query.reader);
  const reader = await getReader(readerId);

  if (!reader) {
    return renderError(
      res,
      404,
      "Reader not found",
      "Choose an existing reader before adding anime or manga.",
    );
  }

  const query = req.query.q?.trim() || "";
  const mediaType = req.query.type?.toUpperCase() || "ANIME";

  if (!isValidMediaType(mediaType)) {
    return renderError(res, 400, "Invalid media type", "Choose Anime or Manga.");
  }

  let results = [];
  let searchError = null;

  if (query) {
    try {
      results = await searchMedia(query, mediaType);
    } catch (error) {
      console.error("AniList search failed:", error.message);
      searchError = "AniList is temporarily unavailable. Please try again.";
    }
  }

  res.render("new-media.ejs", {
    pageTitle: `Add anime or manga for ${reader.name}`,
    reader,
    query,
    mediaType,
    results,
    searchError,
  });
});

// After clicking one search result, fetch that exact AniList entry and show review form.
app.get("/media/review", async (req, res, next) => {
  const readerId = parsePositiveInt(req.query.reader);
  const anilistId = parsePositiveInt(req.query.id);
  const mediaType = req.query.type?.toUpperCase();
  const reader = await getReader(readerId);

  if (!reader) {
    return renderError(res, 404, "Reader not found", "The selected reader does not exist.");
  }

  if (!anilistId || !isValidMediaType(mediaType)) {
    return renderError(res, 400, "Invalid selection", "Choose a valid AniList result.");
  }

  try {
    const media = await getMediaById(anilistId, mediaType);

    if (!media) {
      return renderError(res, 404, "Media not found", "AniList could not find this title.");
    }

    res.render("new-review.ejs", {
      pageTitle: `Review ${media.title}`,
      reader,
      media,
      formError: null,
      values: { rating: "", review: "" },
    });
  } catch (error) {
    next(error);
  }
});

// Save both the shared AniList metadata and this reader's personal review.
app.post("/media", async (req, res, next) => {
  const readerId = parsePositiveInt(req.body.readerId);
  const anilistId = parsePositiveInt(req.body.anilistId);
  const mediaType = req.body.mediaType?.toUpperCase();
  const rating = Number.parseInt(req.body.rating, 10);
  const review = req.body.review?.trim() || "";
  const reader = await getReader(readerId);

  if (!reader) {
    return renderError(res, 404, "Reader not found", "The selected reader does not exist.");
  }

  if (
    !anilistId ||
    !isValidMediaType(mediaType) ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 10 ||
    !review
  ) {
    return renderError(
      res,
      400,
      "Invalid review",
      "Choose a valid title, rate it from 1 to 10, and write a review.",
    );
  }

  let selectedMedia;

  try {
    // Do not trust hidden form fields for catalog metadata. Fetch it again server-side.
    selectedMedia = await getMediaById(anilistId, mediaType);
  } catch (error) {
    console.error("AniList media lookup failed:", error.message);
    return renderError(res, 502, "AniList unavailable", "Could not verify this AniList entry.");
  }

  if (!selectedMedia) {
    return renderError(res, 404, "Media not found", "AniList could not find this title.");
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const mediaResult = await client.query(
      `INSERT INTO media (
        anilist_id,
        media_type,
        title,
        author,
        studio,
        synopsis,
        cover_url
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (anilist_id) DO UPDATE
      SET
        media_type = EXCLUDED.media_type,
        title = EXCLUDED.title,
        author = EXCLUDED.author,
        studio = EXCLUDED.studio,
        synopsis = EXCLUDED.synopsis,
        cover_url = EXCLUDED.cover_url
      RETURNING id`,
      [
        selectedMedia.anilistId,
        selectedMedia.mediaType,
        selectedMedia.title,
        selectedMedia.author,
        selectedMedia.studio,
        selectedMedia.synopsis,
        selectedMedia.coverUrl || null,
      ],
    );

    await client.query(
      `INSERT INTO reader_media (reader_id, media_id, rating, review)
       VALUES ($1, $2, $3, $4)`,
      [reader.id, mediaResult.rows[0].id, rating, review],
    );

    await client.query("COMMIT");
    res.redirect(`/?reader=${reader.id}&sort=rating`);
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      return res.status(409).render("new-review.ejs", {
        pageTitle: `Review ${selectedMedia.title}`,
        reader,
        media: selectedMedia,
        formError: `${reader.name} has already reviewed this title.`,
        values: { rating: req.body.rating, review },
      });
    }

    next(error);
  } finally {
    client.release();
  }
});

app.get("/readers/:readerId/media/:entryId", async (req, res, next) => {
  try {
    const readerId = parsePositiveInt(req.params.readerId);
    const entryId = parsePositiveInt(req.params.entryId);
    const entry = await getReaderMediaEntry(readerId, entryId);

    if (!entry) {
      return renderError(
        res,
        404,
        "Review not found",
        "This anime or manga is not recorded in the selected reader's library.",
      );
    }

    res.render("show-media.ejs", {
      pageTitle: `${entry.title} — ${entry.reader_name}`,
      entry,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/readers/:readerId/media/:entryId/edit", async (req, res, next) => {
  try {
    const readerId = parsePositiveInt(req.params.readerId);
    const entryId = parsePositiveInt(req.params.entryId);
    const entry = await getReaderMediaEntry(readerId, entryId);

    if (!entry) {
      return renderError(res, 404, "Review not found", "This review does not exist.");
    }

    res.render("edit-media.ejs", {
      pageTitle: `Edit ${entry.title}`,
      entry,
      formError: null,
      values: { rating: entry.rating, review: entry.review },
    });
  } catch (error) {
    next(error);
  }
});

app.post("/readers/:readerId/media/:entryId/update", async (req, res, next) => {
  const readerId = parsePositiveInt(req.params.readerId);
  const entryId = parsePositiveInt(req.params.entryId);
  const entry = await getReaderMediaEntry(readerId, entryId);

  if (!entry) {
    return renderError(res, 404, "Review not found", "This review does not exist.");
  }

  const rating = Number.parseInt(req.body.rating, 10);
  const review = req.body.review?.trim() || "";

  if (!Number.isInteger(rating) || rating < 1 || rating > 10 || !review) {
    return res.status(400).render("edit-media.ejs", {
      pageTitle: `Edit ${entry.title}`,
      entry,
      formError: "Enter a rating between 1 and 10 and write your review.",
      values: { rating: req.body.rating, review },
    });
  }

  try {
    await db.query(
      `UPDATE reader_media
       SET rating = $1, review = $2
       WHERE reader_id = $3 AND id = $4`,
      [rating, review, readerId, entryId],
    );

    res.redirect(`/readers/${readerId}/media/${entryId}`);
  } catch (error) {
    next(error);
  }
});

app.post("/readers/:readerId/media/:entryId/delete", async (req, res, next) => {
  const readerId = parsePositiveInt(req.params.readerId);
  const entryId = parsePositiveInt(req.params.entryId);
  const entry = await getReaderMediaEntry(readerId, entryId);

  if (!entry) {
    return renderError(res, 404, "Review not found", "This review does not exist.");
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM reader_media WHERE reader_id = $1 AND id = $2",
      [readerId, entryId],
    );
    await client.query(
      `DELETE FROM media
       WHERE id = $1
         AND NOT EXISTS (
           SELECT 1 FROM reader_media WHERE media_id = $1
         )`,
      [entry.media_id],
    );
    await client.query("COMMIT");

    res.redirect(`/?reader=${readerId}`);
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", service: "anime-manga-notes" });
});

app.get("/ready", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.status(200).json({ status: "ready", database: "connected" });
  } catch (error) {
    console.error("PostgreSQL readiness check failed:", error.message);
    res.status(503).json({ status: "not ready", database: "unavailable" });
  }
});

app.use((req, res) => {
  renderError(res, 404, "Page not found", "The page you requested does not exist.");
});

app.use((error, req, res, _next) => {
  console.error("Unexpected application error:", error);
  renderError(res, 500, "Application error", "Something went wrong. Please try again.");
});

export function startServer() {
  return app.listen(port, (error) => {
    if (error) {
      console.error("Anime & Manga Notes failed to start:", error.message);
      process.exitCode = 1;
      return;
    }

    console.log(`Anime & Manga Notes is running on http://localhost:${port}`);
  });
}

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  startServer();
}
