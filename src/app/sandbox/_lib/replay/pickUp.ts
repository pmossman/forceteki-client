/**
 * "Pick up from here": a sandbox position (POSITION-FORMAT.md) for one moment of a double-sided replay.
 *
 * Every zone comes from the recordings: arenas, bases (damage, fortifications), leaders (deployed, exhausted,
 * epic action used), resources (exhausted), hands (each from its own seat's recording), discards, upgrades,
 * tokens and captured cards. The draw decks are the one thing a replay never shows, so each deck is its
 * decklist minus every card accounted for at that moment, in a seeded random order. Whatever the position
 * format can't hold is listed as an approximation instead of being dropped silently.
 */
import type { IBaseEntry, ICapturedEntry, IEnginePosition, ILeaderEntry, IPlayerPosition, IUnitEntry, IUpgradeEntry, Seat } from '../../_engine/SandboxEngine';
import type { ISandboxCard } from '../cardIndex';
import { encodePositionText } from '../positionText';
import { IDecklist } from './decklist';
import { NormalizedCard, NormalizedPlayer, creditsAfter, forceHolderAfter } from './forgeTimeline';
import { IReplayCards } from './replayCards';
import { IReplayGame, IReplayMoment, seatStates } from './replayGame';

const SEATS: Seat[] = ['p1', 'p2'];
const other = (s: Seat): Seat => (s === 'p1' ? 'p2' : 'p1');
const P = (s: Seat) => s.toUpperCase();

export interface IDeckReport {
    seat: Seat;

    /** main-deck size of the decklist; null without a decklist */
    decklistSize: number | null;

    /** decklist cards accounted for outside the deck at this moment */
    accounted: number;

    /** the remainder in draw order (top first), internalNames */
    deck: string[];

    /** the replay's own count of cards in that deck at this moment */
    replayDeckCount: number;
    matches: boolean;

    /** cards at this moment beyond what the decklist has (name x copies) */
    beyondList: { name: string; count: number }[];
    message: string | null;
}

export interface IPickUpOk {
    ok: true;
    position: IEnginePosition;
    text: string;
    title: string;
    decks: Record<Seat, IDeckReport | null>;
    warnings: string[];
    approximations: string[];
}
export type PickUpResult = IPickUpOk | { ok: false; error: string };

export interface IPickUpOptions {
    decks: Partial<Record<Seat, IDecklist | null>>;

    /** extra seed text: change it to reshuffle the unknown deck order */
    seed?: string;

    /** refuse without both decklists (pick-up); previews may go without and leave the decks empty */
    requireDecks?: boolean;
}

// ---------------- seeded shuffle ----------------

const fnv1a = (s: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
};

const mulberry32 = (seed: number) => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const seededShuffle = <T>(items: T[], seed: string): T[] => {
    const out = [...items];
    const rand = mulberry32(fnv1a(seed));
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
};

// ---------------- the position ----------------

const isTokenCard = (c: NormalizedCard) => /^token/i.test(c.type ?? '') || (!c.cardId && !!c.name && !c.isHidden);
const isLeaderUnit = (c: NormalizedCard | null | undefined) => !!c && /leaderunit/i.test(c.type ?? '');

interface IFlexItem {
    card: ISandboxCard;

    /** who owns it unless the decklists say otherwise */
    defaultOwner: Seat;
    setOwner: (owner: Seat) => void;
    where: string;
}

