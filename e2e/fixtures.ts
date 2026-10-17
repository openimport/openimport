import { expect, type Page } from '@playwright/test'
import { makeXlsx } from '../packages/xlsx/test/make-xlsx'

const FIRST = ['Anna', 'Lukas', 'Mia', 'Leon', 'Emma', 'Paul', 'Sofia', 'Jonas']
const LAST = ['Müller', 'Schmidt', 'Weber', 'Becker', 'Koch']

/** A contacts CSV the playground schema maps fully. Every `errorEvery`-th row has no first name. */
export function contactsCsv(rows: number, errorEvery = 0): Buffer {
  const lines = ['first_name,last_name,email,company,status,signup_date,revenue']
  for (let i = 0; i < rows; i++) {
    const first = errorEvery && i % errorEvery === errorEvery - 1 ? '' : FIRST[i % FIRST.length]
    lines.push(
      `${first},${LAST[i % LAST.length]},user${i}@example.com,Acme,${i % 2 ? 'customer' : 'lead'},2024-0${1 + (i % 9)}-1${i % 9},${(i * 37) % 100000}`,
    )
  }
  return Buffer.from(lines.join('\n'))
}

export function contactsXlsx(rows: number): Buffer {
  const sheet: (string | number)[][] = [['first_name', 'last_name', 'email', 'status', 'revenue']]
  for (let i = 0; i < rows; i++)
    sheet.push([
      FIRST[i % FIRST.length] as string,
      LAST[i % LAST.length] as string,
      `user${i}@example.com`,
      i % 2 ? 'customer' : 'lead',
      (i * 37) % 100000,
    ])
  return Buffer.from(makeXlsx({ Contacts: sheet }))
}

export async function openPlayground(page: Page, runIn: 'Main thread' | 'Worker' | 'Auto') {
  await page.goto('/playground/')
  await page.getByRole('tab', { name: runIn }).click()
}

/** Upload through the importer's real file input. */
export async function upload(page: Page, name: string, buffer: Buffer, mimeType: string) {
  await page.locator('.oi-dropzone input[type=file]').setInputFiles({ name, mimeType, buffer })
}

export async function continueTo(page: Page, selector: string) {
  await page.locator('.oi-footer .oi-btn--primary').click()
  await expect(page.locator(selector).first()).toBeVisible({ timeout: 90_000 })
}

/** Record main-thread long tasks (> 50 ms, the page can't respond) from now on. */
export async function watchLongTasks(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[] }
    w.__long = []
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__long.push(Math.round(e.duration))
    }).observe({ type: 'longtask' })
  })
  return async () => {
    const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long.splice(0))
    return { count: long.length, longest: Math.max(0, ...long), blocked: long.reduce((a, b) => a + b, 0) }
  }
}

/**
 * Put a file into the page without handing it to the importer yet. Playwright's
 * own file transfer blocks the page for a while on big files; staging first
 * keeps that out of measurements. `dropStaged` then gives it to the importer.
 */
export async function stage(page: Page, name: string, buffer: Buffer, mimeType: string) {
  await page.evaluate(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.id = '__staged'
    input.hidden = true
    document.body.append(input)
  })
  await page.locator('#__staged').setInputFiles({ name, mimeType, buffer })
}

export async function dropStaged(page: Page) {
  await page.evaluate(() => {
    const staged = document.querySelector<HTMLInputElement>('#__staged')
    const target = document.querySelector<HTMLInputElement>('.oi-dropzone input[type=file]')
    if (!staged?.files || !target) throw new Error('nothing staged')
    target.files = staged.files
    target.dispatchEvent(new Event('change', { bubbles: true }))
    staged.remove()
  })
}
