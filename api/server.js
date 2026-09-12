import { pathToFileURL } from "node:url";
import { app } from "./app.js";

const port = Number(process.env.API_PORT || process.env.PORT) || 3001;

export function startApiServer() {
  return app.listen(port, () => {
    console.log(`Anime & Manga API is running on http://localhost:${port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startApiServer();
}
