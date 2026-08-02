import type { APIRoute } from "astro";

const paths = [
  "/",
  "/models",
  "/providers",
  "/methodology",
  "/methodology/1.0.0",
  "/api",
  "/privacy",
  "/terms",
] as const;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export const GET: APIRoute = ({ url }) => {
  const entries = paths
    .map(
      (path) =>
        `<url><loc>${escapeXml(new URL(path, url.origin).toString())}</loc></url>`,
    )
    .join("");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