export const buildPickUp = (game: IReplayGame, moment: IReplayMoment, cards: IReplayCards, options: IPickUpOptions): PickUpResult => {
    if (!moment.clean) {
        return { ok: false, error: `This moment can't be picked up: ${moment.why}` };
    }
    const states = seatStates(game, moment);
    if (!states) {
        return { ok: false, error: 'This moment is missing from one of the recordings.' };
    }
    const missingDecks = SEATS.filter((s) => !options.decks[s]);
    if (options.requireDecks && missingDecks.length) {
        return { ok: false, error: `Paste ${missingDecks.map(P).join(' and ')}'s decklist first: the deck remainder is the decklist minus the cards accounted for.` };
    }

    const warnings: string[] = [];
    const approximations: string[] = [];
    const gs = game.a.frames[moment.a.last].gamestate;
    const uuidSeat = new Map<string, Seat>();
    const unresolved: string[] = [];

    const resolve = (c: NormalizedCard): ISandboxCard | null => {
        const hit = (c.cardId ? cards.bySetCode(c.cardId) : undefined) ?? (isTokenCard(c) && c.name ? cards.token(c.name) : undefined);
        if (!hit) {
            unresolved.push(c.cardId ?? c.name ?? '(unnamed card)');
            return null;
        }
        return hit;
    };

    // ownership bookkeeping: what each seat's decklist has used up
    const used: Record<Seat, Record<string, number>> = { p1: {}, p2: {} };
    const use = (seat: Seat, card: ISandboxCard | null) => {
        if (card && !card.isToken) {
            used[seat][card.internalName] = (used[seat][card.internalName] ?? 0) + 1;
        }
    };
    const flex: IFlexItem[] = [];
    const outside: Record<Seat, string[]> = { p1: [], p2: [] };

    // attachments anywhere in play, keyed by the card they hang on
    const upgradesOn = new Map<string, { c: NormalizedCard; seat: Seat }[]>();
    const capturedBy = new Map<string, { c: NormalizedCard; seat: Seat }[]>();
    for (const seat of SEATS) {
        const piles = states[seat].cardPiles;
        for (const c of [...piles.groundArena, ...piles.spaceArena]) {
            if (c.uuid) {
                uuidSeat.set(c.uuid, seat);
            }
            if (c.parentCardId) {
                upgradesOn.set(c.parentCardId, [...(upgradesOn.get(c.parentCardId) ?? []), { c, seat }]);
            }
        }
        for (const c of piles.capturedZone ?? []) {
            if (c.parentCardId) {
                capturedBy.set(c.parentCardId, [...(capturedBy.get(c.parentCardId) ?? []), { c, seat }]);
            } else {
                approximations.push(`A card captured by ${P(seat)}'s side (${c.cardId ?? c.name}) has no captor in the recording, so it is left out of the board.`);
                use(other(seat), resolve(c));
            }
        }
    }

    const attachmentsOf = (holder: NormalizedCard, holderSeat: Seat, where: string) => {
        const upgrades: IUpgradeEntry[] = [];
        const upgradeCards: ISandboxCard[] = [];
        for (const { c, seat } of upgradesOn.get(holder.uuid ?? '') ?? []) {
            const card = resolve(c);
            if (!card) {
                continue;
            }
            upgradeCards.push(card);
            const entry: IUpgradeEntry = { card: card.name };
            if (seat !== holderSeat) {
                entry.owner = seat;
            }
            upgrades.push(entry);
            if (!card.isToken) {
                flex.push({ card, defaultOwner: seat, where: `${where} (upgrade)`, setOwner: (o) => (o === holderSeat ? delete entry.owner : (entry.owner = o)) });
            }
        }
        const captured: ICapturedEntry[] = [];
        for (const { c } of capturedBy.get(holder.uuid ?? '') ?? []) {
            const card = resolve(c);
            if (!card) {
                continue;
            }
            const entry: ICapturedEntry = { card: card.name };
            captured.push(entry);
            flex.push({ card, defaultOwner: other(holderSeat), where: `${where} (captured)`, setOwner: (o) => (o === other(holderSeat) ? delete entry.owner : (entry.owner = o)) });
        }
        return { upgrades, upgradeCards, captured };
    };

    const named = (card: ISandboxCard) => card.name;

    /** The format refuses damage >= HP (the unit would be defeated at once); an effect kept it alive. */
    const clampDamage = (card: ISandboxCard, damage: number, upgradeCards: ISandboxCard[], who: string): number => {
        const hp = (card.hp ?? 0) + upgradeCards.reduce((sum, u) => sum + (u.upgradeHp ?? 0), 0);
        if (hp > 0 && damage >= hp) {
            approximations.push(`${who} had ${damage} damage with ${hp} printed HP (kept alive by an effect the format can't hold); it gets ${hp - 1} damage.`);
            return hp - 1;
        }
        return damage;
    };

    const players: Record<Seat, IPlayerPosition> = { p1: emptyPlayer(), p2: emptyPlayer() };

    for (const seat of SEATS) {
        const p: NormalizedPlayer = states[seat];
        const out = players[seat];
        const piles = p.cardPiles;
        const leaderUuid = p.leader?.uuid ?? null;

        // leader
        if (p.leader) {
            const card = resolve(p.leader);
            if (card) {
                const inArena = [...piles.groundArena, ...piles.spaceArena].find((c) => c.uuid && c.uuid === leaderUuid);
                const deployed = !!inArena || isLeaderUnit(p.leader);
                const leader: ILeaderEntry = { card: named(card) };
                const src = inArena ?? p.leader;
                if (deployed) {
                    leader.deployed = true;
                    if (inArena?.parentCardId) {
                        approximations.push(`${P(seat)}'s leader ${card.title} is deployed as a pilot; the sandbox deploys it as a unit.`);
                    }
                    const { upgrades, upgradeCards, captured } = attachmentsOf(src, seat, `${P(seat)} leader`);
                    if (upgrades.length) {
                        leader.upgrades = upgrades;
                    }
                    if (captured.length) {
                        leader.captured = captured;
                    }
                    if (src.damage) {
                        leader.damage = clampDamage(card, src.damage, upgradeCards, `${P(seat)}'s ${card.title}`);
                    }
                } else if (p.leader.epicDeployActionSpent || p.leader.epicActionSpent) {
                    leader.epicActionUsed = true;
                }
                if (src.exhausted) {
                    leader.exhausted = true;
                }
                if (p.leader.onStartingSide === false) {
                    leader.flipped = true;
                }
                out.leader = leader;
            }
        }
        if (p.secondLeader) {
            approximations.push(`${P(seat)} has a second leader (Twin Suns); the position format holds one leader, so it is left out.`);
        }

        // base and fortifications
        if (p.base) {
            const card = resolve(p.base);
            if (card) {
                const base: IBaseEntry = { card: named(card) };
                const { upgrades: unitUpgrades, captured } = attachmentsOf(p.base, seat, `${P(seat)} base`);
                const fortifications: IUpgradeEntry[] = [];
                const recovered = p.base.upgrades ? null : game.fortifications[seat]?.[seat === 'p1' ? moment.a.last : moment.b!.last] ?? null;
                if (recovered?.length) {
                    approximations.push(`${P(seat)}'s fortifications (${recovered.map((c) => resolve(c)?.title ?? c.name).join(', ')}) were rebuilt from the action log: this recording predates SWU Forge saving them.`);
                }
                for (const u of p.base.upgrades ?? recovered ?? []) {
                    const uc = resolve(u);
                    if (uc) {
                        fortifications.push({ card: named(uc) });
                        use(seat, uc);
                    }
                }
                const upgrades = [...fortifications, ...unitUpgrades.filter((u) => !fortifications.some((f) => f.card === u.card))];
                if (upgrades.length) {
                    base.upgrades = upgrades;
                }
                if (captured.length) {
                    base.captured = captured;
                }
                if (p.base.damage) {
                    base.damage = p.base.damage >= (card.hp ?? Infinity) ? clampDamage(card, p.base.damage, [], `${P(seat)}'s base`) : p.base.damage;
                }
                out.base = base;
            }
        }

        // units
        for (const [arena, pile] of [['ground', piles.groundArena], ['space', piles.spaceArena]] as const) {
            for (const c of pile) {
                if (c.parentCardId || (leaderUuid && c.uuid === leaderUuid)) {
                    continue;
                }
                const card = resolve(c);
                if (!card) {
                    continue;
                }
                const unit: IUnitEntry = { card: named(card) };
                const { upgrades, upgradeCards, captured } = attachmentsOf(c, seat, `${P(seat)} ${arena}: ${card.title}`);
                if (upgrades.length) {
                    unit.upgrades = upgrades;
                }
                if (captured.length) {
                    unit.captured = captured;
                }
                if (c.damage) {
                    unit.damage = clampDamage(card, c.damage, upgradeCards, `${P(seat)}'s ${card.title}`);
                }
                if (c.exhausted) {
                    unit.exhausted = true;
                }
                out[arena].push(unit);
                if (!card.isToken) {
                    flex.push({ card, defaultOwner: seat, where: `${P(seat)} ${arena}: ${card.title}`, setOwner: (o) => (o === seat ? delete unit.owner : (unit.owner = o)) });
                }
            }
        }

        // hidden zones, from the seat's own recording
        for (const c of piles.resources) {
            const card = resolve(c);
            if (card) {
                out.resources.push(c.exhausted ? { card: named(card), exhausted: true } : { card: named(card) });
                use(seat, card);
            }
        }
        for (const c of piles.hand) {
            const card = resolve(c);
            if (card) {
                out.hand.push({ card: named(card) });
                use(seat, card);
            }
        }

        // discard: karabast lists it oldest first; the format wants the top (most recent) first
        for (const c of [...piles.discard].reverse()) {
            const card = resolve(c);
            if (card) {
                out.discard.push({ card: named(card) });
                use(seat, card);
            }
        }

        // removed from the game (not tokens: the Force token and defeated tokens live there too)
        for (const c of piles.outsideTheGame ?? []) {
            if (isTokenCard(c) || !c.cardId) {
                continue;
            }
            const card = resolve(c);
            if (card) {
                outside[seat].push(card.title);
                use(seat, card);
            }
        }
        if (outside[seat].length) {
            approximations.push(`${P(seat)} has ${outside[seat].length} card(s) outside the game (${outside[seat].join(', ')}); the format has no such zone, so they are left out.`);
        }
    }

    // ownership of cards in play: their controller, unless the decklists say a copy must be the opponent's
    const decks = options.decks;
    for (const item of flex) {
        const d = item.defaultOwner;
        const o = other(d);
        const n = item.card.internalName;
        let owner = d;
        if (decks[d] && decks[o] && (used[d][n] ?? 0) >= (decks[d]!.cards[n] ?? 0) && (used[o][n] ?? 0) < (decks[o]!.cards[n] ?? 0)) {
            owner = o;
            warnings.push(`${item.where}: ${P(d)}'s decklist has no copy left, ${P(o)}'s has; treated as ${P(o)}'s card (taken control of).`);
        }
        used[owner][n] = (used[owner][n] ?? 0) + 1;
        if (owner !== d) {
            item.setOwner(owner);
        }
    }

    if (unresolved.length) {
        warnings.push(`Not in the sandbox's card data, left out: ${[...new Set(unresolved)].join(', ')}`);
    }

    // decks: decklist minus everything accounted for
    const reports: Record<Seat, IDeckReport | null> = { p1: null, p2: null };
    for (const seat of SEATS) {
        const replayDeckCount = states[seat].numCardsInDeck ?? 0;
        const list = decks[seat];
        if (!list) {
            continue;
        }
        const remainder: string[] = [];
        const beyondList: { name: string; count: number }[] = [];
        let accounted = 0;
        for (const [n, copies] of Object.entries(list.cards)) {
            const u = used[seat][n] ?? 0;
            accounted += Math.min(u, copies);
            for (let i = u; i < copies; i++) {
                remainder.push(n);
            }
        }
        for (const [n, u] of Object.entries(used[seat])) {
            const extra = u - (list.cards[n] ?? 0);
            if (extra > 0) {
                beyondList.push({ name: cards.get(n)?.name ?? n, count: extra });
            }
        }
        remainder.sort();
        const deck = seededShuffle(remainder, `${game.gameId}:${moment.key}:${seat}:${options.seed ?? ''}`);
        const matches = deck.length === replayDeckCount && beyondList.length === 0;
        let message: string | null = null;
        if (!matches) {
            const parts: string[] = [];
            if (deck.length !== replayDeckCount) {
                parts.push(`the remainder is ${deck.length} card(s) but the replay's deck has ${replayDeckCount}`);
            }
            if (beyondList.length) {
                parts.push(`on the board but not (or not that often) in the decklist: ${beyondList.map((b) => `${b.name}${b.count > 1 ? ` ×${b.count}` : ''}`).join(', ')}`);
            }
            if (deck.length > replayDeckCount && !beyondList.length) {
                parts.push('some cards are somewhere the replay doesn\'t show (or the decklist differs from the one played)');
            }
            message = `${P(seat)}: ${parts.join('; ')}. The deck holds the ${deck.length}-card remainder.`;
            warnings.push(message);
        }
        reports[seat] = { seat, decklistSize: list.size, accounted, deck, replayDeckCount, matches, beyondList, message };
        players[seat].deck = deck.map((n) => ({ card: cards.get(n)?.name ?? n }));

        const leader = states[seat].leader?.cardId ? cards.bySetCode(states[seat].leader!.cardId!)?.internalName : null;
        if (list.leader && leader && list.leader !== leader) {
            warnings.push(`${P(seat)}'s decklist leader is ${cards.get(list.leader)?.name ?? list.leader}, but ${cards.get(leader)?.name ?? leader} was played: is it the right deck?`);
        }
    }
    for (const seat of missingDecks) {
        warnings.push(`${P(seat)} has no decklist: the deck is left empty (paste the decklist to pick up).`);
    }

    // credits and the Force: the gamestate when it has them, else the log-derived ledgers
    const cutoff = moment.chatEnd > 0 ? game.chat[moment.chatEnd - 1].ts : -Infinity;
    const nameSeat = new Map<string, Seat>();
    for (const seat of SEATS) {
        const name = game.a.frames[0].gamestate.players[game.seats[seat].playerId]?.name;
        if (name) {
            nameSeat.set(name, seat);
        }
    }
    const credits = creditsAfter(game.a.timeline.credits ?? [], cutoff);
    for (const seat of SEATS) {
        const fromState = states[seat].credits;
        const fromLog = Object.entries(credits).filter(([n]) => nameSeat.get(n) === seat).reduce((s, [, v]) => s + v, 0);
        const value = typeof fromState === 'number' ? fromState : fromLog;
        if (value > 0) {
            players[seat].credits = value;
        }
    }
    const holder = forceHolderAfter(game.a.timeline.force ?? [], cutoff);
    const forceSeat = holder ? nameSeat.get(holder) : undefined;
    if (forceSeat) {
        players[forceSeat].force = true;
    }

    // the game state around the board
    const initiative: Seat = Object.values(gs.players).find((p) => p.hasInitiative)?.id === game.seats.p2.playerId ? 'p2' : 'p1';
    const phase = moment.phase === 'regroup' ? 'regroup' : 'action';
    const active = phase === 'action' ? moment.active ?? initiative : undefined;

    // what the format can't hold
    approximations.unshift(`Deck order was never recorded: each deck is its decklist minus the cards accounted for, shuffled (seed "${moment.key}${options.seed ? `/${options.seed}` : ''}").`);
    if (moment.round > 0) {
        approximations.push(`Round ${moment.round}: the sandbox has no round counter.`);
    }
    if (phase === 'action') {
        const claimer = gs.initiativeClaimed ? initiative : null;
        if (claimer) {
            approximations.push(`${P(claimer)} already claimed the initiative this round (so has passed for the rest of the phase); in the sandbox ${P(claimer)} still gets actions.`);
        }
        const sincePrev = linesSincePreviousClean(game, moment);
        const passer = active ? other(active) : null;
        if (passer && claimer !== passer && sincePrev.some((l) => new RegExp(`^${P(passer)} passes$`).test(l))) {
            approximations.push(`${P(passer)} passed just before this; in the sandbox that pass isn't remembered, so if ${P(active!)} passes too the phase goes on.`);
        }
        const lasting = linesThisPhase(game, moment).filter((l) => /lasting effect|this phase|this round|for this attack/i.test(l));
        if (lasting.length) {
            approximations.push(`Lasting effects from earlier this phase are not carried over: ${[...new Set(lasting)].slice(0, 4).map((l) => `"${l}"`).join('; ')}.`);
        }
        if ((moment.actionInRound ?? 1) > 1) {
            approximations.push('What already happened this phase (cards played, attacks, defeats) isn\'t remembered by abilities that look back at "this phase".');
        }
    }
    if (holder && !forceSeat) {
        approximations.push(`The Force is held by "${holder}" in the log, which isn't either seat's name; left out.`);
    }

    const title = `${leaderTitle(game, 'p1', cards)} vs ${leaderTitle(game, 'p2', cards)} · ${moment.label}`;
    const position: IEnginePosition = {
        version: 1,
        title,
        phase,
        initiative,
        ...(active && active !== initiative ? { active } : {}),
        p1: players.p1,
        p2: players.p2,
    };
    return { ok: true, position, text: encodePositionText(position), title, decks: reports, warnings, approximations };
};

