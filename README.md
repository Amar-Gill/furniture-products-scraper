# Structube product URL discovery

Collect English-Canada product URLs directly from Structube's public sitemaps using Crawlee. The default command makes HTTP requests for `robots.txt` and its English sitemap (including nested indexes if present). It does not launch Playwright or visit category/product pages.

```sh
npm install
npm start
```

`products.json` contains a sorted, deduplicated array of product URLs. Numeric `pid` parameters are preserved because variants can share a page path. The gift-card product is included explicitly. Category, store, editorial, French-language, and robots-disallowed URLs are excluded. This is URL discovery, not extraction of product details, prices, or inventory.

The collector retries sitemap downloads and rejects empty, failed, or malformed sitemap documents. It replaces `products.json` only after discovery succeeds, preserving the previous output on failure. Empty sitemaps are conservatively treated as errors. Coverage is limited to products listed in the sitemap and the observed Structube URL format; it cannot establish that every live product is listed.

The verified run on October 14, 2026 collected **2,938 product URLs** across **1,988 distinct page paths**, including the gift card, with **zero browser navigations**. Source: [Structube English sitemap](https://www.structube.com/media/sitemap_en_ca.xml), advertised in [robots.txt](https://www.structube.com/robots.txt).

```sh
npm run build           # Compile to dist/
npm run start:prod      # Run the compiled collector
npm test               # Filtering and local HTTP sitemap integration tests
npm run discover:categories  # Original Playwright category discovery, opt-in
```

The category command retains the original browser-based workflow and writes `categories.json`. Playwright remains a dependency for that command; the existing installation hook also installs its browsers. Neither is used during default product discovery.

Implementation references checked with Context7: [Crawlee sitemap example](https://crawlee.dev/js/docs/examples/crawl-sitemap). The collector uses Crawlee's `parseSitemap` one document at a time so a failed child sitemap cannot silently yield a partial successful output.
