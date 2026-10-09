/**
 * A small, fully synthetic double-sided SWU Forge replay for unit tests: two seats' `__data.json` exports of one
 * made-up game, built the way SWU Forge stores them (normalized base gamestate + structural patches, devalue-
 * flattened page data). Players, ids and cards are invented ('Alice' / 'Bob', TST set codes), so it is safe to
 * commit. It covers what the importer must read: hidden opponent hands, a deployed leader with an upgrade, a
 * base fortification, a captured card, a stolen unit, tokens, credits, the Force, a mid-prompt frame.
 */
import type { ISandboxCard } from '../../../src/app/sandbox/_lib/cardIndex';
import type { NormalizedCard, NormalizedGamestate, NormalizedPlayer, PersistedTimeline } from '../../../src/app/sandbox/_lib/replay/forgeTimeline';

// ---------------- a tiny card index ----------------

/** an invented FFG-style card id (the engine's set-code map points at these, not at internalNames) */
export const testCardId = (code: string) => String(5550000000 + Number(code.split('_')[1]));

const c = (code: string, internalName: string, title: string, types: string[], extra: Partial<ISandboxCard> = {}): ISandboxCard => {
    const [set, num] = code.split('_');
    return { internalName, name: title, title, types, setId: { set, number: Number(num) }, setCode: code, id: testCardId(code), ...extra };
};

export const TEST_CARDS: ISandboxCard[] = [
    c('TST_001', 'alpha-leader', 'Alpha Leader', ['leader'], { hp: 6, isLeader: true }),
    c('TST_002', 'beta-leader', 'Beta Leader', ['leader'], { hp: 6, isLeader: true }),
    c('TST_010', 'alpha-base', 'Alpha Base', ['base'], { hp: 25 }),
    c('TST_011', 'beta-base', 'Beta Base', ['base'], { hp: 25 }),
    c('TST_020', 'trooper', 'Trooper', ['unit'], { hp: 3, arena: 'ground' }),
    c('TST_021', 'walker', 'Walker', ['unit'], { hp: 6, arena: 'ground' }),
    c('TST_022', 'fighter', 'Fighter', ['unit'], { hp: 2, arena: 'space' }),
    c('TST_030', 'rifle', 'Rifle', ['upgrade'], { upgradeHp: 1 }),
    c('TST_031', 'bunker', 'Bunker', ['upgrade']),
    c('TST_040', 'strike', 'Strike', ['event']),
    { internalName: 'shield', name: 'Shield', title: 'Shield', types: ['token', 'upgrade'], setId: { set: 'TST' }, id: 'T1', isToken: true },
    { internalName: 'experience', name: 'Experience', title: 'Experience', types: ['token', 'upgrade'], setId: { set: 'TST' }, id: 'T2', isToken: true, upgradeHp: 1 },
    { internalName: 'spy', name: 'Spy', title: 'Spy', types: ['token', 'unit'], setId: { set: 'TST' }, id: 'T3', isToken: true, hp: 2 },
];

export const testIndex = () => {
    const by = new Map(TEST_CARDS.map((x) => [x.internalName, x]));
    return { all: TEST_CARDS, get: (n: string) => by.get(n) };
};

/**
 * Reprint codes as the engine's set-code map (forceteki test/json/_setCodeMap.json) lists them: set code -> card id
 * (FFG id). TST_120 reprints Trooper, TST_210 reprints Alpha Base, TST_201 reprints Alpha Leader.
 */
export const TEST_SET_CODE_MAP = { TST_120: testCardId('TST_020'), TST_210: testCardId('TST_010'), TST_201: testCardId('TST_001') };

export const deckJson = (leader: string, base: string, cards: [string, number][]) =>
    JSON.stringify({ metadata: { name: 'test', author: 'test' }, leader: { id: leader, count: 1 }, base: { id: base, count: 1 }, deck: cards.map(([id, count]) => ({ id, count })), sideboard: [] });

