'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent, JSX, ReactNode } from 'react'
import { ArrowIcon, FileIcon } from './workspace-icons'
import type {
  WorkspaceCitation,
  WorkspaceMessage,
} from './workspace-state'

interface ChatPanelProps {
  readonly messages: readonly WorkspaceMessage[]
  readonly enabled: boolean
  readonly sending: boolean
  readonly statusMessage?: string
  readonly onSend: (question: string) => Promise<void>
  readonly onCitation: (citation: WorkspaceCitation) => void
}

function citationNode(
  index: number,
  citations: readonly WorkspaceCitation[],
  onCitation: (citation: WorkspaceCitation) => void
): ReactNode {
  const citation = citations.find((item) => item.index === index)

  if (!citation) {
    return null
  }

  return (
    <button
      className="cite"
      type="button"
      key={`citation-${citation.index}`}
      aria-label={`${citation.displayName}, página ${citation.page}`}
      onClick={() => onCitation(citation)}
    >
      <FileIcon />
      <span className="cite-name">{citation.displayName}</span>
      <span className="cite-tooltip" aria-hidden="true">
        Página {citation.page}
      </span>
    </button>
  )
}

function renderAnswer(
  text: string,
  citations: readonly WorkspaceCitation[],
  onCitation: (citation: WorkspaceCitation) => void
): ReactNode[] {
  const parts = text.split(/(\*\*[^*\n]+\*\*|\[\d+\]|\n|\*+)/g)
  const nodes: ReactNode[] = []

  for (const [partIndex, part] of parts.entries()) {
    if (!part) {
      continue
    }

    if (part === '\n') {
      nodes.push(<br key={`line-${partIndex}`} />)
      continue
    }

    const marker = /^\[(\d+)\]$/.exec(part)

    if (marker) {
      const citation = citationNode(Number(marker[1]), citations, onCitation)

      if (citation) {
        nodes.push(citation)
      }

      continue
    }

    if (part.startsWith('**') && part.endsWith('**')) {
      const content = part.slice(2, -2)
      const inlineParts = content.split(/(\[\d+\]|\n)/g)

      nodes.push(
        <strong key={`bold-${partIndex}`}>
          {inlineParts.map((inlinePart, inlineIndex) => {
            if (inlinePart === '\n') {
              return <br key={`bold-line-${inlineIndex}`} />
            }

            const inlineMarker = /^\[(\d+)\]$/.exec(inlinePart)

            if (inlineMarker) {
              return citationNode(
                Number(inlineMarker[1]),
                citations,
                onCitation
              )
            }

            return inlinePart
          })}
        </strong>
      )
      continue
    }

    if (/^\*+$/.test(part)) {
      continue
    }

    nodes.push(part)
  }

  return nodes
}

export function ChatPanel({
  messages,
  enabled,
  sending,
  statusMessage,
  onSend,
  onCitation,
}: ChatPanelProps): JSX.Element {
  const [question, setQuestion] = useState('')
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
    await onSend(normalized)
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
              <p>
                {message.role === 'assistant'
                  ? renderAnswer(message.text, message.citations, onCitation)
                  : message.text}
              </p>
            </div>
          ))}
          {sending && (
            <div className="msg-bot waiting-message">
              <span className="typing-indicator" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className="sr-only" aria-live="polite">
                Preparando respuesta
              </span>
            </div>
          )}
        </div>
        {messages.length === 0 && (
          <p className="chat-empty">
            {statusMessage ?? 'Sube un documento y escribe una pregunta sobre él.'}
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
