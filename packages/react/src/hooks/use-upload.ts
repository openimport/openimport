import { type SourceFile, sourceFromString } from '@openimport/core'
import { type ChangeEvent, type DragEvent, useCallback, useRef, useState } from 'react'
import { useSession } from '../context'
import { useImportState } from './use-import-state'

export interface UseUploadOptions {
  /** Disable drag & drop / the file dialog. */
  disabled?: boolean
}

export interface UseUploadReturn {
  isDragging: boolean
  isLoading: boolean
  /** File input `accept` attribute derived from the registered formats. */
  accept: string
  formats: { id: string; label: string; extensions: string[] }[]
  open: () => void
  loadFile: (file: File | Blob | SourceFile) => Promise<void>
  /** Import pasted text, e.g. cells copied from a spreadsheet (tab-separated). */
  loadText: (text: string, name?: string) => Promise<void>
  getRootProps: () => {
    onDragEnter: (e: DragEvent) => void
    onDragOver: (e: DragEvent) => void
    onDragLeave: (e: DragEvent) => void
    onDrop: (e: DragEvent) => void
    'data-dragging': boolean | undefined
  }
  getInputProps: () => {
    ref: React.RefObject<HTMLInputElement | null>
    type: 'file'
    accept: string
    hidden: true
    tabIndex: -1
    onChange: (e: ChangeEvent<HTMLInputElement>) => void
  }
}

/** Headless dropzone + file dialog wired to the session. */
export function useUpload(options: UseUploadOptions = {}): UseUploadReturn {
  const session = useSession()
  const busy = useImportState((s) => s.busy)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const depth = useRef(0)
  const [isDragging, setDragging] = useState(false)
  const { accept, formats } = session.importer

  const loadFile = useCallback((file: File | Blob | SourceFile) => session.loadFile(file), [session])
  const loadText = useCallback(
    (text: string, name?: string) => {
      const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
      const guessed =
        name ??
        (text.trimStart().startsWith('[') || text.trimStart().startsWith('{')
          ? 'pasted.json'
          : firstLine.includes('\t')
            ? 'pasted.tsv'
            : 'pasted.csv')
      return session.loadFile(sourceFromString(text, guessed))
    },
    [session],
  )

  const open = useCallback(() => {
    if (!options.disabled) inputRef.current?.click()
  }, [options.disabled])

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

  return {
    isDragging,
    isLoading: busy === 'inspecting' || busy === 'loading' || busy === 'matching',
    accept,
    formats: formats.map((f) => ({ id: f.id, label: f.label, extensions: f.extensions })),
    open,
    loadFile,
    loadText,
    getRootProps: () => ({
      onDragEnter: (e) => {
        if (options.disabled || !hasFiles(e)) return
        e.preventDefault()
        depth.current++
        setDragging(true)
      },
      onDragOver: (e) => {
        if (options.disabled || !hasFiles(e)) return
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      },
      onDrop: (e) => {
        if (options.disabled) return
        e.preventDefault()
        depth.current = 0
        setDragging(false)
        const file = e.dataTransfer?.files?.[0]
        if (file) void loadFile(file)
      },
      'data-dragging': isDragging || undefined,
    }),
    getInputProps: () => ({
      ref: inputRef,
      type: 'file',
      accept,
      hidden: true,
      tabIndex: -1,
      onChange: (e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (file) void loadFile(file)
      },
    }),
  }
}
