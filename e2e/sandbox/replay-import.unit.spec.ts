import { expect, test } from '@playwright/test';
import { readSvelteKitData, unflatten } from '../../src/app/sandbox/_lib/replay/devalue';
import { parseDecklist } from '../../src/app/sandbox/_lib/replay/decklist';
import { SINGLE_SIDED_REFUSAL, parseForgeRecording } from '../../src/app/sandbox/_lib/replay/forgeExport';
import { buildPickUp, seededShuffle } from '../../src/app/sandbox/_lib/replay/pickUp';
import { normalizeSetCode, replayCardsFrom } from '../../src/app/sandbox/_lib/replay/replayCards';
import { IReplayGame, momentForFrame, nearestCleanMoment, pairRecordings } from '../../src/app/sandbox/_lib/replay/replayGame';
import { decodePositionText } from '../../src/app/sandbox/_lib/positionText';
import { ALICE_DECK, BOB_DECK, GAME_ID, TEST_SET_CODE_MAP, flatten, pageExport, testIndex } from './replay/syntheticGame';
import { VERDANT, hasRealReplay, loadVerdantGame, readRealReplay, syntheticDecklists } from './replay/realReplays';

/**
 * Unit tests for the SWU Forge replay importer (no browser): devalue decoding, recording parsing and the
 * single-sided refusal, the double-sided join, the pick-up position, and the deck-remainder arithmetic.
 * The synthetic fixture is invented data; the real-file tests read the overseer hub's exports and skip
 * without them.
 */

const cards = replayCardsFrom(testIndex(), TEST_SET_CODE_MAP);

const syntheticGame = (): IReplayGame => {
    const a = parseForgeRecording(pageExport('alice'));
    const b = parseForgeRecording(pageExport('bob'));
    if (!a.ok || !b.ok) {
        throw new Error('fixture did not parse');
    }
    const paired = pairRecordings(a.recording, b.recording);
    if (!paired.ok) {
        throw new Error(paired.error);
    }
    return paired.game;
};

const decks = () => {
    const a = parseDecklist(ALICE_DECK, cards);
    const b = parseDecklist(BOB_DECK, cards);
    if (!a.ok || !b.ok) {
        throw new Error('decks did not parse');
    }
    return { p1: a.deck, p2: b.deck };
};

test.describe('devalue (SvelteKit __data.json)', () => {
    test('unflattens objects, arrays, shared references, holes and special values', () => {
        const value = unflatten([{ a: 1, b: 2, c: 4, d: 5 }, 'hello', [3, -2, 3], 7, ['Date', '2026-10-06T11:52:49.152Z'], [-1, -3, -6]]) as Record<string, unknown>;
        expect(value.a).toBe('hello');
        expect(value.b).toEqual([7, undefined, 7]);
        expect(1 in (value.b as unknown[])).toBe(false);
        expect((value.c as Date).toISOString()).toBe('2026-10-06T11:52:49.152Z');
        const [u, nan, negZero] = value.d as number[];
        expect(u).toBeUndefined();
        expect(nan).toBeNaN();
        expect(Object.is(negZero, -0)).toBe(true);

        const shared = unflatten([{ x: 1, y: 1 }, { k: 2 }, 'v']) as { x: object; y: object };
        expect(shared.x).toBe(shared.y);
        const typed = unflatten([['Map', 1, 2], 'key', ['Set', 3], 9]) as Map<string, Set<number>>;
        expect([...typed.get('key')!]).toEqual([9]);
    });

    test('reads every route node, skipping non-data nodes', () => {
        const nodes = readSvelteKitData({ type: 'data', nodes: [{ type: 'data', data: flatten({ a: 1 }) }, { type: 'skip' }, { type: 'data', data: flatten({ game: { id: 'g' } }) }] });
        expect(nodes).toEqual([{ a: 1 }, null, { game: { id: 'g' } }]);
        expect(() => readSvelteKitData({ nodes: [] })).toThrow(/__data.json/);
    });
});

