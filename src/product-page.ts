import type { Cheerio, CheerioAPI, Element } from "crawlee";
import type { Page } from "playwright";
import { BASE } from "./sitemap.js";

export type ReviewSummary = {
  /** Average rating out of 5, or null when the product has no reviews. */
  rating: number | null;
  reviewCount: number;
};

export type ProductDetails = {
  url: string;
  status: "ok";
  name: string | null;
  sku: string | null;
  price: number | null;
  discountedPrice: number | null;
  currency: string | null;
  description: string | null;
  category: string | null;
  categoryPath: string[];
  specifications: string[];
  color: string | null;
  dimensions: Record<string, string> | null;
  rating: number | null;
  reviewCount: number;
  inStockAndReadyToShip: boolean | null;
  stockStatus: string | null;
  stockRegion: string | null;
};

export type UnavailableProduct = {
  url: string;
  status: "not_found" | "failed" | "skipped";
  reason: string;
};

export type ProductResult = ProductDetails | UnavailableProduct;
export type ProductRecord = ProductResult & { scrapedAt: string };

// Storefront class names are CSS-module names with a per-build hash suffix
// (e.g. `productFullDetail-module-prices-398`), so selectors match the stable prefix.
export const PRODUCT_TITLE = 'h1[class*="productFullDetail-module-productName"]';
export const NOT_FOUND = ".main-container-404";
export const BREADCRUMBS_LOADING = '[class*="productFullDetail-module-breadcrumbs"] [aria-busy="true"]';
export const CUSTOMER_REGION = '[class*="customerRegion-module-underlineRegionText"]';
export const STOCK_ALERT = '[class*="productFullDetail-module-stockProductAlert"] [class*="productAlert-module-root"]';

// These availability states mean the item can be ordered online right now.
const ORDERABLE_ONLINE = /availabilityMessage_(?:inStock|lowStock|openBox)\b/;
// Icons are inline SVGs whose <title> ("Approved", "Close") is not visible text.
const NON_TEXT_ELEMENTS = "noscript, script, style, svg";
const BLOCK_ELEMENTS =
  "address, article, aside, blockquote, dd, div, dl, dt, figcaption, figure, footer, " +
  "h1, h2, h3, h4, h5, h6, header, li, ol, p, pre, section, table, tr, ul";

type Variant = { pid: string | null; sku: string | null; color: string | null };
type Breadcrumb = { name: string; url: string };

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function text(node: Cheerio<Element>): string {
  const copy = node.clone();
  copy.find(NON_TEXT_ELEMENTS).remove();
  return normalizeSpace(copy.text());
}

/** Text split at line breaks and block elements, the way the page displays it. */
function lines($: CheerioAPI, nodes: Cheerio<Element>): string[] {
  return nodes.toArray().flatMap((element) => {
    const copy = $(element).clone();
    copy.find(`button, ${NON_TEXT_ELEMENTS}`).remove();
    copy.find("br").replaceWith("\n");
    copy.find(BLOCK_ELEMENTS).prepend("\n").append("\n");
    return copy.text().split("\n").map(normalizeSpace).filter(Boolean);
  });
}

export function parsePrice(value: string): number | null {
  const match = /\d[\d,]*(?:\.\d+)?/.exec(value);
  return match ? Number(match[0].replace(/,/g, "")) : null;
}

/** The deepest breadcrumb that is one of the known category URLs. */
export function matchCategory(breadcrumbUrls: string[], categories: ReadonlySet<string>): string | null {
  return [...breadcrumbUrls].reverse().find((url) => categories.has(url)) ?? null;
}

function readVariants($: CheerioAPI): Variant[] {
  return $('[itemprop="hasVariant"]')
    .toArray()
    .map((element) => {
      const variant = $(element);
      const url = variant.find('meta[itemprop="url"]').first().attr("content");
      return {
        pid: url ? new URL(url, BASE).searchParams.get("pid") : null,
        sku: variant.find('meta[itemprop="sku"]').first().attr("content") ?? null,
        color: variant.find('meta[itemprop="color"]').first().attr("content") ?? null,
      };
    });
}

function readBreadcrumbs($: CheerioAPI): Breadcrumb[] {
  return $('[class*="productFullDetail-module-breadcrumbs"] a[itemprop="item"]')
    .toArray()
    .flatMap((element) => {
      const href = $(element).attr("href");
      if (!href) return [];
      const url = new URL(href, BASE);
      const path = url.pathname.replace(/\/+$/, "");
      if (path === "" || path === "/en_ca") return []; // "Home"
      return [{ name: text($(element)), url: `${url.origin}${path}` }];
    });
}

