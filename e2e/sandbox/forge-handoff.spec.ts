import fs from 'node:fs';
import path from 'node:path';
import { BrowserContext, Page, expect, test } from '@playwright/test';
import { parseForgeRecording } from '../../src/app/sandbox/_lib/replay/forgeExport';
import { pairRecordings } from '../../src/app/sandbox/_lib/replay/replayGame';
import { GAMES_DIR } from './replay/gameManifest';
import { syntheticPayload } from './replay/handoffPayload';

/**
 * "Open in sandbox" from SWU Forge, in a real browser: a stand-in for SWU Forge's replay page (served by Playwright
 * at an origin of the test's choosing) opens /sandbox#handoff=<nonce>&frame=<step> and answers its "ready" the way
 * SWU Forge does. The sandbox must take the game from an allow-listed origin (localhost, in this dev build) and pick
 * it up at the frame, and must ignore the very same message from any other origin.
 *
 * The allow-list test uses the committed invented game. The pick-up test uses the real Verdant pair and its real
 * decklists from the overseer hub (REPLAY_GAMES_DIR); it skips without them.
 */
const SANDBOX_PATH = process.env.SANDBOX_ENGINE ? `/sandbox?engine=${process.env.SANDBOX_ENGINE}` : '/sandbox';
const ALLOWED = 'http://localhost:5598';
const EVIL = 'https://evil.example';

/** The stand-in opener: `go(url, reply)` opens the sandbox and answers its ready; `blind` posts without waiting. */
const OPENER_HTML = `<!doctype html><title>opener</title><script>
window.__seen = [];
window.go = (url, nonce, reply, blind) => {
    const w = window.open(url, '_blank');
    const send = () => w.postMessage(reply, '*');
    window.addEventListener('message', (e) => {
        window.__seen.push({ origin: e.origin, type: e.data && e.data.type, nonce: e.data && e.data.nonce });
        if (e.source === w && e.data && e.data.type === 'sandbox-ready' && e.data.nonce === nonce) send();
    });
    if (blind) { let n = 0; const t = setInterval(() => { send(); if (++n > 30) clearInterval(t); }, 300); }
};
</script>`;

