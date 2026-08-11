import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";

import { secureResponse } from "./lib/http.js";
import { readPublicationState } from "./lib/dataset-metadata.js";

export const onRequest = defineMiddleware(async ({ locals, request }, next) => {
  const pathname = new URL(request.url).pathname;
  const nonHtmlRoute =
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/_image";
  locals.publicationState = nonHtmlRoute
    ? { kind: "unavailable" }
    : await readPublicationState(env);
  const response = await next();
  return secureResponse(request, response, undefined);
});