function readPrices($: CheerioAPI): Pick<ProductDetails, "price" | "discountedPrice"> {
  const section = $('[class*="productFullDetail-module-prices"]').first();
  const amount = (selector: string) => parsePrice(text(section.find(selector).first()));
  // Discounts show the struck-through regular price followed by the special price; seasonal
  // promotions add a "Price after discount: $X" line.
  const price = amount('[class*="priceOld"]') ?? amount('[class*="regularPrice"]');
  const offers = [
    amount('[class*="priceSpecial"]'),
    parsePrice(text(section.find('[class*="seasonalPromotion-module-root"] > span').last())),
  ].filter((offer): offer is number => offer !== null && price !== null && offer < price);
  return { price, discountedPrice: offers.length > 0 ? Math.min(...offers) : null };
}

function readSpecifications($: CheerioAPI): string[] {
  const section = $("#product_specifications");
  // Either a definition list (label/value) or bullet points, possibly preceded by badges.
  const items = section
    .find("dt, li")
    .toArray()
    .map((element) => {
      const node = $(element);
      if (element.tagName !== "dt") return text(node);
      const values = node
        .nextUntil("dt", "dd")
        .toArray()
        .map((value) => text($(value)))
        .filter(Boolean);
      return values.length > 0 ? `${text(node)}: ${values.join(", ")}` : text(node);
    })
    .filter(Boolean);
  if (items.length > 0) return items;
  return lines($, section.find('[class*="accordionCmsContent"], [class*="specificationsBullets"]'));
}

