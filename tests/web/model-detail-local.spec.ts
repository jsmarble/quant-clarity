import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const localDetail = process.env.QUANTCLARITY_MODEL_DETAIL_LOCAL === "1";
const origin = "https://quantclarity.invalid";
const modelId = "mdl_22222222-2222-4222-8222-222222222222";
const stablePath = `/models/${modelId}`;
const expectedTitle = `Fixture <script> & Model (${modelId}) Model Facts — QuantClarity`;
const expectedDescription = `Publisher and source facts for Fixture <script> & Model include evidence and observation times. QuantClarity canonical Model ID: ${modelId}.`;

async function expectNoBrowserState(page: Page) {
  expect(
    await page.evaluate(async () => ({
      cacheKeys: await caches.keys(),
      indexedDatabases: await indexedDB.databases(),
      localStorageEntries: localStorage.length,
      scripts: document.querySelectorAll("script").length,
      serviceWorkers: (await navigator.serviceWorker.getRegistrations()).map(
        ({ scope }) => scope,
      ),
      sessionStorageEntries: sessionStorage.length,
    })),
  ).toEqual({
    cacheKeys: [],
    indexedDatabases: [],
    localStorageEntries: 0,
    scripts: 0,
    serviceWorkers: [],
    sessionStorageEntries: 0,
  });
}

test("keeps Model detail closed outside the local Model Facts stack (FE-030, SEC-011)", async ({
  page,
}) => {
  test.skip(
    localDetail,
    "The dedicated local stack exercises the admitted route.",
  );
  const response = await page.goto(stablePath);
  expect(response?.status()).toBe(404);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
});

test("renders local Model Facts through the pinned web API query chain (FE-030, FE-031, API-004)", async ({
  context,
  page,
}) => {
  test.skip(!localDetail, "Requires the dedicated local-only stack.");
  const outsideRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:8789") outsideRequests.push(url.href);
  });

  const response = await page.goto(`${stablePath}?visitor-secret=never-render`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toBe("private, no-store");
  expect(response?.headers()["set-cookie"]).toBeUndefined();
  await expect(
    page.getByText("Model Facts", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Fixture <script> & Model" }),
  ).toBeVisible();
  await expect(page.locator("body")).toContainText(
    "stable Model ID is QuantClarity's canonical routing identity",
  );
  await expect(page.locator("body")).not.toContainText("visitor-secret");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${origin}${stablePath}`,
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    `${origin}${stablePath}`,
  );
  await expect(page).toHaveTitle(expectedTitle);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    expectedDescription,
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    expectedTitle,
  );
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
    "content",
    expectedDescription,
  );
  await expect(page.locator("body")).toContainText(
    "publisher/example<checkpoint>",
  );
  await expect(page.locator("body")).not.toContainText("provider winner");
  for (const state of ["Known", "Unknown", "Unavailable", "Not applicable"])
    await expect(page.getByText(state, { exact: true }).first()).toBeVisible();
  for (const label of [
    "Stable Model ID",
    "Cataloged provider count",
    "Total parameters",
    "Active parameters",
    "Source weight format",
    "Source quantization",
    "Evidence",
    "Observed",
  ])
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    "fam_33333333-3333-4333-8333-333333333333",
  );
  await expect(page.locator("body")).not.toContainText(
    "chk_55555555-5555-4555-8555-555555555555",
  );
  await expect(page.locator("body")).not.toContainText(
    "org_66666666-6666-4666-8666-666666666666",
  );

  expect(
    await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze(),
  ).toMatchObject({ violations: [] });
  await expectNoBrowserState(page);
  expect(await context.cookies()).toEqual([]);
  expect(outsideRequests).toEqual([]);

  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("handles current, historical, and absent identifiers in the local Model Facts stack (FE-030, API-005)", async ({
  page,
  request,
}) => {
  test.skip(!localDetail, "Requires the dedicated local-only stack.");

  const current = await page.goto("/models/fixture-model");
  expect(current?.status()).toBe(200);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${origin}${stablePath}`,
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    `${origin}${stablePath}`,
  );
  await expect(page).toHaveTitle(expectedTitle);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    expectedDescription,
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    expectedTitle,
  );
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
    "content",
    expectedDescription,
  );

  const historical = await request.get(
    "/models/fixture-model-old?visitor-secret=discarded",
    { maxRedirects: 0 },
  );
  expect(historical.status()).toBe(308);
  expect(await historical.body()).toHaveLength(0);
  expect(historical.headers().location).toBe(stablePath);
  expect(historical.headers()["cache-control"]).toBe("private, no-store");

  const missing = await page.goto("/models/not-in-publication");
  expect(missing?.status()).toBe(404);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
  expect(
    await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze(),
  ).toMatchObject({ violations: [] });
});

test("renders a generic dependency-unavailable local Model Facts page without visitor state (FE-061, PRIV-006, QA-009)", async ({
  context,
  page,
}) => {
  test.skip(!localDetail, "Requires the dedicated local-only stack.");
  const outsideRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:8789") outsideRequests.push(url.href);
  });

  const response = await page.goto(
    "/models/fixture-model-unavailable?visitor-secret=must-not-reflect",
  );
  expect(response?.status()).toBe(503);
  expect(response?.headers()["cache-control"]).toBe("private, no-store");
  expect(response?.headers()["set-cookie"]).toBeUndefined();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Model Facts are temporarily unavailable",
    }),
  ).toBeVisible();
  await expect(page.locator("body")).toContainText(
    "could not verify one publication-consistent Model Facts response",
  );
  await expect(page.locator("body")).not.toContainText(
    "fixture-model-unavailable",
  );
  await expect(page.locator("body")).not.toContainText("visitor-secret");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
  expect(
    await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze(),
  ).toMatchObject({ violations: [] });
  await expectNoBrowserState(page);
  expect(await context.cookies()).toEqual([]);
  expect(outsideRequests).toEqual([]);
});
