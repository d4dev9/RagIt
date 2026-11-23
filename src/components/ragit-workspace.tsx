'use client'

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import type { JSX } from 'react'
import { ChatPanel } from './chat-panel'
import { DocumentViewer } from './document-viewer'
import { DocumentsPanel } from './documents-panel'
import { WorkspaceHeader } from './workspace-header'
import type {
  WorkspaceCitation,
  WorkspaceDocument,
  WorkspaceMessage,
} from './workspace-state'
import {
  hasReadyDocument,
  getChatStatusMessage,
  initialWorkspaceState,
  workspaceReducer,
} from './workspace-state'

const GENERIC_ERROR = 'No se pudo completar la solicitud.'

interface DocumentListResponse {
  readonly documents: readonly WorkspaceDocument[]
}

interface AskResponse {
  readonly answer: string
  readonly citations: readonly WorkspaceCitation[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDocument(value: unknown): value is WorkspaceDocument {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.documentId === 'string' &&
    typeof value.displayName === 'string' &&
    typeof value.available === 'boolean' &&
    (value.errorMessage === undefined ||
      typeof value.errorMessage === 'string') &&
    (value.status === 'pending' ||
      value.status === 'processing' ||
      value.status === 'ready' ||
      value.status === 'failed') &&
    typeof value.sizeBytes === 'number' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  )
}

function isCitation(value: unknown): value is WorkspaceCitation {
  return (
    isRecord(value) &&
    typeof value.index === 'number' &&
    Number.isInteger(value.index) &&
    value.index > 0 &&
    typeof value.documentId === 'string' &&
    typeof value.displayName === 'string' &&
    typeof value.page === 'number' &&
    Number.isInteger(value.page) &&
    value.page > 0
  )
}

function logClientFailure(code: string, requestId: string): void {
  console.error({ code, requestId })
}

async function throwResponseFailure(response: Response): Promise<never> {
  let body: unknown

  try {
    body = await response.json()
  } catch {
    body = null
  }

  const error =
    isRecord(body) && typeof body.error === 'string'
      ? body.error
      : GENERIC_ERROR
  const code =
    isRecord(body) && typeof body.code === 'string'
      ? body.code
      : 'REQUEST_FAILED'
  const requestId =
    isRecord(body) && typeof body.requestId === 'string'
      ? body.requestId
      : 'unavailable'

  logClientFailure(code, requestId)
  throw new Error(error)
}

async function readDocumentList(response: Response): Promise<DocumentListResponse> {
  if (!response.ok) {
    return throwResponseFailure(response)
  }

  const body: unknown = await response.json()

  if (!isRecord(body) || !Array.isArray(body.documents)) {
    logClientFailure('INVALID_API_RESPONSE', 'unavailable')
    throw new Error(GENERIC_ERROR)
  }

  const documents: unknown[] = body.documents

  if (!documents.every(isDocument)) {
    logClientFailure('INVALID_API_RESPONSE', 'unavailable')
    throw new Error(GENERIC_ERROR)
  }

  return {
    documents: documents.map((document) => {
      if (!isDocument(document)) {
        throw new Error(GENERIC_ERROR)
      }

      return document
    }),
  }
}

async function readAskResponse(response: Response): Promise<AskResponse> {
  if (!response.ok) {
    return throwResponseFailure(response)
  }

  const body: unknown = await response.json()

  if (
    !isRecord(body) ||
    typeof body.answer !== 'string' ||
    !Array.isArray(body.citations) ||
    !body.citations.every(isCitation)
  ) {
    logClientFailure('INVALID_API_RESPONSE', 'unavailable')
    throw new Error(GENERIC_ERROR)
  }

  return { answer: body.answer, citations: body.citations }
}

export function RagItWorkspace(): JSX.Element {
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspaceState)
  const [page, setPage] = useState(1)
  const [listError, setListError] = useState('')
  const [sending, setSending] = useState(false)

  const refreshDocuments = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/documents', { cache: 'no-store' })
      const result = await readDocumentList(response)