function readDimensions($: CheerioAPI): Record<string, string> | null {
  // The first subsection describes the product itself; the next one its shipping boxes.
  const subsection = $('#product_dimensions [class*="productFullDetail-module-subsection"]').first();
  const entries: [string, string][] = [];
  for (const line of lines($, subsection.find("p"))) {
    const match = /^([^:]+):\s*(.+)$/.exec(line);
    if (match) entries.push([match[1]!.toLowerCase(), match[2]!]);
  }
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function readColor($: CheerioAPI, variant: Variant | undefined): string | null {
  for (const element of $('[data-cy="ProductOptions-Option-root"]').toArray()) {
    const title = $(element).find('[class*="option-module-title"]').first();
    if (!/^colou?r\b/i.test(text(title))) continue;
    const selected = text(title.find('[class*="option-module-selected"]').first());
    if (selected) return selected;
  }
  return variant?.color ?? null;
}

function readStock($: CheerioAPI): Pick<ProductDetails, "inStockAndReadyToShip" | "stockStatus"> {
  const alert = $('[class*="productFullDetail-module-stockProductAlert"]').first();
  const message = alert.find('[class*="productAlert-module-availabilityMessage"]').first();
  if (message.length > 0) {
    return {
      inStockAndReadyToShip: ORDERABLE_ONLINE.test(message.attr("class") ?? ""),
      stockStatus: text(message) || null,
    };
  }
  // Out of stock with a restock estimate: "Reserve now" + "Available <date>".
  const restock = alert.find('[class*="backInStockStatus-module-root"]').first();
  if (restock.length > 0) {
    const estimate = restock
      .find('[class*="backInStockStatus-module-estimate"] > span')
      .toArray()
      .map((span) => text($(span)))
      .filter(Boolean)
      .join(" ");
    const reserve = text(restock.find('[class*="backInStockStatus-module-orderNow"]').first());
    return { inStockAndReadyToShip: false, stockStatus: [reserve, estimate].filter(Boolean).join(" - ") || null };
  }
  return { inStockAndReadyToShip: null, stockStatus: null };
}

/** Extracts a rendered product page. Throws if the page shows a different variant than requested. */
export function extractProduct(
  $: CheerioAPI,
  { url, categories, reviews }: { url: string; categories: ReadonlySet<string>; reviews: ReviewSummary },
): ProductResult {
  const pid = new URL(url).searchParams.get("pid");
  const variants = readVariants($);
  const variant = variants.find((candidate) => candidate.pid === pid);
  // Configurable products silently switch to their default variant when `pid` no longer exists.
  if (pid && variants.length > 0 && !variant) {
    return { url, status: "not_found", reason: `Variant pid=${pid} is no longer offered on this product page.` };
  }

  const sku = text($('[class*="productFullDetail-module-sku"]').first()).replace(/^#\s*/, "") || null;
  if (variant?.sku && sku && variant.sku !== sku) {
    throw new Error(`Page shows SKU ${sku} instead of variant pid=${pid} (${variant.sku}).`);
  }

  const breadcrumbs = readBreadcrumbs($);
  return {
    url,
    status: "ok",
    name: text($(PRODUCT_TITLE).first()) || null,
    sku,
    ...readPrices($),
    currency: $('[itemprop="offers"] meta[itemprop="priceCurrency"]').first().attr("content") ?? null,
    description: lines($, $("#product_description")).join("\n") || null,
    category: matchCategory(breadcrumbs.map((breadcrumb) => breadcrumb.url), categories),
    categoryPath: breadcrumbs.map((breadcrumb) => breadcrumb.name),
    specifications: readSpecifications($),
    color: readColor($, variant),
    dimensions: readDimensions($),
    rating: reviews.rating,
    reviewCount: reviews.reviewCount,
    ...readStock($),
    stockRegion: text($(CUSTOMER_REGION).first()) || null,
  };
}

/** Reads the aggregate rating from the storefront's review query; review texts and authors are ignored. */
export function parseReviewSummary(body: unknown): ReviewSummary | null {
  const reviews = (body as { data?: { reviews?: { reviews_count?: unknown; ratings_total?: unknown } } } | null)
    ?.data?.reviews;
  const count = reviews?.reviews_count;
  const total = reviews?.ratings_total;
  if (typeof count !== "number" || typeof total !== "number") return null;
  return { rating: count > 0 ? total : null, reviewCount: count };
}

/** Whether the storefront's route lookup reported the URL as missing. */
export function isRouteNotFound(body: unknown): boolean {
  const route = (body as { data?: { route?: { redirect_code?: unknown; type?: unknown } | null } } | null)?.data
    ?.route;
  return route?.redirect_code === 404 || route?.type === "PWA_404";
}

export type PageWatch = {
  /**
   * The page's own review query. The rating summary renders "no ratings yet" until it completes,
   * which the DOM cannot distinguish from a product without reviews.
   */
  reviews: Promise<ReviewSummary>;
  readonly routeNotFound: boolean;
};

/** Observes the storefront's own API responses; must be attached before navigation. */
export function watchPage(page: Page): PageWatch {
  let routeNotFound = false;
  let settle: (result: ReviewSummary | Error) => void = () => {};
  const reviews = new Promise<ReviewSummary>((resolve, reject) => {
    settle = (result) => (result instanceof Error ? reject(result) : resolve(result));
  });
  // Not-found pages never request reviews, so the promise may never be awaited.
  reviews.catch(() => {});

  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.endsWith("/graphql")) return;
    const operation = url.searchParams.get("operationName");
    if (operation === "ResolveURL") {
      response.json().then(
        (body) => {
          routeNotFound ||= isRouteNotFound(body);
        },
        () => {},
      );
    } else if (operation === "getProductReviews") {
      const unexpected = new Error(`Unexpected reviews response (HTTP ${response.status()}).`);
      response.json().then(
        (body) => settle(parseReviewSummary(body) ?? unexpected),
        (error: unknown) => settle(new Error(`Could not read the reviews response: ${String(error)}`)),
      );
    }
  });

  return {
    reviews,
    get routeNotFound() {
      return routeNotFound;
    },
  };
}

/** Waits until the single-page app renders either the product or its Not Found screen. */
export async function waitForProductOrNotFound(page: Page, timeout: number): Promise<"product" | "not_found"> {
  await page.waitForFunction(
    ([title, notFound]) =>
      document.querySelector(title) !== null ||
      document.querySelector(notFound) !== null ||
      document.title.startsWith("404"),
    [PRODUCT_TITLE, NOT_FOUND] as const,
    { timeout },
  );
  return (await page.locator(PRODUCT_TITLE).count()) > 0 ? "product" : "not_found";
}

/** Waits for product sections that load after the product itself. */
export async function waitForProductDetails(page: Page, timeout: number): Promise<void> {
  // Breadcrumbs (the category) come from a separate query and show a busy shimmer until then.
  await page.locator(BREADCRUMBS_LOADING).first().waitFor({ state: "detached", timeout });
  // Availability is only rendered once the shopper's region is known. On a browser's first
  // visit the header takes several seconds to resolve it.
  await page.locator(CUSTOMER_REGION).filter({ hasText: /\S/ }).first().waitFor({ timeout });
  // The availability message is a lazily loaded component; some products (gift cards) have none.
  await page
    .locator(STOCK_ALERT)
    .first()
    .waitFor({ timeout: 5_000 })
    .catch(() => {});
}
