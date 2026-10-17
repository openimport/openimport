import type { ImportError, ImportErrorCode } from './types'

/**
 * Throw this from plugins (or `onSubmit`) to show a specific, user-facing
 * message. The session surfaces `message` and `code` in `state.error`.
 */
export class ImportException extends Error implements ImportError {
  readonly code: ImportErrorCode

  constructor(code: ImportErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ImportException'
    this.code = code
  }
}

export function importError(code: ImportErrorCode, message: string, cause?: unknown): ImportException {
  return new ImportException(code, message, { cause })
}
