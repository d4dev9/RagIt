import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChatPanel } from '../../src/components/chat-panel'

describe('ChatPanel', () => {
  it('muestra el nombre completo y la página de cada cita', () => {
    const markup = renderToStaticMarkup(
      createElement(ChatPanel, {
        messages: [
          {
            role: 'assistant',
            text: '**Total** [1].\nDetalle.',
            citations: [
              {
                index: 1,
                documentId: '4f7073b6-10b8-4ea6-9c52-6c8c8190ed4f',
                displayName: 'comprobante_MKW-03252.pdf',
                page: 2,
              },
            ],
          },
        ],
        enabled: true,
        sending: false,
        onSend: async () => {},
        onCitation: () => {},
      })
    )

    expect(markup).toContain('comprobante_MKW-03252.pdf')
    expect(markup).toContain(
      'aria-label="comprobante_MKW-03252.pdf, página 2"'
    )
    expect(markup).toContain('class="cite-tooltip" aria-hidden="true">Página 2')
    expect(markup).toContain('<strong>Total</strong>')
    expect(markup).toContain('<br/>')
    expect(markup).not.toContain('4f7073b6-10b8-4ea6-9c52-6c8c8190ed4f')
  })

  it('muestra la espera accesible y deshabilita el envío durante la pregunta', () => {
    const markup = renderToStaticMarkup(
      createElement(ChatPanel, {
        messages: [{ role: 'user', text: '¿Cuál es el total?' }],
        enabled: true,
        sending: true,
        onSend: async () => {},
        onCitation: () => {},
      })
    )

    expect(markup).toContain('class="msg-bot waiting-message"')
    expect(markup).toContain('aria-live="polite">Preparando respuesta')
    expect(markup).toContain('class="typing-indicator"')
    expect(markup).toMatch(/<textarea[^>]*disabled=""/)
    expect(markup).toMatch(/<button[^>]*class="btn-send"[^>]*disabled=""/)
  })

  it('reemplaza la espera por el mensaje de error al finalizar con fallo', () => {
    const errorMessage = 'La solicitud al modelo de respuesta excedió el tiempo límite'
    const markup = renderToStaticMarkup(
      createElement(ChatPanel, {
        messages: [
          { role: 'user', text: '¿Cuál es el total?' },
          {
            role: 'assistant',
            text: errorMessage,
            citations: [],
          },
        ],
        enabled: true,
        sending: false,
        onSend: async () => {},
        onCitation: () => {},
      })
    )

    expect(markup).toContain(errorMessage)
    expect(markup).not.toContain('class="typing-indicator"')
    expect(markup).not.toContain('Preparando respuesta')
  })
})
