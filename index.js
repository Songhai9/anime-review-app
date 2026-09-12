import { pathToFileURL } from "node:url";
import { startFrontendServer } from "./frontend/server.js";

export { app } from "./frontend/app.js";
export { startFrontendServer as startServer } from "./frontend/server.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startFrontendServer();
}
