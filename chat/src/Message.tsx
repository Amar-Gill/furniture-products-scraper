import type { ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage, SearchProductsInput } from '../server/tools.ts'

type Part = ChatMessage['parts'][number]
type SearchPart = Extract<Part, { type: 'tool-searchProducts' }>
type DetailsPart = Extract<Part, { type: 'tool-getProductDetails' }>

const remarkPlugins = [remarkGfm]
const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
}

export function Message({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="message user">
        <p>{message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('')}</p>
      </div>
    )
  }

  return (
    <div className="message assistant">
      {message.parts.map((part, index) => {
        switch (part.type) {
          case 'text':
            return (
              <div key={index} className="markdown">
                <Markdown remarkPlugins={remarkPlugins} components={markdownComponents}>
                  {part.text}
                </Markdown>
              </div>
            )
          case 'tool-searchProducts':
            return <SearchActivity key={part.toolCallId} part={part} />
          case 'tool-getProductDetails':
            return <DetailsActivity key={part.toolCallId} part={part} />
          default:
            return null
        }
      })}
    </div>
  )
}

function SearchActivity({ part }: { part: SearchPart }) {
  switch (part.state) {
    case 'input-streaming':
      return <Activity pending>Searching products…</Activity>
    case 'input-available':
      return <Activity pending>Searching {describeSearch(part.input)}…</Activity>
    case 'output-available':
      return (
        <Activity>
          Searched {describeSearch(part.input)} · {count(part.output.matches, 'match', 'matches')}
        </Activity>
      )
    case 'output-error':
      return <Activity failed>Search failed: {part.errorText}</Activity>
    default:
      return null
  }
}

function DetailsActivity({ part }: { part: DetailsPart }) {
  switch (part.state) {
    case 'input-streaming':
      return <Activity pending>Looking up product details…</Activity>
    case 'input-available':
      return <Activity pending>Looking up details for {count(part.input.skus.length, 'product')}…</Activity>
    case 'output-available':
      return <Activity>Looked up details for {count(part.output.products.length, 'product')}</Activity>
    case 'output-error':
      return <Activity failed>Lookup failed: {part.errorText}</Activity>
    default:
      return null
  }
}

function Activity({ pending = false, failed = false, children }: { pending?: boolean; failed?: boolean; children: ReactNode }) {
  return <p className={['activity', pending && 'pending', failed && 'failed'].filter(Boolean).join(' ')}>{children}</p>
}

const SORT_LABELS: Record<NonNullable<SearchProductsInput['sortBy']>, string | undefined> = {
  relevance: undefined,
  price_asc: 'cheapest first',
  price_desc: 'most expensive first',
  rating: 'best rated first',
  reviews: 'most reviewed first',
  discount: 'biggest discount first',
}

function describeSearch(input: SearchProductsInput): string {
  const filters = [
    input.query && `“${input.query}”`,
    input.category && `in ${input.category}`,
    input.color?.toLowerCase(),
    priceFilter(input.minPrice, input.maxPrice),
    input.onSale !== undefined && (input.onSale ? 'on sale' : 'full price'),
    input.inStock !== undefined && (input.inStock ? 'in stock' : 'not in stock'),
    input.openBox !== undefined && (input.openBox ? 'open box' : 'no open box'),
    input.minRating !== undefined && `rated ${input.minRating}+`,
    input.sortBy && SORT_LABELS[input.sortBy],
  ].filter(Boolean)
  return filters.length > 0 ? filters.join(' · ') : 'all products'
}

function priceFilter(min: number | undefined, max: number | undefined): string | undefined {
  if (min !== undefined && max !== undefined) return `$${min}–$${max}`
  if (max !== undefined) return `under $${max}`
  if (min !== undefined) return `$${min} and up`
  return undefined
}

function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`
}