const serveOpener = async (context: BrowserContext, origin: string) => {
    await context.route(`${origin}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: OPENER_HTML }));
};

/** Open the sandbox from an opener at `origin`, replying `reply`; returns the sandbox window. */
const openFrom = async (context: BrowserContext, baseURL: string, origin: string, opts: { nonce: string; step: number; reply: object; blind?: boolean }) => {
    const opener = await context.newPage();
    await opener.goto(`${origin}/replay`);
    const url = `${baseURL}${SANDBOX_PATH}#handoff=${opts.nonce}&frame=${opts.step}`;
    const popupPromise = context.waitForEvent('page');
    await opener.evaluate(({ u, n, r, b }) => (window as unknown as { go: (...a: unknown[]) => void }).go(u, n, r, b), { u: url, n: opts.nonce, r: opts.reply, b: !!opts.blind });
    const sandbox = await popupPromise;
    await sandbox.waitForLoadState('domcontentloaded');
    return { opener, sandbox };
};

const seenBy = (opener: Page) => opener.evaluate(() => (window as unknown as { __seen: { origin: string; type: string; nonce: string }[] }).__seen);

test('the sandbox takes a game only from an allow-listed origin, from its opener, with its own nonce', async ({ context, baseURL }) => {
    await serveOpener(context, ALLOWED);
    await serveOpener(context, EVIL);

    // 1. Not on the allow-list: the very same message, posted again and again, is ignored. The sandbox never even
    //    tells that origin it is ready (the nonce goes to allowed origins only).
    const evilNonce = 'nonce-evil-000001';
    const evil = await openFrom(context, baseURL!, EVIL, {
        nonce: evilNonce, step: 3, blind: true, reply: { type: 'sandbox-handoff', nonce: evilNonce, payload: syntheticPayload(3) },
    });
    await expect(evil.sandbox.getByTestId('replay-handoff')).toHaveText('Opening a game from SWU Forge…');
    await evil.sandbox.waitForTimeout(6_000);
    await expect(evil.sandbox.getByTestId('replay-handoff')).toHaveText('Opening a game from SWU Forge…');
    await expect(evil.sandbox.getByTestId('replay-status')).toHaveCount(0);
    expect((await seenBy(evil.opener)).filter((m) => m.type === 'sandbox-ready')).toEqual([]);

    // 2. Allowed origin, but an answer with another nonce: ignored too.
    const nonce = 'nonce-allowed-0002';
    const wrong = await openFrom(context, baseURL!, ALLOWED, {
        nonce, step: 3, reply: { type: 'sandbox-handoff', nonce: 'nonce-somebody-else', payload: syntheticPayload(3) },
    });
    await expect.poll(async () => (await seenBy(wrong.opener)).filter((m) => m.type === 'sandbox-ready').length).toBe(1);
    await wrong.sandbox.waitForTimeout(2_000);
    await expect(wrong.sandbox.getByTestId('replay-status')).toHaveCount(0);

    // 3. The control: the same game from an allowed origin with the right nonce is imported.
    const good = await openFrom(context, baseURL!, ALLOWED, {
        nonce: 'nonce-allowed-0003', step: 3, reply: { type: 'sandbox-handoff', nonce: 'nonce-allowed-0003', payload: syntheticPayload(3) },
    });
    await expect(good.sandbox.getByTestId('replay-handoff')).toContainText('From SWU Forge: Alice Leader vs Bob Leader');
    await expect(good.sandbox.getByTestId('replay-status')).toContainText('moments can be picked up');
    // the nonce is single-use: it is gone from the address once read (the editor writes #pos= there instead)
    expect(new URL(good.sandbox.url()).hash).not.toContain('handoff');
});

const manifestEntry = (leader: string) => {
    const file = path.join(GAMES_DIR, 'manifest.json');
    if (!fs.existsSync(file)) {
        return null;
    }
    const entries = JSON.parse(fs.readFileSync(file, 'utf8')) as { gameId: string; leader: string; exportFile: string; deckFile: string }[];
    const e = entries.find((x) => x.gameId.startsWith('3f844c65') && x.leader === leader);
    return e && fs.existsSync(path.join(GAMES_DIR, e.exportFile)) && fs.existsSync(path.join(GAMES_DIR, e.deckFile)) ? e : null;
};

test('Verdant pair from SWU Forge: picks up at the handed frame, both decks rebuilt from the lists', async ({ context, baseURL }) => {
    const boba = manifestEntry('JTL_009');
    const wicket = manifestEntry('HMW_014');
    test.skip(!boba || !wicket, `the Verdant exports and decklists are not in ${GAMES_DIR}`);
    await serveOpener(context, ALLOWED);

    const read = (f: string) => fs.readFileSync(path.join(GAMES_DIR, f), 'utf8');
    const recs = [boba!, wicket!].map((e) => parseForgeRecording(read(e.exportFile)));
    if (!recs[0].ok || !recs[1].ok) {
        throw new Error('the Verdant exports did not parse');
    }
    const paired = pairRecordings(recs[0].recording, recs[1].recording);
    if (!paired.ok) {
        throw new Error(paired.error);
    }
    // a mid-game moment the importer can pick up (Round 3), handed over as a frame inside it
    const target = paired.game.moments.find((m) => m.clean && m.round === 3 && m.phase === 'action')!;
    const step = target.a.first;

    const seat = (e: typeof boba, rec: (typeof recs)[number]) => ({
        leader: e!.leader,
        deckName: `${e!.leader} list`,
        recording: (rec as { recording: { timeline: unknown } }).recording.timeline,
        decklist: JSON.parse(read(e!.deckFile)),
        decklistSource: 'filed',
    });
    const nonce = 'nonce-verdant-0001';
    const payload = { format: 'swuforge-sandbox-handoff', version: 1, gameId: paired.game.gameId, seats: [seat(boba, recs[0]), seat(wicket, recs[1])], frame: { step, forgeFrame: 99 } };
    const { sandbox } = await openFrom(context, baseURL!, ALLOWED, { nonce, step, reply: { type: 'sandbox-handoff', nonce, payload } });

    await expect(sandbox.getByTestId('replay-handoff')).toContainText('opened at frame 99', { timeout: 60_000 });
    await expect(sandbox.getByTestId('replay-moment-label')).toHaveAttribute('data-moment-key', target.key);
    await expect(sandbox.getByTestId('replay-snap-note')).toHaveCount(0);
    // picked up (into Edit, approximations on show), not just previewed
    await expect(sandbox.getByTestId('replay-approximations')).toBeVisible({ timeout: 60_000 });
    // Wicket's list is the one he played: exact. Boba's registered list isn't the version played (53 vs 52 main,
    // Planetary Bombardment from the sideboard): a known data limitation, and the existing mismatch report says so.
    await expect(sandbox.getByTestId('replay-deck-report-p2')).toHaveAttribute('data-matches', 'true');
    await expect(sandbox.getByTestId('replay-deck-report-p1')).toHaveAttribute('data-matches', 'false');
    await expect(sandbox.getByTestId('replay-deck-report-p1')).toHaveText(/^Deck (\d+) ≠ replay (\d+)$/);
    const [, deck, replay] = /Deck (\d+) ≠ replay (\d+)/.exec(await sandbox.getByTestId('replay-deck-report-p1').innerText())!;
    expect(Number(deck) - Number(replay)).toBeGreaterThanOrEqual(1);
    expect(Number(deck) - Number(replay)).toBeLessThanOrEqual(2);
});
