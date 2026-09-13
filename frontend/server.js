import { pathToFileURL } from "node:url";
import { app } from "./app.js";

const port = Number(process.env.FRONTEND_PORT) || 3000;

export function startFrontendServer() {
  return app.listen(port, () => {
    console.log(`Anime & Manga frontend is running on http://localhost:${port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startFrontendServer();
}
