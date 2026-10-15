# Structube product chat

A React + Vite chat app that answers questions about the scraped products in `../product-details.json`, built with the [Vercel AI SDK](https://ai-sdk.dev) and OpenAI.

```sh
cd chat
npm install
npm run dev        # http://localhost:5173
```

The app reads its settings from the scraper's `.env`, one directory up. Variables set in the shell take precedence. Restart the dev server after changing `.env`.

| Variable | Default | |
| --- | --- | --- |
| `OPENAI_API_KEY` | | Required. The OpenAI account needs API credits. |
| `OPENAI_MODEL` | `gpt-6-luna` | Any OpenAI model with tool calling, e.g. `gpt-6.1-sol` for stronger (pricier) answers. |
| `OUTPUT_FILE` | `product-details.json` | The scraper's output, relative to the scraper directory. |

## How it works

- **Browser** (`src/`): `useChat` from `@ai-sdk/react` posts the conversation to `/api/chat` and renders the streamed reply as Markdown, with a status line for each product lookup.
- **Server** (`server/chat.ts`): a small plugin in `vite.config.ts` serves `POST /api/chat` from the dev and preview servers, so the API key never reaches the browser. It runs `streamText` with the conversation and two tools, then streams the result back to `useChat`.
- **Tools** (`server/tools.ts`, `server/products.ts`): the product file is too big to send with every question (about 75k tokens now, ten times that for a full scrape). Instead, the model gets a short catalogue overview (categories, colours, counts and price range) and looks products up itself:
  - `searchProducts`: keyword search (plurals and accents are ignored) with filters for category, colour, price, sale, stock, open box and rating, plus sorting. It returns the number of matches, their price range and the top listings.
  - `getProductDetails`: the description, specifications and dimensions for given SKUs.

The data file is re-read when it changes, so the chat picks up a new scrape without a restart.

`npm run build` produces the static client in `dist/`, and `npm run preview` serves it together with `/api/chat`. To host it elsewhere, mount `createChatHandler` from `server/chat.ts` on any Node HTTP server.

```sh
npm test           # search tests
npm run lint
```

Implementation references checked with Context7: the AI SDK's [chatbot](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot), [chatbot tool usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage), [Node.js HTTP server](https://ai-sdk.dev/cookbook/api-servers/node-http-server), [AI SDK 7 migration](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0) and [OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai) pages; Vite's [plugin API](https://vite.dev/guide/api-plugin) (`configureServer`, `configurePreviewServer`) and [`loadEnv`](https://vite.dev/guide/api-javascript#loadenv); and [react-markdown](https://github.com/remarkjs/react-markdown).
