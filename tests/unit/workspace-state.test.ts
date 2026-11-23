import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  getChatStatusMessage,
  hasReadyDocument,
  initialWorkspaceState,
  workspaceReducer,
} from '../../src/components/workspace-state'
import type { WorkspaceDocument } from '../../src/components/workspace-state'

function document(documentId = randomUUID()): WorkspaceDocument {
  return {
    documentId,
    displayName: 'report.pdf',
    available: true,
    status: 'ready',
    sizeBytes: 1024,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

describe('workspaceReducer', () => {
  it('allows chat when any session document is ready, even if another failed', () => {
    const failed = { ...document(), status: 'failed' as const }

    expect(hasReadyDocument([failed])).toBe(false)
    expect(hasReadyDocument([failed, document()])).toBe(true)
  })

  it('surfaces the specific failed-document message in the chat status', () => {
    const message =
      'No pudimos leer texto de este PDF. Puede ser un escaneo, que aún no soportamos.'
    const failed = { ...document(), status: 'failed' as const, errorMessage: message }

    expect(getChatStatusMessage([failed])).toBe(message)
  })

  it('selects an uploaded document and clears the selection when it is removed', () => {
    const item = document()
    const selected = workspaceReducer(initialWorkspaceState, {
      type: 'documentsLoaded',
      documents: [item],
    })
    const opened = workspaceReducer(selected, {
      type: 'documentSelected',
      documentId: item.documentId,
    })
    const removed = workspaceReducer(opened, {
      type: 'documentRemoved',
      documentId: item.documentId,
    })

    expect(opened.activeDocumentId).toBe(item.documentId)
    expect(removed.documents).toEqual([])
    expect(removed.activeDocumentId).toBeNull()
  })

  it('keeps the active selection only while that document remains in the list', () => {
    const first = document()
    const second = document()
    const loaded = workspaceReducer(initialWorkspaceState, {
      type: 'documentsLoaded',
      documents: [first, second],
    })
    const selected = workspaceReducer(loaded, {
      type: 'documentSelected',
      documentId: first.documentId,
    })

    expect(
      workspaceReducer(selected, {
        type: 'documentsLoaded',
        documents: [second],
      }).activeDocumentId
    ).toBeNull()
  })
})
