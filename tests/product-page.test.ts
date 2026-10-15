import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { playwrightUtils } from "crawlee";
import { type Browser, chromium, type Page } from "playwright";
import {
  extractProduct,
  isRouteNotFound,
  matchCategory,
  parsePrice,
  parseReviewSummary,
} from "../src/product-page.js";

const CATEGORIES = new Set([
  "https://www.structube.com/en_ca/furniture/living-room",
  "https://www.structube.com/en_ca/furniture/living-room/loveseats",
]);
const NO_REVIEWS = { rating: null, reviewCount: 0 };

let browser: Browser;
let page: Page;
before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
after(() => browser.close());

/** Parses fixture markup the same way the crawler parses rendered pages. */
async function load(main: string) {
  await page.setContent(
    `<html><body><header><button><span class="customerRegion-module-underlineRegionText-1BZ">Quebec</span></button></header><main>${main}</main></body></html>`,
  );
  return playwrightUtils.parseWithCheerio(page, true, true);
}

const variant = (pid: number, sku: string, color: string) => `
  <div itemprop="hasVariant" itemscope itemtype="https://schema.org/Product">
    <meta itemprop="sku" content="${sku}"><meta itemprop="url" content="https://www.structube.com/en_ca/?pid=${pid}">
    <div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="priceCurrency" content="CAD"><meta itemprop="price" content="999"></div>
    <meta itemprop="color" content="${color}">
  </div>`;

const LOVESEAT = `
<div itemscope itemtype="https://schema.org/ProductGroup">
  <div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="priceCurrency" content="CAD"><meta itemprop="price" content="999"></div>
  ${variant(24915, "60.40.93.02", "Charcoal")}${variant(24916, "60.40.93.30", "Grey")}
  <div class="productFullDetail-module-root-16F">
    <div class="productFullDetail-module-breadcrumbs-2Bm"><nav aria-label="You are here"><ol itemscope itemtype="https://schema.org/BreadcrumbList">
      <li itemprop="itemListElement"><a itemprop="item" href="/en_ca/"><span itemprop="name">Home</span></a></li>
      <li itemprop="itemListElement"><a itemprop="item" href="/en_ca/furniture"><span itemprop="name">Furniture</span></a></li>
      <li itemprop="itemListElement"><a itemprop="item" href="/en_ca/furniture/living-room"><span itemprop="name">Living Room</span></a></li>
      <li itemprop="itemListElement"><a itemprop="item" href="/en_ca/furniture/living-room/loveseats"><span itemprop="name">Loveseats</span></a></li>
      <li itemprop="itemListElement"><span itemprop="item"><span itemprop="name" aria-current="page">AARON</span></span></li>
    </ol></nav></div>
    <section class="productFullDetail-module-title-1IQ"><h1 class="productFullDetail-module-productName-2ph">AARON <span class="productFullDetail-module-shortDescription-3L2">loveseat</span></h1><span class="productFullDetail-module-sku-4Gx">#&nbsp;60.40.93.02</span></section>
    <section class="productFullDetail-module-prices-398"><div class="priceRange-module-root_small-2FD productFullDetail-module-regularPrice-2i_"><span class="price-module-currency-Gx-">$</span><span>999</span></div></section>
    <section class="productFullDetail-module-optionsSection-MoP"><div class="option-module-root-1_J" data-cy="ProductOptions-Option-root"><div class="option-module-title-3nk"><span>Colour: </span><span class="option-module-selected-1qs">Charcoal</span><span class="option-module-tooltip-1R6"><button type="button">i</button></span></div></div></section>
    <section class="productFullDetail-module-stockProductAlert-3rm"><div class="productAlert-module-root-2E4"><p class="productAlert-module-availabilityMessage_inStock-3Q8 productAlert-module-availabilityMessage-1tn"><svg><title>Approved</title><desc>Approved</desc></svg>In stock and ready to ship</p><p class="productAlert-module-specialMessage_lastChance-2dA productAlert-module-specialMessage-Ut8">Last Chance! Get it before it's gone!</p></div></section>
    <div id="product_description" aria-hidden="true"><div class="productFullDetail-module-accordionContent-GyW"><div class="productFullDetail-module-accordionCmsContent-20m">The Aaron loveseat is the epitome of sophistication.</div><h3><svg></svg></h3><div><div class="productFullDetail-module-accordionContentIcon-woj"><ul><li>Plush seating</li><li>Solid walnut legs</li></ul></div></div></div></div>
    <div id="product_specifications" aria-hidden="true"><div class="productFullDetail-module-accordionContent-GyW"><a class="productFullDetail-module-link-eAg" href="/en_ca/structube-for-business"><span>Commercial Quality</span></a><div><div class="productFullDetail-module-specificationsBullets-1Qy"><ul><li>Cover material: 100% polyester</li><li>Back cushions are attached by a zipper</li></ul></div></div></div></div>
    <div id="product_dimensions" aria-hidden="true">
      <div class="productFullDetail-module-subsection-1OR"><h3 class="productFullDetail-module-subtitle-oyF">Product Dimensions</h3><p>Width: 175 cm (69")<br>Height: 85 cm (34")<br>Depth: 89 cm (35")<br></p><div><button type="button" title="Click here for detailed dimensions"><img alt="AARON - Dimensions"></button></div></div>
      <div class="productFullDetail-module-subsection-1OR productFullDetail-module-collapsibleSubSection-1Ak"><h3>Packaging Dimensions</h3><p><span>Box 1 of 1</span><br>Width: 178 cm (70.1")<br>Weight: 49 kg (108.03 lbs)</p></div>
    </div>
  </div>
</div>`;

