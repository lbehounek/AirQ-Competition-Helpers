import { test, expect, type Page } from '@playwright/test'

async function openCreateForm(page: Page) {
  await page.getByRole('button', { name: /Nová soutěž|New Competition/i }).click()
}

async function createCompetition(page: Page, name: string) {
  await openCreateForm(page)
  const input = page.getByRole('textbox')
  await input.fill(name)
  await page.getByRole('button', { name: /^Vytvořit$|^Create$/ }).click()
  await expect(page.getByRole('combobox')).toContainText(name)
}

test.describe('Landing page — core flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('1. loads with Czech UI by default and no console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await expect(
      page.getByRole('heading', { name: 'Nástroje pro navigační soutěže' }),
    ).toBeVisible()
    await expect(page.getByText('Vyberte soutěž a aplikaci')).toBeVisible()
    await expect(page).toHaveTitle(/Nástroje pro navigační soutěže/)

    expect(errors, `unexpected console errors: ${errors.join(' | ')}`).toEqual([])
  })

  test('2. language switcher toggles CZ ↔ EN and persists after reload', async ({ page }) => {
    await page.getByRole('button', { name: 'EN', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Navigation Flying Tools' }),
    ).toBeVisible()

    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'Navigation Flying Tools' }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'CZ', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Nástroje pro navigační soutěže' }),
    ).toBeVisible()
  })

  test('3. empty state shows placeholder and disabled app cards', async ({ page }) => {
    await expect(page.getByRole('combobox')).toBeDisabled()
    await expect(page.getByText('Nejdříve vyberte soutěž')).toBeVisible()
  })

  test('4. creates a competition via the inline form', async ({ page }) => {
    await createCompetition(page, 'Test Rally 2026')
    await expect(page.getByRole('combobox')).toContainText('Test Rally 2026')
    await expect(page.getByRole('combobox')).toBeEnabled()
  })

  test('5. discipline toggle switches Rally ↔ Precision and persists', async ({ page }) => {
    await createCompetition(page, 'Discipline Test')

    const rallyButton = page.getByRole('button', { name: 'Rally' })
    const precisionButton = page.getByRole('button', { name: 'Precision' })

    await expect(rallyButton).toHaveAttribute('aria-pressed', 'true')

    await precisionButton.click()
    await expect(precisionButton).toHaveAttribute('aria-pressed', 'true')
    await expect(rallyButton).toHaveAttribute('aria-pressed', 'false')

    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Precision' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  test('6. deletes the active competition and reassigns to the next one', async ({ page }) => {
    await createCompetition(page, 'First Competition')
    await createCompetition(page, 'Second Competition')

    await expect(page.getByRole('combobox')).toContainText('Second Competition')

    await page.getByRole('button', { name: 'Smazat' }).click()
    await page
      .getByRole('button', { name: /^Smazat$/ })
      .last()
      .click()

    await expect(page.getByRole('combobox')).toContainText('First Competition')
    await expect(page.getByRole('combobox')).not.toContainText('Second Competition')
  })

  test('7. switches active competition via the select', async ({ page }) => {
    await createCompetition(page, 'Alpha')
    await createCompetition(page, 'Bravo')

    await expect(page.getByRole('combobox')).toContainText('Bravo')

    await page.getByRole('combobox').click()
    await page.getByRole('option', { name: /Alpha/ }).click()

    await expect(page.getByRole('combobox')).toContainText('Alpha')
  })

  test('8. app cards enable once a competition is selected', async ({ page }) => {
    await expect(page.getByText('Nejdříve vyberte soutěž')).toBeVisible()

    await createCompetition(page, 'Navigation Target')

    await expect(page.getByText('Nejdříve vyberte soutěž')).toBeHidden()

    const mapCard = page.getByRole('button', { name: /Umístění fotek/ })
    const helperCard = page.getByRole('button', { name: /Foto editor/ })
    await expect(mapCard).toBeEnabled()
    await expect(helperCard).toBeEnabled()
  })

  test('9. app card click builds the expected /map-corridors/ URL with params', async ({
    page,
  }) => {
    await createCompetition(page, 'URL Target')

    const rallyButton = page.getByRole('button', { name: 'Rally' })
    await expect(rallyButton).toHaveAttribute('aria-pressed', 'true')

    const navigationPromise = page.waitForRequest(/\/map-corridors\/\?/, {
      timeout: 5_000,
    })
    await page.getByRole('button', { name: /Umístění fotek/ }).click()
    const request = await navigationPromise
    const url = new URL(request.url())
    expect(url.pathname).toBe('/map-corridors/')
    expect(url.searchParams.get('competitionId')).toMatch(/^comp-/)
    expect(url.searchParams.get('discipline')).toBe('rally')
  })

  test('10. state persists across full reload (OPFS)', async ({ page }) => {
    await createCompetition(page, 'Persisted Comp')
    await page.getByRole('button', { name: 'Precision' }).click()

    await page.reload()

    await expect(page.getByRole('combobox')).toContainText('Persisted Comp')
    await expect(page.getByRole('button', { name: 'Precision' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
