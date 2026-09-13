import { pathToFileURL } from "node:url";
import { app } from "./app.js";
import { initializeDatabase } from "./database/initialize.js";

const port = Number(process.env.API_PORT) || 3001;

export async function startApiServer() {
  await initializeDatabase();

  return app.listen(port, () => {
    console.log(`Anime & Manga API is running on http://localhost:${port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startApiServer().catch((error) => {
    console.error("Anime & Manga API failed to initialize:", error);
    process.exitCode = 1;
  });
}
