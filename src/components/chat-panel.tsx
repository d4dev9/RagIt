'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent, JSX } from 'react'
import { ArrowIcon } from './workspace-icons'
import type {
  WorkspaceCitation,
  WorkspaceMessage,
} from './workspace-state'

interface ChatPanelProps {
  readonly messages: readonly WorkspaceMessage[]
  readonly enabled: boolean
  readonly onSend: (question: string) => Promise<void>
  readonly onCitation: (citation: WorkspaceCitation) => void
}

export function ChatPanel({
  messages,
  enabled,
  onSend,
  onCitation,
}: ChatPanelProps): JSX.Element {
  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)
  const chatBodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = chatBodyRef.current

    if (element) {
      element.scrollTop = element.scrollHeight
    }
  }, [messages])

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const normalized = question.trim()

    if (!enabled || sending || !normalized) {
      return
    }

    setQuestion('')
    setSending(true)

    try {
      await onSend(normalized)
    } finally {
      setSending(false)
    }
  }

  return (
    <aside className="panel panel-right" aria-label="Chat">
      <div className="panel-head">
        <span className="label">Chat</span>
      </div>
      <div className="panel-body chat-body" ref={chatBodyRef}>
        <div className="chat-log" aria-live="polite">
          {messages.map((message, index) => (
            <div
              className={message.role === 'user' ? 'msg-user' : 'msg-bot'}
              key={`${message.role}-${index}`}
            >
              <p>{message.text}</p>
              {message.role === 'assistant' &&
                message.citations.length > 0 && (
                  <div className="citations">
                    {message.citations.map((citation, citationIndex) => (
                      <button
                        className="cite"
                        type="button"
                        key={`${citation.documentId}-${citation.page}-${citationIndex}`}
                        onClick={() => onCitation(citation)}
                      >
                        p. {citation.page}
                      </button>
                    ))}
                  </div>
                )}
            </div>
          ))}
        </div>
        {messages.length === 0 && (
          <p className="chat-empty">
            Sube un documento y escribe una pregunta sobre él.
          </p>
        )}
      </div>
      <form className="chat-form" onSubmit={(event) => void submit(event)}>
        <label className="sr-only" htmlFor="question">
          Pregunta
        </label>
        <textarea
          id="question"
          placeholder="Escribe una pregunta"
          value={question}
          disabled={!enabled || sending}
          onChange={(event) => setQuestion(event.currentTarget.value)}
        />
        <div className="row">
          <button
            className="btn-send"
            type="submit"
            disabled={!enabled || sending || question.trim().length === 0}
          >
            Enviar
            <ArrowIcon />
          </button>
        </div>
      </form>
    </aside>
  )
}
