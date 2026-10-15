import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, isToolUIPart } from 'ai'
import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../server/tools.ts'
import { Message } from './Message.tsx'

const transport = new DefaultChatTransport<ChatMessage>({ api: '/api/chat' })

const SUGGESTIONS = [
  'Which sofas are in stock and ready to ship?',
  'What are the best deals on lighting right now?',
  'Compare the KINSEY and BETTA leather loveseats',
  'Which dining tables seat six or more people?',
]

export default function App() {
  const { messages, sendMessage, status, stop, error, regenerate, setMessages, clearError } =
    useChat<ChatMessage>({ transport })
  const [input, setInput] = useState('')
  const scroller = useRef<HTMLElement>(null)
  const followOutput = useRef(true)
  const busy = status === 'submitted' || status === 'streaming'

  // Keep the latest output in view, unless the user has scrolled up to read.
  useEffect(() => {
    const element = scroller.current
    if (element && followOutput.current) element.scrollTop = element.scrollHeight
  }, [messages, status, error])

  function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    followOutput.current = true
    void sendMessage({ text: trimmed })
    setInput('')
  }

  function startOver() {
    void stop()
    clearError()
    setMessages([])
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Structube product chat</h1>
          <p>Answers come from the scraped product data</p>
        </div>
        <button type="button" className="secondary" onClick={startOver} disabled={messages.length === 0}>
          New chat
        </button>
      </header>

      <main
        ref={scroller}
        className="scroller"
        onScroll={(event) => {
          const element = event.currentTarget
          followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
        }}
      >
        <div className="thread">
          {messages.length === 0 && (
            <div className="welcome">
              <h2>What are you looking for?</h2>
              <p>Ask about prices, sales, colours, sizes, materials, stock and reviews.</p>
              <div className="suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => send(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <Message key={message.id} message={message} />
          ))}

          {isWaitingForModel(messages, busy) && <p className="thinking">Thinking…</p>}

          {error && (
            <div className="error" role="alert">
              <p>{error.message || 'Something went wrong.'}</p>
              <button type="button" onClick={() => void regenerate()}>
                Try again
              </button>
            </div>
          )}
        </div>
      </main>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault()
          send(input)
        }}
      >
        <div className="composer-inner">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                send(input)
              }
            }}
            placeholder="Ask a question…"
            aria-label="Message"
            rows={1}
            autoFocus
          />
          {busy ? (
            <button type="button" onClick={() => void stop()}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()}>
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

// True while a response is in progress but nothing visible is streaming: before the first token,
// while the model reasons, and between a tool result and the next step.
function isWaitingForModel(messages: ChatMessage[], busy: boolean): boolean {
  if (!busy) return false
  const last = messages.at(-1)
  if (last?.role !== 'assistant') return true
  const part = last.parts.at(-1)
  if (part?.type === 'text') return false
  if (part && isToolUIPart(part)) return part.state === 'output-available' || part.state === 'output-error'
  return true
}
