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
