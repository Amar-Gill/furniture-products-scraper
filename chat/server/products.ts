// Product data for the chat: the records written by the scraper (`npm run scrape:details`) and
// a small keyword search over them. Free of Node APIs so the browser bundle can import its types.

/** A product page that was scraped successfully. Mirrors `ProductRecord` in ../../src/product-page.ts. */
export type ProductDetails = {
  url: string
  status: 'ok'
  name: string | null
  sku: string | null
  price: number | null
  discountedPrice: number | null
  currency: string | null
  description: string | null
  category: string | null
  categoryPath: string[]
  specifications: string[]
  color: string | null
  dimensions: Record<string, string> | null
  rating: number | null
  reviewCount: number
  inStockAndReadyToShip: boolean | null
  stockStatus: string | null
  stockRegion: string | null
  scrapedAt: string
}

type UnavailableProduct = {
  url: string
  status: 'not_found' | 'failed' | 'skipped'
  reason: string
  scrapedAt: string
}

export type ProductRecord = ProductDetails | UnavailableProduct

type Field = 'sku' | 'name' | 'category' | 'color' | 'specifications' | 'availability' | 'description'

// How much a query word counts depending on where it is found. A whole-word match counts fully,
// a match at the start of a longer word (e.g. "bed" in "bedside") counts half.
const FIELD_WEIGHTS: Record<Field, number> = {
  sku: 8,
  name: 8,
  category: 4,
  color: 4,
  specifications: 2,
  availability: 1,
  description: 1,
}
const FIELDS = Object.keys(FIELD_WEIGHTS) as Field[]

export type Product = ProductDetails & {
  /** The SKU, or the URL for a product without one. */
  id: string
  /** The sale price when discounted, otherwise the regular price. */
  currentPrice: number | null
  openBox: boolean
  words: Record<Field, string[]>
  /** The words of each category path level: [["furniture"], ["dining", "room"], ["dining", "table"]]. */
  categoryLevels: string[][]
}

export type Catalog = {
  products: Product[]
  byId: Map<string, Product>
  /** Records for pages that were not found, failed or skipped. */
  unavailableCount: number
}

export function buildCatalog(records: ProductRecord[]): Catalog {
  const products = records
    .filter((record): record is ProductDetails => record.status === 'ok')
    .map(toProduct)
  return {
    products,
    byId: new Map(products.map((product) => [product.id.toLowerCase(), product])),
    unavailableCount: records.length - products.length,
  }
}

function toProduct(record: ProductDetails): Product {
  return {
    ...record,
    id: record.sku ?? record.url,
    currentPrice: record.discountedPrice ?? record.price,
    openBox: record.categoryPath.includes('Open Box'),
    words: {
      sku: words(record.sku ?? ''),
      name: words(record.name ?? ''),
      category: words(record.categoryPath.join(' ')),
      color: words(record.color ?? ''),
      specifications: words(record.specifications.join(' ')),
      availability: words(record.stockStatus ?? ''),
      description: words(record.description ?? ''),
    },
    categoryLevels: record.categoryPath.map(words),
  }
}

export function findProduct(catalog: Catalog, id: string): Product | undefined {
  return catalog.byId.get(id.trim().toLowerCase())
}