test("extracts a configurable product variant", async () => {
  const url = "https://www.structube.com/en_ca/aaron-loveseat-60-40-93?pid=24915";
  const $ = await load(LOVESEAT);
  assert.deepEqual(extractProduct($, { url, categories: CATEGORIES, reviews: { rating: 4.96, reviewCount: 23 } }), {
    url,
    status: "ok",
    name: "AARON loveseat",
    sku: "60.40.93.02",
    price: 999,
    discountedPrice: null,
    currency: "CAD",
    description: "The Aaron loveseat is the epitome of sophistication.\nPlush seating\nSolid walnut legs",
    category: "https://www.structube.com/en_ca/furniture/living-room/loveseats",
    categoryPath: ["Furniture", "Living Room", "Loveseats"],
    specifications: ["Cover material: 100% polyester", "Back cushions are attached by a zipper"],
    color: "Charcoal",
    dimensions: { width: '175 cm (69")', height: '85 cm (34")', depth: '89 cm (35")' },
    rating: 4.96,
    reviewCount: 23,
    inStockAndReadyToShip: true,
    stockStatus: "In stock and ready to ship",
    stockRegion: "Quebec",
  });
});

test("reports variants that are no longer offered and rejects mismatched variants", async () => {
  const $ = await load(LOVESEAT);
  const url = "https://www.structube.com/en_ca/aaron-loveseat-60-40-93?pid=99999";
  assert.deepEqual(extractProduct($, { url, categories: CATEGORIES, reviews: NO_REVIEWS }), {
    url,
    status: "not_found",
    reason: "Variant pid=99999 is no longer offered on this product page.",
  });
  assert.throws(
    () => extractProduct($, { url: `${url.split("?")[0]}?pid=24916`, categories: CATEGORIES, reviews: NO_REVIEWS }),
    /shows SKU 60\.40\.93\.02 instead of variant pid=24916/,
  );
});

test("extracts discounts, specification lists and out-of-stock open-box items", async () => {
  const url = "https://www.structube.com/en_ca/aglaya-3tier-tempered-glass-shelves-132cm-30-93-28-20-d?pid=76035";
  const $ = await load(`
<div itemscope itemtype="https://schema.org/Product">
  <div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="priceCurrency" content="CAD"><meta itemprop="price" content="929.25"></div>
  <div class="productFullDetail-module-root-16F">
    <div class="productFullDetail-module-breadcrumbs-2Bm"><nav><ol itemscope itemtype="https://schema.org/BreadcrumbList">
      <li><a itemprop="item" href="/en_ca/"><span itemprop="name">Home</span></a></li>
      <li><a itemprop="item" href="/en_ca/open-box"><span itemprop="name">Open Box</span></a></li>
      <li><span itemprop="item"><span itemprop="name">AGLAYA</span></span></li>
    </ol></nav></div>
    <h1 class="productFullDetail-module-productName-2ph">AGLAYA <span>3-Tier tempered Glass Shelves 132cm</span></h1><span class="productFullDetail-module-sku-4Gx">#&nbsp;30.93.28.20.D</span>
    <section class="productFullDetail-module-prices-398"><div class="priceRange-module-root_small-2FD priceRange-module-pricesWrapper-3ZA"><div class="productFullDetail-module-priceOld-sXh priceRange-module-priceOld-Szq priceRange-module-price-991"><span>$</span><span>1,239</span></div><div class="productFullDetail-module-specialPrice-HBL priceRange-module-priceSpecial-CmE priceRange-module-price-991"><span>$</span><span>929</span><span>.</span><span>25</span></div></div></section>
    <section class="productFullDetail-module-stockProductAlert-3rm"><div class="productAlert-module-root-2E4"><span class="productAlert-module-availabilityMessage_outOfStock-O1J productAlert-module-availabilityMessage-1tn"><svg><title>Close</title><desc>Close</desc></svg>Out of stock online</span></div><form><button type="button">Notify me when back in stock</button></form></section>
    <div id="product_specifications"><div class="productFullDetail-module-accordionContent-GyW"><div class="productFullDetail-module-accordionCmsContent-20m"><dl><dt>Style</dt><dd>Minimalism contemporary</dd><dt>Primary Frame Material</dt><dd>Iron</dd></dl></div></div></div>
    <div id="product_dimensions"><div class="productFullDetail-module-subsection-1OR"><h3>Product Dimensions</h3><p>Width: 36 cm (14")<br>Height: 81 cm (32")<br>Depth: 132 cm (52")<br></p></div></div>
  </div>
</div>`);
  const product = extractProduct($, { url, categories: CATEGORIES, reviews: NO_REVIEWS });
  assert.equal(product.status, "ok");
  assert.partialDeepStrictEqual(product, {
    sku: "30.93.28.20.D",
    price: 1239,
    discountedPrice: 929.25,
    category: null,
    categoryPath: ["Open Box"],
    specifications: ["Style: Minimalism contemporary", "Primary Frame Material: Iron"],
    color: null,
    description: null,
    rating: null,
    reviewCount: 0,
    inStockAndReadyToShip: false,
    stockStatus: "Out of stock online",
  });
});