/** Alice: 10 cards. At the main moment her deck holds one Walker. */
export const ALICE_DECK = deckJson('TST_001', 'TST_010', [['TST_020', 3], ['TST_021', 2], ['TST_030', 2], ['TST_031', 1], ['TST_040', 2]]);

/** Bob: 10 cards. At the main moment his deck holds a Strike and a Walker; one of his Fighters is Alice's. */
export const BOB_DECK = deckJson('TST_002', 'TST_011', [['TST_020', 2], ['TST_022', 3], ['TST_040', 3], ['TST_021', 2]]);

// ---------------- gamestates ----------------

export const ALICE = 'pid-alice-0000';
export const BOB = 'pid-bob-1111';
export const GAME_ID = 'game-synthetic-0001';

let uuidSeq = 0;
const card = (cardId: string | null, o: Partial<NormalizedCard> = {}): NormalizedCard => ({
    uuid: `Card_${++uuidSeq}`, cardId, karabastId: cardId ? `k-${cardId}` : null, name: null, type: 'basicUnit', printedType: 'basicUnit',
    power: null, hp: null, damage: 0, exhausted: false, isHidden: false, sentinel: false, epicDeployActionSpent: false, epicActionSpent: false,
    parentCardId: null, ...o,
});
const token = (name: string, o: Partial<NormalizedCard> = {}) => card(null, { name, type: o.type ?? 'tokenUpgrade', ...o });
const hide = (cards: NormalizedCard[]) => cards.map((x) => ({ ...x, uuid: null, cardId: null, karabastId: null, name: null, type: null, printedType: null, isHidden: true }));

interface ISeatSetup {
    leader: NormalizedCard;
    base: NormalizedCard;
    hand: NormalizedCard[];
    resources: NormalizedCard[];
    ground: NormalizedCard[];
    space: NormalizedCard[];
    discard: NormalizedCard[];
    captured: NormalizedCard[];
    deck: number;
    hasInitiative: boolean;
    active: boolean | null;
    credits?: number;
}

const player = (id: string, name: string, s: ISeatSetup, prompt: object): NormalizedPlayer => ({
    id, name, hasInitiative: s.hasInitiative, availableResources: s.resources.filter((r) => !r.exhausted).length, numCardsInDeck: s.deck,
    aspects: [], isActionPhaseActivePlayer: s.active, disconnected: false, leader: s.leader, secondLeader: null, base: s.base,
    cardPiles: { hand: s.hand, resources: s.resources, groundArena: s.ground, spaceArena: s.space, discard: s.discard, outsideTheGame: [token('The Force', { type: 'tokenCard' })], capturedZone: s.captured },
    promptState: prompt, ...(s.credits != null ? { credits: s.credits } : {}),
});

const actionWindow = { menuTitle: 'Choose an action', promptTitle: 'Action Window', promptType: 'actionWindow', buttons: [{ text: 'Pass', arg: 'pass', command: 'menuButton' }] };
const waiting = { menuTitle: 'Waiting for opponent to take an action or pass', promptTitle: 'Action Window', buttons: [] };
const choosing = { menuTitle: 'Choose a unit to attack', promptTitle: 'Walker', promptType: 'select', buttons: [] };

interface IWorld { phase: string; alice: ISeatSetup; bob: ISeatSetup; alicePrompt: object; bobPrompt: object }

