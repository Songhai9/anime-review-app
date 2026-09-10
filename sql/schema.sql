-- Remove the old book-specific tables.
DROP TABLE IF EXISTS reader_books;
DROP TABLE IF EXISTS books;

-- Keep existing readers, but remove the timestamp you no longer use.
CREATE TABLE IF NOT EXISTS readers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  color VARCHAR(7) NOT NULL DEFAULT '#7b4a2d'
    CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);

ALTER TABLE readers DROP COLUMN IF EXISTS created_at;

CREATE TABLE IF NOT EXISTS media (
  id SERIAL PRIMARY KEY,
  anilist_id INTEGER NOT NULL UNIQUE,
  media_type VARCHAR(5) NOT NULL CHECK (media_type IN ('ANIME', 'MANGA')),
  title VARCHAR(250) NOT NULL,
  author VARCHAR(200),
  studio VARCHAR(200),
  synopsis TEXT,
  cover_url TEXT
);

CREATE TABLE IF NOT EXISTS reader_media (
  id SERIAL PRIMARY KEY,
  reader_id INTEGER NOT NULL REFERENCES readers(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 10),
  review TEXT NOT NULL CHECK (LENGTH(TRIM(review)) > 0),
  UNIQUE (reader_id, media_id)
);

CREATE INDEX IF NOT EXISTS reader_media_rating_idx
  ON reader_media (reader_id, rating DESC);

CREATE INDEX IF NOT EXISTS media_title_idx
  ON media (title ASC);

CREATE INDEX IF NOT EXISTS media_type_idx
  ON media (media_type);
