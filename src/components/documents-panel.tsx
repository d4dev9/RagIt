'use client'

import { useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, JSX } from 'react'
import { CloseIcon, FileIcon } from './workspace-icons'
import type { WorkspaceDocument } from './workspace-state'

const MAX_DOCUMENTS = 5
const MAX_FILE_SIZE = 5 * 1024 * 1024

interface DocumentsPanelProps {
  readonly documents: readonly WorkspaceDocument[]
  readonly activeDocumentId: string | null
  readonly onSelect: (documentId: string) => void
  readonly onUpload: (file: File) => Promise<void>
  readonly onDelete: (document: WorkspaceDocument) => Promise<void>
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2).replace('.', ',')} MB`
}

export function DocumentsPanel({
  documents,
  activeDocumentId,
  onSelect,
  onUpload,
  onDelete,
}: DocumentsPanelProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const atLimit = documents.length >= MAX_DOCUMENTS

  async function uploadFiles(files: FileList | readonly File[]): Promise<void> {
    setError('')
    setUploading(true)

    try {
      let uploaded = 0

      for (const file of Array.from(files)) {
        if (documents.length + uploaded >= MAX_DOCUMENTS) {
          setError('Se alcanzó el límite de documentos.')
          break
        }

        if (file.size > MAX_FILE_SIZE) {
          setError('El archivo supera el límite de 5 MB.')
          continue
        }

        if (file.type !== 'application/pdf') {
          setError('Solo se admiten archivos PDF.')
          continue
        }

        try {
          await onUpload(file)
          uploaded += 1
        } catch (uploadError) {
          setError(
            uploadError instanceof Error
              ? uploadError.message
              : 'No se pudo subir el documento.'
          )
        }
      }
    } finally {
      setUploading(false)
    }
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const files = event.currentTarget.files

    if (files) {
      void uploadFiles(files)
    }

    event.currentTarget.value = ''
  }

  function onDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault()
    setDragging(false)

    if (!atLimit && event.dataTransfer.files.length > 0) {
      void uploadFiles(event.dataTransfer.files)
    }
  }

  return (
    <aside className="panel panel-left" aria-label="Documentos">
      <div className="panel-head">
        <span className="label">Documentos</span>
        <span className="label">{documents.length}/5</span>
      </div>
      <div className="panel-body">
        <label
          className={`dropzone${dragging ? ' over' : ''}${atLimit || uploading ? ' disabled' : ''}`}
          onDragEnter={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            disabled={atLimit || uploading}
            onChange={onInputChange}
          />
          <p>Arrastra un PDF o selecciona un archivo</p>
          <p className="hint">PDF · máx. 5 MB · 5 por sesión</p>
        </label>
        <div className="form-error" role="alert">
          {error}
        </div>
        <ul className="doc-list">
          {documents.map((document) => (
            <li
              className={`doc-item${document.documentId === activeDocumentId ? ' active' : ''}`}
              key={document.documentId}
            >
              <FileIcon className="file" />
              <button
                className="open"
                type="button"
                title={document.displayName}
                onClick={() => onSelect(document.documentId)}
              >
                {document.displayName}
              </button>
              {document.status === 'failed' && document.errorMessage && (
                <span className="doc-error" role="status">
                  {document.errorMessage}
                </span>
              )}
              {!document.available && (
                <span className="size">No disponible</span>
              )}
              <span className="size">{formatSize(document.sizeBytes)}</span>
              <button
                className="icon-btn"
                type="button"
                aria-label={`Eliminar ${document.displayName}`}
                onClick={() => void onDelete(document)}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
        {documents.length === 0 && (
          <p className="empty">Sube un PDF para empezar a preguntar.</p>
        )}
      </div>
    </aside>
  )
}
