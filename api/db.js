import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const useSsl = process.env.DATABASE_SSL === "true";
const ssl = useSsl ? { rejectUnauthorized: false } : false;

const config = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl }
  : {
      host: process.env.DATABASE_HOST || "localhost",
      port: Number(process.env.DATABASE_PORT) || 5432,
      database: process.env.DATABASE_NAME || "medias",
      user: process.env.DATABASE_USER || "postgres",
      password: process.env.DATABASE_PASSWORD,
      ssl,
    };

export const db = new pg.Pool(config);

db.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error.message);
});
