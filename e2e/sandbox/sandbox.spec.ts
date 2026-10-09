import { expect, Page, test } from '@playwright/test';

/** SANDBOX_ENGINE=worker|socket picks the transport (default: the page's default, the in-browser worker). */
const SANDBOX_PATH = process.env.SANDBOX_ENGINE ? `/sandbox?engine=${process.env.SANDBOX_ENGINE}` : '/sandbox';

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
    if (process.env.SANDBOX_ENGINE !== 'socket') {
        // the in-browser engine must not need the dev server: make :9600 unreachable for this page
        await page.route(/localhost:9600/, (route) => route.abort());
        await page.routeWebSocket(/localhost:9600/, (ws) => ws.close());
    }
    await page.goto(SANDBOX_PATH);
    await page.evaluate(() => window.localStorage.clear());
    await page.goto(SANDBOX_PATH);

    // 1. preset
    await page.getByTestId('tab-position').click();
    await page.getByTestId('preset-krennic-cad-bane').click();
    await expect(page.getByTestId('position-text')).toHaveValue(/Cad Bane, Impressed Now\?/);
    await expect(page.getByTestId('position-title')).toContainText(/Krennic \+ Cad Bane/);

    // 2. play
    await expect(page.getByTestId('engine-status')).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
    if (process.env.SANDBOX_ENGINE) {
        await expect(page.getByTestId('engine-status')).toHaveAttribute('data-engine', process.env.SANDBOX_ENGINE);
    }
    await expect(page.getByTestId('play-position')).toBeEnabled();
    await page.getByTestId('play-position').click();
    await expect(page.getByTestId('analysis-view')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('prompt-dock')).toHaveAttribute('data-acting', 'p1');

    // 3. deploy Krennic: click the leader, then the deploy button
    await img(page, KRENNIC.set, KRENNIC.num, { leaderSide: true }).first().click({ force: true });
    await popupButton(page, /Deploy Director Krennic/).click();

    // 4. one trigger window, two triggers, P1 orders them
    const stack = page.getByTestId('stack-panel');
    await expect(stack).toContainText('Plot');
    await expect(stack).toContainText('When Deployed');
    await expect(page.getByTestId('stack-chooser').first()).toContainText('P1');
    await expect(page.getByTestId('prompt-dock')).toHaveAttribute('data-acting', 'p1');

    // 5. Plot first: choose it in the order prompt, then accept the optional Plot ("you may") prompt
    const treeNodes = page.locator('[data-testid^="tree-node-"]');
    const before = await treeNodes.count();
    await popupButton(page, /Play Cad Bane using\s*plot/i).click();
    await expect(treeNodes).toHaveCount(before + 1);
    await expect(page.getByTestId('prompt-dock')).toHaveAttribute('data-acting', 'p1');
    await popupButton(page, /Play Cad Bane using\s*plot|^Trigger$/i).click();
    await expect(treeNodes).toHaveCount(before + 2);
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

    // 8. play the Krennic-first line out: AT-ST deals 6 to Consular Security Force, then Cad Bane (Plot) defeats it
    const CSF = img(page, 'SOR', 46);
    await expect(page.getByTestId('prompt-dock')).toHaveAttribute('data-acting', 'p1');
    let count = await treeNodes.count();
    await img(page, 'SOR', 232).first().click({ force: true });           // AT-ST is the "another friendly unit"
    await expect(treeNodes).toHaveCount(++count);
    await CSF.first().click({ force: true });                             // 6 damage -> 1 HP left
    await expect(treeNodes).toHaveCount(++count);
    await popupButton(page, /Play Cad Bane using\s*plot|^Trigger$/i).click();
    await expect(treeNodes).toHaveCount(++count);
    await expect(page.getByTestId('stack-nested-under').first()).toContainText(/Plot/);
    await CSF.first().click({ force: true });                             // Cad Bane's When Played: defeat it
    await expect(treeNodes).toHaveCount(++count);
    await expect(CSF).toHaveCount(0);
    const krennicFirstEnd = await page.locator('[data-current="true"]').getAttribute('data-testid');

    // 9. switch back to the Plot-first line (its last decision: accepting the optional Plot trigger). It is the
    //    main line, which the explorer prints after the variation block, so it is the last "Trigger" row.
    const plotNode = page.locator('[data-testid^="tree-node-"]').filter({ hasText: /P1: Trigger/ }).last();
    await plotNode.click();
    await expect(plotNode).toHaveAttribute('data-current', 'true');
    await expect(img(page, CAD_BANE.set, CAD_BANE.num).first()).toBeVisible();
    await expect(CSF.first()).toBeVisible();                              // Consular Security Force survives this line so far

    // ... and forward again to the end of the Krennic-first line
    await page.getByTestId(krennicFirstEnd!).click();
    await expect(CSF).toHaveCount(0);

    // 10. copy the current position out
    await page.getByTestId('topbar-copy-text').click();
    await expect(page.getByTestId('toast')).toContainText(/copied/i);
});