/** The frames of the game (both seats' truth); each recording hides the other seat's hand and resources. */
const buildWorld = (): IWorld[] => {
    uuidSeq = 0;
    const aliceLeader = card('TST_001', { type: 'leader', printedType: 'leader' });
    const bobLeader = card('TST_002', { type: 'leader', printedType: 'leader' });
    const aliceBase = card('TST_010', { type: 'base', printedType: 'base', upgrades: [] });
    const bobBase = card('TST_011', { type: 'base', printedType: 'base', upgrades: [] });
    const empty = (leader: NormalizedCard, base: NormalizedCard, deck: number, hasInitiative: boolean): ISeatSetup =>
        ({ leader, base, hand: [], resources: [], ground: [], space: [], discard: [], captured: [], deck, hasInitiative, active: null });

    const setup: IWorld = { phase: 'setup', alice: empty(aliceLeader, aliceBase, 10, false), bob: empty(bobLeader, bobBase, 10, true), alicePrompt: waiting, bobPrompt: {} };

    // the main moment: round 1, Alice to act
    const walker = card('TST_021', { damage: 2, exhausted: true });
    const leaderUnit = { ...aliceLeader, type: 'nonTokenLeaderUnit', epicDeployActionSpent: true, damage: 1 };
    const stolenFighter = card('TST_022', { exhausted: true });
    const bobTrooper = card('TST_020', { damage: 1 });
    const alice: ISeatSetup = {
        leader: leaderUnit,
        base: { ...aliceBase, damage: 3, upgrades: [card('TST_031', { type: 'basicUpgrade', parentCardId: aliceBase.uuid })] },
        hand: [card('TST_020'), card('TST_030', { type: 'basicUpgrade' })],
        resources: [card('TST_020', { exhausted: true }), card('TST_040', { type: 'event' })],
        ground: [walker, token('Shield', { parentCardId: walker.uuid }), leaderUnit, card('TST_030', { type: 'basicUpgrade', parentCardId: leaderUnit.uuid }), token('Spy', { type: 'tokenUnit' })],
        space: [stolenFighter],
        // karabast lists the discard oldest first
        discard: [card('TST_040', { type: 'event' }), card('TST_020')],
        captured: [card('TST_020', { parentCardId: walker.uuid })],
        deck: 1,
        hasInitiative: false,
        active: true,
    };
    const bob: ISeatSetup = {
        leader: { ...bobLeader, exhausted: true },
        base: bobBase,
        hand: [card('TST_021'), card('TST_022')],
        resources: [card('TST_022', { exhausted: true }), card('TST_040', { type: 'event', exhausted: true }), card('TST_040', { type: 'event' })],
        ground: [bobTrooper, token('Experience', { parentCardId: bobTrooper.uuid })],
        space: [],
        discard: [],
        captured: [],
        deck: 2,
        hasInitiative: true,
        active: false,
        credits: 2,
    };
    const main: IWorld = { phase: 'action', alice, bob, alicePrompt: actionWindow, bobPrompt: waiting };
    // a moment earlier: Bob had just played his Trooper (one more card in his hand)
    const before: IWorld = { ...main, bob: { ...bob, hand: [...bob.hand, card('TST_040', { type: 'event' })], deck: 1 }, alice: { ...alice } };
    // Alice attacks: Bob is mid-prompt choosing (not a moment to pick up)
    const mid: IWorld = { phase: 'action', alice: { ...alice, active: false }, bob: { ...bob, active: true, leader: { ...bob.leader!, damage: 0 } }, alicePrompt: waiting, bobPrompt: choosing };
    mid.alice.ground = alice.ground.map((x) => (x.uuid === walker.uuid ? { ...x, damage: 3 } : x));
    return [setup, before, main, mid];
};

const gamestateFor = (w: IWorld, viewer: 'alice' | 'bob'): NormalizedGamestate => {
    const seen = (who: 'alice' | 'bob', s: ISeatSetup): ISeatSetup => (who === viewer ? s : { ...s, hand: hide(s.hand), resources: hide(s.resources) });
    return {
        gameId: GAME_ID,
        phase: w.phase,
        initiativeClaimed: false,
        winners: [],
        playerUpdate: viewer === 'alice' ? 'Alice' : 'Bob',
        players: {
            [ALICE]: player(ALICE, viewer === 'alice' ? 'Alice' : 'Opponent', seen('alice', w.alice), viewer === 'alice' ? w.alicePrompt : {}),
            [BOB]: player(BOB, viewer === 'bob' ? 'Bob' : 'Opponent', seen('bob', w.bob), viewer === 'bob' ? w.bobPrompt : {}),
        },
    };
};

