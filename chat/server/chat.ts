// POST /api/chat: answers the browser's useChat requests by streaming a model response. It runs on
// the server so the OpenAI API key never reaches the browser.
import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  convertToModelMessages,
  isStepCount,
  pipeUIMessageStreamToResponse,
  streamText,
  toUIMessageStream,
  validateUIMessages,
  type LanguageModel,
} from 'ai'
import { buildCatalog, catalogOverview, type Catalog, type ProductRecord } from './products.ts'
import { createTools, type ChatMessage } from './tools.ts'

export type ChatHandlerOptions = {
  model: LanguageModel
  /** The scraper's product-details.json. */
  productsFile: string
}

type Middleware = (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => void

export function createChatHandler({ model, productsFile }: ChatHandlerOptions): Middleware {
  const loadCatalog = catalogLoader(productsFile)

  async function handle(req: IncomingMessage, res: ServerResponse) {
    let catalog: Catalog
    try {
      catalog = await loadCatalog()
    } catch (error) {
      return sendError(res, 500, `Could not read the product data in ${productsFile}: ${errorMessage(error)}`)
    }

    const tools = createTools(catalog)
    let messages: ChatMessage[]
    try {
      const body = (await readJson(req)) as { messages?: unknown }
      messages = await validateUIMessages<ChatMessage>({ messages: body.messages, tools })
    } catch (error) {
      return sendError(res, 400, `Invalid chat request: ${errorMessage(error)}`)
    }

    // Stop generating (and paying for) tokens when the user presses Stop or leaves the page.
    const abortController = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) abortController.abort()
    })

    const result = streamText({
      model,
      instructions: instructions(catalog),
      messages: await convertToModelMessages(messages),
      tools,
      stopWhen: isStepCount(8),
      abortSignal: abortController.signal,
      onError: ({ error }) => console.error(`[chat] ${errorMessage(error)}`),
    })

    await pipeUIMessageStreamToResponse({
      response: res,
      // Error messages are masked by default; this app runs locally, so show the real cause.
      stream: toUIMessageStream({ stream: result.stream, onError: errorMessage }),
    })
  }

  return (req, res, next) => {
    if (req.method !== 'POST') return next()
    handle(req, res).catch((error: unknown) => {
      console.error('[chat]', error)
      if (res.headersSent) res.end()
      else sendError(res, 500, errorMessage(error))
    })
  }
}

function instructions(catalog: Catalog): string {
  const overview = catalogOverview(catalog)
  const price = (value: number) => `$${value.toLocaleString('en-CA')}`
  return [
    'You help people explore furniture and home décor from Structube, a Canadian retailer, using product data scraped from structube.com.',
    '',
    'Guidelines:',
    '- Look products up with the tools before answering. Base every product, price, specification and availability detail on tool results, and never invent them.',
    `- The data covers ${overview.listings} listings, not Structube's whole range. When something is not in the data, say so rather than claiming Structube doesn't sell it.`,
    '- If a search finds nothing, retry with broader keywords, a category or fewer filters before giving up.',
    '- Prices are in Canadian dollars. "price" is the regular price and "salePrice" the discounted price, when there is one.',
    '- Each listing is one SKU. Many products come in several colours: mention the colours together instead of repeating the product. Point out open-box listings, which are separate discounted units.',
    '- "inStock" means in stock and ready to ship online. "availability" is the website\'s availability message for the Quebec region on the scrape date.',
    '- Keep answers concise and easy to scan. Link product names to their URLs, and use a Markdown table to compare products.',
    '',
    `Catalogue overview (scraped ${overview.lastScrapedAt?.slice(0, 10) ?? 'on an unknown date'}):`,
    `- ${overview.listings} listings of ${overview.distinctProducts} distinct products: ${overview.onSale} on sale, ${overview.inStock} in stock and ready to ship, ${overview.openBox} open-box.`,
    ...(overview.priceRange
      ? [`- Current prices range from ${price(overview.priceRange.min)} to ${price(overview.priceRange.max)}.`]
      : []),
    `- Categories, with listing counts: ${overview.categories.map(([name, count]) => `${name} (${count})`).join('; ')}.`,
    `- Colours: ${overview.colors.map(([color]) => color).join(', ')}.`,
    `- ${overview.unavailable} other product pages were not found or failed to load, so they are not in the data.`,
  ].join('\n')
}

// Re-reads the file when it changes, e.g. after another scraper run.
function catalogLoader(file: string): () => Promise<Catalog> {
  let cache: { mtimeMs: number; catalog: Catalog } | undefined
  return async () => {
    const { mtimeMs } = await stat(file)
    if (cache?.mtimeMs !== mtimeMs) {
      const records: unknown = JSON.parse(await readFile(file, 'utf8'))
      if (!Array.isArray(records)) throw new Error('expected a JSON array of product records')
      cache = { mtimeMs, catalog: buildCatalog(records as ProductRecord[]) }
    }
    return cache.catalog
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  req.setEncoding('utf8')
  let body = ''
  for await (const chunk of req) body += chunk
  return JSON.parse(body)
}

function sendError(res: ServerResponse, status: number, message: string) {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