test('an analysis survives a reload (localStorage) and can be resumed', async ({ page }) => {
    await page.goto(SANDBOX_PATH);
    await page.evaluate(() => window.localStorage.clear());
    await page.goto(SANDBOX_PATH);
    await page.getByTestId('tab-position').click();
    await page.getByTestId('preset-krennic-cad-bane').click();
    await expect(page.getByTestId('engine-status')).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
    await page.getByTestId('play-position').click();
    await expect(page.getByTestId('analysis-view')).toBeVisible();

    const treeNodes = page.locator('[data-testid^="tree-node-"]');
    await img(page, KRENNIC.set, KRENNIC.num, { leaderSide: true }).first().click({ force: true });
    await expect(treeNodes).toHaveCount(2);
    await popupButton(page, /Deploy Director Krennic/).click();
    await expect(treeNodes).toHaveCount(3);
    await expect(page.getByTestId('stack-panel')).toContainText('Plot');
    await page.waitForTimeout(800); // autosave is debounced

    await page.reload();
    await expect(page.getByTestId('edit-view')).toBeVisible();
    await expect(page.getByTestId('engine-status')).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
    await page.getByTestId('tab-position').click();
    await page.locator('[data-testid^="saved-analysis-"]').first().click();
    await expect(page.getByTestId('analysis-view')).toBeVisible();
    await expect(treeNodes).toHaveCount(3);
    await expect(page.locator('[data-current="true"]')).toContainText('Deploy Director Krennic');
    await expect(page.getByTestId('stack-panel')).toContainText('When Deployed');
});

test('Edit and Play share one board: leaving Play keeps the analysis, and "edit from here" starts from the current board', async ({ page }) => {
    await page.goto(SANDBOX_PATH);
    await page.evaluate(() => window.localStorage.clear());
    await page.goto(SANDBOX_PATH);
    await page.getByTestId('tab-position').click();
    await page.getByTestId('preset-krennic-cad-bane').click();
    await expect(page.getByTestId('engine-status')).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
    // the edit board is the real board: Krennic's leader card is on it, and clicking it offers a swap
    await img(page, KRENNIC.set, KRENNIC.num, { leaderSide: true }).first().click({ force: true });
    await expect(page.getByTestId('swap-picker')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('swap-picker')).toHaveCount(0);

    await page.getByTestId('play-position').click();
    await expect(page.getByTestId('analysis-view')).toBeVisible();
    const treeNodes = page.locator('[data-testid^="tree-node-"]');
    await img(page, KRENNIC.set, KRENNIC.num, { leaderSide: true }).first().click({ force: true });
    await popupButton(page, /Deploy Director Krennic/).click();
    await expect(treeNodes).toHaveCount(3);

    // to Edit and back without changing anything: the same tree, at the same node
    await page.getByTestId('mode-edit').click();
    await expect(page.getByTestId('edit-view')).toBeVisible();
    await page.getByTestId('mode-play').click();
    await expect(page.getByTestId('analysis-view')).toBeVisible();
    await expect(treeNodes).toHaveCount(3);
    await expect(page.locator('[data-current="true"]')).toContainText('Deploy Director Krennic');

    // edit from here: the deployed Krennic becomes part of a new start position
    await page.getByTestId('edit-from-here').click();
    await expect(page.getByTestId('edit-view')).toBeVisible();
    await page.getByTestId('tab-position').click();
    await expect(page.getByTestId('position-text')).toHaveValue(/leader: Director Krennic, Amidst My Achievement \[deployed\]/);
});
