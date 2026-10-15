// Keep first: loads .env before any other module reads process.env.
import "./env.js";
import { readFile, rename, writeFile } from "node:fs/promises";
import { Dataset, PlaywrightCrawler, playwrightUtils } from "crawlee";
import type { Page } from "playwright";
import {
  extractProduct,
  type PageWatch,
  type ProductRecord,
  type ProductResult,
  waitForProductDetails,
  waitForProductOrNotFound,
  watchPage,
} from "./product-page.js";

const PAGE_TIMEOUT_MS = 45_000;
const DETAILS_TIMEOUT_MS = 20_000;

// Product data never depends on these, and blocking them keeps crawler visits out of the
// site's analytics. `blockRequests` already blocks images, CSS, fonts and PDFs by default.
const BLOCKED_URL_PATTERNS = [
  ".webp",
  ".mp4",
  ".ico",
  "fonts.gstatic.com",
  "typekit.net",
  "google-analytics.com",
  "googletagmanager.com",
  "googleoptimize.com",
  "googlesyndication.com",
  "doubleclick.net",
  "nr-data.net",
  "js-agent.newrelic.com",
  "collector.structube.com",
  "structube-attribution",
  "cookieyes.com",
  "getcandid.com",
  "publitas.com",
  "commerce.adobe.io",
  "maps.googleapis.com",
  "ajax.googleapis.com",
  "google.com/recaptcha",
  "gstatic.com/recaptcha",
];

// The storefront persists its Apollo cache in localStorage. Without it every page fetches fresh
// data, including the review query that the crawler waits for.
const CLEAR_PERSISTED_API_CACHE =
  'try { for (const key of Object.keys(localStorage)) if (key.startsWith("apollo-cache-persist")) localStorage.removeItem(key); } catch {}';

function positiveInteger(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer (got "${raw}").`);
  }
  return value;
}

async function readUrlList(path: string): Promise<string[]> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(`${path} must contain a JSON array of URLs.`);
  }
  return value;
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const productsFile = process.env.PRODUCTS_FILE || "products.json";
const outputFile = process.env.OUTPUT_FILE || "product-details.json";
const limit = positiveInteger("LIMIT");
const products = await readUrlList(productsFile);
const urls = limit ? products.slice(0, limit) : products;
const categories = new Set(await readUrlList("categories.json"));

const dataset = await Dataset.open<ProductRecord>();
const pageWatches = new WeakMap<Page, PageWatch>();

async function save(result: ProductResult): Promise<void> {
  await dataset.pushData({ ...result, scrapedAt: new Date().toISOString() });
}

const crawler = new PlaywrightCrawler({
  maxConcurrency: positiveInteger("MAX_CONCURRENCY") ?? 2,
  maxRequestsPerMinute: positiveInteger("MAX_REQUESTS_PER_MINUTE") ?? 20,
  maxRequestRetries: 3,
  navigationTimeoutSecs: 60,
  requestHandlerTimeoutSecs: 180,
  respectRobotsTxtFile: true,

  async onSkippedRequest({ url, reason }) {
    if (reason === "robotsTxt")
      await save({
        url,
        status: "skipped",
        reason: "Disallowed by robots.txt.",
      });
  },

  preNavigationHooks: [
    async ({ page, blockRequests }, gotoOptions) => {
      // The app shell is enough: product data arrives through the app's own API calls.
      gotoOptions.waitUntil = "domcontentloaded";
      await blockRequests({ extraUrlPatterns: BLOCKED_URL_PATTERNS });
      await page.addInitScript({ content: CLEAR_PERSISTED_API_CACHE });
      pageWatches.set(page, watchPage(page));
    },
  ],

  async requestHandler({ request, page, log }) {
    const watch = pageWatches.get(page);
    if (!watch) throw new Error("The page was not prepared before navigation.");

    let state = await waitForProductOrNotFound(page, PAGE_TIMEOUT_MS);
    if (state === "not_found" && !watch.routeNotFound) {
      // The app shows the same screen when its product query fails, so confirm once before
      // recording a dead URL.
      log.info(`Unconfirmed "not found" page, reloading once: ${request.url}`);
      await page.reload({ waitUntil: "domcontentloaded" });
      state = await waitForProductOrNotFound(page, PAGE_TIMEOUT_MS);
    }
    if (state === "not_found") {
      log.info(`Not found: ${request.url}`);
      await save({
        url: request.url,
        status: "not_found",
        reason: "The product page shows 404 Not Found.",
      });
      return;
    }

    await waitForProductDetails(page, DETAILS_TIMEOUT_MS);
    const reviews = await withTimeout(
      watch.reviews,
      DETAILS_TIMEOUT_MS,
      "The review summary did not load.",
    );
    const $ = await playwrightUtils.parseWithCheerio(page, true, true);
    const result = extractProduct($, { url: request.url, categories, reviews });
    const outcome =
      result.status === "ok"
        ? `Scraped ${result.name}`
        : `Not found (${result.reason})`;
    log.info(`${outcome}: ${request.url}`);
    await save(result);
  },

  async failedRequestHandler({ request }, error) {
    await save({ url: request.url, status: "failed", reason: error.message });
  },
});

await crawler.run(urls);

// A resumed crawl can record a URL twice; keep its latest record.
const { items } = await dataset.getData();
const records = [
  ...new Map(items.map((record) => [record.url, record])).values(),
].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
await writeFile(`${outputFile}.tmp`, `${JSON.stringify(records, null, 2)}\n`);
await rename(`${outputFile}.tmp`, outputFile);

const counts = new Map<string, number>();
for (const { status } of records)
  counts.set(status, (counts.get(status) ?? 0) + 1);
console.log(
  `Saved ${records.length} product records to ${outputFile} (` +
    [...counts].map(([status, count]) => `${count} ${status}`).join(", ") +
    ").",
);
