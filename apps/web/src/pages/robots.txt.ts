import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

import { robotsPolicy } from "../lib/http.js";

export const GET: APIRoute = ({ url }) =>
  new Response(robotsPolicy(env.DEPLOYMENT_ENV, url.hostname, url.origin), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
