import { Geist, Geist_Mono } from 'next/font/google'
import type { JSX, ReactNode } from 'react'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode
}): JSX.Element {
  return (
    <html
      lang="es"
      data-theme="dark"
      className={`${geist.variable} ${geistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
