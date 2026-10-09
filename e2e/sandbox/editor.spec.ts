import { expect, test } from '@playwright/test';

/** Editor-only checks (no engine needed): presets round-trip through the position text, editing and sharing work. */

test.beforeEach(async ({ page }) => {
    await page.goto('/sandbox');
    await page.evaluate(() => window.localStorage.clear());
    await page.goto('/sandbox');
    await expect(page.getByTestId('board-editor')).toBeVisible();
});

for (const id of ['krennic-cad-bane', 'iden-plot-krayt', 'shields-experience', 'empty-board']) {
    test(`preset ${id} loads without errors and round-trips through text`, async ({ page }) => {
        await page.getByTestId('presets-button').click();
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

test('add a card by search, set its state, and share by URL', async ({ page, context }) => {
    await page.getByTestId('presets-button').click();
    await page.getByTestId('preset-empty-board').click();

    // target P2's ground arena, search, add
    await page.getByTestId('zone-p2-ground').click();
    await page.getByTestId('card-search-input').fill('consular security');
    await page.getByTestId('search-result-consular-security-force').click();
    await expect(page.getByTestId('card-p2-ground-consular-security-force')).toBeVisible();

    // inspector: 2 damage, a shield, exhausted
    await page.getByTestId('card-p2-ground-consular-security-force').click();
    await page.getByTestId('inspector-damage').getByLabel('increase').click();
    await page.getByTestId('inspector-damage').getByLabel('increase').click();
    await page.getByTestId('inspector-shield').getByLabel('increase').click();
    await page.getByTestId('inspector-exhausted').click();
    await expect(page.getByTestId('position-text')).toHaveValue(/ground: Consular Security Force \[damage 2, exhausted\]\n {2}\+ Shield/);

    // the URL carries the position: open it in a fresh page
    await page.waitForTimeout(400);
    const url = page.url();
    expect(url).toContain('#pos=');
    const other = await context.newPage();
    await other.goto(url);
    await expect(other.getByTestId('position-text')).toHaveValue(/Consular Security Force \[damage 2, exhausted\]/);
});
