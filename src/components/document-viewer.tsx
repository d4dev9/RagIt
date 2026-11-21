'use client'

import type { JSX } from 'react'
import { ChevronIcon } from './workspace-icons'
import type { WorkspaceDocument } from './workspace-state'

interface DocumentViewerProps {
  readonly document: WorkspaceDocument | null
  readonly page: number
  readonly onPageChange: (page: number) => void
}

export function DocumentViewer({
  document,
  page,
  onPageChange,
}: DocumentViewerProps): JSX.Element {
  return (
    <section className="panel viewer" aria-label="Visor del documento">
      <div className="viewer-bar">
        <span className="viewer-title">{document?.displayName ?? ''}</span>
        <div className="pager">
          <button
            className="icon-btn"
            type="button"
            aria-label="Página anterior"
            disabled={!document || page <= 1}
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            <ChevronIcon direction="left" />
          </button>
          <span>{document ? `Página ${page}` : ''}</span>
          <button
            className="icon-btn"
            type="button"
            aria-label="Página siguiente"
            disabled={!document}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronIcon direction="right" />
          </button>
        </div>
      </div>
      <div className="viewer-frame">
        {document?.available ? (
          <iframe
            key={`${document.documentId}-${page}`}
            title={document.displayName}
            src={`/api/documents/${encodeURIComponent(document.documentId)}/file#page=${page}`}
          />
        ) : document ? (
          <div className="viewer-empty">
            <p>Documento no disponible</p>
          </div>
        ) : (
          <div className="viewer-empty">
            <p>Sube o selecciona un archivo para visualizarlo</p>
          </div>
        )}
      </div>
    </section>
  )
}
