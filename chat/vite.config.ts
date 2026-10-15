import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOpenAI } from '@ai-sdk/openai'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { createChatHandler } from './server/chat.ts'

// The scraper project one level up: its .env holds OPENAI_API_KEY, and its OUTPUT_FILE
// (product-details.json by default) is the data the chat answers questions about.
const scraperDir = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig(({ mode }) => {
  // '' loads every variable, not just VITE_-prefixed ones. They are only used on the server.
  const env = loadEnv(mode, scraperDir, '')
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY })
  const chat = createChatHandler({
    model: openai(env.OPENAI_MODEL || 'gpt-6-luna'),
    productsFile: resolve(scraperDir, env.OUTPUT_FILE || 'product-details.json'),
  })

  return {
    plugins: [
      react(),
      {
        // Serves POST /api/chat from the dev server (`npm run dev`) and preview server (`npm run preview`).
        name: 'chat-api',
        configureServer(server) {
          if (!env.OPENAI_API_KEY) server.config.logger.warn('OPENAI_API_KEY is not set; add it to ../.env')
          server.middlewares.use('/api/chat', chat)
        },
        configurePreviewServer(server) {
          server.middlewares.use('/api/chat', chat)
        },
      },
    ],
  }
})
