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
    typeof value.documentId === 'string' &&
    typeof value.page === 'number' &&
    Number.isInteger(value.page) &&
    value.page > 0
  )
}

async function readDocumentList(response: Response): Promise<DocumentListResponse> {
  if (!response.ok) {
    throw new Error(GENERIC_ERROR)
  }

  const body: unknown = await response.json()

  if (!isRecord(body) || !Array.isArray(body.documents)) {
    throw new Error(GENERIC_ERROR)
  }

  const documents: unknown[] = body.documents

  if (!documents.every(isDocument)) {
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
    throw new Error(GENERIC_ERROR)
  }

  const body: unknown = await response.json()

  if (
    !isRecord(body) ||
    typeof body.answer !== 'string' ||
    !Array.isArray(body.citations) ||
    !body.citations.every(isCitation)
  ) {
    throw new Error(GENERIC_ERROR)
  }

  return { answer: body.answer, citations: body.citations }
}

export function RagItWorkspace(): JSX.Element {
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspaceState)
  const [page, setPage] = useState(1)
  const [listError, setListError] = useState('')

  const refreshDocuments = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/documents', { cache: 'no-store' })
      const result = await readDocumentList(response)

      dispatch({ type: 'documentsLoaded', documents: result.documents })
      setListError('')
    } catch {
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
  const chatEnabled =
    activeDocument !== null &&
    state.documents.some((item) => item.status === 'ready')

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
      throw new Error(GENERIC_ERROR)
    }

    if (!response.ok) {
      throw new Error(GENERIC_ERROR)
    }

    const body: unknown = await response.json()

    if (!isRecord(body) || typeof body.documentId !== 'string') {
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
        throw new Error(GENERIC_ERROR)
      }

      dispatch({
        type: 'documentRemoved',
        documentId: document.documentId,
      })
    } catch {
      setListError('No se pudo eliminar el documento.')
    }
  }

  async function send(question: string): Promise<void> {
    const userMessage: WorkspaceMessage = { role: 'user', text: question }
    dispatch({ type: 'messageAdded', message: userMessage })

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
    } catch {
      dispatch({
        type: 'messageAdded',
        message: {
          role: 'assistant',
          text: GENERIC_ERROR,
          citations: [],
        },
      })
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
          onSend={send}
          onCitation={selectCitation}
        />
      </main>
    </div>
  )
}