test.describe('recordings', () => {
    test('a replay page export reads as one seat\'s recording', () => {
        const res = parseForgeRecording(pageExport('alice'));
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.recording.gameId).toBe(GAME_ID);
            expect(res.recording.source).toBe('replayPage');
            expect(res.recording.frames).toHaveLength(4);
            expect(res.recording.deckName).toBe('alice\'s deck');
            expect(res.recording.doubleSidedAvailable).toBe(true);
        }
    });

    test('a single-sided replay is refused, saying why', () => {
        const res = parseForgeRecording(pageExport('alice', { doubleSided: false }));
        expect(res).toEqual({ ok: false, error: SINGLE_SIDED_REFUSAL });
        expect(SINGLE_SIDED_REFUSAL).toMatch(/single-sided/);
        expect(SINGLE_SIDED_REFUSAL).toMatch(/opponent's hand/);
    });

    test('anything else is refused with a hint', () => {
        expect(parseForgeRecording('not json')).toMatchObject({ ok: false, error: expect.stringMatching(/not JSON/) });
        expect(parseForgeRecording('{"type":"data","nodes":[{"type":"data","data":[{"matches":1},2]}]}')).toMatchObject({ ok: false, error: expect.stringMatching(/no game/) });
        expect(parseForgeRecording('{"hello":1}')).toMatchObject({ ok: false, error: expect.stringMatching(/not a SWU Forge replay/) });
    });

    test('the "both sides" endpoint JSON is a recording too', () => {
        const page = JSON.parse(pageExport('bob'));
        const data = readSvelteKitData(page)[1] as { game: { rawEvents: unknown } };
        const res = parseForgeRecording(JSON.stringify({ oppPlayerId: 'x', alignment: {}, timeline: data.game.rawEvents, cardCatalog: {} }));
        expect(res).toMatchObject({ ok: true, recording: { source: 'oppositeEndpoint', gameId: GAME_ID } });
    });

    test('pairing refuses the same seat twice and different games', () => {
        const a = parseForgeRecording(pageExport('alice'));
        const a2 = parseForgeRecording(pageExport('alice'));
        const other = parseForgeRecording(pageExport('bob', { gameId: 'another-game' }));
        if (!a.ok || !a2.ok || !other.ok) {
            throw new Error('fixture');
        }
        expect(pairRecordings(a.recording, a2.recording)).toMatchObject({ ok: false, error: expect.stringMatching(/same player/) });
        expect(pairRecordings(a.recording, other.recording)).toMatchObject({ ok: false, error: expect.stringMatching(/different games/) });
    });
});

test.describe('moments', () => {
    test('the two recordings join, and only between-action moments can be picked up', () => {
        const game = syntheticGame();
        expect(game.alignment).toMatchObject({ mode: 'exact', matchedRuns: 4 });
        expect(game.seats.p1).toMatchObject({ name: 'Alice', leaderCardId: 'TST_001', startingDeckCount: 10 });
        expect(game.seats.p2).toMatchObject({ name: 'Bob', leaderCardId: 'TST_002' });
        expect(game.moments.map((m) => [m.label, m.clean])).toEqual([
            ['Setup', false],
            ['Round 1 · action 1 · P1 to act', true],
            ['Round 1 · action 2 · P1 to act', true],
            ['Round 1 · action phase · P2 to act', false],
        ]);
        expect(game.moments[3].why).toBe('Mid-prompt: P2 is deciding "Walker: Choose a unit to attack"');
        // log lines use seat labels, never handles
        expect(game.moments[2].log).toEqual(['P1 uses Walker to apply a lasting effect to P1 for this phase', 'P2 passes']);
        // a mid-prompt frame snaps to the nearest clean moment
        const at = momentForFrame(game, 3)!;
        expect(at.clean).toBe(false);
        expect(nearestCleanMoment(game, at.index)!.key).toBe('2-2');
    });
});

