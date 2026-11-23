export type WorkspaceTheme = 'dark' | 'light'

export interface WorkspaceDocument {
  readonly documentId: string
  readonly displayName: string
  readonly available: boolean
  readonly status: 'pending' | 'processing' | 'ready' | 'failed'
  readonly errorMessage?: string
  readonly sizeBytes: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface WorkspaceCitation {
  readonly index: number
  readonly documentId: string
  readonly displayName: string
  readonly page: number
}

export type WorkspaceMessage =
  | { readonly role: 'user'; readonly text: string }
  | {
      readonly role: 'assistant'
      readonly text: string
      readonly citations: readonly WorkspaceCitation[]
    }

export interface WorkspaceState {
  readonly documents: readonly WorkspaceDocument[]
  readonly activeDocumentId: string | null
  readonly theme: WorkspaceTheme
  readonly messages: readonly WorkspaceMessage[]
}

export type WorkspaceAction =
  | { readonly type: 'documentsLoaded'; readonly documents: readonly WorkspaceDocument[] }
  | { readonly type: 'documentAdded'; readonly document: WorkspaceDocument }
  | { readonly type: 'documentRemoved'; readonly documentId: string }
  | { readonly type: 'documentSelected'; readonly documentId: string }
  | { readonly type: 'messageAdded'; readonly message: WorkspaceMessage }
  | { readonly type: 'themeChanged'; readonly theme: WorkspaceTheme }

export const initialWorkspaceState: WorkspaceState = {
  documents: [],
  activeDocumentId: null,
  theme: 'dark',
  messages: [],
}

export function hasReadyDocument(
  documents: readonly WorkspaceDocument[]
): boolean {
  return documents.some((document) => document.status === 'ready')
}

export function getChatStatusMessage(
  documents: readonly WorkspaceDocument[]
): string | undefined {
  return documents.find(
    (document) => document.status === 'failed' && document.errorMessage
  )?.errorMessage
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction
): WorkspaceState {
  switch (action.type) {
    case 'documentsLoaded': {
      const activeExists = action.documents.some(
        (document) => document.documentId === state.activeDocumentId
      )

      return {
        ...state,
        documents: action.documents,
        activeDocumentId: activeExists ? state.activeDocumentId : null,
      }
    }
    case 'documentAdded':
      return {
        ...state,
        documents: [
          ...state.documents.filter(
            (document) => document.documentId !== action.document.documentId
          ),
          action.document,
        ],
        activeDocumentId: action.document.documentId,
      }
    case 'documentRemoved':
      return {
        ...state,
        documents: state.documents.filter(
          (document) => document.documentId !== action.documentId
        ),
        activeDocumentId:
          state.activeDocumentId === action.documentId
            ? null
            : state.activeDocumentId,
      }
    case 'documentSelected':
      return state.documents.some(
        (document) => document.documentId === action.documentId
      )
        ? { ...state, activeDocumentId: action.documentId }
        : state
    case 'messageAdded':
      return { ...state, messages: [...state.messages, action.message] }
    case 'themeChanged':
      return { ...state, theme: action.theme }
  }
}
