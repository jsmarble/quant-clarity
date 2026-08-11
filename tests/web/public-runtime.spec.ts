import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

const routes = [
  "/",
  "/models",
  "/providers",
  "/methodology",
  "/methodology/1.0.0",
  "/api",
  "/privacy",
  "/terms",
] as const;
const expectedSiteOrigin = process.env.QUANTCLARITY_EXPECTED_SITE_ORIGIN;
const publicationState =
  process.env.QUANTCLARITY_MOCK_PUBLICATION_STATE ?? "published";

async function browserPersistence(page: Page) {
  return page.evaluate(async () => ({
    cacheKeys: await caches.keys(),
    indexedDatabases: await indexedDB.databases(),
    localStorageEntries: localStorage.length,
    scripts: document.querySelectorAll("script").length,
    serviceWorkers: (await navigator.serviceWorker.getRegistrations()).map(
      (registration) => registration.scope,
    ),
    sessionStorageEntries: sessionStorage.length,
  }));
}

async function expectMethodologyVersion100(page: Page) {
  const article = page.getByRole("article");
  await expect(article.locator('time[datetime="2026-08-01"]')).toHaveCount(2);
  for (const term of [
    "Source-checkpoint precision",
    "Source-provided quantization",
    "Serving-weights precision",
    "Compute and component precision",
    "Normalized labels",
    "Mixed, other, and unknown",
  ]) {
    await expect(page.locator("dt").filter({ hasText: term })).toBeVisible();
  }

  for (const heading of [
    "Model grouping",
    "Evidence and source precedence",
    "Freshness and status",
    "Prices",
    "Neutral comparison and ordering",
    "Material-change log",
  ]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }

  for (const requiredRule of [
    "serving precision alone does not split a canonical model",
    "explicitly named and selectable precision or material variant receives its own variant resource",
    "Canonical and variant pages link to one another while their provider comparisons remain separate",
    "Alias matching never hides an explicit variant distinction",
    "Precedence is field-specific, not simply “newest wins.”",
    "Exact provider API or authenticated-catalog facts lead for the exact offering",
    "Publisher-controlled checkpoints and documentation lead for upstream identity",
    "community discussion is only a lead for investigation",
    "Equally authoritative unresolved conflicts publish as unknown",
    "lower-priority conflicts are retained internally for audit",
    "two consecutive completed Monday/Thursday refresh opportunities",
    "more than eight elapsed days since its last successful observation",
    "Stale active and historical offerings remain visible through explicit filters",
    "default table is limited to active, non-stale offerings",
    "each offering exposes its own observation time",
    "does not rank or recommend inference providers",
    "prices are stated per one million tokens, stored as decimal-safe amounts, and stay separate",
    "missing cached-input price is unknown, never zero or a copy of standard input",
    "provider-stated currency is preserved, using an ISO 4217 code where one exists, without foreign-exchange conversion",
    "USD is visibly labeled as a system default rather than a provider statement",
    "Every current price shows its source, unit, currency, effective or observed time",
    "If only a promotional price is available, that limitation is visible",
    "historical price and precision observations are retained for the life of the service",
    "Conditional price classes remain separately filterable",
    "Input, output, and cached-input price fields remain independently sortable and filterable",
    "does not calculate a blended token price",
    "compute a composite value score",
    "USD is the default currency scope when a matching USD offering exists",
    "requires a currency selection or uses the first available ISO currency in ascending code order",
    "Prices in different currencies are never numerically interleaved, converted, or ranked",
    "sort and filter state is visible in the interface and URL and is not persisted as a global provider preference",
    "Equal factual values remain equal",
    "commission, and operator preference never break factual ties",
    "does not compute or publish a provider winner, recommendation, preferred-provider list, fidelity rank, value rank, or cheapest-provider designation",
    "default offering order is provider display name ascending, then stable offering ID ascending",
    "sort by provider, normalized precision label, each standard comparable price role, freshness, or status",
    "Precision display order is organizational only—not fidelity, quality, or lineage ranking",
    "Mixed, other, unknown, and non-comparable precision states remain explicit and are never forced into a misleading numerical rank",
    "Affiliate status, commission, and operator preference never break factual ties or affect facts, inclusion, relevance, filters, or ordering",
  ]) {
    await expect(article, requiredRule).toContainText(requiredRule);
  }
}

