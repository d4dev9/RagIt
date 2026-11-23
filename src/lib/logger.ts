import { randomUUID } from 'node:crypto'

export type ServerLogLevel = 'info' | 'warn' | 'error'

export interface ServerLogEntry {
  readonly event: string
  readonly requestId: string
  readonly error?: unknown
  readonly nulCharactersRemoved?: number
}

interface SerializedError {
  readonly name: string
  readonly message: string
  readonly stack: string
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? '',
    }
  }

  return {
    name: 'UnknownError',
    message: String(error),
    stack: '',
  }
}

function write(level: ServerLogLevel, entry: ServerLogEntry): void {
  const structured = {
    level,
    event: entry.event,
    requestId: entry.requestId,
    ...(entry.nulCharactersRemoved === undefined
      ? {}
      : { nulCharactersRemoved: entry.nulCharactersRemoved }),
    ...(entry.error === undefined ? {} : { error: serializeError(entry.error) }),
  }

  if (process.env.NODE_ENV === 'production') {
    console.log(JSON.stringify(structured))
    return
  }

  const details =
    entry.error === undefined
      ? ''
      : `\n${structured.error?.name}: ${structured.error?.message}\n${structured.error?.stack}`
  const message = `[${level.toUpperCase()}] ${entry.event} requestId=${entry.requestId}${details}`

  if (level === 'error') {
    console.error(message)
  } else if (level === 'warn') {
    console.warn(message)
  } else {
    console.info(message)
  }
}

export const logger = {
  info(entry: ServerLogEntry): void {
    write('info', entry)
  },
  warn(entry: ServerLogEntry): void {
    write('warn', entry)
  },
  error(entry: ServerLogEntry): void {
    write('error', entry)
  },
}

export function createRequestId(): string {
  return randomUUID()
}
