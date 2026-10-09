import { expect, Page, test } from '@playwright/test';
import { VERDANT, hasRealReplay, loadVerdantGame, readCardIndex, realReplayPath, syntheticDecklists, varietyFiller } from './replay/realReplays';

/**
 * Import a double-sided SWU Forge replay (the Verdant Fortress game, saved from both seats), pick a mid-game
 * moment, pick up from there, and play a draw for each side: the drawn cards must be the top of the rebuilt
 * decks (decklist minus everything accounted for, in the seeded order the pick-up wrote into the position).
 *
 * The real exports hold player handles, so they stay outside the repo: the test skips when they're absent
 * (REPLAY_FIXTURES_DIR, see replay/realReplays.ts). Decklists are synthetic (the replay carries none).
 */
const SANDBOX_PATH = process.env.SANDBOX_ENGINE ? `/sandbox?engine=${process.env.SANDBOX_ENGINE}` : '/sandbox';

interface ISeatLines { hand: string[]; deck: string[]; others: string[] }

/**
 * Per seat, from position text (expanding `Nx` groups): the hand, the deck (top first) and every other card
 * that came out of that seat's deck (arenas, upgrades, resources, discard, captured; not leader and base).
 * These games have no stolen cards, so a card belongs to the section it is listed in.
 */
const parseSeats = (text: string): Record<'P1' | 'P2', ISeatLines> => {
    const out: Record<string, ISeatLines> = { P1: { hand: [], deck: [], others: [] }, P2: { hand: [], deck: [], others: [] } };
    let seat: 'P1' | 'P2' | null = null;
    for (const line of text.split('\n')) {
        const header = /^\[(P1|P2)\]/.exec(line.trim());
        if (header) {
            seat = header[1] as 'P1' | 'P2';
            continue;
        }
        const m = /^\s*(hand|deck|ground|space|resource|discard|leader|base|\+|captured):?\s*(?:(\d+)x\s+)?(.+?)\s*(\[.*\])?$/.exec(line);
        if (!seat || !m) {
            continue;
        }
        const kind = m[1];
        const isToken = ['Shield', 'Experience', 'Spy'].includes(m[3]);
        for (let i = 0; i < Number(m[2] ?? 1); i++) {
            if (kind === 'hand' || kind === 'deck') {
                out[seat][kind].push(m[3]);
            } else if (!['leader', 'base'].includes(kind) && !isToken) {
                out[seat].others.push(m[3]);
            }
        }
    }
    return out as Record<'P1' | 'P2', ISeatLines>;
};

const minus = (a: string[], b: string[]) => {
    const rest = [...a];
    for (const x of b) {
        const i = rest.indexOf(x);
        if (i >= 0) {
            rest.splice(i, 1);
        }
    }
    return rest;
};

const positionText = (page: Page) => page.getByTestId('position-text').inputValue();