test("serves every public page through the guarded Worker (FE-001, FE-063, PRIV-006)", async ({
  context,
  page,
}) => {
  for (const route of routes) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    expect(response?.headers()["set-cookie"], route).toBeUndefined();
    expect(response?.headers()["x-robots-tag"], route).toBe(
      "noindex, nofollow",
    );
    expect(response?.headers()["content-security-policy"], route).toContain(
      "script-src 'none'",
    );
    const canonical = page.locator('link[rel="canonical"]');
    const openGraphUrl = page.locator('meta[property="og:url"]');
    if (expectedSiteOrigin === undefined) {
      await expect(canonical, route).toHaveCount(0);
      await expect(openGraphUrl, route).toHaveCount(0);
    } else {
      const expectedUrl = new URL(route, expectedSiteOrigin).toString();
      await expect(canonical, route).toHaveAttribute("href", expectedUrl);
      await expect(openGraphUrl, route).toHaveAttribute("content", expectedUrl);
    }
    expect(await browserPersistence(page), route).toEqual({
      cacheKeys: [],
      indexedDatabases: [],
      localStorageEntries: 0,
      scripts: 0,
      serviceWorkers: [],
      sessionStorageEntries: 0,
    });
  }
  expect(await context.cookies()).toEqual([]);

  const missing = await page.goto("/not-a-real-page");
  expect(missing?.status()).toBe(404);
  expect(missing?.headers()["cache-control"]).toBe("private, no-store");
  expect(missing?.headers()["set-cookie"]).toBeUndefined();
  expect(await browserPersistence(page)).toEqual({
    cacheKeys: [],
    indexedDatabases: [],
    localStorageEntries: 0,
    scripts: 0,
    serviceWorkers: [],
    sessionStorageEntries: 0,
  });
});

test("renders the configured canonical publication state through the web/API/query Worker chain (FE-007, FE-009, API-003, API-015)", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const status = page.getByRole("status");
  if (publicationState === "not_published") {
    await page.goto("/models");
    await expect(
      page.getByText("0 published models", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Publication pending")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Not yet published");
    return;
  }
  if (publicationState === "unavailable") {
    await page.goto("/providers");
    await expect(
      page.getByText("Published provider count unavailable", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Unavailable");
    await expect(page.getByText("0 published providers")).toHaveCount(0);
    return;
  }
  await expect(status).toContainText(
    "Publication pub_11111111-1111-4111-8111-111111111111",
  );
  await expect(status.locator("time")).toHaveAttribute(
    "datetime",
    "2026-08-01T00:30:00.000Z",
  );
  await expect(status).toContainText("Aug 1, 2026, 12:30 AM UTC");

  if (publicationState === "published_zero") {
    await page.goto("/models");
    await expect(
      page.getByText("0 published models", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "This publication contains no active models",
      }),
    ).toBeVisible();
    await expect(page.getByText("Publication pending")).toHaveCount(0);
    await page.goto("/providers");
    await expect(
      page.getByText("0 published providers", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "This publication contains no active providers",
      }),
    ).toBeVisible();
    return;
  }

  await page.goto("/models");
  await expect(
    page.getByText("2 published models", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Model listing is not yet available",
    }),
  ).toBeVisible();
  await expect(page.getByText("Publication pending")).toHaveCount(0);

  await page.goto("/providers");
  await expect(
    page.getByText("1 published provider", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Provider listing is not yet available",
    }),
  ).toBeVisible();

  const wildcardHtml = await request.get("/", {
    headers: { Accept: "*/*" },
  });
  expect(await wildcardHtml.text()).toContain(
    "pub_11111111-1111-4111-8111-111111111111",
  );
});