const STOP_WORDS = new Set(['a', 'an', 'and', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with'])
const SPELLINGS: Record<string, string> = { gray: 'grey' }

/** Lowercase, accent-free, singular words without duplicates: "Décor cushions" → ["decor", "cushion"]. */
export function words(text: string): string[] {
  const result = new Set<string>()
  for (const word of text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (word && !STOP_WORDS.has(word)) result.add(singular(SPELLINGS[word] ?? word))
  }
  return [...result]
}

function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (/(?:ss|sh|ch|x|z)es$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1)
  return word
}

// Numbers and very short words only match whole words, so "8" doesn't match "80".
function wordScore(product: Product, word: string): number {
  const prefixAllowed = word.length >= 3 && !/^\d+$/.test(word)
  let best = 0
  for (const field of FIELDS) {
    const fieldWords = product.words[field]
    if (fieldWords.includes(word)) {
      best = Math.max(best, FIELD_WEIGHTS[field])
    } else if (prefixAllowed && fieldWords.some((fieldWord) => fieldWord.startsWith(word))) {
      best = Math.max(best, FIELD_WEIGHTS[field] / 2)
    }
  }
  return best
}

export type SortOrder = 'relevance' | 'price_asc' | 'price_desc' | 'rating' | 'reviews' | 'discount'

export type SearchOptions = {
  /** Keywords that must all appear somewhere in the product's text. */
  query?: string
  /**
   * A category level such as "Sofas" or "Dining Tables", whose words must all appear in one level of the
   * category path (so "Dining Tables" excludes "Dining Room > Bar and Counter Tables"). Separate levels
   * with ">", e.g. "Outdoor > Dining Room".
   */
  category?: string
  color?: string
  /** Bounds on the current price (sale price when discounted). */
  minPrice?: number
  maxPrice?: number
  onSale?: boolean
  inStock?: boolean
  openBox?: boolean
  minRating?: number
  sortBy?: SortOrder
  limit?: number
}

export type SearchResult = {
  /** Number of matching listings before `limit` is applied. */
  total: number
  /** Number of distinct product names among the matches (colours are separate listings). */
  distinctProducts: number
  /** Lowest and highest current price among the matches. */
  priceRange: { min: number; max: number } | null
  products: Product[]
}

export const DEFAULT_LIMIT = 10

export function search(catalog: Catalog, options: SearchOptions): SearchResult {
  const queryWords = words(options.query ?? '')
  const categoryLevels = (options.category ?? '').split('>').map(words).filter((level) => level.length > 0)
  const colorWords = words(options.color ?? '')

  const matches: Match[] = []
  for (const product of catalog.products) {
    if (!passesFilters(product, options)) continue
    if (!categoryLevels.every((level) => inCategoryLevel(product, level))) continue
    if (!colorWords.every((word) => product.words.color.includes(word))) continue
    const scores = queryWords.map((word) => wordScore(product, word))
    if (scores.includes(0)) continue
    matches.push({ product, score: scores.reduce((sum, score) => sum + score, 0) })
  }

  const order = comparator(options.sortBy ?? 'relevance')
  matches.sort((a, b) => order(a, b) || byName(a.product, b.product))

  const prices = matches.map(({ product }) => product.currentPrice).filter((price) => price !== null)
  return {
    total: matches.length,
    distinctProducts: new Set(matches.map(({ product }) => product.name)).size,
    priceRange: prices.length > 0 ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
    products: matches.slice(0, options.limit ?? DEFAULT_LIMIT).map(({ product }) => product),
  }
}

function inCategoryLevel(product: Product, levelWords: string[]): boolean {
  return product.categoryLevels.some((level) => levelWords.every((word) => level.includes(word)))
}

function passesFilters(product: Product, options: SearchOptions): boolean {
  const { currentPrice, rating } = product
  if (options.minPrice != null && (currentPrice === null || currentPrice < options.minPrice)) return false
  if (options.maxPrice != null && (currentPrice === null || currentPrice > options.maxPrice)) return false
  if (options.onSale != null && (product.discountedPrice !== null) !== options.onSale) return false
  if (options.inStock != null && (product.inStockAndReadyToShip === true) !== options.inStock) return false
  if (options.openBox != null && product.openBox !== options.openBox) return false
  if (options.minRating != null && (rating === null || rating < options.minRating)) return false
  return true
}

type Match = { product: Product; score: number }

function comparator(sortBy: SortOrder): (a: Match, b: Match) => number {
  switch (sortBy) {
    case 'price_asc':
      return (a, b) => compareNullsLast(a.product.currentPrice, b.product.currentPrice, 'asc')
    case 'price_desc':
      return (a, b) => compareNullsLast(a.product.currentPrice, b.product.currentPrice, 'desc')
    case 'rating':
      return (a, b) =>
        compareNullsLast(a.product.rating, b.product.rating, 'desc') || b.product.reviewCount - a.product.reviewCount
    case 'reviews':
      return (a, b) =>
        b.product.reviewCount - a.product.reviewCount || compareNullsLast(a.product.rating, b.product.rating, 'desc')
    case 'discount':
      return (a, b) => compareNullsLast(discount(a.product), discount(b.product), 'desc')
    case 'relevance':
      return (a, b) => b.score - a.score
  }
}

function compareNullsLast(a: number | null, b: number | null, direction: 'asc' | 'desc'): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  return direction === 'asc' ? a - b : b - a
}

function discount(product: Product): number | null {
  const { price, discountedPrice } = product
  return price && discountedPrice !== null ? (price - discountedPrice) / price : null
}

function byName(a: Product, b: Product): number {
  return (a.name ?? '').localeCompare(b.name ?? '') || (a.color ?? '').localeCompare(b.color ?? '')
}

export type CatalogOverview = {
  listings: number
  distinctProducts: number
  onSale: number
  inStock: number
  openBox: number
  unavailable: number
  priceRange: { min: number; max: number } | null
  /** [category path, listing count], most listings first. */
  categories: [string, number][]
  colors: [string, number][]
  lastScrapedAt: string | null
}

export function catalogOverview(catalog: Catalog): CatalogOverview {
  const { products } = catalog
  const prices = products.map((product) => product.currentPrice).filter((price) => price !== null)
  return {
    listings: products.length,
    distinctProducts: new Set(products.map((product) => product.name)).size,
    onSale: products.filter((product) => product.discountedPrice !== null).length,
    inStock: products.filter((product) => product.inStockAndReadyToShip === true).length,
    openBox: products.filter((product) => product.openBox).length,
    unavailable: catalog.unavailableCount,
    priceRange: prices.length > 0 ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
    categories: countBy(products.map((product) => product.categoryPath.join(' > ') || '(no category)')),
    colors: countBy(products.flatMap((product) => (product.color ? [product.color] : []))),
    lastScrapedAt: products.reduce<string | null>(
      (latest, product) => (latest === null || product.scrapedAt > latest ? product.scrapedAt : latest),
      null,
    ),
  }
}

function countBy(values: string[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}
