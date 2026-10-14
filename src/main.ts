import { RobotsTxtFile } from "crawlee";
import { rename, writeFile } from "node:fs/promises";
import { BASE, collectProductUrls, loadSitemapUrls } from "./sitemap.js";

// Discovery uses HTTP only: no browser or product-page requests are needed.
const robots = await RobotsTxtFile.find(BASE, undefined, { timeoutMillis: 30_000 });
const advertisedSitemaps = robots.getSitemaps();
// Keep the existing English-Canada scope; still follow language-neutral indexes.
const sitemaps = advertisedSitemaps.filter(
  (url) => !new URL(url).pathname.includes("_fr_ca"),
);
if (sitemaps.length === 0) {
  throw new Error("robots.txt did not advertise an applicable sitemap.");
}

const urls = await loadSitemapUrls(sitemaps);
const products = collectProductUrls(urls, (url) => robots.isAllowed(url));
if (products.length === 0) {
  throw new Error("No product URLs found; existing products.json was left intact.");
}

// Replace the previous result only after the entire discovery succeeds.
await writeFile("products.json.tmp", `${JSON.stringify(products, null, 2)}\n`);
await rename("products.json.tmp", "products.json");

const pages = new Set(products.map((url) => new URL(url).pathname));
console.log(
  `Saved ${products.length} product URLs (${pages.size} distinct page paths) ` +
    `from ${urls.length} sitemap URLs to products.json. Browser navigations: 0.`,
);