// Forge's objectDiff (parser/diff.ts): plain objects key by key, everything else replaced
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const objectDiff = (prev: unknown, next: unknown): unknown => {
    if (JSON.stringify(prev) === JSON.stringify(next)) {
        return undefined;
    }
    if (!isObj(prev) || !isObj(next)) {
        return next;
    }
    const out: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
        const d = objectDiff(prev[k], next[k]);
        if (d !== undefined) {
            out[k] = d;
        }
    }
    return Object.keys(out).length ? out : undefined;
};

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);

export const timelineFor = (viewer: 'alice' | 'bob'): PersistedTimeline => {
    const states = buildWorld().map((w) => gamestateFor(w, viewer));
    const me = viewer === 'alice' ? 'Alice' : 'Bob';
    const name = (who: 'alice' | 'bob') => (who === viewer ? me : 'Opponent');
    const player = (who: 'alice' | 'bob') => ({ kind: 'player' as const, name: name(who), uuid: who === 'alice' ? 'Player_1' : 'Player_2' });
    const at = (frame: number) => T0 + frame * 10_000 - 30;
    return {
        v: 5,
        base: states[0],
        baseCapturedAt: new Date(T0).toISOString(),
        baseTimestamp: T0,
        steps: states.slice(1).map((s, i) => ({ capturedAt: new Date(T0 + (i + 1) * 10_000).toISOString(), timestamp: T0 + (i + 1) * 10_000, patch: (objectDiff(states[i], s) as object) ?? null })),
        chat: [
            { ts: at(1), tokens: [{ kind: 'alert', text: 'Round: 1 - Action Phase' }] },
            { ts: at(1), tokens: [player('bob'), ' plays ', { kind: 'card', name: 'Trooper', cardId: 'k-TST_020', setId: { set: 'TST', number: 20 }, controllerId: BOB }] },
            { ts: at(2), tokens: [player('alice'), ' uses ', { kind: 'card', name: 'Walker', cardId: 'k-TST_021', setId: { set: 'TST', number: 21 }, controllerId: ALICE }, ' to apply a lasting effect to ', player('alice'), ' for this phase'] },
            { ts: at(2), tokens: [player('bob'), ' passes'] },
            { ts: at(3), tokens: [player('alice'), ' attacks ', { kind: 'card', name: 'Trooper', cardId: 'k-TST_020', setId: { set: 'TST', number: 20 }, controllerId: BOB }] },
        ],
        credits: [],
        force: [{ ts: at(1), playerName: name('alice'), action: 'gain' }],
        bounces: [],
    };
};

// ---------------- page data (SvelteKit __data.json, devalue-flattened) ----------------

/** devalue `stringify`'s flat form, minus dedupe (enough for plain JSON data) */
export const flatten = (root: unknown): unknown[] => {
    const values: unknown[] = [];
    const add = (v: unknown): number => {
        if (v === undefined) {
            return -1;
        }
        const i = values.length;
        values.push(null);
        if (Array.isArray(v)) {
            values[i] = v.map(add);
        } else if (isObj(v)) {
            const o: Record<string, number> = {};
            for (const [k, x] of Object.entries(v)) {
                o[k] = add(x);
            }
            values[i] = o;
        } else {
            values[i] = v;
        }
        return i;
    };
    add(root);
    return values;
};

export const pageExport = (viewer: 'alice' | 'bob', opts: { doubleSided?: boolean; gameId?: string } = {}) => {
    const timeline = timelineFor(viewer);
    if (opts.gameId) {
        timeline.base.gameId = opts.gameId;
    }
    const page = {
        deckAccess: 'holder',
        deck: { id: 'deck-x', name: `${viewer}'s deck`, href: '/decks/deck-x', versionNumber: 1 },
        opponentLabel: 'Opponent',
        doubleSided: { available: opts.doubleSided ?? true, endpoint: null },
        game: { gameId: GAME_ID, deckVersionId: null, deckVersion: null, rawEvents: timeline, myName: viewer === 'alice' ? 'Alice' : 'Bob' },
        cardCatalog: {},
    };
    return JSON.stringify({ type: 'data', nodes: [{ type: 'data', data: flatten({ session: null }) }, { type: 'data', data: flatten(page) }] });
};