test("extracts restock estimates, seasonal promotions and missing sections", async () => {
  const url = "https://www.structube.com/en_ca/addie-table-lamp-655-cm-height-14-52-27?pid=68857";
  const $ = await load(`
<div itemscope itemtype="https://schema.org/ProductGroup">
  ${variant(68857, "14.52.27.70", "Green")}
  <div class="productFullDetail-module-root-16F">
    <h1 class="productFullDetail-module-productName-2ph">ADDIE <span>table lamp 65.5 cm height</span></h1><span class="productFullDetail-module-sku-4Gx">#&nbsp;14.52.27.70</span>
    <section class="productFullDetail-module-prices-398"><div class="priceRange-module-root_small-2FD productFullDetail-module-regularPrice-2i_"><span>$</span><span>69</span></div><p class="seasonalPromotion-module-root-2qI"><span>Price after discount:</span> <span>$51.75</span></p></section>
    <section class="productFullDetail-module-stockProductAlert-3rm"><div class="productAlert-module-root-2E4"><div class="backInStockStatus-module-root-2x_"><p class="backInStockStatus-module-orderNow-2Ne">Reserve now</p><p class="backInStockStatus-module-estimate-3ni"><span>Available</span><span>November 29, 2026</span><button type="button">?</button></p></div></div></section>
    <div id="product_dimensions"><div class="productFullDetail-module-subsection-1OR"><h3>Product Dimensions</h3><p>Not Available</p></div></div>
  </div>
</div>`);
  assert.partialDeepStrictEqual(extractProduct($, { url, categories: CATEGORIES, reviews: NO_REVIEWS }), {
    status: "ok",
    price: 69,
    discountedPrice: 51.75,
    color: "Green",
    category: null,
    categoryPath: [],
    specifications: [],
    dimensions: null,
    inStockAndReadyToShip: false,
    stockStatus: "Reserve now - Available November 29, 2026",
  });
});

test("parses prices, categories, review summaries and route lookups", () => {
  assert.equal(parsePrice("$1,199"), 1199);
  assert.equal(parsePrice("$179.25"), 179.25);
  assert.equal(parsePrice(""), null);

  const base = "https://www.structube.com/en_ca/furniture";
  assert.equal(matchCategory([base, `${base}/living-room`, `${base}/living-room/new`], CATEGORIES), `${base}/living-room`);
  assert.equal(matchCategory(["https://www.structube.com/en_ca/open-box"], CATEGORIES), null);

  const reviews = (count: number, total: number) => ({
    data: { reviews: { reviews_count: count, ratings_total: total, items: [{ nickname: "A", m1_email: "a@example.com" }] } },
  });
  assert.deepEqual(parseReviewSummary(reviews(23, 4.96)), { rating: 4.96, reviewCount: 23 });
  assert.deepEqual(parseReviewSummary(reviews(0, 0)), { rating: null, reviewCount: 0 });
  assert.equal(parseReviewSummary({ errors: [{ message: "Internal error" }] }), null);

  assert.equal(isRouteNotFound({ data: { route: { redirect_code: 404, type: "PWA_404" } } }), true);
  assert.equal(isRouteNotFound({ data: { route: { redirect_code: 0, type: "PRODUCT" } } }), false);
  assert.equal(isRouteNotFound({ data: { route: null } }), false);
});
