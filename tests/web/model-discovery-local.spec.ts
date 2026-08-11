import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const localDiscovery = process.env.QUANTCLARITY_MODEL_DETAIL_LOCAL === "1";
const exactQuery = "Fixture <script> & Model";
const providerModelIdQuery = "fixture/provider-model-id";
const emptyQuery = "No exact fixture match";
const pagedQuery = "Paged fixture models";
const failureQuery = "Unavailable fixture search";
const modelId = "mdl_22222222-2222-4222-8222-222222222222";
const stablePath = `/models/${modelId}`;
const retainedPublication = "pub_11111111-1111-4111-8111-111111111111";

async function expectNoVisitorState(
  context: BrowserContext,
  page: Page,
): Promise<void> {
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
  expect(await context.cookies()).toEqual([]);
}

function expectPrivateResponse(
  response: Awaited<ReturnType<Page["goto"]>>,
  status: number,
): void {
  expect(response?.status()).toBe(status);
  expect(response?.headers()["cache-control"]).toBe("private, no-store");
  expect(response?.headers()["set-cookie"]).toBeUndefined();
}

test("keeps exact Model discovery closed outside the local stack (FE-010, FE-013, CF-005)", async ({
  page,
}) => {
  test.skip(localDiscovery, "The dedicated local stack exercises discovery.");
  const response = await page.goto(
    `/models?q=${encodeURIComponent(exactQuery)}`,
  );
  expect(response?.headers()["cache-control"]).toBe("private, no-store");
  expect(response?.headers()["set-cookie"]).toBeUndefined();
  await expect(
    page.getByRole("heading", { name: "Exact Model matches" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: exactQuery })).toHaveCount(0);
});

test("runs home-to-stable-ID local Model discovery with hostile text safely (FE-010, FE-013, PRIV-006)", async ({
  context,
  page,
}) => {
  test.skip(!localDiscovery, "Requires the dedicated local-only stack.");
  const outsideRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:8789") outsideRequests.push(url.href);
  });

  await page.goto("/");
  const search = page.getByRole("search");
  await search
    .getByRole("searchbox", {
      name: "Search exact Model names or provider model IDs",
    })
    .fill(exactQuery);
  const navigation = page.waitForResponse(
    (response) =>
      response.request().isNavigationRequest() &&
      new URL(response.url()).pathname === "/models",
  );
  const searchbox = search.getByRole("searchbox", {
    name: "Search exact Model names or provider model IDs",
  });
  await searchbox.focus();
  await expect(searchbox).toBeFocused();
  await searchbox.press("Enter");
  const response = await navigation;
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(response.headers()["set-cookie"]).toBeUndefined();
  expect(new URL(page.url()).searchParams.get("q")).toBe(exactQuery);

  await expect(
    page.getByRole("heading", { level: 2, name: "Exact Model matches" }),
  ).toBeVisible();
  await expect(
    page.getByText(`Results publication: ${retainedPublication}`),
  ).toBeVisible();
  const results = page.getByRole("list", { name: "Exact Model matches" });
  await expect(results).toBeVisible();
  const modelLink = results.getByRole("link", { name: exactQuery });
  await expect(modelLink).toHaveAttribute("href", stablePath);
  await expect(results).toContainText(modelId);
  await expect(results.locator("script, img")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("provider winner");
  expect(
    await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze(),
  ).toMatchObject({ violations: [] });
  await expectNoVisitorState(context, page);
  expect(outsideRequests).toEqual([]);

  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  await modelLink.focus();
  await expect(modelLink).toBeFocused();
  await modelLink.press("Enter");
  await expect(page).toHaveURL(`http://127.0.0.1:8789${stablePath}`);
  await expect(
    page.getByRole("heading", { level: 1, name: exactQuery }),
  ).toBeVisible();
  await expect(
    page.getByText("Model Facts", { exact: true }).first(),
  ).toBeVisible();
  await expectNoVisitorState(context, page);
  expect(outsideRequests).toEqual([]);
});

test("explains empty local exact results and clears the query in one action (FE-016, A11Y-002)", async ({
  page,
}) => {
  test.skip(!localDiscovery, "Requires the dedicated local-only stack.");
  const response = await page.goto(
    `/models?q=${encodeURIComponent(emptyQuery)}`,
  );
  expectPrivateResponse(response, 200);
  await expect(
    page.getByRole("heading", { level: 2, name: "No exact Model matches" }),
  ).toBeVisible();
  const clear = page.getByRole("link", { name: "Clear search" });
  await expect(clear).toHaveAttribute("href", "/models");
  expect(
    await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze(),
  ).toMatchObject({ violations: [] });

  await clear.focus();
  await expect(clear).toBeFocused();
  await clear.press("Enter");
  await expect(page).toHaveURL("http://127.0.0.1:8789/models");
  await expect(
    page.getByRole("searchbox", {
      name: "Search exact Model names or provider model IDs",
    }),
  ).toHaveValue("");
  await expect(
    page.getByRole("heading", { name: "Exact Model matches" }),
  ).toHaveCount(0);
});