test.describe('pick up from here', () => {
    test('builds every zone of both seats', () => {
        const game = syntheticGame();
        const res = buildPickUp(game, game.moments[2], cards, { decks: decks(), requireDecks: true });
        if (!res.ok) {
            throw new Error(res.error);
        }
        const p1 = res.text.slice(res.text.indexOf('[P1]'), res.text.indexOf('[P2]')).trim().split('\n');
        expect(p1).toEqual([
            '[P1]',
            'leader: Alpha Leader [deployed, damage 1]',
            '  + Rifle',
            'base: Alpha Base [damage 3]',
            '  + Bunker',
            'ground: Walker [damage 2, exhausted]',
            '  + Shield',
            '  captured: Trooper',
            'ground: Spy',
            'space: Fighter [exhausted, owner P2]',
            'resource: Trooper [exhausted]',
            'resource: Strike',
            'hand: Trooper',
            'hand: Rifle',
            'deck: Walker',
            'discard: Trooper',
            'discard: Strike',
            'force: yes',
        ]);
        const p2 = res.text.slice(res.text.indexOf('[P2]')).trim().split('\n');
        expect(p2.filter((l) => !l.startsWith('deck:'))).toEqual([
            '[P2]',
            'leader: Beta Leader [exhausted]',
            'base: Beta Base',
            'ground: Trooper [damage 1]',
            '  + Experience',
            'resource: Fighter [exhausted]',
            'resource: Strike [exhausted]',
            'resource: Strike',
            'hand: Walker',
            'hand: Fighter',
            'credits: 2',
        ]);
        expect(res.text).toMatch(/^# Alpha Leader vs Beta Leader · Round 1 · action 2 · P1 to act\nphase: action\ninitiative: P2\nactive: P1\n/);
        // the client's own codec reads it back
        expect(decodePositionText(res.text).errors).toEqual([]);
        expect(res.warnings).toEqual([expect.stringMatching(/P1 space: Fighter.*treated as P2's card/)]);
    });

    test('decks are the decklist minus everything accounted for, checked against the replay\'s deck count', () => {
        const game = syntheticGame();
        const res = buildPickUp(game, game.moments[2], cards, { decks: decks(), requireDecks: true });
        if (!res.ok) {
            throw new Error(res.error);
        }
        expect(res.decks.p1).toMatchObject({ decklistSize: 10, accounted: 9, deck: ['walker'], replayDeckCount: 1, matches: true, message: null });
        expect(res.decks.p2).toMatchObject({ decklistSize: 10, accounted: 8, replayDeckCount: 2, matches: true });
        expect([...res.decks.p2!.deck].sort()).toEqual(['strike', 'walker']);
    });

    test('a decklist that doesn\'t fit warns and lists the cards involved', () => {
        const game = syntheticGame();
        const short = parseDecklist(JSON.stringify({ leader: { id: 'TST_001' }, base: { id: 'TST_010' }, deck: [{ id: 'TST_020', count: 3 }, { id: 'TST_021', count: 4 }, { id: 'TST_040', count: 2 }] }), cards);
        if (!short.ok) {
            throw new Error(short.error);
        }
        const res = buildPickUp(game, game.moments[2], cards, { decks: { ...decks(), p1: short.deck }, requireDecks: true });
        if (!res.ok) {
            throw new Error(res.error);
        }
        expect(res.decks.p1).toMatchObject({ matches: false, replayDeckCount: 1 });
        expect(res.decks.p1!.beyondList).toEqual(expect.arrayContaining([{ name: 'Rifle', count: 2 }, { name: 'Bunker', count: 1 }]));
        expect(res.decks.p1!.deck).toEqual(['walker', 'walker', 'walker']);
        expect(res.warnings.join('\n')).toMatch(/P1: the remainder is 3 card\(s\) but the replay's deck has 1; on the board but not .* in the decklist: .*Rifle ×2/);
    });

    test('deck order is seeded: stable for a seed, different for another', () => {
        const items = Array.from({ length: 30 }, (_, i) => `c${i}`);
        expect(seededShuffle(items, 's1')).toEqual(seededShuffle(items, 's1'));
        expect(seededShuffle(items, 's1')).not.toEqual(seededShuffle(items, 's2'));
        expect([...seededShuffle(items, 's1')].sort()).toEqual([...items].sort());
    });

    test('lists what the position format can\'t hold', () => {
        const game = syntheticGame();
        const res = buildPickUp(game, game.moments[2], cards, { decks: decks(), requireDecks: true });
        if (!res.ok) {
            throw new Error(res.error);
        }
        expect(res.approximations).toEqual([
            expect.stringMatching(/^Deck order was never recorded/),
            'Round 1: the sandbox has no round counter.',
            expect.stringMatching(/^P2 passed just before this/),
            expect.stringMatching(/^Lasting effects from earlier this phase are not carried over: "P1 uses Walker to apply a lasting effect/),
            expect.stringMatching(/isn't remembered by abilities that look back at "this phase"/),
        ]);
    });

    test('refuses without both decklists, and refuses mid-prompt moments', () => {
        const game = syntheticGame();
        expect(buildPickUp(game, game.moments[2], cards, { decks: { p1: decks().p1 }, requireDecks: true }))
            .toMatchObject({ ok: false, error: expect.stringMatching(/Paste P2's decklist first/) });
        const preview = buildPickUp(game, game.moments[2], cards, { decks: {} });
        expect(preview.ok && preview.position.p1.deck).toEqual([]);
        expect(buildPickUp(game, game.moments[3], cards, { decks: decks() })).toMatchObject({ ok: false, error: expect.stringMatching(/Mid-prompt/) });
    });
});

test.describe('decklists', () => {
    test('SWU Forge / SWUDB deck JSON, reprint codes included', () => {
        const res = parseDecklist(JSON.stringify({ metadata: { name: 'D', swuforgeDeckId: 'x' }, leader: { id: 'TST_001', count: 1 }, base: { id: 'TST_010', count: 1 }, deck: [{ id: 'TST_120', count: 2 }, { id: 'tst-21', count: 1 }] }), cards);
        expect(res).toMatchObject({ ok: true, deck: { source: 'swuforge', name: 'D', leader: 'alpha-leader', base: 'alpha-base', cards: { trooper: 2, walker: 1 }, size: 3 } });
        expect(parseDecklist(JSON.stringify({ deck: [{ id: 'NOPE_999', count: 1 }] }), cards)).toMatchObject({ ok: false, error: expect.stringMatching(/NOPE_999/) });
        expect(parseDecklist('[1,2]', cards)).toMatchObject({ ok: false });
        expect(normalizeSetCode('sor-10')).toBe('SOR_010');
        expect(normalizeSetCode('HMW_14')).toBe('HMW_014');
        expect(normalizeSetCode('LAW_T001')).toBe('LAW_T001');
        expect(normalizeSetCode('SOR010')).toBeNull();
    });
});

test.describe('reprints', () => {
    // regression: the engine's set-code map points at card ids (FFG ids), not internalNames, so reprints never
    // resolved and a decklist naming a reprinted base or leader (e.g. a JTL printing of an HMW base) lost it
    test('a reprint code resolves through the set-code map (set code -> card id) in decklists and replays', () => {
        expect(cards.bySetCode('TST_120')?.internalName).toBe('trooper');
        expect(cards.bySetCode('tst-210')?.internalName).toBe('alpha-base');
        // a map that names internalNames directly still works
        expect(replayCardsFrom(testIndex(), { TST_121: 'walker' }).bySetCode('TST_121')?.internalName).toBe('walker');

        const res = parseDecklist(JSON.stringify({ leader: { id: 'TST_201' }, base: { id: 'TST_210' }, deck: [{ id: 'TST_120', count: 3 }, { id: 'TST_21', count: 2 }] }), cards);
        expect(res).toMatchObject({ ok: true, deck: { leader: 'alpha-leader', base: 'alpha-base', cards: { trooper: 3, walker: 2 }, size: 5 }, warnings: [] });
    });

    test('a decklist whose leader or base can\'t be resolved says so', () => {
        const res = parseDecklist(JSON.stringify({ leader: { id: 'NOPE_001' }, base: { id: 'NOPE_002' }, deck: [{ id: 'TST_020', count: 1 }] }), cards);
        expect(res).toMatchObject({ ok: true, deck: { leader: null, base: null } });
        expect(res.ok && res.warnings).toEqual([expect.stringMatching(/leader NOPE_001 and base NOPE_002 are not in the sandbox's card data/)]);
    });

    test('a decklist with another base (or leader) than the one played warns', () => {
        const game = syntheticGame();
        const other = parseDecklist(ALICE_DECK.replace('"TST_010"', '"TST_011"'), cards);
        if (!other.ok) {
            throw new Error(other.error);
        }
        const res = buildPickUp(game, game.moments[2], cards, { decks: { ...decks(), p1: other.deck }, requireDecks: true });
        expect(res.ok && res.warnings).toContain('P1\'s decklist base is Beta Base, but Alpha Base was played: is it the right deck?');
    });

    test('a replay that shows a reprint printing rebuilds the deck from a list with the primary printing', () => {
        // Alice's recording shows her resource Trooper as the TST_120 printing; her decklist names TST_020
        const game = syntheticGame();
        const alice = game.a.frames[game.moments[2].a.last].gamestate.players[game.seats.p1.playerId];
        const res0 = buildPickUp(game, game.moments[2], cards, { decks: decks(), requireDecks: true });
        const reprinted = alice.cardPiles.resources.find((x) => x.cardId === 'TST_020');
        expect(reprinted).toBeTruthy();
        reprinted!.cardId = 'TST_120';
        const res = buildPickUp(game, game.moments[2], cards, { decks: decks(), requireDecks: true });
        if (!res.ok || !res0.ok) {
            throw new Error('pick-up');
        }
        expect(res.warnings).toEqual(res0.warnings);
        expect(res.decks.p1).toMatchObject({ matches: true, deck: res0.decks.p1!.deck });
        expect(res.text).toBe(res0.text);
    });
});

test.describe('real exports (local only)', () => {
    test('single-sided replays are refused', () => {
        for (const name of ['tarkin-5adf3f43.json', 'memorial-55123051.json']) {
            test.skip(!hasRealReplay(name), 'real replay exports not present');
            expect(parseForgeRecording(readRealReplay(name))).toEqual({ ok: false, error: SINGLE_SIDED_REFUSAL });
        }
    });

    test('Verdant pair: every pick-up-able moment rebuilds both decks to the replay\'s exact count', () => {
        test.skip(!hasRealReplay(...VERDANT), 'real replay exports not present');
        const game = loadVerdantGame();
        const index = realIndex();
        const realCards = replayCardsFrom(index.index, index.setCodes);
        const lists = syntheticDecklists(game);
        const d1 = parseDecklist(lists.p1, realCards);
        const d2 = parseDecklist(lists.p2, realCards);
        if (!d1.ok || !d2.ok) {
            throw new Error('decks');
        }
        expect(game.alignment).toMatchObject({ mode: 'lcs', matchedRuns: 70, runsA: 71, runsB: 71 });
        const clean = game.moments.filter((m) => m.clean);
        expect(clean.length).toBe(48);
        for (const m of clean) {
            const res = buildPickUp(game, m, realCards, { decks: { p1: d1.deck, p2: d2.deck }, requireDecks: true });
            if (!res.ok) {
                throw new Error(`${m.label}: ${res.error}`);
            }
            expect(res.decks.p1!.matches, `${m.label} P1`).toBe(true);
            expect(res.decks.p2!.matches, `${m.label} P2`).toBe(true);
            expect(decodePositionText(res.text).errors, m.label).toEqual([]);
        }
        // round 4, after the undo: two Verdant Fortresses on Aldhani Garrison, rebuilt from the log
        const r4 = game.moments.find((m) => m.label === 'Round 4 · action 11 · P1 to act')!;
        const res = buildPickUp(game, r4, realCards, { decks: { p1: d1.deck, p2: d2.deck }, requireDecks: true });
        if (!res.ok) {
            throw new Error(res.error);
        }
        expect(res.text).toContain('base: Aldhani Garrison [damage 1]\n  + Verdant Fortress\n  + Verdant Fortress\n');
        expect(res.text).toContain('leader: Wicket, Few Greater Battles to Fight [deployed, exhausted]');
        expect(res.approximations.join('\n')).toMatch(/fortifications .* were rebuilt from the action log/);
        expect(res.decks.p1).toMatchObject({ deck: expect.any(Array), replayDeckCount: 34, matches: true });
    });
});

/** the real card index + set-code map the dev server serves (generated assets) */
const realIndex = () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    const root = `${__dirname}/../../public/sandbox`;
    const all = JSON.parse(fs.readFileSync(`${root}/card-index.json`, 'utf8')).cards;
    const by = new Map(all.map((c: { internalName: string }) => [c.internalName, c]));
    const setCodes = fs.existsSync(`${root}/engine/set-codes.json`) ? JSON.parse(fs.readFileSync(`${root}/engine/set-codes.json`, 'utf8')) : null;
    return { index: { all, get: (n: string) => by.get(n) as never }, setCodes };
};
