# Three-tier architecture

The application is split into three independently deployable tiers:

1. **Frontend** (`frontend/`) renders the EJS pages and serves static assets. It only communicates with the API through `API_URL` and has no database credentials.
2. **API** (`api/`) exposes JSON endpoints under `/api`, owns validation and business rules, calls AniList, and is the only tier allowed to connect to PostgreSQL.
3. **Database** (`db` in Docker Compose) stores readers, media, and reviews. It is initialized from `sql/`.

## Local development

Run the API and frontend in separate terminals:

```sh
npm run compose:db
npm run dev:api
npm run dev:frontend
```

`compose:db` starts PostgreSQL for local development. The defaults are `http://localhost:3001` for the API and `http://localhost:3000` for the frontend. Override them with `API_PORT`, `FRONTEND_PORT`, and `API_URL`.

The API applies the idempotent schema at startup, including when the PostgreSQL volume already exists. Set `DATABASE_SEED=true` to insert the demo readers.

## Containers

```sh
npm run compose:up
```

Compose builds separate `frontend-runtime` and `api-runtime` images. Only the API receives database credentials. The frontend reaches the API over the internal Compose network.

## Tests

- `npm test` runs isolated unit and API contract tests.
- `npm run test:integration` uses `TEST_DATABASE_URL` when supplied.
- `npm run test:container` creates an isolated PostgreSQL instance and runs integration tests against the API.