test("routes an exact provider model ID match to canonical Model Facts (FE-010, SRCH-002)", async ({
  page,
}) => {
  test.skip(!localDiscovery, "Requires the dedicated local-only stack.");
  const response = await page.goto(
    `/models?q=${encodeURIComponent(providerModelIdQuery)}`,
  );
  expectPrivateResponse(response, 200);
  await expect(
    page
      .getByRole("list", { name: "Exact Model matches" })
      .getByRole("link", { name: exactQuery }),
  ).toHaveAttribute("href", stablePath);
  await expect(
    page.getByText("Exact provider model ID", { exact: true }),
  ).toBeVisible();
});

test("pins pagination across a publication rollover and fails generically after retention expiry (API-003, API-007, SEC-007)", async ({
  page,
}) => {
  test.skip(!localDiscovery, "Requires the dedicated local-only stack.");
  const first = await page.goto(`/models?q=${encodeURIComponent(pagedQuery)}`);
  expectPrivateResponse(first, 200);
  const results = page.getByRole("list", { name: "Exact Model matches" });
  await expect(results.getByRole("link")).toHaveCount(20);
  const next = page.getByRole("link", { name: "Next exact matches" });
  const nextHref = await next.getAttribute("href");
  expect(nextHref).not.toBeNull();
  const nextUrl = new URL(nextHref ?? "", "http://127.0.0.1:8789");
  expect([...nextUrl.searchParams.keys()]).toEqual([
    "q",
    "cursor",
    "publication",
  ]);
  expect(nextUrl.searchParams.get("q")).toBe(pagedQuery);
  expect(nextUrl.searchParams.get("cursor")).toMatch(/^[A-Za-z0-9_.-]+$/u);
  expect(nextUrl.searchParams.get("publication")).toMatch(/^pub_[0-9a-f-]+$/u);
  expect(nextUrl.searchParams.get("publication")).toBe(retainedPublication);

  await next.click();
  await expect(
    page.getByRole("link", { name: "Paged Fixture Model 21" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Next exact matches" }),
  ).toHaveCount(0);
  await expect(
    page.getByText(`Results publication: ${retainedPublication}`),
  ).toBeVisible();

  const expired = await page.goto(nextUrl.pathname + nextUrl.search);
  expectPrivateResponse(expired, 503);
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Exact Model search is temporarily unavailable",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Search URL is invalid" }),
  ).toHaveCount(0);
});

test("rejects invalid and oversized discovery URLs before rendering results (SEC-007, PRIV-006)", async ({
  page,
}) => {
  test.skip(!localDiscovery, "Requires the dedicated local-only stack.");
  for (const path of [
    "/models?q=Fixture&unexpected=1",
    `/models?q=${"x".repeat(201)}`,
    "/models?q=Fixture&cursor=not-a-valid-cursor",
    `/models?q=Fixture&publication=${retainedPublication}`,
    "/models?q=Fixture&cursor=opaque&publication=not-a-publication",
    `/models?q=Fixture&publication=${retainedPublication}&cursor=opaque`,
  ]) {
    const response = await page.goto(path);
    expectPrivateResponse(response, 400);
    await expect(
      page.getByRole("heading", { level: 2, name: "Search URL is invalid" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Clear search" }),
    ).toHaveAttribute("href", "/models");
    await expect(
      page.getByRole("heading", { name: "Exact Model matches" }),
    ).toHaveCount(0);
  }
});

test("renders a generic dependency failure without visitor state or indexing metadata (FE-061, NFR-006, QA-009)", async ({
  context,
  page,
}) => {
  test.skip(!localDiscovery, "Requires the dedicated local-only stack.");
  const outsideRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:8789") outsideRequests.push(url.href);
  });
  const response = await page.goto(
    `/models?q=${encodeURIComponent(failureQuery)}`,
  );
  expectPrivateResponse(response, 503);
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Exact Model search is temporarily unavailable",
    }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(failureQuery);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
  expect(
    await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze(),
  ).toMatchObject({ violations: [] });
  await expectNoVisitorState(context, page);
  expect(outsideRequests).toEqual([]);
});
