import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { api, ApiError } from "./services/api-client.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(rootDir, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(rootDir, "public")));

function positiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function validMediaType(value) {
  const type = value?.toUpperCase();
  return type === "ANIME" || type === "MANGA" ? type : null;
}

function renderError(res, statusCode, pageTitle, message) {
  return res.status(statusCode).render("error.ejs", { pageTitle, statusCode, message });
}

function forwardApiError(error, res, fallbackTitle = "Application error") {
  if (error instanceof ApiError) {
    return renderError(res, error.status, fallbackTitle, error.message);
  }
  throw error;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "anime-manga-frontend" });
});

app.get("/", async (req, res, next) => {
  try {
    const readers = await api.getReaders();
    if (!readers.length) {
      return res.render("index.ejs", {
        pageTitle: "Anime & Manga Notes", readers: [], currentReader: null,
        entries: [], currentSort: "rating",
      });
    }
    const requestedId = positiveInt(req.query.reader);
    const currentReader = readers.find((reader) => reader.id === requestedId) || readers[0];
    const currentSort = req.query.sort === "title" ? "title" : "rating";
    const library = await api.getLibrary(currentReader.id, currentSort);
    res.render("index.ejs", {
      pageTitle: `${currentReader.name}'s Anime & Manga Notes`,
      readers,
      currentReader,
      entries: library.entries,
      currentSort: library.sort,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/readers/new", (_req, res) => {
  res.render("new-reader.ejs", {
    pageTitle: "Add a reader", errorMessage: null,
    values: { name: "", color: "#7b4a2d" },
  });
});

app.post("/readers", async (req, res, next) => {
  const values = { name: req.body.name?.trim() || "", color: req.body.color?.trim() || "#7b4a2d" };
  try {
    const reader = await api.createReader(values);
    res.redirect(`/?reader=${reader.id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 409)) {
      return res.status(error.status).render("new-reader.ejs", {
        pageTitle: "Add a reader", errorMessage: error.message, values,
      });
    }
    next(error);
  }
});

app.get("/media/new", async (req, res, next) => {
  const readerId = positiveInt(req.query.reader);
  const query = req.query.q?.trim() || "";
  const mediaType = validMediaType(req.query.type || "ANIME");
  if (!readerId) return renderError(res, 404, "Reader not found", "Choose an existing reader before adding anime or manga.");
  if (!mediaType) return renderError(res, 400, "Invalid media type", "Choose Anime or Manga.");
  try {
    const reader = await api.getReader(readerId);
    let results = [];
    let searchError = null;
    if (query) {
      try {
        results = await api.searchMedia(query, mediaType);
      } catch {
        searchError = "AniList is temporarily unavailable. Please try again.";
      }
    }
    res.render("new-media.ejs", {
      pageTitle: `Add anime or manga for ${reader.name}`,
      reader, query, mediaType, results, searchError,
    });
  } catch (error) {
    if (error instanceof ApiError) return forwardApiError(error, res, "Reader not found");
    next(error);
  }
});

app.get("/media/review", async (req, res, next) => {
  const readerId = positiveInt(req.query.reader);
  const anilistId = positiveInt(req.query.id);
  const mediaType = validMediaType(req.query.type);
  if (!readerId || !anilistId || !mediaType) {
    return renderError(res, 400, "Invalid selection", "Choose a valid AniList result.");
  }
  try {
    const [reader, media] = await Promise.all([
      api.getReader(readerId), api.getMedia(anilistId, mediaType),
    ]);
    res.render("new-review.ejs", {
      pageTitle: `Review ${media.title}`, reader, media, formError: null,
      values: { rating: "", review: "" },
    });
  } catch (error) {
    if (error instanceof ApiError) return forwardApiError(error, res, "Media not found");
    next(error);
  }
});

app.post("/media", async (req, res, next) => {
  const readerId = positiveInt(req.body.readerId);
  const anilistId = positiveInt(req.body.anilistId);
  const mediaType = validMediaType(req.body.mediaType);
  const rating = Number.parseInt(req.body.rating, 10);
  const review = req.body.review?.trim() || "";
  if (!readerId || !anilistId || !mediaType || !Number.isInteger(rating) || rating < 1 || rating > 10 || !review) {
    return renderError(res, 400, "Invalid review", "Choose a valid title, rate it from 1 to 10, and write a review.");
  }
  try {
    await api.createReview(readerId, { anilistId, mediaType, rating, review });
    res.redirect(`/?reader=${readerId}&sort=rating`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      try {
        const [reader, media] = await Promise.all([
          api.getReader(readerId), api.getMedia(anilistId, mediaType),
        ]);
        return res.status(409).render("new-review.ejs", {
          pageTitle: `Review ${media.title}`, reader, media,
          formError: error.message, values: { rating: req.body.rating, review },
        });
      } catch (lookupError) {
        return next(lookupError);
      }
    }
    if (error instanceof ApiError) return forwardApiError(error, res);
    next(error);
  }
});

app.get("/readers/:readerId/media/:entryId", async (req, res, next) => {
  try {
    const entry = await api.getEntry(req.params.readerId, req.params.entryId);
    res.render("show-media.ejs", { pageTitle: `${entry.title} — ${entry.reader_name}`, entry });
  } catch (error) {
    if (error instanceof ApiError) return forwardApiError(error, res, "Review not found");
    next(error);
  }
});

app.get("/readers/:readerId/media/:entryId/edit", async (req, res, next) => {
  try {
    const entry = await api.getEntry(req.params.readerId, req.params.entryId);
    res.render("edit-media.ejs", {
      pageTitle: `Edit ${entry.title}`, entry, formError: null,
      values: { rating: entry.rating, review: entry.review },
    });
  } catch (error) {
    if (error instanceof ApiError) return forwardApiError(error, res, "Review not found");
    next(error);
  }
});

app.post("/readers/:readerId/media/:entryId/update", async (req, res, next) => {
  const rating = Number.parseInt(req.body.rating, 10);
  const review = req.body.review?.trim() || "";
  try {
    const entry = await api.getEntry(req.params.readerId, req.params.entryId);
    if (!Number.isInteger(rating) || rating < 1 || rating > 10 || !review) {
      return res.status(400).render("edit-media.ejs", {
        pageTitle: `Edit ${entry.title}`, entry,
        formError: "Enter a rating between 1 and 10 and write your review.",
        values: { rating: req.body.rating, review },
      });
    }
    await api.updateEntry(req.params.readerId, req.params.entryId, { rating, review });
    res.redirect(`/readers/${req.params.readerId}/media/${req.params.entryId}`);
  } catch (error) {
    if (error instanceof ApiError) return forwardApiError(error, res, "Review not found");
    next(error);
  }
});

app.post("/readers/:readerId/media/:entryId/delete", async (req, res, next) => {
  try {
    await api.deleteEntry(req.params.readerId, req.params.entryId);
    res.redirect(`/?reader=${req.params.readerId}`);
  } catch (error) {
    if (error instanceof ApiError) return forwardApiError(error, res, "Review not found");
    next(error);
  }
});

app.use((_req, res) => renderError(res, 404, "Page not found", "The page you requested does not exist."));

app.use((error, _req, res, _next) => {
  console.error("Unexpected frontend error:", error);
  renderError(res, 500, "Application error", "Something went wrong. Please try again.");
});
