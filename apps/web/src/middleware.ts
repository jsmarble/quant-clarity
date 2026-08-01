import { defineMiddleware } from "astro:middleware";

import { secureResponse } from "./lib/http.js";

export const onRequest = defineMiddleware(async ({ request }, next) => {
  const response = await next();
  return secureResponse(request, response, undefined);
});
