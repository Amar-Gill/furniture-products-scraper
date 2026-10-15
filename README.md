# Structube product scraper

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
npm test               # Sitemap tests and product page extraction tests
npm run discover:categories  # Original Playwright category discovery, opt-in
```

The category command retains the original browser-based workflow and writes `categories.json`. Playwright remains a dependency for that command; the existing installation hook also installs its browsers. Neither is used during default product discovery.

Implementation references checked with Context7: [Crawlee sitemap example](https://crawlee.dev/js/docs/examples/crawl-sitemap). The collector uses Crawlee's `parseSitemap` one document at a time so a failed child sitemap cannot silently yield a partial successful output.

## Product details

```sh
npm run scrape:details              # every URL in products.json
LIMIT=20 npm run scrape:details     # quick trial run
```

Structube renders product pages client-side, so the crawler opens each URL from `products.json` in Playwright and writes `product-details.json`: one record per URL, sorted by URL. Records with `status: "ok"` contain:

| Field | Description |
| --- | --- |
| `name`, `sku` | Product title and the SKU of the requested variant. |
| `price` | Regular price in `currency` (CAD). |
| `discountedPrice` | Lowest sale or promotion price shown, or `null` when the product is not discounted. |
| `description` | Description and its feature bullets, one paragraph or bullet per line. |
| `category` | Deepest breadcrumb that appears in `categories.json`, or `null` (decor, open-box items and products the site assigns to no category). |
| `categoryPath` | Breadcrumb names as shown, e.g. `["Furniture", "Living Room", "Loveseats"]`. |
| `specifications` | Specification lines as shown; label/value pairs become `"Label: value"`. |
| `color` | Selected colour, or `null` when the product has no colour. |
| `dimensions` | Product (not packaging) dimensions as shown, e.g. `{"width": "175 cm (69\")", "height": "85 cm (34\")", "depth": "89 cm (35\")"}`; `null` when not available. |
| `rating`, `reviewCount` | Average customer rating out of 5 (`null` without reviews) and number of reviews. |
| `inStockAndReadyToShip` | `true` when the item can be ordered online now ("In stock and ready to ship", "Low stock online", or "Online only" for open-box items); `false` when out of stock, restocking or in store only; `null` when the page shows no availability (gift card). |
| `stockStatus` | Availability message as shown, e.g. `"Reserve now - Available November 29, 2026"`. |
| `stockRegion` | Region the availability applies to. Without a postal code, Structube uses Quebec. |

Other records contain `url`, `status`, `reason` and `scrapedAt`:

- `not_found`: the page shows "404 Not Found" (it still returns HTTP 200, so the crawler checks the rendered page), or the URL's `pid` variant is no longer offered (the site silently shows another variant). A 404 screen is accepted when the storefront's own route lookup confirms it; otherwise the page is reloaded once, because the same screen appears when the product query fails.
- `failed`: the page kept failing after 3 retries; `reason` holds the last error.
- `skipped`: disallowed by robots.txt.

The crawl is deliberately polite: 2 pages at a time and at most 20 per minute, so the full list takes about 2.5 hours. Tune it with `MAX_CONCURRENCY` and `MAX_REQUESTS_PER_MINUTE`. `PRODUCTS_FILE` and `OUTPUT_FILE` change the input and output paths. These settings (and `LIMIT`) can also go in a `.env` file (see `.env.example`); variables set in the shell take precedence. Press Ctrl+C to pause and resume with `CRAWLEE_PURGE_ON_START=0 npm run scrape:details`. Keep that variable on the command line: set in `.env`, it would make every run resume. `product-details.json` is only replaced when a crawl completes.

The crawler respects robots.txt, which disallows Structube's `/graphql` API, so it never calls the API itself and reads the rendered page. The one exception is the review summary: it shows "no ratings yet" until the page's own reviews request completes, so the crawler waits for that response and keeps only the average and count (review texts and reviewer details are discarded). Images, fonts, analytics, ads and third-party widgets are blocked, and the storefront's persisted API cache is cleared before each page so every page loads fresh data.

Implementation references checked with Context7: [saving data](https://crawlee.dev/js/docs/introduction/saving-data), [scaling crawlers](https://crawlee.dev/js/docs/guides/scaling-crawlers), [failed request handling](https://crawlee.dev/js/docs/examples/http-crawler) and [navigation hooks](https://crawlee.dev/js/docs/upgrading/upgrading-to-v1). Context7 had no entries for `respectRobotsTxtFile`, `blockRequests` or `parseWithCheerio`, so those were checked against the installed Crawlee 3.18 type definitions.
