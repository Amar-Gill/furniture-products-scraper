import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildCatalog,
  catalogOverview,
  findProduct,
  search,
  words,
  type ProductDetails,
  type ProductRecord,
  type SearchOptions,
} from './products.ts'

function product(details: Partial<ProductDetails> & { name: string; sku: string }): ProductRecord {
  return {
    url: `https://www.structube.com/en_ca/${details.sku}`,
    status: 'ok',
    price: 100,
    discountedPrice: null,
    currency: 'CAD',
    description: null,
    category: null,
    categoryPath: [],
    specifications: [],
    color: null,
    dimensions: null,
    rating: null,
    reviewCount: 0,
    inStockAndReadyToShip: false,
    stockStatus: 'Available in store only',
    stockRegion: 'Quebec',
    scrapedAt: '2026-10-15T01:00:00.000Z',
    ...details,
  }
}

const catalog = buildCatalog([
  product({
    name: 'MUMBAI acacia wood queen size bed',
    sku: '15.36.78.42',
    price: 1199,
    categoryPath: ['Furniture', 'Bedroom', 'Beds'],
    color: 'Natural',
  }),
  product({
    name: 'MUMBAI bedside table',
    sku: '09.94.16.42',
    price: 369,
    categoryPath: ['Furniture', 'Bedroom', 'Nightstands'],
    color: 'Natural',
    rating: 5,
    reviewCount: 4,
  }),
  product({
    name: 'KINSEY velvet loveseat',
    sku: '41.28.78.60',
    price: 799,
    categoryPath: ['Furniture', 'Living Room', 'Loveseats'],
    color: 'Blue',
    rating: 4.83,
    reviewCount: 23,
    inStockAndReadyToShip: true,
  }),
  product({
    name: 'AMELIE modern dining chair',
    sku: '19.11.92.20',
    price: 119,
    discountedPrice: 79,
    categoryPath: ['Furniture', 'Dining Room', 'Dining Chairs'],
    color: 'Black',
    inStockAndReadyToShip: true,
  }),
  product({
    name: 'AMELIE modern counter table 90 cm height',
    sku: '88.29.43.20',
    price: 269,
    discountedPrice: 199,
    categoryPath: ['Furniture', 'Dining Room', 'Bar and Counter Tables'],
    color: 'Black/Gold',
  }),
  product({
    name: 'KIERA modern dining table 180cm',
    sku: '73.57.05.20',
    price: 329,
    categoryPath: ['Furniture', 'Dining Room', 'Dining Tables'],
    color: 'Grey',
    description: 'Simple, sturdy décor.',
  }),
  product({
    name: 'KINSEY 100% leather ottoman',
    sku: '99.16.71.49.D',
    price: 399,
    discountedPrice: 299.25,
    categoryPath: ['Open Box'],
  }),
  {
    url: 'https://www.structube.com/en_ca/gone',
    status: 'not_found',
    reason: 'The product page shows 404 Not Found.',
    scrapedAt: '2026-10-15T01:00:00.000Z',
  },
])

const skus = (options: SearchOptions) => search(catalog, options).products.map((product) => product.id)

test('keeps scraped products and counts unavailable pages', () => {
  assert.equal(catalog.products.length, 7)
  assert.equal(catalog.unavailableCount, 1)
})

test('normalizes case, accents, plurals and spelling', () => {
  assert.deepEqual(words('Décor Cushions, Glasses & Accessories'), ['decor', 'cushion', 'glass', 'accessory'])
  assert.deepEqual(words('Gray'), ['grey'])
})

test('requires every query word and ranks whole words above prefixes', () => {
  assert.deepEqual(skus({ query: 'bed' }), ['15.36.78.42', '09.94.16.42'])
  assert.deepEqual(skus({ query: 'kinsey loveseats' }), ['41.28.78.60'])
  assert.deepEqual(skus({ query: 'decor' }), ['73.57.05.20'])
  assert.deepEqual(skus({ query: '99.16.71.49.D' }), ['99.16.71.49.D'])
})

test('matches category levels as a whole', () => {
  assert.deepEqual(skus({ category: 'Dining Tables' }), ['73.57.05.20'])
  assert.equal(skus({ category: 'dining room' }).length, 3)
  assert.deepEqual(skus({ category: 'Furniture > Bedroom > Beds' }), ['15.36.78.42'])
})

test('filters by current price, sale, stock, colour and open box', () => {
  assert.deepEqual(skus({ maxPrice: 200, sortBy: 'price_asc' }), ['19.11.92.20', '88.29.43.20'])
  assert.deepEqual(skus({ inStock: true, onSale: true }), ['19.11.92.20'])
  assert.deepEqual(skus({ color: 'black' }), ['88.29.43.20', '19.11.92.20'])
  assert.deepEqual(skus({ openBox: true }), ['99.16.71.49.D'])
})

test('sorts by rating and by percentage discount', () => {
  assert.deepEqual(skus({ sortBy: 'rating' }).slice(0, 2), ['09.94.16.42', '41.28.78.60'])
  assert.deepEqual(skus({ sortBy: 'discount' }).slice(0, 3), ['19.11.92.20', '88.29.43.20', '99.16.71.49.D'])
})

test('reports totals and price range for all matches, not just the returned ones', () => {
  const result = search(catalog, { category: 'Furniture', limit: 2 })
  assert.equal(result.total, 6)
  assert.equal(result.products.length, 2)
  assert.deepEqual(result.priceRange, { min: 79, max: 1199 })
})

test('finds products by SKU regardless of case and surrounding spaces', () => {
  assert.equal(findProduct(catalog, ' 99.16.71.49.d ')?.name, 'KINSEY 100% leather ottoman')
})

test('summarizes the catalogue', () => {
  const overview = catalogOverview(catalog)
  assert.equal(overview.listings, 7)
  assert.equal(overview.onSale, 3)
  assert.equal(overview.inStock, 2)
  assert.equal(overview.openBox, 1)
  assert.deepEqual(overview.priceRange, { min: 79, max: 1199 })
  assert.equal(overview.lastScrapedAt, '2026-10-15T01:00:00.000Z')
})
