import { expect, test } from '@playwright/test';

/** SANDBOX_ENGINE=worker|socket picks the transport (default: the page's default, the in-browser worker). */
const SANDBOX_PATH = process.env.SANDBOX_ENGINE ? `/sandbox?engine=${process.env.SANDBOX_ENGINE}` : '/sandbox';

/** Edit mode: presets round-trip through the position text; adding and changing cards happens on the real board. */

test.beforeEach(async ({ page }) => {
    await page.goto(SANDBOX_PATH);
    await page.evaluate(() => window.localStorage.clear());
    await page.goto(SANDBOX_PATH);
    await expect(page.getByTestId('edit-view')).toBeVisible();
});

for (const id of ['krennic-cad-bane', 'iden-plot-krayt', 'shields-experience', 'empty-board']) {
    test(`preset ${id} loads without errors and round-trips through text`, async ({ page }) => {
        await page.getByTestId('tab-position').click();
        await page.getByTestId(`preset-${id}`).click();
        const text = await page.getByTestId('position-text').inputValue();
        expect(text).toContain('[P1]');
        await expect(page.getByTestId('position-panel')).not.toContainText('error');
        // re-apply the exported text: it must produce the same text again
        await page.getByTestId('position-text').fill(text.replace('phase: action', 'phase:   action'));
        await page.getByTestId('apply-position-text').click();
        await expect(page.getByTestId('position-text')).toHaveValue(text);
    });
}

test('add a card on the board, set its state there, and share by URL', async ({ page, context }) => {
    await page.getByTestId('tab-position').click();
    await page.getByTestId('preset-empty-board').click();
    await expect(page.getByTestId('position-text')).toHaveValue(/# Empty board/);

    // "+ Ground" on P2's side of the real board opens the card palette for that zone
    await page.getByTestId('add-p2-ground').click();
    await page.getByTestId('card-search-input').fill('consular security');
    await page.getByTestId('search-result-consular-security-force').click();
    await page.keyboard.press('Escape');
    const csf = page.locator('[data-testid="sandbox-board"] img[src*="/SOR/"][src*="/046.webp"]').first();
    await expect(csf).toBeVisible();

    // click it on the board: the inspector sets 2 damage, a shield, exhausted
    await csf.click({ force: true });
    await expect(page.getByTestId('edit-inspector')).toBeVisible();
    await page.getByTestId('inspector-damage').getByLabel('increase').click();
    await page.getByTestId('inspector-damage').getByLabel('increase').click();
    await page.getByTestId('inspector-shield').getByLabel('increase').click();
    await page.getByTestId('inspector-exhausted').click();
    await expect(page.getByTestId('position-text')).toHaveValue(/ground: Consular Security Force \[damage 2, exhausted\]\n {2}\+ Shield/);
    await page.keyboard.press('Escape');

    // the board shows the engine's own rendering of that state (a Shield token on the unit)
    await expect(page.locator('[data-testid="sandbox-board"] [data-card-uuid]').filter({ has: page.locator('img[src*="/046.webp"]') }).first()).toBeVisible();

    // the URL carries the position: open it in a fresh page
    await page.waitForTimeout(400);
    const url = page.url();
    expect(url).toContain('#pos=');
    const other = await context.newPage();
    await other.goto(url);
    await expect(other.getByTestId('position-text')).toHaveValue(/Consular Security Force \[damage 2, exhausted\]/);
});
