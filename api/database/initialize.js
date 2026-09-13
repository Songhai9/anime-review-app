import { readFile } from "node:fs/promises";
import { db } from "../db.js";

const sqlDirectory = new URL("../../sql/", import.meta.url);

export async function initializeDatabase() {
  const schema = await readFile(new URL("schema.sql", sqlDirectory), "utf8");
  await db.query(schema);

  if (process.env.DATABASE_SEED === "true") {
    const seed = await readFile(new URL("seed.sql", sqlDirectory), "utf8");
    await db.query(seed);
  }
}
