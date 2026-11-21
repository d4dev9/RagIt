import type { JSX } from 'react'
import { GitHubIcon, ThemeIcon } from './workspace-icons'
import type { WorkspaceTheme } from './workspace-state'

interface WorkspaceHeaderProps {
  readonly theme: WorkspaceTheme
  readonly onThemeChange: (theme: WorkspaceTheme) => void
}

export function WorkspaceHeader({
  theme,
  onThemeChange,
}: WorkspaceHeaderProps): JSX.Element {
  const nextTheme = theme === 'dark' ? 'light' : 'dark'

  return (
    <header className="header">
      <span className="wordmark">RagIt</span>
      <div className="header-actions">
        <a
          className="gh"
          href="https://github.com/d4dev9/RagIt"
          target="_blank"
          rel="noopener"
          aria-label="Repositorio de RagIt en GitHub"
        >
          <GitHubIcon className="github-icon" />
          <span>GitHub</span>
        </a>
        <button
          className="icon-btn"
          type="button"
          aria-label={`Cambiar a modo ${nextTheme === 'light' ? 'claro' : 'oscuro'}`}
          onClick={() => onThemeChange(nextTheme)}
        >
          <ThemeIcon theme={theme} />
        </button>
      </div>
    </header>
  )
}
