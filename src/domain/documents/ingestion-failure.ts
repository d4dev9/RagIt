export const INGESTION_FAILURE_CODES = [
  'NOT_PDF',
  'TOO_LARGE',
  'NO_EXTRACTABLE_TEXT',
  'UNREADABLE_PDF',
  'EMBEDDING_PROVIDER_FAILED',
  'STORAGE_FAILED',
  'UNKNOWN',
] as const

export type IngestionFailureCode = (typeof INGESTION_FAILURE_CODES)[number]

export const INGESTION_FAILURE_MESSAGES: Readonly<
  Record<IngestionFailureCode, string>
> = {
  NOT_PDF: 'Solo se admiten archivos PDF.',
  TOO_LARGE: 'El archivo supera el límite de 5 MB.',
  NO_EXTRACTABLE_TEXT:
    'No pudimos leer texto de este PDF. Puede ser un escaneo, que aún no soportamos.',
  UNREADABLE_PDF: 'No pudimos leer este PDF. Prueba con otro archivo.',
  EMBEDDING_PROVIDER_FAILED:
    'No pudimos procesar el documento en este momento. Inténtalo más tarde.',
  STORAGE_FAILED: 'No pudimos acceder al archivo. Inténtalo de nuevo más tarde.',
  UNKNOWN: 'No pudimos procesar el documento. Inténtalo de nuevo más tarde.',
}

export function isIngestionFailureCode(
  value: string
): value is IngestionFailureCode {
  return INGESTION_FAILURE_CODES.some((code) => code === value)
}

export function ingestionFailureMessage(
  code: IngestionFailureCode
): string {
  return INGESTION_FAILURE_MESSAGES[code]
}
