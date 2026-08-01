import { handle } from "@astrojs/cloudflare/handler";

import { guardedApplicationResponse, secureResponse } from "./lib/http.js";
import {
  rateLimitDecision,
  type FrontendRateLimitEnv,
} from "./lib/rate-limit.js";

type FrontendEnv = Env &
  FrontendRateLimitEnv & {
    DEPLOYMENT_ENV: string;
  };

function unavailable(request: Request, environment: string): Response {
  return secureResponse(
    request,
    new Response("Service temporarily unavailable.", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      status: 503,
    }),
    environment,
  );
}

function rateLimited(request: Request, environment: string): Response {
  return secureResponse(
    request,
    new Response("Rate limit exceeded.", {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Retry-After": "60",
      },
      status: 429,
    }),
    environment,
  );
}

export default {
  async fetch(request, env, context) {
    const rateLimit = await rateLimitDecision(request, env);
    if (rateLimit === "unavailable")
      return unavailable(request, env.DEPLOYMENT_ENV);
    if (rateLimit === "limited")
      return rateLimited(request, env.DEPLOYMENT_ENV);

    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      return secureResponse(
        request,
        new Response("Method not allowed.", {
          headers: { Allow: "GET, HEAD, OPTIONS" },
          status: 405,
        }),
        env.DEPLOYMENT_ENV,
      );
    }

    return guardedApplicationResponse(
      request,
      env.DEPLOYMENT_ENV,
      env,
      context,
      handle,
    );
  },
} satisfies ExportedHandler<FrontendEnv>;
