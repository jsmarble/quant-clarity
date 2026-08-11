import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const localDiscovery = process.env.QUANTCLARITY_MODEL_DETAIL_LOCAL === "1";
const exactQuery = "Fixture <script> FP8 Variant";
const providerModelIdQuery = "fixture/provider-variant-fp8";
const emptyQuery = "No exact fixture Variant match";
const pagedQuery = "Paged fixture variants";
const failureQuery = "Unavailable fixture Variant search";
const variantId = "var_99999999-9999-4999-8999-999999999999";
const modelId = "mdl_22222222-2222-4222-8222-222222222222";
const familyId = "fam_33333333-3333-4333-8333-333333333333";

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

test("keeps exact Variant discovery closed outside local (FE-020, FE-027, CF-005)", async ({
  page,
}) => {
  test.skip(localDiscovery, "The dedicated local stack exercises discovery.");
  const response = await page.goto(
    `/variants?q=${encodeURIComponent(exactQuery)}`,
  );
  expectPrivateResponse(response, 200);
  await expect(
    page.getByRole("heading", { name: "Exact Variant matches" }),
  ).toHaveCount(0);
});

test("renders an evidence-backed explicit Variant card and canonical Model relationship without JavaScript (FE-020–FE-027, PRIV-006, A11Y-001)", async ({
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
    `/variants?q=${encodeURIComponent(exactQuery)}`,
  );
  expectPrivateResponse(response, 200);
  await expect(
    page.getByRole("heading", { level: 2, name: "Exact Variant matches" }),
  ).toBeVisible();
  const results = page.getByRole("list", { name: "Exact Variant matches" });
  await expect(
    results.getByText("Explicit variant", { exact: true }),
  ).toBeVisible();
  const title = results.getByRole("heading", { level: 3, name: exactQuery });
  await expect(title).toBeVisible();
  await expect(results.getByRole("link", { name: exactQuery })).toHaveCount(0);
  await expect(results).toContainText(variantId);
  await expect(results).toContainText(familyId);
  const modelLink = results.getByRole("link", {
    name: "Open canonical Model Facts",
  });
  await expect(modelLink).toHaveAttribute("href", `/models/${modelId}`);

  const factRow = (label: string) =>
    results
      .locator(".fact-row")
      .filter({ has: page.getByText(label, { exact: true }) });
  const expectedFacts = [
    "Display name",
    "Variant kind",
    "Publisher",
    "Total parameters",
    "Active parameters",
    "Source checkpoint weight format",
    "Source-provided quantization",
    "Cataloged provider count",
    "Last Model-data refresh",
  ];
  for (const label of expectedFacts)
    await expect(
      factRow(label).getByText(label, { exact: true }),
    ).toBeVisible();
  await expect(factRow("Display name")).toContainText(exactQuery);
  await expect(factRow("Variant kind")).toContainText(
    "publisher_precision_variant",
  );
  await expect(factRow("Publisher")).toContainText("Fixture Publisher");
  await expect(factRow("Total parameters")).toContainText(
    "~70B; normalized: 70000000000; approximation: approximate",
  );
  await expect(
    factRow("Active parameters").getByText("Unknown", { exact: true }),
  ).toBeVisible();
  await expect(factRow("Active parameters")).toContainText(
    "Observed: Not recorded",
  );
  await expect(factRow("Active parameters")).toContainText(
    "Evidence: No references",
  );
  await expect(
    factRow("Source checkpoint weight format").getByText("Unavailable", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(factRow("Source-provided quantization")).toContainText("FP8");
  await expect(factRow("Cataloged provider count")).toContainText(
    "cataloged-provider-count@1",
  );
  for (const label of [
    "Display name",
    "Variant kind",
    "Publisher",
    "Total parameters",
    "Source-provided quantization",
    "Last Model-data refresh",
  ]) {
    await expect(factRow(label)).toContainText("Observed:");
    await expect(factRow(label)).toContainText(
      "evd_44444444-4444-4444-8444-444444444444",
    );
  }
  await expect(results).not.toContainText("Provider price");
  await expect(results).not.toContainText("Serving precision");
  await expect(results).not.toContainText("Affiliate");
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
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "4";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  await modelLink.focus();
  await expect(modelLink).toBeFocused();
  await modelLink.press("Enter");
  await expect(page).toHaveURL(`http://127.0.0.1:8789/models/${modelId}`);
  await expect(
    page.getByText("Model Facts", { exact: true }).first(),
  ).toBeVisible();
});

test("exposes Variant discovery through navigation and handles exact provider IDs and empty results (FE-020, FE-025, A11Y-002)", async ({
  page,
}) => {
  test.skip(!localDiscovery, "Requires the dedicated local-only stack.");
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Variants", exact: true }),
  ).toHaveAttribute("href", "/variants");
  await expect(
    page.getByRole("link", { name: "Search explicit Variants" }),
  ).toHaveAttribute("href", "/variants");

  let response = await page.goto(
    `/variants?q=${encodeURIComponent(providerModelIdQuery)}`,
  );
  expectPrivateResponse(response, 200);
  await expect(
    page.getByText("Exact provider model ID", { exact: true }),
  ).toBeVisible();
  response = await page.goto(`/variants?q=${encodeURIComponent(emptyQuery)}`);
  expectPrivateResponse(response, 200);
  await expect(
    page.getByRole("heading", { name: "No exact Variant matches" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Clear search" }),
  ).toHaveAttribute("href", "/variants");
});

test("pins Variant pagination and rejects malformed public URL state (API-003, SEC-007)", async ({
  page,
}) => {
  test.skip(!localDiscovery, "Requires the dedicated local-only stack.");
  const first = await page.goto(
    `/variants?q=${encodeURIComponent(pagedQuery)}`,
  );
  expectPrivateResponse(first, 200);
  await expect(page.locator("article.exact-match")).toHaveCount(20);
  const next = page.getByRole("link", { name: "Next exact matches" });
  const nextHref = await next.getAttribute("href");
  const nextUrl = new URL(nextHref ?? "", "http://127.0.0.1:8789");
  expect([...nextUrl.searchParams.keys()]).toEqual([
    "q",
    "cursor",
    "publication",
  ]);
  const pinned = nextUrl.searchParams.get("publication");
  expect(pinned).toMatch(/^pub_[0-9a-f-]+$/u);
  if (pinned === null) throw new Error("next page must retain a publication");
  await next.click();
  await expect(
    page.getByRole("heading", {
      level: 3,
      name: "Paged Fixture FP8 Variant 21",
    }),
  ).toBeVisible();
  await expect(page.getByText(`Results publication: ${pinned}`)).toBeVisible();

  for (const path of [
    "/variants?q=Fixture&unexpected=1",
    `/variants?q=${"x".repeat(201)}`,
    "/variants?q=Fixture&cursor=opaque",
    "/variants?q=Fixture&publication=pub_11111111-1111-4111-8111-111111111111",
  ]) {
    const invalid = await page.goto(path);
    expectPrivateResponse(invalid, 400);
    await expect(
      page.getByRole("heading", { name: "Search URL is invalid" }),
    ).toBeVisible();
  }
});

test("renders a generic Variant dependency failure without indexing or visitor state (FE-061, NFR-006, QA-009)", async ({
  context,
  page,
}) => {
  test.skip(!localDiscovery, "Requires the dedicated local-only stack.");
  const response = await page.goto(
    `/variants?q=${encodeURIComponent(failureQuery)}`,
  );
  expectPrivateResponse(response, 503);
  await expect(
    page.getByRole("heading", {
      name: "Exact Variant search is temporarily unavailable",
    }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(failureQuery);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
  expect(
    await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze(),
  ).toMatchObject({ violations: [] });
  await expectNoVisitorState(context, page);
});