const emptyPlayer = (): IPlayerPosition => ({ ground: [], space: [], resources: [], hand: [], deck: [], discard: [] });

const leaderTitle = (game: IReplayGame, seat: Seat, cards: IReplayCards) => {
    const id = game.seats[seat].leaderCardId;
    return (id && cards.bySetCode(id)?.title) || P(seat);
};

/** Log lines (seat-labelled) between the previous pick-up-able moment and this one. */
const linesSincePreviousClean = (game: IReplayGame, moment: IReplayMoment): string[] => {
    const out: string[] = [];
    for (let i = moment.index; i >= 0; i--) {
        const m = game.moments[i];
        if (i < moment.index && m.clean) {
            break;
        }
        out.unshift(...m.log);
    }
    return out;
};

/** Log lines since the current phase started. */
const linesThisPhase = (game: IReplayGame, moment: IReplayMoment): string[] => {
    const out: string[] = [];
    for (let i = moment.index; i >= 0; i--) {
        const m = game.moments[i];
        if (m.phase !== moment.phase || m.round !== moment.round) {
            break;
        }
        out.unshift(...m.log);
    }
    return out.filter((l) => !/^Round: \d+/.test(l));
};

/** The last log lines (seat-labelled) that have happened at a moment. */
export const logUpTo = (game: IReplayGame, moment: IReplayMoment, last = 3): string[] =>
    game.lines.slice(Math.max(0, moment.chatEnd - last), moment.chatEnd);
