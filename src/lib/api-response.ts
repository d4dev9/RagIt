export function apiError(
  error: string,
  code: string,
  requestId: string,
  status: number
): Response {
  return Response.json({ error, code, requestId }, { status })
}

export function serviceUnavailableResponse(requestId: string): Response {
  return apiError(
    'El servicio no está disponible en este momento. Inténtalo más tarde.',
    'SERVICE_UNAVAILABLE',
    requestId,
    503
  )
}
