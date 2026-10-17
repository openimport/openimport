import { type CSSProperties, createContext, useContext } from 'react'
import { en, format, type Messages } from './i18n'

export interface ImporterTheme {
  /** Brand color used for primary actions and highlights. Any CSS color. */
  accent?: string
  /** Base corner radius in px. */
  radius?: number
  /** `auto` follows the OS setting. */
  colorScheme?: 'light' | 'dark' | 'auto'
  fontFamily?: string
}

export interface UiContextValue {
  messages: Messages
  lang: string
  /** Props to spread on any element that renders outside the root (portals). */
  themeProps: { className: string; style: CSSProperties; 'data-theme': string }
  maxFileSize?: number
  templateDownload: boolean
}

export const UiContext = createContext<UiContextValue>({
  messages: en,
  lang: 'en',
  themeProps: { className: 'oi-theme', style: {}, 'data-theme': 'auto' },
  templateDownload: true,
})

export function useUi() {
  const ctx = useContext(UiContext)
  const t = (template: string, vars?: Record<string, string | number>) => format(template, vars, ctx.lang)
  return { ...ctx, m: ctx.messages, t }
}

export function themeStyle(theme: ImporterTheme = {}): CSSProperties {
  const style: Record<string, string> = {}
  if (theme.accent) style['--oi-accent'] = theme.accent
  if (theme.radius !== undefined) style['--oi-radius'] = `${theme.radius}px`
  if (theme.fontFamily) style['--oi-font'] = theme.fontFamily
  return style as CSSProperties
}
