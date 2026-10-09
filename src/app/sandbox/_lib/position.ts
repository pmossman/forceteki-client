/**
 * The board editor's model, and conversion to/from the engine's position object (POSITION-FORMAT.md §2).
 *
 * The editor model differs from the engine's `IPosition` only where editing needs it:
 * - every card carries an editor-local `uid` (selection, drag and drop);
 * - cards are referenced by engine internalName (stable while names get canonicalised);
 * - plain filler resources and deck cards (Underworld Thug) are counts, so "7 resources" is one stepper.
 */
import { IEnginePosition, IPlayerPosition, IUnitEntry, Seat } from '../_engine/SandboxEngine';
import { CardIndex } from './cardIndex';

/** The engine's own filler card (DeckBuilder.deckFillerCard). */
export const FILLER_CARD = 'underworld-thug';

export interface IPosCard {
    uid: string;

    /** engine internalName */
    card: string;
    damage?: number;
    exhausted?: boolean;

    /** upgrades, including token upgrades (shield, experience) */
    upgrades?: IPosCard[];

    /** captured cards (kept through round trips; not editable in the UI yet) */
    captured?: IPosCard[];

    /** owner when it differs from the default (a stolen unit, an opponent-owned upgrade) */
    owner?: Seat;

    /** leader only */
    deployed?: boolean;
    epicActionUsed?: boolean;
    flipped?: boolean;
}

export type PileZone = 'hand' | 'ground' | 'space' | 'resources' | 'discard' | 'deck';
export const PILE_ZONES: PileZone[] = ['hand', 'ground', 'space', 'resources', 'discard', 'deck'];
export type SlotZone = 'leader' | 'base';
export type EditorZone = PileZone | SlotZone;

export const ZONE_LABELS: Record<EditorZone, string> = {
    leader: 'Leader',
    base: 'Base',
    hand: 'Hand',
    ground: 'Ground arena',
    space: 'Space arena',
    resources: 'Resources',
    discard: 'Discard',
    deck: 'Deck (top first)',
};

export interface IPosPlayer {
    leader: IPosCard | null;
    base: IPosCard | null;
    hand: IPosCard[];
    ground: IPosCard[];
    space: IPosCard[];

    /** named resource cards (Plot / Smuggle cards must be named) */
    resources: IPosCard[];

    /** unnamed filler resources */
    fillerResources: { ready: number; exhausted: number };
    discard: IPosCard[];

    /** named deck cards, top first */
    deck: IPosCard[];

    /** filler cards under the named deck cards */
    fillerDeck: number;
    force?: boolean;
    credits?: number;
}

export interface IPosition {
    title?: string;
    phase: 'action' | 'regroup';
    initiative: Seat;
    active?: Seat;
    p1: IPosPlayer;
    p2: IPosPlayer;
}

