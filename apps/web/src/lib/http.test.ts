import { describe, expect, it } from "vitest";

import {
  guardedApplicationResponse,
  isPreviewRequest,
  robotsPolicy,
  sanitizedApplicationRequest,
  secureResponse,
} from "./http.js";

describe("frontend response privacy and indexing policy", () => {
  it("guards framework failures without exposing details or emitting cookies", async () => {
    const response = await guardedApplicationResponse(
      new Request("https://preview.example.test/models?q=private"),
      "preview",
      {},
      {},
      () => {
        throw new Error("sensitive internal failure");
      },
    );
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Service temporarily unavailable.");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("removes cookie-setting headers and adds security headers", async () => {
    const request = new Request("https://example.test/models");
    const response = secureResponse(
      request,
      new Response("ok", {
        headers: { "Content-Type": "text/html", "Set-Cookie": "id=1" },
      }),
      "production",
    );

    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "script-src 'none'",
    );
    expect(await response.text()).toBe("ok");
  });

  it("makes every query-string response private and non-cacheable", () => {
    const response = secureResponse(
      new Request("https://example.test/models?q=test"),
      new Response("ok", { headers: { "Cache-Control": "public" } }),
      "production",
    );

    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("marks configured and workers.dev previews as non-indexable", () => {
    expect(isPreviewRequest("preview", "preview.example.test")).toBe(true);
    expect(isPreviewRequest("production", "v1-web.account.workers.dev")).toBe(
      true,
    );
    expect(isPreviewRequest("production", "example.test")).toBe(false);

    const response = secureResponse(
      new Request("https://preview.example.test/"),
      new Response("ok"),
      "preview",
    );
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(
      robotsPolicy(
        "preview",
        "preview.example.test",
        "https://preview.example.test",
      ),
    ).toContain("Disallow: /");
  });

  it("removes visitor and credential headers before Astro receives a request", () => {
    const sanitized = sanitizedApplicationRequest(
      new Request("https://example.test/models?q=public", {
        headers: {
          Accept: "text/html",
          Authorization: "Bearer secret",
          Cookie: "visitor=1",
          "CF-Connecting-IP": "192.0.2.1",
          "CF-IPCountry": "US",
          Referer: "https://referrer.test/",
          "User-Agent": "visitor-agent",
          "X-Forwarded-For": "192.0.2.1",
        },
      }),
    );

    expect(sanitized.url).toBe("https://example.test/models?q=public");
    expect(sanitized.headers.get("Accept")).toBe("text/html");
    expect([...sanitized.headers]).toEqual([["accept", "text/html"]]);
  });
});
