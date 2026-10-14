import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { RobotsTxtFile } from "crawlee";
import { BASE, collectProductUrls, loadSitemapUrls, normalizeProductUrl } from "../src/sitemap.js";

test("product filtering preserves variants, includes gift cards and excludes other pages", () => {
  const product = `${BASE}/en_ca/bixx-armchair-50-66-80`;
  const gift = `${BASE}/en_ca/gift-card-giftcard`;
  assert.deepEqual(collectProductUrls([
    `${product}?pid=17445`, `${product}?pid=17446`,
    `${product}/?pid=17445&tracking=example#details`, gift,
    `${BASE}/en_ca/furniture/office`, `${BASE}/en_ca/about-us`,
    `${BASE}/en_ca/important-information-on-covid-19`,
    `${BASE}/fr_ca/armchair?pid=17445`,
    "https://example.com/en_ca/armchair?pid=17445", "invalid URL",
    `${product}?pid=`, `${product}?pid=wrong`, `${product}?pid=1&pid=2`,
  ], () => true), [`${product}?pid=17445`, `${product}?pid=17446`, gift]);
  assert.equal(normalizeProductUrl(`http://www.structube.com/en_ca/armchair?pid=1`), null);
});

test("robots rules apply before and after URL normalization", () => {
  const product = `${BASE}/en_ca/chair?pid=123`;
  const robots = RobotsTxtFile.from(`${BASE}/robots.txt`,
    "User-agent: *\nDisallow: *&color\nDisallow: /en_ca/blocked\n");
  assert.deepEqual(collectProductUrls([
    product, `${product}&color=red`, `${BASE}/en_ca/blocked?pid=456`,
  ], (url) => robots.isAllowed(url)), [product]);
  assert.deepEqual(collectProductUrls([`${product}&tracking=yes`],
    (url) => url !== product), []);
});

test("HTTP sitemap traversal handles nested indexes, gzip, cycles, and failures", async (t) => {
  const hits = new Map<string, number>();
  let origin: string;
  const index = (paths: string[]) => `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(
    (path) => `<sitemap><loc>${origin}${path}</loc></sitemap>`,
  ).join("")}</sitemapindex>`;
  const urlset = () => `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/product?pid=1&amp;extra=2</loc><image:image xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><image:loc>${origin}/image.jpg</image:loc></image:image></url></urlset>`;
  const server = createServer((request, response) => {
    const path = request.url!;
    hits.set(path, (hits.get(path) ?? 0) + 1);
    response.setHeader("Content-Type", "application/xml");
    if (path === "/index.xml") response.end(index(["/nested.xml", "/products.xml.gz", "/nested.xml"]));
    else if (path === "/nested.xml") response.end(index(["/index.xml", "/products.xml.gz"]));
    else if (path === "/products.xml.gz") {
      response.setHeader("Content-Type", "application/gzip");
      response.end(gzipSync(urlset()));
    } else if (path === "/partial.xml") response.end(index(["/products.xml.gz", "/missing.xml"]));
    else if (path === "/empty.xml") response.end('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>');
    else if (path === "/malformed.xml") response.end(urlset().replace("</urlset>", "<broken></urlset>"));
    else { response.statusCode = 404; response.end("Not found"); }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  assert.deepEqual(await loadSitemapUrls([`${origin}/index.xml`]), [`${origin}/product?pid=1&extra=2`]);
  assert.deepEqual([...hits.values()], [1, 1, 1]);
  await assert.rejects(loadSitemapUrls([`${origin}/partial.xml`]), /missing\.xml/);
  await assert.rejects(loadSitemapUrls([`${origin}/empty.xml`]), /empty\.xml/);
  await assert.rejects(loadSitemapUrls([`${origin}/malformed.xml`]));
});
