import { stringify } from '@openimport/core'

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`
}

/** Short display string for a cell/sample value. */
export function display(value: unknown, max = 80): string {
  const s = stringify(value)
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export function download(content: string, name: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿', content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const escapeCsv = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(escapeCsv).join(',')).join('\r\n')
}
