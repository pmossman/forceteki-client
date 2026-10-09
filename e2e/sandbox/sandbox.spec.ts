import { expect, Page, test } from '@playwright/test';

/**
 * Full browser flow (BUILD-PLAN "Tests"): load the Krennic preset, deploy Krennic, see both triggers on the
 * stack with P1 ordering them, take Plot first and see Cad Bane's When Played nested under Plot, jump back to
 * the ordering decision, take Krennic first instead, and see the branch in the move tree. Then switch back.
 *
 * Needs the client on :3100 and the forceteki sandbox server on :9600 already running.
 */

// card images are the most stable handle on the (upstream, untagged) board components
const img = (page: Page, set: string, num: number, opts: { leaderSide?: boolean } = {}) =>
    page.locator(`[data-testid="sandbox-board"] img[src*="/${set}/"][src*="/${String(num).padStart(3, '0')}${opts.leaderSide ? '-base' : ''}.webp"]`);

const KRENNIC = { set: 'LAW', num: 8 };
const CAD_BANE = { set: 'SEC', num: 34 };

const popupButton = (page: Page, text: string | RegExp) =>
    page.locator('button, [role="button"]').filter({ hasText: text }).first();

test('Krennic + Cad Bane: both orders as branches', async ({ page }) => {
    await page.goto('/sandbox');
    await page.evaluate(() => window.localStorage.clear());
    await page.goto('/sandbox');

    // 1. preset
    await page.getByTestId('presets-button').click();
    await page.getByTestId('preset-krennic-cad-bane').click();
    await expect(page.getByTestId('position-text')).toHaveValue(/Cad Bane, Impressed Now\?/);
    await expect(page.getByTestId('position-title')).toHaveText(/Krennic \+ Cad Bane/);

    // 2. play
    await expect(page.getByTestId('engine-status')).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
    await expect(page.getByTestId('play-position')).toBeEnabled();
    await page.getByTestId('play-position').click();
    await expect(page.getByTestId('analysis-view')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('prompt-dock')).toHaveAttribute('data-acting', 'p1');

    // 3. deploy Krennic: click the leader, then the deploy button
    await img(page, KRENNIC.set, KRENNIC.num, { leaderSide: true }).first().click();
    await popupButton(page, /Deploy Director Krennic/).click();

    // 4. one trigger window, two triggers, P1 orders them
    const stack = page.getByTestId('stack-panel');
    await expect(stack).toContainText('Plot');
    await expect(stack).toContainText('When Deployed');
    await expect(page.getByTestId('stack-chooser').first()).toContainText('P1');
    await expect(page.getByTestId('prompt-dock')).toHaveAttribute('data-acting', 'p1');

    // 5. Plot first
    await popupButton(page, /Play Cad Bane using Plot/).click();
    const trigger = popupButton(page, /^Trigger$/);
    if (await trigger.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await trigger.click();
    }
    // Cad Bane is in play and his When Played is nested under Plot, above Krennic's waiting layer
    await expect(img(page, CAD_BANE.set, CAD_BANE.num).first()).toBeVisible();
    await expect(page.getByTestId('stack-nested-under').first()).toContainText(/Plot/);
    await expect(stack).toContainText('When Played');

    const nodesAfterPlot = await page.locator('[data-testid^="tree-node-"]').count();
    expect(nodesAfterPlot).toBeGreaterThanOrEqual(3);

    // 6. jump back to the moment P1 ordered the triggers (the deploy node), and take Krennic first
    const deployNode = page.locator('[data-testid^="tree-node-"]').filter({ hasText: /Deploy Director Krennic/ }).first();
    await deployNode.click();
    await expect(deployNode).toHaveAttribute('data-current', 'true');
    await expect(stack).toContainText('Plot');
    await expect(img(page, CAD_BANE.set, CAD_BANE.num)).toHaveCount(0);
    await popupButton(page, /Another friendly unit deals damage/).click();

    // 7. the tree now has a fork with a variation
    await expect(page.getByTestId('tree-variation').first()).toBeVisible();
    await expect(page.getByTestId('tree-fork-marker').first()).toContainText('2');

    // 8. switch back to the Plot-first line: Cad Bane is on the board again
    const plotNode = page.locator('[data-testid^="tree-node-"]').filter({ hasText: /Plot/ }).first();
    await plotNode.click();
    await expect(plotNode).toHaveAttribute('data-current', 'true');
    await expect(img(page, CAD_BANE.set, CAD_BANE.num).first()).toBeVisible();

    // 9. copy the current position out
    await page.getByTestId('topbar-copy-text').click();
    await expect(page.getByTestId('toast')).toContainText(/copied/i);
});
