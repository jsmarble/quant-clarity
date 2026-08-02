import { handleRequest } from "./request.js";

export default {
  fetch: handleRequest,
} satisfies ExportedHandler<CloudflareEnv>;