let uidCounter = 0;
export const newUid = () => `c${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

export const makeCard = (card: string, props: Partial<Omit<IPosCard, 'uid' | 'card'>> = {}): IPosCard => ({ uid: newUid(), card, ...props });

export const emptyPlayer = (): IPosPlayer => ({
    leader: null,
    base: null,
    hand: [],
    ground: [],
    space: [],
    resources: [],
    fillerResources: { ready: 0, exhausted: 0 },
    discard: [],
    deck: [],
    fillerDeck: 8,
});

export const emptyPosition = (): IPosition => ({
    phase: 'action',
    initiative: 'p1',
    p1: emptyPlayer(),
    p2: emptyPlayer(),
});

export const resourceCount = (p: IPosPlayer) => p.resources.length + p.fillerResources.ready + p.fillerResources.exhausted;

// ---------------- editor model -> engine position ----------------

const nameOf = (index: CardIndex, internalName: string) => index.get(internalName)?.name ?? internalName;

const upgradesOut = (index: CardIndex, c: IPosCard) =>
    (c.upgrades?.length ? { upgrades: c.upgrades.map((u) => ({ card: nameOf(index, u.card), ...(u.owner ? { owner: u.owner } : {}) })) } : {});

const capturedOut = (index: CardIndex, c: IPosCard) =>
    (c.captured?.length ? { captured: c.captured.map((u) => ({ card: nameOf(index, u.card), ...(u.owner ? { owner: u.owner } : {}) })) } : {});

const unitOut = (index: CardIndex, c: IPosCard): IUnitEntry => ({
    card: nameOf(index, c.card),
    ...(c.damage ? { damage: c.damage } : {}),
    ...(c.exhausted ? { exhausted: true } : {}),
    ...(c.owner ? { owner: c.owner } : {}),
    ...upgradesOut(index, c),
    ...capturedOut(index, c),
});

const playerOut = (index: CardIndex, p: IPosPlayer): IPlayerPosition => {
    const filler = nameOf(index, FILLER_CARD);
    return {
        ...(p.leader ? {
            leader: {
                card: nameOf(index, p.leader.card),
                ...(p.leader.deployed ? { deployed: true } : {}),
                ...(p.leader.exhausted ? { exhausted: true } : {}),
                ...(p.leader.damage ? { damage: p.leader.damage } : {}),
                ...(p.leader.epicActionUsed && !p.leader.deployed ? { epicActionUsed: true } : {}),
                ...(p.leader.flipped ? { flipped: true } : {}),
                ...upgradesOut(index, p.leader),
                ...capturedOut(index, p.leader),
            },
        } : {}),
        ...(p.base ? { base: { card: nameOf(index, p.base.card), ...(p.base.damage ? { damage: p.base.damage } : {}), ...upgradesOut(index, p.base), ...capturedOut(index, p.base) } } : {}),
        ground: p.ground.map((c) => unitOut(index, c)),
        space: p.space.map((c) => unitOut(index, c)),
        resources: [
            ...p.resources.map((r) => ({ card: nameOf(index, r.card), ...(r.exhausted ? { exhausted: true } : {}) })),
            ...Array.from({ length: p.fillerResources.ready }, () => ({ card: filler })),
            ...Array.from({ length: p.fillerResources.exhausted }, () => ({ card: filler, exhausted: true })),
        ],
        hand: p.hand.map((c) => ({ card: nameOf(index, c.card) })),
        deck: [...p.deck.map((c) => ({ card: nameOf(index, c.card) })), ...Array.from({ length: p.fillerDeck }, () => ({ card: filler }))],
        discard: p.discard.map((c) => ({ card: nameOf(index, c.card) })),
        ...(p.credits ? { credits: p.credits } : {}),
        ...(p.force ? { force: true } : {}),
    };
};

export const toEnginePosition = (pos: IPosition, index: CardIndex): IEnginePosition => ({
    version: 1,
    ...(pos.title ? { title: pos.title } : {}),
    phase: pos.phase,
    initiative: pos.initiative,
    ...(pos.active && pos.active !== pos.initiative ? { active: pos.active } : {}),
    p1: playerOut(index, pos.p1),
    p2: playerOut(index, pos.p2),
});

// ---------------- engine position -> editor model ----------------

export interface IResolveIssue { path: string; message: string }

const cardIn = (index: CardIndex, name: string, path: string, issues: IResolveIssue[]): string => {
    const card = index.resolve(name);
    if (!card) {
        issues.push({ path, message: `Unknown card "${name}"` });
        return name;
    }
    return card.internalName;
};

const playerIn = (index: CardIndex, d: IPlayerPosition | undefined, seat: Seat, issues: IResolveIssue[]): IPosPlayer => {
    const p = emptyPlayer();
    p.fillerDeck = 0;
    if (!d) {
        return p;
    }
    const sub = (list: { card: string; owner?: Seat }[] | undefined, path: string) =>
        (list?.length ? list.map((u, i) => makeCard(cardIn(index, u.card, `${path}[${i}].card`, issues), u.owner ? { owner: u.owner } : {})) : undefined);
    const unit = (u: IUnitEntry, path: string): IPosCard => {
        const c = makeCard(cardIn(index, u.card, `${path}.card`, issues));
        if (u.damage) {
            c.damage = u.damage;
        }
        if (u.exhausted) {
            c.exhausted = true;
        }
        if (u.owner) {
            c.owner = u.owner;
        }
        const ups = sub(u.upgrades, `${path}.upgrades`);
        if (ups) {
            c.upgrades = ups;
        }
        const cap = sub(u.captured, `${path}.captured`);
        if (cap) {
            c.captured = cap;
        }
        return c;
    };
    if (d.leader) {
        const l = d.leader;
        p.leader = unit({ card: l.card, damage: l.damage, exhausted: l.exhausted, upgrades: l.upgrades, captured: l.captured }, `${seat}.leader`);
        if (l.deployed) {
            p.leader.deployed = true;
        }
        if (l.epicActionUsed) {
            p.leader.epicActionUsed = true;
        }
        if (l.flipped) {
            p.leader.flipped = true;
        }
    }
    if (d.base) {
        p.base = unit({ card: d.base.card, damage: d.base.damage, upgrades: d.base.upgrades, captured: d.base.captured }, `${seat}.base`);
    }
    p.ground = (d.ground ?? []).map((u, i) => unit(u, `${seat}.ground[${i}]`));
    p.space = (d.space ?? []).map((u, i) => unit(u, `${seat}.space[${i}]`));
    (d.resources ?? []).forEach((r, i) => {
        const internal = cardIn(index, r.card, `${seat}.resources[${i}].card`, issues);
        if (internal === FILLER_CARD) {
            if (r.exhausted) {
                p.fillerResources.exhausted++;
            } else {
                p.fillerResources.ready++;
            }
        } else {
            p.resources.push(makeCard(internal, r.exhausted ? { exhausted: true } : {}));
        }
    });
    p.hand = (d.hand ?? []).map((c, i) => makeCard(cardIn(index, c.card, `${seat}.hand[${i}].card`, issues)));
    p.discard = (d.discard ?? []).map((c, i) => makeCard(cardIn(index, c.card, `${seat}.discard[${i}].card`, issues)));
    const deck = (d.deck ?? []).map((c, i) => cardIn(index, c.card, `${seat}.deck[${i}].card`, issues));
    let end = deck.length;
    while (end > 0 && deck[end - 1] === FILLER_CARD) {
        end--;
    }
    p.deck = deck.slice(0, end).map((n) => makeCard(n));
    p.fillerDeck = deck.length - end;
    if (d.credits) {
        p.credits = d.credits;
    }
    if (d.force) {
        p.force = true;
    }
    return p;
};

export const fromEnginePosition = (pos: IEnginePosition, index: CardIndex): { position: IPosition; issues: IResolveIssue[] } => {
    const issues: IResolveIssue[] = [];
    const position: IPosition = {
        ...(pos.title ? { title: pos.title } : {}),
        phase: pos.phase === 'regroup' ? 'regroup' : 'action',
        initiative: pos.initiative === 'p2' ? 'p2' : 'p1',
        ...(pos.active ? { active: pos.active } : {}),
        p1: playerIn(index, pos.p1, 'p1', issues),
        p2: playerIn(index, pos.p2, 'p2', issues),
    };
    return { position, issues };
};
