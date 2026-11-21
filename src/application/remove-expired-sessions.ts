import { SESSION_INACTIVITY_LIMIT_MS } from '../domain/sessions/session'
import type { SessionRepository } from '../ports/sessions/session-repository'
import type { ChunkRepository } from '../ports/documents/chunk-repository'
import type { DocumentRepository } from '../ports/documents/document-repository'
import type { JobQueue } from '../ports/job-queue'
import type { PdfFileStore } from '../ports/pdf-file-store'

export { SESSION_INACTIVITY_LIMIT_MS }

export interface RemoveExpiredSessionsDependencies {
  readonly sessionRepository: SessionRepository
  readonly documentRepository: DocumentRepository
  readonly chunkRepository: ChunkRepository
  readonly jobQueue: JobQueue
  readonly pdfFileStore: PdfFileStore
}

export interface RemoveExpiredSessionsResult {
  readonly sessionsRemoved: number
  readonly documentsRemoved: number
}

export async function removeExpiredSessions(
  now: Date,
  deps: RemoveExpiredSessionsDependencies
): Promise<RemoveExpiredSessionsResult> {
  const expiredSessions = await deps.sessionRepository.listExpired(now)
  let sessionsRemoved = 0
  let documentsRemoved = 0

  for (const session of expiredSessions) {
    const currentSession = await deps.sessionRepository.findById(session.id)

    if (!currentSession || !currentSession.isExpiredAt(now)) {
      continue
    }

    const documents = await deps.documentRepository.listBySession(
      currentSession.id
    )

    await deps.jobQueue.deleteBySession(currentSession.id)

    for (const document of documents) {
      await deps.chunkRepository.deleteByDocument(
        currentSession.id,
        document.id
      )
      if (document.storagePath) {
        await deps.pdfFileStore.remove(document.storagePath)
      }
      const deleted = await deps.documentRepository.delete(
        currentSession.id,
        document.id
      )

      if (deleted) {
        documentsRemoved += 1
      }
    }

    if (await deps.sessionRepository.delete(currentSession.id)) {
      sessionsRemoved += 1
    }
  }

  return { sessionsRemoved, documentsRemoved }
}
