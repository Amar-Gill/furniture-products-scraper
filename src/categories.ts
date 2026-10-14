import { PlaywrightCrawler, RobotsTxtFile } from "crawlee";
import { writeFile } from "node:fs/promises";

const BASE = "https://www.structube.com";

const fallbackSeeds = [
  `${BASE}/en_ca/furniture/living-room`,
  `${BASE}/en_ca/furniture/dining-room`,
  `${BASE}/en_ca/furniture/bedroom`,
  `${BASE}/en_ca/furniture/office`,
];

function normalizeCategory(rawUrl: string): string | null {
  const url = new URL(rawUrl);

  if (url.hostname !== "www.structube.com") return null;
  if (!url.pathname.startsWith("/en_ca/furniture/")) {
    return null;
  }

  // Avoid filter, sorting and pagination URLs.
  if (url.search) return null;

  return url.origin + url.pathname.replace(/\/$/, "");
}

// Step 1: Get candidate categories from the sitemap.
const robots = await RobotsTxtFile.find(BASE);
const sitemapCategories = new Set<string>();

try {
  const urls = await robots.parseUrlsFromSitemaps();

  for (const url of urls) {
    const category = normalizeCategory(url);
    if (category && robots.isAllowed(category)) {
      sitemapCategories.add(category);
    }
  }
} catch (error) {
  console.warn("Sitemap unavailable:", error);
}

const discovered = new Set<string>();

// Step 2: Discover additional categories by browsing.
const crawler = new PlaywrightCrawler({
  maxConcurrency: 1,
  maxRequestsPerMinute: 12,
  maxRequestsPerCrawl: 300,
  respectRobotsTxtFile: true,

  async requestHandler({ request, page, enqueueLinks, log }) {
    const categoryUrl = normalizeCategory(request.url);
    if (!categoryUrl) return;

    // Wait for client-rendered navigation links.
    await page
      .locator('a[href*="/en_ca/furniture/"]')
      .first()
      .waitFor({ timeout: 10000 })
      .catch(() => {});

    const title = await page
      .locator("h1")
      .first()
      .textContent({ timeout: 5000 })
      .catch(() => null);

    discovered.add(categoryUrl);

    log.info(`Category: ${title?.trim() ?? categoryUrl}`);

    // Automatically queue linked subcategories.
    await enqueueLinks({
      selector: 'a[href*="/en_ca/furniture/"]',
      strategy: "same-hostname",

      transformRequestFunction(req) {
        const normalized = normalizeCategory(req.url);
        if (!normalized) return false;

        req.url = normalized;
        req.uniqueKey = normalized;

        return req;
      },
    });
  },
});

const seeds = [...new Set([...sitemapCategories, ...fallbackSeeds])].filter(
  (url) => robots.isAllowed(url),
);

await crawler.run(seeds);

// Step 3: Persist the discovered category URLs.
const allCategories = [
  ...new Set([...sitemapCategories, ...discovered]),
].sort();

await writeFile("categories.json", JSON.stringify(allCategories, null, 2));

console.log(`Found ${allCategories.length} categories`);