test("publishes complete versioned methodology and material-change semantics (FE-050–FE-052)", async ({
  page,
}) => {
  await page.goto("/methodology");
  await expect(page).toHaveTitle("Methodology — QuantClarity");
  await expect(page.getByText("Methodology version 1.0.0")).toBeVisible();
  await expect(page.locator('time[datetime="2026-08-01"]')).toHaveCount(2);

  await expect(
    page.getByText(
      "QuantClarity publishes scoped, evidence-backed facts. It does not rank or recommend inference providers.",
      { exact: true },
    ),
  ).toBeVisible();

  const versions = page.getByRole("list", { name: "Methodology versions" });
  await expect(
    versions.getByRole("link", { name: "Version 1.0.0", exact: true }),
  ).toHaveAttribute("href", "/methodology/1.0.0");
  await expect(versions).toContainText(
    "model-grouping and normalization rules",
  );
  await expect(versions).toContainText("neutral comparison and sort behavior");
  await expectMethodologyVersion100(page);

  const historical = await page.goto("/methodology/1.0.0");
  expect(historical?.status()).toBe(200);
  await expect(page).toHaveTitle("Methodology v1.0.0 — QuantClarity");
  await expect(page.getByText("Methodology version 1.0.0")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Material-change log" }),
  ).toBeVisible();
  await expectMethodologyVersion100(page);
});

test("passes automated accessibility, keyboard, mobile, and reflow smoke (A11Y-001–A11Y-007, NFR-004)", async ({
  browser,
  page,
}) => {
  for (const route of routes) {
    await page.goto(route);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations, route).toEqual([]);
  }

  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  const noJavaScript = await browser.newContext({
    javaScriptEnabled: false,
    reducedMotion: "reduce",
    viewport: { height: 640, width: 320 },
  });
  const noJavaScriptPage = await noJavaScript.newPage();
  await noJavaScriptPage.goto("/models?q=Qwen%20%26%20test");
  await expect(
    noJavaScriptPage.getByRole("heading", { level: 1 }),
  ).toBeVisible();
  expect(
    await noJavaScriptPage.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(await noJavaScript.cookies()).toEqual([]);
  await noJavaScript.close();

  for (const width of [640, 320]) {
    const reflow = await browser.newContext({
      reducedMotion: "reduce",
      viewport: { height: 720, width },
    });
    const reflowPage = await reflow.newPage();
    for (const route of routes) {
      await reflowPage.goto(route);
      expect(
        await reflowPage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `${route} must reflow at the ${String(width)}px equivalent zoom viewport`,
      ).toBe(true);
    }
    await reflow.close();
  }
});

test("emits no browser console errors or third-party requests (PRIV-005, PRIV-011)", async ({
  page,
}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") external.push(url.toString());
  });

  for (const route of routes) await page.goto(route);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("guards mutation, framework image errors, and rate-limit responses (API-013, API-022, PRIV-006)", async ({
  request,
}) => {
  const mutation = await request.post("/");
  expect(mutation.status()).toBe(405);
  expect(mutation.headers()["cache-control"]).toBe("private, no-store");
  expect(mutation.headers()["set-cookie"]).toBeUndefined();

  const imageError = await request.get("/_image");
  expect(imageError.status()).toBeGreaterThanOrEqual(400);
  expect(imageError.headers()["cache-control"]).toBe("private, no-store");
  expect(imageError.headers()["set-cookie"]).toBeUndefined();

  let limited: APIResponse | undefined;
  for (let attempt = 0; attempt < 140; attempt += 1) {
    const response = await request.get(
      `/?synthetic-rate-probe=${String(attempt)}`,
    );
    if (response.status() === 429) {
      limited = response;
      break;
    }
  }
  expect(
    limited,
    "local workerd must exercise the rate-limit path",
  ).toBeDefined();
  expect(limited?.headers()["retry-after"]).toBe("60");
  expect(limited?.headers()["cache-control"]).toBe("private, no-store");
  expect(limited?.headers()["set-cookie"]).toBeUndefined();
});