test('Verdant pair: import both seats, pick up mid-game, each side draws from its remainder', async ({ page }) => {
    test.skip(!hasRealReplay(...VERDANT), 'real replay exports not present (REPLAY_FIXTURES_DIR)');
    const game = loadVerdantGame();
    const seen = new Set(game.a.frames.concat(game.b.frames).flatMap((f) => Object.values(f.gamestate.players)
        .flatMap((p) => Object.values(p.cardPiles).flat().map((c) => c.cardId).filter((id): id is string => !!id))));
    const decks = syntheticDecklists(game, varietyFiller(16, seen));
    const nameOf = new Map(readCardIndex().map((c) => [c.setCode, c.name]));
    const decklistNames = (json: string) => (JSON.parse(json).deck as { id: string; count: number }[])
        .flatMap((e) => Array.from({ length: e.count }, () => nameOf.get(e.id)!));

    await page.goto(SANDBOX_PATH);
    await page.evaluate(() => window.localStorage.clear());
    await page.goto(SANDBOX_PATH);
    await expect(page.getByTestId('engine-status')).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
    await page.getByTestId('tab-position').click();

    // 1. import: a single-sided replay is refused with the reason
    await page.getByTestId('replay-open').click();
    if (hasRealReplay('tarkin-5adf3f43.json')) {
        await page.getByTestId('replay-file-input').setInputFiles(realReplayPath('tarkin-5adf3f43.json'));
        await expect(page.getByTestId('replay-error')).toContainText('single-sided');
    }
    // one seat first: it asks for the other one
    await page.getByTestId('replay-file-input').setInputFiles(realReplayPath(VERDANT[0]));
    await expect(page.getByTestId('replay-status')).toContainText('add the other player');
    await page.getByTestId('replay-file-input').setInputFiles(realReplayPath(VERDANT[1]));
    await expect(page.getByTestId('replay-status')).toContainText('Wicket (P1) vs Boba Fett (P2)');

    // 2. decklists (pasted into the wrong boxes on purpose: they move to the seat whose leader they have)
    await page.getByTestId('replay-deck-p1').fill(decks.p2);
    await page.getByTestId('replay-deck-p1').fill(decks.p1);
    await expect(page.getByTestId('replay-deck-ok-p1')).toContainText('50 cards');
    await expect(page.getByTestId('replay-deck-ok-p2')).toContainText('52 cards');

    // 3. a mid-prompt frame snaps to the nearest clean one and says so; then round 3, P1 to act (frame 57)
    await page.getByTestId('replay-frame-input').fill('54');
    await page.getByTestId('replay-frame-input').press('Enter');
    await expect(page.getByTestId('replay-snap-note')).toContainText(/can't be picked up .*Mid-prompt/);
    await page.getByTestId('replay-frame-input').fill('57');
    await page.getByTestId('replay-frame-input').press('Enter');
    await expect(page.getByTestId('replay-moment-label')).toHaveText('Round 3 · action 4 · P1 to act');
    await expect(page.getByTestId('replay-log')).toContainText('P2 claims initiative and passes');
    await expect(page.getByTestId('replay-deck-report-p1')).toHaveAttribute('data-matches', 'true');
    await expect(page.getByTestId('replay-deck-report-p2')).toHaveAttribute('data-matches', 'true');
    await expect(page.getByTestId('replay-deck-report-p1')).toContainText('Deck 38 = replay 38');
    await expect(page.getByTestId('replay-deck-report-p2')).toContainText('Deck 42 = replay 42');

    // 4. pick up: the position is in the editor, with the approximations on show
    await page.getByTestId('replay-pickup').click();
    await expect(page.getByTestId('replay-approximations')).toContainText('Deck order was never recorded');
    await expect(page.getByTestId('replay-approximations')).toContainText('claimed the initiative');
    await expect(page.getByTestId('position-text')).toHaveValue(/Wicket vs Boba Fett · Round 3 · action 4/);
    const start = parseSeats(await positionText(page));
    expect(start.P1.deck).toHaveLength(38);
    expect(start.P2.deck).toHaveLength(42);
    // each deck is exactly its decklist minus every card accounted for elsewhere on that side
    for (const [seat, list] of [['P1', decks.p1], ['P2', decks.p2]] as const) {
        const expected = minus(decklistNames(list), [...start[seat].hand, ...start[seat].others]);
        expect([...start[seat].deck].sort()).toEqual(expected.sort());
    }
    expect(start.P1.hand).toEqual(['Verdant Fortress', 'Karis Nemik', 'Han Solo, Hibernation Sick', 'Logray']);
    expect(start.P2.hand).toHaveLength(4);
    await expect(page).toHaveURL(/#pos=/);

    // 5. play: both pass, the regroup phase draws two cards for each side
    await expect(page.getByTestId('play-position')).toBeEnabled();
    await page.getByTestId('play-position').click();
    await expect(page.getByTestId('analysis-view')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('prompt-dock')).toHaveAttribute('data-acting', 'p1');

    const treeNodes = page.locator('[data-testid^="tree-node-"]');
    const passFor = async (seat: 'p1' | 'p2') => {
        await expect(page.getByTestId('prompt-dock')).toHaveAttribute('data-acting', seat);
        const before = await treeNodes.count();
        await page.locator('button:visible').filter({ hasText: /^Pass$/ }).first().click();
        await expect(treeNodes).toHaveCount(before + 1);
    };
    await passFor('p1');
    await passFor('p2');
    await expect(page.getByTestId('prompt-dock-text')).toContainText(/resource/i);

    await page.getByTestId('tab-position').click();
    await expect(page.getByTestId('position-text')).toHaveValue(/phase: regroup/);
    const after = parseSeats(await positionText(page));
    for (const seat of ['P1', 'P2'] as const) {
        const drawn = minus(after[seat].hand, start[seat].hand);
        console.log(seat, 'drew', drawn, 'top of deck was', start[seat].deck.slice(0, 2));
        expect(drawn).toHaveLength(2);
        // the drawn cards are exactly the top two of the rebuilt deck, so they come from the remainder
        expect([...drawn].sort()).toEqual([...start[seat].deck.slice(0, 2)].sort());
        expect(after[seat].deck).toEqual(start[seat].deck.slice(2));
    }

    // 6. the panel came back with the Position tab without touching the game in progress
    await expect(page.getByTestId('analysis-view')).toBeVisible();
    await expect(page.getByTestId('replay-moment-label')).toHaveText('Round 3 · action 4 · P1 to act');
    await expect(page.getByTestId('replay-approximations')).toBeVisible();

    // 7. the replay and the pick are kept in this browser
    await page.reload();
    await page.getByTestId('tab-position').click();
    const stored = page.locator('[data-testid^="replay-stored-"]');
    await expect(stored).toHaveCount(1);
    await expect(stored).toContainText('Wicket vs Boba Fett');
    await expect(page.getByTestId('replay-import')).toContainText('↳ Round 3 · action 4 · P1 to act');
    await expect(page.getByTestId('replay-deck-ok-p2')).toContainText('52 cards');
});

test('Verdant pair: a regroup moment picks up at the resource step', async ({ page }) => {
    test.skip(!hasRealReplay(...VERDANT), 'real replay exports not present (REPLAY_FIXTURES_DIR)');
    const decks = syntheticDecklists(loadVerdantGame());
    await page.goto(SANDBOX_PATH);
    await page.evaluate(() => window.localStorage.clear());
    await page.goto(SANDBOX_PATH);
    await expect(page.getByTestId('engine-status')).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
    await page.getByTestId('tab-position').click();
    await page.getByTestId('replay-open').click();
    await page.getByTestId('replay-file-input').setInputFiles(VERDANT.map(realReplayPath));
    await page.getByTestId('replay-deck-p1').fill(decks.p1);
    await page.getByTestId('replay-deck-p2').fill(decks.p2);
    await page.getByTestId('replay-frame-input').fill('50');
    await page.getByTestId('replay-frame-input').press('Enter');
    await expect(page.getByTestId('replay-moment-label')).toHaveText('Round 2 · regroup, resource step');
    await expect(page.getByTestId('replay-deck-report-p1')).toHaveAttribute('data-matches', 'true');
    await page.getByTestId('replay-pickup').click();
    await expect(page.getByTestId('position-text')).toHaveValue(/phase: regroup/);
    await expect(page.getByTestId('play-position')).toBeEnabled();
    await page.getByTestId('play-position').click();
    await expect(page.getByTestId('analysis-view')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('prompt-dock-text')).toContainText(/resource/i);
});
