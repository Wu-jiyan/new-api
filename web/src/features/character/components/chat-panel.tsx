import { Loader2, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { getFreshAuthHeaders } from '@/lib/api'
import { cn } from '@/lib/utils'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatPanelProps {
  modelName: string
  characterName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChatPanel({
  modelName,
  characterName,
  open,
  onOpenChange,
}: ChatPanelProps) {
  const { t } = useTranslation()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const viewport = listRef.current?.parentElement
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [messages, open])

  useEffect(
    () => () => {
      abortRef.current?.abort()
      abortRef.current = null
    },
    []
  )

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      abortRef.current?.abort()
      abortRef.current = null
    }
    onOpenChange(next)
  }

  const send = async () => {
    const content = input.trim()
    if (!content || sending) return

    const history = messages
    const userMsg: ChatMessage = { role: 'user', content }
    setMessages([...history, userMsg, { role: 'assistant', content: '' }])
    setInput('')
    setSending(true)

    let assistantContent = ''
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const authHeaders = await getFreshAuthHeaders()
      const res = await fetch(
        `/api/character/${encodeURIComponent(modelName)}/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ messages: history.concat(userMsg) }),
          signal: controller.signal,
        }
      )

      if (!res.ok || !res.body) {
        let message = ''
        try {
          const data = (await res.json()) as { message?: string }
          message = data?.message ?? ''
        } catch {
          // ignore json parse error
        }
        throw new Error(message || `HTTP ${res.status}: ${res.statusText}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let done = false

      while (!done) {
        const { done: readerDone, value } = await reader.read()
        if (readerDone) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const eventData = line.slice(6).trim()
          if (!eventData) continue
          if (eventData === '[DONE]') {
            done = true
            break
          }
          try {
            const chunk = JSON.parse(eventData) as {
              choices?: Array<{ delta?: { content?: string } }>
            }
            const delta = chunk?.choices?.[0]?.delta?.content
            if (typeof delta === 'string' && delta) {
              assistantContent += delta
              setMessages((prev) => [
                ...prev.slice(0, -1),
                { role: 'assistant', content: assistantContent },
              ])
            }
          } catch {
            // ignore malformed chunk
          }
        }
      }
    } catch (err: unknown) {
      const isAbort =
        typeof err === 'object' &&
        err !== null &&
        'name' in err &&
        (err as { name?: unknown }).name === 'AbortError'
      if (!isAbort) {
        setMessages((prev) => {
          if (!assistantContent && prev[prev.length - 1]?.role === 'assistant') {
            return prev.slice(0, -1)
          }
          return prev
        })
        const msg = err instanceof Error ? err.message : ''
        toast.error(msg || t('character.chat.failed'))
      }
    } finally {
      setSending(false)
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('character.chat.title')}</DialogTitle>
          <DialogDescription>{characterName}</DialogDescription>
        </DialogHeader>

        {messages.length === 0 ? (
          <div className='flex h-64 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground'>
            {t('character.chat.title')}
          </div>
        ) : (
          <ScrollArea className='h-64 rounded-lg border'>
            <div ref={listRef} className='space-y-3 p-3'>
              {messages.map((msg, index) => (
                <div
                  key={index}
                  className={cn(
                    'flex',
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[80%] rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap',
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground'
                    )}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <div className='space-y-2'>
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('character.chat.placeholder')}
            disabled={sending}
            rows={3}
            className='resize-none'
          />
          <div className='flex justify-end'>
            <Button
              onClick={() => void send()}
              disabled={sending || !input.trim()}
            >
              {sending ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  {t('character.chat.sending')}
                </>
              ) : (
                <>
                  <Send className='mr-2 h-4 w-4' />
                  {t('character.chat.send')}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
