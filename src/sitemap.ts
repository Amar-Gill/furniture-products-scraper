import { parseSitemap } from "crawlee";

export const BASE = "https://www.structube.com";

/** Keep variant IDs: several products share a path but have different pid values. */
export function normalizeProductUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.origin !== BASE || url.username || url.password) return null;
  if (!/^\/en_ca\/[^/]+\/?$/.test(url.pathname)) return null;

  const pathname = url.pathname.replace(/\/$/, "");
  const pids = url.searchParams.getAll("pid");
  const isGiftCard = pathname === "/en_ca/gift-card-giftcard";
  if (!isGiftCard && (pids.length !== 1 || !/^\d+$/.test(pids[0]!))) {
    return null;
  }

  url.pathname = pathname;
  url.hash = "";
  url.search = "";
  if (!isGiftCard) url.searchParams.set("pid", pids[0]!);
  return url.href;
}

export function collectProductUrls(
  urls: Iterable<string>,
  isAllowed: (url: string) => boolean,
): string[] {
  const products = new Set<string>();
  for (const rawUrl of urls) {
    const url = normalizeProductUrl(rawUrl);
    // Removing query parameters must not bypass robots rules on the original URL.
    if (url && isAllowed(rawUrl) && isAllowed(url)) products.add(url);
  }
  return [...products].sort();
}

/** Traverse indexes explicitly so a failed child cannot silently lose products. */
export async function loadSitemapUrls(sitemapUrls: string[]): Promise<string[]> {
  const pending = [...sitemapUrls];
  const visited = new Set<string>();
  const urls = new Set<string>();

  for (const sitemapUrl of pending) {
    if (visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);
    let entries = 0;

    // Crawlee normally logs and skips failed downloads. Loading one document at a
    // time lets us reject empty/failed documents instead of publishing partial data.
    for await (const item of parseSitemap([{ type: "url", url: sitemapUrl }], undefined, {
      emitNestedSitemaps: true,
      maxDepth: 0,
      sitemapRetries: 2,
      networkTimeouts: { request: 30_000 },
    })) {
      entries++;
      if (item.originSitemapUrl === null) pending.push(item.loc);
      else urls.add(item.loc);
    }
    if (entries === 0) {
      throw new Error(`Sitemap was empty or could not be loaded: ${sitemapUrl}`);
    }
  }

  return [...urls];
}
