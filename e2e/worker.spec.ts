import { expect, test } from '@playwright/test'
import { contactsCsv, contactsXlsx, continueTo, openPlayground, upload } from './fixtures'

const thread = (page: import('@playwright/test').Page) => page.getByTestId('thread')

test('auto mode keeps small files on the main thread and moves large ones to a worker', async ({ page }) => {
  await openPlayground(page, 'Auto')
  await upload(page, 'small.csv', contactsCsv(200), 'text/csv')
  await expect(page.locator('.oi-map')).toBeVisible()
  await expect(thread(page)).toHaveText('main thread')

  await page.getByRole('button', { name: 'Reset session' }).click()
  await upload(page, 'large.csv', contactsCsv(120_000), 'text/csv') // ~8 MB, over the 5 MB threshold
  await expect(page.locator('.oi-map')).toBeVisible({ timeout: 60_000 })
  await expect(thread(page)).toHaveText('worker')
  await continueTo(page, '.oi-grid__row:not(.is-loading)')
  await expect(page.locator('.oi-segmented')).toContainText('120,000')
})

test('in a worker: review, find and fix errors, remove the rest, import', async ({ page }) => {
  await openPlayground(page, 'Worker')
  await upload(page, 'contacts.csv', contactsCsv(30_000, 1_000), 'text/csv') // 30 rows without a first name
  await expect(page.locator('.oi-map')).toBeVisible({ timeout: 60_000 })
  await expect(thread(page)).toHaveText('worker')
  // Mapping previews come from the worker
  await expect(page.locator('.oi-map__row').filter({ hasText: 'First name' }).locator('.oi-pill').first()).toHaveText('Anna')

  await continueTo(page, '.oi-grid__row:not(.is-loading)')
  const counts = page.locator('.oi-segmented')
  await expect(counts).toContainText('Errors 30')

  // Rows far down are paged in from the worker as you scroll
  await page.locator('.oi-grid').evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  await expect(page.locator('.oi-grid__row:not(.is-loading)').last()).toContainText('user29999@example.com')

  // Next error → fix it inline
  await page.getByRole('button', { name: 'Next error' }).click()
  await expect(page.locator('.oi-statusbar')).toContainText('First name is required')
  await page.keyboard.type('Fixed')
  await page.keyboard.press('Enter')
  await expect(counts).toContainText('Errors 29')

  await page.getByRole('button', { name: /Remove 29 rows with errors/ }).click()
  await expect(counts).toContainText('Errors 0')
  await page.getByRole('button', { name: 'Import 29,971 rows' }).click()
  await expect(page.getByText('Import complete')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('29,971 records were imported successfully.')).toBeVisible()
})

test('Excel files are parsed in the worker', async ({ page }) => {
  await openPlayground(page, 'Worker')
  await upload(page, 'contacts.xlsx', contactsXlsx(20_000), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  await expect(page.locator('.oi-map')).toBeVisible({ timeout: 60_000 })
  await continueTo(page, '.oi-grid__row:not(.is-loading)')
  await expect(page.locator('.oi-segmented')).toContainText('20,000')
})

test('main-thread mode still works the same', async ({ page }) => {
  await openPlayground(page, 'Main thread')
  await upload(page, 'contacts.csv', contactsCsv(2_000, 500), 'text/csv')
  await expect(thread(page)).toHaveText('main thread')
  await continueTo(page, '.oi-grid__row:not(.is-loading)')
  await expect(page.locator('.oi-segmented')).toContainText('Errors 4')
})