      dispatch({ type: 'documentsLoaded', documents: result.documents })
      setListError('')
    } catch (error) {
      if (error instanceof TypeError) {
        logClientFailure('NETWORK_ERROR', 'unavailable')
      }
      setListError('No se pudieron consultar los documentos.')
    }
  }, [])

  useEffect(() => {
    void refreshDocuments()
  }, [refreshDocuments])

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme
  }, [state.theme])

  useEffect(() => {
    if (
      state.documents.some(
        (item) => item.status === 'pending' || item.status === 'processing'
      )
    ) {
      const timer = window.setInterval(() => {
        void refreshDocuments()
      }, 2000)

      return () => window.clearInterval(timer)
    }
  }, [refreshDocuments, state.documents])

  const activeDocument = useMemo(
    () =>
      state.documents.find(
        (item) => item.documentId === state.activeDocumentId
      ) ?? null,
    [state.activeDocumentId, state.documents]
  )
  const chatEnabled = hasReadyDocument(state.documents)
  const chatStatusMessage = getChatStatusMessage(state.documents)

  async function upload(file: File): Promise<void> {
    const formData = new FormData()
    formData.set('file', file)

    let response: Response

    try {
      response = await fetch('/api/documents', {
        method: 'POST',
        body: formData,
      })
    } catch {
      logClientFailure('NETWORK_ERROR', 'unavailable')
      throw new Error(GENERIC_ERROR)
    }

    if (!response.ok) {
      return throwResponseFailure(response)
    }

    const body: unknown = await response.json()

    if (!isRecord(body) || typeof body.documentId !== 'string') {
      logClientFailure('INVALID_API_RESPONSE', 'unavailable')
      throw new Error(GENERIC_ERROR)
    }

    const documentId = body.documentId
    await refreshDocuments()
    dispatch({ type: 'documentSelected', documentId })
    setPage(1)
  }

  async function remove(document: WorkspaceDocument): Promise<void> {
    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(document.documentId)}`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        return await throwResponseFailure(response)
      }

      dispatch({
        type: 'documentRemoved',
        documentId: document.documentId,
      })
    } catch (error) {
      if (error instanceof TypeError) {
        logClientFailure('NETWORK_ERROR', 'unavailable')
      }
      setListError('No se pudo eliminar el documento.')
    }
  }

  async function send(question: string): Promise<void> {
    const userMessage: WorkspaceMessage = { role: 'user', text: question }
    dispatch({ type: 'messageAdded', message: userMessage })
    setSending(true)

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      const result = await readAskResponse(response)
      const assistantMessage: WorkspaceMessage = {
        role: 'assistant',
        text: result.answer,
        citations: result.citations,
      }

      dispatch({ type: 'messageAdded', message: assistantMessage })
    } catch (error) {
      if (error instanceof TypeError) {
        logClientFailure('NETWORK_ERROR', 'unavailable')
      }
      dispatch({
        type: 'messageAdded',
        message: {
          role: 'assistant',
          text: error instanceof Error ? error.message : GENERIC_ERROR,
          citations: [],
        },
      })
    } finally {
      setSending(false)
    }
  }

  function selectDocument(documentId: string): void {
    dispatch({ type: 'documentSelected', documentId })
    setPage(1)
  }

  function selectCitation(citation: WorkspaceCitation): void {
    const citationDocumentExists = state.documents.some(
      (item) => item.documentId === citation.documentId
    )

    if (!citationDocumentExists) {
      return
    }

    dispatch({
      type: 'documentSelected',
      documentId: citation.documentId,
    })
    setPage(citation.page)
  }

  return (
    <div className="app-shell">
      <WorkspaceHeader
        theme={state.theme}
        onThemeChange={(theme) => dispatch({ type: 'themeChanged', theme })}
      />
      {listError && <p className="global-error" role="alert">{listError}</p>}
      <main className="layout">
        <DocumentsPanel
          documents={state.documents}
          activeDocumentId={state.activeDocumentId}
          onSelect={selectDocument}
          onUpload={upload}
          onDelete={remove}
        />
        <DocumentViewer
          document={activeDocument}
          page={page}
          onPageChange={setPage}
        />
        <ChatPanel
          messages={state.messages}
          enabled={chatEnabled}
          sending={sending}
          statusMessage={chatStatusMessage}
          onSend={send}
          onCitation={selectCitation}
        />
      </main>
    </div>
  )
}
