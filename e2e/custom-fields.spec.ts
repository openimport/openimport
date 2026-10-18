import { expect, test } from '@playwright/test'
import { contactsCsv, continueTo, openPlayground, upload } from './fixtures'

/** The contacts CSV plus a column the schema doesn't have. */
function withSegment(rows: number): Buffer {
  const lines = contactsCsv(rows).toString().split('\n')
  return Buffer.from(lines.map((line, i) => `${line},${i === 0 ? 'segment' : ['A', 'B', 'C'][i % 3]}`).join('\n'))
}

for (const mode of ['Main thread', 'Worker'] as const) {
  test(`custom fields: add an unused column as a field and import it (${mode.toLowerCase()})`, async ({ page }) => {
    await openPlayground(page, mode)
    await upload(page, 'contacts.csv', withSegment(30), 'text/csv')
    await expect(page.locator('.oi-map')).toBeVisible()

    await page.getByRole('button', { name: 'Add as field: segment' }).click()
    await expect(page.getByText('New field from “segment”')).toBeVisible()
    // Three values repeated over 30 rows: suggested as a choice with those options
    await expect(page.getByRole('combobox', { name: 'Type' })).toHaveText('Choice')
    await expect(page.getByText('3 options from the column')).toBeVisible()
    await page.getByRole('textbox', { name: 'Name' }).fill('Segment')
    await page.getByRole('button', { name: 'Add field' }).click()

    const row = page.locator('.oi-map__row').filter({ hasText: 'Segment' })
    await expect(row.getByText('New field')).toBeVisible()
    await expect(row.locator('.oi-pill').first()).toHaveText(/^[ABC]$/)

    await continueTo(page, '.oi-grid__row:not(.is-loading)')
    await expect(page.locator('.oi-grid__th').filter({ hasText: 'Segment' })).toBeVisible()
    await page.getByRole('button', { name: /^Import \d+ rows$/ }).click()
    await expect(page.getByText('Import complete')).toBeVisible()
    // The records the app receives carry the value apart from the typed record
    await expect(page.locator('pre').filter({ hasText: '"$custom"' })).toContainText('"segment": "B"')
  })
}
