import { expect, test } from '@playwright/test'
import { contactsCsv, continueTo, openPlayground, upload } from './fixtures'

// Every menu in the importer is the same styled, portaled Radix select.
test('select menus: transformations, parsing options, filters and enum cells', async ({ page }) => {
  await openPlayground(page, 'Main thread')
  await upload(page, 'contacts.csv', contactsCsv(50, 10), 'text/csv')
  await expect(page.locator('.oi-map')).toBeVisible()
  await expect(page.locator('select')).toHaveCount(0)

  // Field editor: pick a transformation with the keyboard, a date format with the mouse
  await page.locator('.oi-map__row').filter({ hasText: 'Signup date' }).first().locator('.oi-map__configure').click()
  await page.getByRole('button', { name: 'Add transformation' }).click()
  const step = page.locator('.oi-steps__item .oi-select').first()
  await step.click()
  await expect(page.locator('.oi-menu')).toBeVisible()
  await page.getByRole('option', { name: 'Trim whitespace' }).click()
  await expect(step).toHaveText('Trim whitespace')
  await page.getByRole('combobox', { name: 'Date format' }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('option', { name: 'YYYY-MM-DD' }).click()
  await expect(page.getByRole('combobox', { name: 'Date format' })).toHaveText('YYYY-MM-DD')
  await expect(page.locator('.oi-menu')).toHaveCount(0)

  await continueTo(page, '.oi-grid__row:not(.is-loading)')

  // Review toolbar filter
  await page.getByRole('combobox', { name: 'All fields' }).click()
  await page.getByRole('option', { name: /Errors in First name/ }).click()
  await expect(page.locator('.oi-segmented')).toContainText('Errors 5')

  // Enum cell: the menu opens on edit; picking saves, Esc cancels, focus returns to the grid
  await page.getByRole('combobox', { name: 'All fields' }).click()
  await page.getByRole('option', { name: 'All fields' }).click()
  const col = await page.locator('.oi-grid__th').filter({ hasText: 'Status' }).first().getAttribute('data-col')
  const cell = page.locator(`.oi-grid__row:not(.is-loading) [data-col="${col}"]`).first()
  await expect(cell).toHaveText('lead')
  await cell.dblclick()
  await page.getByRole('option', { name: 'Churned' }).click()
  await expect(cell).toHaveText('churned')
  await expect(page.locator('.oi-grid')).toBeFocused()
  await cell.dblclick()
  await expect(page.locator('.oi-menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.oi-menu')).toHaveCount(0)
  await expect(cell).toHaveText('churned')
  await expect(page.locator('.oi-grid')).toBeFocused()
})
