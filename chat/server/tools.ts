// Tools the model calls to look products up. Their input and output types also type the tool
// parts that the React client renders, via `ChatMessage`.
import { tool, type InferUITools, type UIDataTypes, type UIMessage } from 'ai'
import { z } from 'zod'
import { DEFAULT_LIMIT, findProduct, search, type Catalog, type Product } from './products.ts'

const searchProductsInput = z.object({
  query: z
    .string()
    .optional()
    .describe(
      'Keywords such as "leather armchair" or "kinsey". Every word must appear in the name, category, colour, ' +
        'description, specifications or availability message. Omit to filter by the other fields only.',
    ),
  category: z
    .string()
    .optional()
    .describe(
      'A category from the catalogue overview, e.g. "Sofas", "Dining Tables", "Lighting" or "Open Box". ' +
        'Separate levels with ">", e.g. "Outdoor > Dining Room".',
    ),
  color: z.string().optional().describe('A colour such as "black", which also matches "Black/Gold".'),
  minPrice: z.number().nonnegative().optional().describe('Minimum current price in CAD (the sale price when discounted).'),
  maxPrice: z.number().nonnegative().optional().describe('Maximum current price in CAD (the sale price when discounted).'),
  onSale: z.boolean().optional().describe('true for discounted listings only, false for full-price listings only.'),
  inStock: z
    .boolean()
    .optional()
    .describe('true for listings in stock and ready to ship online, false for listings that are not.'),
  openBox: z.boolean().optional().describe('true for open-box listings only, false to exclude them.'),
  minRating: z.number().min(0).max(5).optional().describe('Minimum average customer rating out of 5.'),
  sortBy: z
    .enum(['relevance', 'price_asc', 'price_desc', 'rating', 'reviews', 'discount'])
    .optional()
    .describe(
      'Result order: relevance (default; by name without a query), price, best rating, most reviews or largest percentage discount.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe(`Number of listings to return (default ${DEFAULT_LIMIT}, max 50).`),
})

export type SearchProductsInput = z.infer<typeof searchProductsInput>

export function createTools(catalog: Catalog) {
  return {
    searchProducts: tool({
      description:
        'Search and filter the product catalogue. Returns how many listings match, how many distinct products ' +
        'they represent, their price range and summaries of the top results. Each listing is one SKU: products ' +
        'often come in several colours, and open-box units are listed separately.',
      inputSchema: searchProductsInput,
      execute: (input) => {
        const result = search(catalog, input)
        return {
          matches: result.total,
          distinctProducts: result.distinctProducts,
          priceRange: result.priceRange,
          results: result.products.map(summarize),
          ...(result.total === 0 && { hint: noMatchesHint(catalog, input) }),
        }
      },
    }),

    getProductDetails: tool({
      description:
        'Get the full details of listings by SKU: description, specifications, dimensions and availability.',
      inputSchema: z.object({
        skus: z.array(z.string()).min(1).max(10).describe('SKUs from searchProducts results.'),
      }),
      execute: ({ skus }) => {
        const products = skus.map((sku) => findProduct(catalog, sku))
        const notFound = skus.filter((_, index) => !products[index])
        return {
          products: products.filter((product) => product !== undefined).map(describe),
          ...(notFound.length > 0 && { notFound }),
        }
      },
    }),
  }
}

function noMatchesHint(catalog: Catalog, input: SearchProductsInput): string {
  if (input.category && search(catalog, { category: input.category }).total === 0) {
    return `No category matches "${input.category}". Use a category from the catalogue overview, e.g. "Sofas" or "Dining Tables".`
  }
  return 'Nothing matched. Try fewer or broader keywords, a category, or fewer filters.'
}

function summarize(product: Product) {
  return {
    sku: product.id,
    name: product.name,
    color: product.color,
    price: product.price,
    salePrice: product.discountedPrice,
    category: product.categoryPath.join(' > ') || null,
    ...(product.openBox && { openBox: true }),
    rating: product.rating,
    reviews: product.reviewCount,
    inStock: product.inStockAndReadyToShip,
    availability: product.stockStatus,
    dimensions: product.dimensions,
    url: product.url,
  }
}

function describe(product: Product) {
  return {
    ...summarize(product),
    description: product.description,
    specifications: product.specifications,
    availabilityRegion: product.stockRegion,
  }
}

export type ChatTools = InferUITools<ReturnType<typeof createTools>>
export type ChatMessage = UIMessage<never, UIDataTypes, ChatTools>
