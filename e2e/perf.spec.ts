/**
 * Measures how long the page is blocked (Chrome "long tasks") while importing,
 * on the main thread vs in a worker. Prints a table; doesn't assert thresholds
 * (CI machines vary). Run: pnpm e2e:perf
 * THROTTLE=4 slows the CPU down 4× (roughly a mid-range laptop).
 */
import { expect, test } from '@playwright/test'
import { contactsCsv, contactsXlsx, continueTo, dropStaged, openPlayground, stage, watchLongTasks } from './fixtures'

const cases = [
  { name: 'CSV · 250,000 rows', file: () => contactsCsv(250_000), filename: 'contacts.csv', mime: 'text/csv' },
  {
    name: 'Excel · 60,000 rows',
    file: () => contactsXlsx(60_000),
    filename: 'contacts.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
]

test('page responsiveness: main thread vs worker', async ({ page }) => {
  test.skip(!process.env.PERF, 'set PERF=1 (pnpm e2e:perf) to run')
  const rows: string[] = []
  const throttle = Number(process.env.THROTTLE ?? 1)
  if (throttle > 1) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle })
  }
  for (const c of cases) {
    const buffer = c.file()
    for (const mode of ['Main thread', 'Worker'] as const) {
      await openPlayground(page, mode)
      await stage(page, c.filename, buffer, c.mime)
      const read = await watchLongTasks(page)
      const t0 = Date.now()
      await dropStaged(page)
      await expect(page.locator('.oi-map')).toBeVisible({ timeout: 90_000 })
      const parse = await read()
      const t1 = Date.now()
      await continueTo(page, '.oi-grid__row:not(.is-loading)')
      const validate = await read()
      const t2 = Date.now()
      rows.push(
        `${c.name.padEnd(22)} ${mode.padEnd(12)} parse ${String(t1 - t0).padStart(5)} ms (longest block ${String(parse.longest).padStart(4)} ms)   validate ${String(t2 - t1).padStart(5)} ms (longest block ${String(validate.longest).padStart(4)} ms)   blocked total ${String(parse.blocked + validate.blocked).padStart(5)} ms`,
      )
    }
  }
  console.log(`\nCPU ${throttle}×\n${rows.join('\n')}\n`)
})
