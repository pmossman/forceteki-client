/**
 * Audits "pick up from here" on one real double-sided game, the way /sandbox does it: import both seats' exports
 * with their real decklists, then for EVERY pick-up-able moment build the position and check
 *   (a) each deck's remainder count equals the replay's deck count, and the importer accounted for exactly the
 *       cards that left that deck (list-independent: replay start count - replay count = cards accounted for);
 *   (b) every card in each remainder is in that seat's decklist (reprints resolve to the same card);
 *   (c) the position loads in the engine (the Worker build) with the right seat(s) to act, and the engine's
 *       decks are the remainders in the order the pick-up wrote them;
 *   (d) playing on to the next draw (both pass; at a regroup moment, no resource first), each seat draws the top
 *       of its rebuilt deck.
 * Warnings and approximations are collected by category. Every string kept here is scrubbed of player handles:
 * seats are P1/P2 and leader names.
 */
import fs from 'node:fs';
import type { IEnginePosition, IPlayerPosition, ISandboxSnapshot, Seat } from '../../../src/app/sandbox/_engine/SandboxEngine';
import { IDecklist, parseDecklist } from '../../../src/app/sandbox/_lib/replay/decklist';
import { IForgeRecording, parseForgeRecording } from '../../../src/app/sandbox/_lib/replay/forgeExport';
import { buildPickUp } from '../../../src/app/sandbox/_lib/replay/pickUp';
import { IReplayCards } from '../../../src/app/sandbox/_lib/replay/replayCards';
import { IReplayGame, IReplayMoment, pairRecordings, seatStates } from '../../../src/app/sandbox/_lib/replay/replayGame';
import type { NormalizedCard, NormalizedPlayer } from '../../../src/app/sandbox/_lib/replay/forgeTimeline';
import { readSvelteKitData } from '../../../src/app/sandbox/_lib/replay/devalue';
import { IManifestGame, IManifestSeat } from './gameManifest';
import { NodeWorkerEngine } from './nodeEngine';

const SEATS: Seat[] = ['p1', 'p2'];
const P = (s: Seat) => s.toUpperCase();

export type Severity = 'fail' | 'limitation' | 'info';

export interface IFinding {
    severity: Severity;
    category: string;
    message: string;

    /** moment labels it applies to (grouped) */
    moments?: string[];
}

export interface ISeatAudit {
    seat: Seat;
    leader: string;
    base: string;
    deckFile: string;

    /** main deck / sideboard sizes of the decklist file */
    decklistSize: number;
    sideboardSize: number;

    /** cards in the replay's draw deck at the first frame (before the opening hand): the deck actually played */
    startingDeckCount: number;
    leaderMatches: boolean;
    baseMatches: boolean;

    /** the export's SWU Forge deck version number (the version the game was recorded against), when it names one */
    exportDeckVersion: number | null;

    /** the most copies of each card seen beyond the decklist's main deck at one moment, and how many the sideboard has */
    beyondMain: { name: string; count: number; inSideboard: number }[];
}

export interface IMomentAudit {
    key: string;
    label: string;
    phase: string;
    decks: Record<Seat, { remainder: number; replay: number; engine: number | null; accountingDelta: number; beyond: { name: string; count: number }[] }>;
    notInDecklist: Record<Seat, string[]>;
    loaded: boolean;
    loadErrors: string[];
    deciders: Seat[] | null;
    expectedDeciders: Seat[];
    draw: { status: 'ok' | 'failed' | 'skipped'; detail: string };
    warnings: string[];
    approximations: string[];
}

export interface ICategoryCount { kind: 'warning' | 'approximation' | 'engine'; category: string; moments: number; example: string }

export interface IGameAudit {
    gameId: string;
    tag: string;
    gameInMatch: number;
    gamesInMatch: number;
    title: string;
    seats: Record<Seat, ISeatAudit>;
    alignment: { mode: string; matchedRuns: number; runsA: number; runsB: number };
    moments: number;
    clean: number;
    momentAudits: IMomentAudit[];
    categories: ICategoryCount[];
    findings: IFinding[];
    durationMs: number;
    generatedAt: string;
}

// ---------------- categories ----------------

const CATEGORY_RULES: [RegExp, string][] = [
    [/^Deck order was never recorded/, 'deck order unknown (seeded shuffle)'],
    [/the sandbox has no round counter/, 'round number not held'],
    [/already claimed the initiative/, 'initiative already claimed'],
    [/passed just before this/, 'pass just before not remembered'],
    [/^Lasting effects from earlier this phase/, 'lasting effects dropped'],
    [/look back at "this phase"/, '"this phase" history dropped'],
    [/outside the game/, 'cards outside the game left out'],
    [/second leader \(Twin Suns\)/, 'Twin Suns second leader left out'],
    [/deployed as a pilot/, 'pilot-deployed leader as a unit'],
    [/has no captor/, 'captured card without a captor'],
    [/printed HP/, 'damage clamped below HP'],
    [/rebuilt from the action log/, 'fortifications rebuilt from the log'],
    [/The Force is held by/, 'Force holder unknown'],
    [/taken control of/, 'stolen card: owner from the decklists'],
    [/Not in the sandbox's card data/, 'card not in the card data'],
    [/the remainder is .* but the replay's deck has|not \(or not that often\) in the decklist/, 'deck count mismatch'],
    [/decklist leader is/, 'decklist leader differs'],
    [/decklist base is/, 'decklist base differs'],
    [/has no decklist/, 'no decklist'],
];

export const categorize = (message: string): string => CATEGORY_RULES.find(([re]) => re.test(message))?.[1] ?? `other: ${message.slice(0, 60)}`;

// ---------------- helpers ----------------

const multiset = (items: string[]) => {
    const m = new Map<string, number>();
    for (const x of items) {
        m.set(x, (m.get(x) ?? 0) + 1);
    }
    return m;
};

/** a - b as a multiset */
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

const sameMultiset = (a: string[], b: string[]) => [...a].sort().join('\n') === [...b].sort().join('\n');

const cleanButton = (text: string) => String(text ?? '').replace(/\{(\w+):([^}]+)\}/g, (_m, _k, v: string) => v);

interface IDeckFile { leader?: { id?: string }; base?: { id?: string }; deck?: { id?: string; count?: number }[]; sideboard?: { id?: string; count?: number }[] }

/** Every handle in both recordings (gamestate names, chat player tokens), longest first, for scrubbing. */
export const playerNames = (game: IReplayGame): string[] => {
    const names = new Set<string>();
    for (const rec of [game.a, game.b]) {
        for (const p of Object.values(rec.timeline.base?.players ?? {})) {
            if (p?.name) {
                names.add(p.name);
            }
        }
        for (const f of [rec.frames[0], rec.frames[rec.frames.length - 1]]) {
            for (const p of Object.values(f?.gamestate.players ?? {})) {
                if (p?.name) {
                    names.add(p.name);
                }
            }
        }
        for (const e of rec.timeline.chat ?? []) {
            for (const t of e.tokens) {
                if (typeof t !== 'string' && t.kind === 'player' && t.name) {
                    names.add(t.name);
                }
            }
        }
    }
    return [...names].filter((n) => n.trim().length > 1).sort((x, y) => y.length - x.length);
};

/** a handle as a whole word (so a short handle inside a card name is left alone) */
export const nameRegExp = (name: string) => {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${/^\w/.test(name) ? '\\b' : ''}${esc}${/\w$/.test(name) ? '\\b' : ''}`, 'g');
};

const exportDeckVersion = (raw: string): number | null => {
    try {
        const page = readSvelteKitData(JSON.parse(raw)).find((n) => n && typeof n.game === 'object') as { deck?: { versionNumber?: unknown } } | undefined;
        return typeof page?.deck?.versionNumber === 'number' ? page.deck.versionNumber : null;
    } catch {
        return null;
    }
};

// ---------------- board parity: the replay's zones vs what the engine loaded ----------------

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Per seat, counts the replay shows vs counts in the engine's export right after loading. Some differences are
 * known approximations (a pilot leader deployed as a unit, damage clamped below HP); those rows are skipped when
 * the moment lists that approximation.
 */
export const boardParity = (replay: Record<Seat, NormalizedPlayer>, loaded: IEnginePosition, approximations: string[]): string[] => {
    const diffs: string[] = [];
    const arenaCards = (seat: Seat) => [...replay[seat].cardPiles.groundArena, ...replay[seat].cardPiles.spaceArena];
    const allArena = [...arenaCards('p1'), ...arenaCards('p2')];
    const pilots = approximations.some((a) => /deployed as a pilot/.test(a));
    const clamped = approximations.some((a) => /printed HP/.test(a));
    for (const seat of ['p1', 'p2'] as Seat[]) {
        const r = replay[seat];
        const e: IPlayerPosition = loaded[seat];
        const leaderUuid = r.leader?.uuid ?? null;
        const units = (pile: NormalizedCard[]) => pile.filter((c) => !c.parentCardId && c.uuid !== leaderUuid);
        const hosts = new Set([...units(arenaCards(seat)), ...arenaCards(seat).filter((c) => c.uuid === leaderUuid)].map((c) => c.uuid));
        const leaderUnit = arenaCards(seat).find((c) => c.uuid && c.uuid === leaderUuid) ?? null;
        const eUnits = [...e.ground, ...e.space];
        const rows: [string, number, number, boolean][] = [
            ['hand', r.cardPiles.hand.length, e.hand.length, true],
            ['resources', r.cardPiles.resources.length, e.resources.length, true],
            ['exhausted resources', r.cardPiles.resources.filter((c) => c.exhausted).length, e.resources.filter((c) => c.exhausted).length, true],
            ['discard', r.cardPiles.discard.length, e.discard.length, true],
            ['ground units', units(r.cardPiles.groundArena).length, e.ground.length, !pilots],
            ['space units', units(r.cardPiles.spaceArena).length, e.space.length, !pilots],
            ['exhausted units', units(arenaCards(seat)).filter((c) => c.exhausted).length, eUnits.filter((u) => u.exhausted).length, !pilots],
            ['upgrades on units', allArena.filter((c) => c.parentCardId && hosts.has(c.parentCardId)).length, sum(eUnits.map((u) => u.upgrades?.length ?? 0)) + (e.leader?.upgrades?.length ?? 0), !pilots],
            ['damage on units', sum(units(arenaCards(seat)).map((c) => c.damage ?? 0)), sum(eUnits.map((u) => u.damage ?? 0)), !pilots && !clamped],
            ['leader deployed', leaderUnit || /leaderunit/i.test(r.leader?.type ?? '') ? 1 : 0, e.leader?.deployed ? 1 : 0, true],
            ['leader damage', leaderUnit?.damage ?? 0, e.leader?.damage ?? 0, !clamped],
            ['base damage', r.base?.damage ?? 0, e.base?.damage ?? 0, !clamped],
        ];
        for (const [what, want, got, check] of rows) {
            if (check && want !== got) {
                diffs.push(`${P(seat)} ${what}: replay ${want}, engine ${got}`);
            }
        }
    }
    return diffs;
};

// ---------------- the engine part: load, deciders, play on to a draw ----------------

interface IEngineCheck {
    loaded: boolean;
    loadErrors: string[];
    loadWarnings: string[];
    deciders: Seat[] | null;
    start: IEnginePosition | null;
    draw: { status: 'ok' | 'failed' | 'skipped'; detail: string };
}

/** the regroup resource step's "resource nothing" button ('Skip Resourcing', or 'Done' with nothing selected) */
const skipResourcing = (snap: ISandboxSnapshot, seat: Seat) => {
    const p = snap.prompts[seat];
    return /resource/i.test(`${p.promptTitle} ${p.menuTitle}`) ? p.buttons.find((b) => /^(skip resourcing|done)$/i.test(cleanButton(b.text))) : undefined;
};
const isResourcePrompt = (snap: ISandboxSnapshot, seat: Seat) => !!skipResourcing(snap, seat);

const phaseOf = (snap: ISandboxSnapshot): string => snap.godView?.phase ?? '';

const engineCheck = async (engine: NodeWorkerEngine, text: string): Promise<IEngineCheck> => {
    const out: IEngineCheck = { loaded: false, loadErrors: [], loadWarnings: [], deciders: null, start: null, draw: { status: 'skipped', detail: 'not loaded' } };
    const load = await engine.call('load', { position: text });
    if (!load.ok) {
        out.loadErrors = (load.errors ?? []).map((e: { path: string; message: string }) => `${e.path ? `${e.path}: ` : ''}${e.message}`);
        return out;
    }
    out.loaded = true;
    out.loadWarnings = (load.warnings ?? []).map((e: { message: string }) => e.message);
    let snap: ISandboxSnapshot = load.snapshot;
    out.deciders = [...snap.deciders];
    const start = (await engine.call('exportPosition', {})).position as IEnginePosition;
    out.start = start;

    // play on to the next draw: pass in the action phase; at a regroup moment, resource nothing first
    let sawActionPhase = false;
    for (let step = 0; step < 20; step++) {
        if (snap.gameOver) {
            out.draw = { status: 'skipped', detail: 'the game ended before a draw' };
            return out;
        }
        const phase = phaseOf(snap);
        if (phase === 'action') {
            sawActionPhase = true;
        }
        if (phase === 'regroup' && sawActionPhase && snap.deciders.length && snap.deciders.every((s) => isResourcePrompt(snap, s))) {
            const after = (await engine.call('exportPosition', {})).position as IEnginePosition;
            const problems: string[] = [];
            const drawnBy: string[] = [];
            for (const seat of SEATS) {
                const before = start[seat];
                const now = after[seat];
                const k = Math.min(2, before.deck.length);
                const expected = before.deck.slice(0, k).map((c) => c.card);
                const drawn = minus(now.hand.map((c) => c.card), before.hand.map((c) => c.card));
                const lost = minus(before.hand.map((c) => c.card), now.hand.map((c) => c.card));
                if (lost.length) {
                    problems.push(`${P(seat)}'s hand lost ${lost.join(', ')} on the way`);
                }
                if (!sameMultiset(drawn, expected)) {
                    problems.push(`${P(seat)} drew [${drawn.join(', ')}], the top of its rebuilt deck was [${expected.join(', ')}]`);
                }
                const rest = now.deck.map((c) => c.card);
                if (rest.join('\n') !== before.deck.slice(k).map((c) => c.card).join('\n')) {
                    problems.push(`${P(seat)}'s deck after the draw isn't the rest of the rebuilt deck (${rest.length} vs ${before.deck.length - k})`);
                }
                drawnBy.push(`${P(seat)} drew ${drawn.length}`);
            }
            out.draw = problems.length ? { status: 'failed', detail: problems.join('; ') } : { status: 'ok', detail: drawnBy.join(', ') };
            return out;
        }
        const seat = snap.deciders[0];
        if (!seat) {
            out.draw = { status: 'skipped', detail: `nobody to act (${phase})` };
            return out;
        }
        const prompt = snap.prompts[seat];
        const button = phase === 'action'
            ? prompt.buttons.find((b) => /^pass$/i.test(cleanButton(b.text)))
            : phase === 'regroup' ? skipResourcing(snap, seat) : undefined;
        if (!button) {
            out.draw = { status: 'skipped', detail: `stopped at ${P(seat)}'s prompt "${[prompt.promptTitle, prompt.menuTitle].filter(Boolean).join(': ')}" (${phase || 'no phase'}; buttons: ${prompt.buttons.map((b) => cleanButton(b.text)).join(' / ') || 'none'})` };
            return out;
        }
        const r = await engine.call('act', { seat, command: 'menuButton', args: [button.arg] });
        if (!r.ok) {
            out.draw = { status: 'failed', detail: `${P(seat)} "${cleanButton(button.text)}" was refused: ${r.error}` };
            return out;
        }
        snap = r.snapshot;
    }
    out.draw = { status: 'skipped', detail: 'no draw within 20 inputs' };
    return out;
};

/** Every player handle in a game's two exports, as whole-word patterns (to check reports before writing them). */
export const handlePatterns = (mg: IManifestGame): RegExp[] => {
    const recs = mg.seats.filter((s) => s.hasExport).map((s) => parseForgeRecording(fs.readFileSync(s.exportPath, 'utf8')));
    const ok = recs.filter((r): r is { ok: true; recording: IForgeRecording } => r.ok).map((r) => r.recording);
    if (ok.length !== 2) {
        return [];
    }
    const paired = pairRecordings(ok[0], ok[1]);
    return paired.ok ? playerNames(paired.game).map(nameRegExp) : [];
};

// ---------------- the audit ----------------

export interface IAuditOptions {
    engine: NodeWorkerEngine | null;
    cards: IReplayCards;

    /** import the second manifest seat first (the panel's swap button) */
    swapped?: boolean;
}

const readDecklist = (seat: IManifestSeat, cards: IReplayCards) => {
    const raw = fs.readFileSync(seat.deckPath, 'utf8');
    const parsed = parseDecklist(raw, cards);
    const doc = JSON.parse(raw) as IDeckFile;
    const resolveAll = (entries: IDeckFile['deck']) => {
        const out: string[] = [];
        const unknown: string[] = [];
        for (const e of entries ?? []) {
            const card = e.id ? cards.bySetCode(e.id) : undefined;
            if (!card) {
                unknown.push(String(e.id));
                continue;
            }
            for (let i = 0; i < (e.count ?? 1); i++) {
                out.push(card.internalName);
            }
        }
        return { out, unknown };
    };
    const main = resolveAll(doc.deck);
    const side = resolveAll(doc.sideboard);
    return {
        parsed,
        main: main.out,
        sideboard: side.out,
        unknown: [...main.unknown, ...side.unknown],
        leader: doc.leader?.id ? cards.bySetCode(doc.leader.id)?.internalName ?? null : null,
        base: doc.base?.id ? cards.bySetCode(doc.base.id)?.internalName ?? null : null,
        rawLeader: doc.leader?.id ?? null,
        rawBase: doc.base?.id ?? null,
    };
};

export const auditGame = async (mg: IManifestGame, options: IAuditOptions): Promise<IGameAudit> => {
    const t0 = Date.now();
    const { cards, engine } = options;
    const findings: IFinding[] = [];
    const ordered = options.swapped ? [mg.seats[1], mg.seats[0]] : mg.seats;
    const raws = ordered.map((s) => fs.readFileSync(s.exportPath, 'utf8'));
    const recs = raws.map((raw) => parseForgeRecording(raw));
    for (const [i, r] of recs.entries()) {
        if (!r.ok) {
            throw new Error(`${ordered[i].entry.exportFile}: ${r.error}`);
        }
    }
    const [a, b] = recs.map((r) => (r as { ok: true; recording: IForgeRecording }).recording);
    const paired = pairRecordings(a, b);
    if (!paired.ok) {
        throw new Error(`pairing: ${paired.error}`);
    }
    const game = paired.game;
    const names = playerNames(game);
    const seatName = new Map<string, string>([[game.seats.p1.name ?? '', 'P1'], [game.seats.p2.name ?? '', 'P2']]);
    const nameRes = names.map((n) => ({ n, re: nameRegExp(n) }));
    const scrub = (s: string) => nameRes.reduce((acc, { n, re }) => acc.replace(re, seatName.get(n) ?? '[player]'), s);

    const title = (seat: Seat) => {
        const id = game.seats[seat].leaderCardId;
        return (id && cards.bySetCode(id)?.title) || P(seat);
    };
    const nameOf = (internalName: string | null) => (internalName ? cards.get(internalName)?.name ?? internalName : '(none)');

    // decklists
    const lists = SEATS.map((seat, i) => readDecklist(ordered[i], cards));
    const decks: Record<Seat, IDecklist | null> = { p1: null, p2: null };
    const seatAudits = {} as Record<Seat, ISeatAudit>;
    SEATS.forEach((seat, i) => {
        const l = lists[i];
        if (l.unknown.length) {
            findings.push({ severity: 'fail', category: 'decklist id not resolved', message: `${P(seat)}'s decklist names ids the sandbox can't resolve: ${l.unknown.join(', ')}` });
        }
        if (l.parsed.ok) {
            decks[seat] = l.parsed.deck;
        } else {
            findings.push({ severity: 'fail', category: 'decklist not parsed', message: `${P(seat)}'s decklist: ${l.parsed.error}` });
        }
        const playedLeader = game.seats[seat].leaderCardId ? cards.bySetCode(game.seats[seat].leaderCardId!)?.internalName ?? null : null;
        const playedBase = game.seats[seat].baseCardId ? cards.bySetCode(game.seats[seat].baseCardId!)?.internalName ?? null : null;
        seatAudits[seat] = {
            seat,
            leader: title(seat),
            base: nameOf(playedBase),
            deckFile: ordered[i].entry.deckFile,
            decklistSize: l.main.length,
            sideboardSize: l.sideboard.length,
            startingDeckCount: game.seats[seat].startingDeckCount,
            leaderMatches: !!l.leader && l.leader === playedLeader,
            baseMatches: !!l.base && l.base === playedBase,
            exportDeckVersion: exportDeckVersion(raws[i]),
            beyondMain: [],
        };
        if (!seatAudits[seat].leaderMatches) {
            findings.push({ severity: 'limitation', category: 'decklist leader differs', message: `${P(seat)}'s decklist leader is ${nameOf(l.leader)} (${l.rawLeader}), the replay's is ${nameOf(playedLeader)} (${game.seats[seat].leaderCardId})` });
        }
        if (!seatAudits[seat].baseMatches) {
            findings.push({ severity: 'limitation', category: 'decklist base differs', message: `${P(seat)}'s decklist base is ${nameOf(l.base)} (${l.rawBase}), the replay's is ${nameOf(playedBase)} (${game.seats[seat].baseCardId})` });
        }
    });

    const clean = game.moments.filter((m) => m.clean);
    if (game.alignment.mode === 'none' || game.alignment.matchedRuns === 0) {
        findings.push({ severity: 'fail', category: 'recordings do not align', message: `alignment ${game.alignment.mode}: ${game.alignment.matchedRuns} runs matched` });
    }
    if (!clean.length) {
        findings.push({ severity: 'fail', category: 'no pick-up-able moment', message: 'the game has no pick-up-able moment' });
    }

    const momentAudits: IMomentAudit[] = [];
    const beyondMax: Record<Seat, Map<string, number>> = { p1: new Map(), p2: new Map() };
    const fail = (category: string, moment: IReplayMoment, message: string) => findings.push({ severity: 'fail', category, message: scrub(message), moments: [moment.label] });

    for (const m of clean) {
        const res = buildPickUp(game, m, cards, { decks, requireDecks: true });
        if (!res.ok) {
            fail('pick-up refused', m, res.error);
            continue;
        }
        const audit: IMomentAudit = {
            key: m.key,
            label: m.label,
            phase: m.phase,
            decks: {} as IMomentAudit['decks'],
            notInDecklist: { p1: [], p2: [] },
            loaded: false,
            loadErrors: [],
            deciders: null,
            expectedDeciders: m.phase === 'regroup' ? ['p1', 'p2'] : m.active ? [m.active] : [],
            draw: { status: 'skipped', detail: 'no engine' },
            warnings: res.warnings.map(scrub),
            approximations: res.approximations.map(scrub),
        };
        for (const [i, seat] of SEATS.entries()) {
            const rep = res.decks[seat]!;
            const beyond = rep.beyondList;
            const used = rep.accounted + beyond.reduce((s, x) => s + x.count, 0);
            const accountingDelta = (game.seats[seat].startingDeckCount - rep.replayDeckCount) - used;
            audit.decks[seat] = { remainder: rep.deck.length, replay: rep.replayDeckCount, engine: null, accountingDelta, beyond };
            for (const x of beyond) {
                beyondMax[seat].set(x.name, Math.max(beyondMax[seat].get(x.name) ?? 0, x.count));
            }
            // (b) every remainder card is in the decklist, resolved independently from the file (reprint-aware)
            const notIn = minus(rep.deck, lists[i].main);
            audit.notInDecklist[seat] = notIn.map((n) => nameOf(n));
            if (notIn.length) {
                fail('remainder card not in the decklist', m, `${P(seat)}'s remainder has ${audit.notInDecklist[seat].join(', ')}, which the decklist doesn't`);
            }
            if (accountingDelta !== 0) {
                fail('cards unaccounted for', m, `${P(seat)}: ${game.seats[seat].startingDeckCount - rep.replayDeckCount} card(s) have left the deck by the replay's count, the import accounts for ${used}`);
            }
        }

        if (engine) {
            const ec = await engineCheck(engine, res.text);
            audit.loaded = ec.loaded;
            audit.loadErrors = ec.loadErrors.map(scrub);
            audit.deciders = ec.deciders;
            audit.draw = { status: ec.draw.status, detail: scrub(ec.draw.detail) };
            audit.warnings.push(...ec.loadWarnings.map((w) => `engine: ${scrub(w)}`));
            if (!ec.loaded) {
                fail('position does not load', m, ec.loadErrors.join('; '));
            } else {
                if ([...(ec.deciders ?? [])].sort().join() !== [...audit.expectedDeciders].sort().join()) {
                    fail('wrong seat to act', m, `the engine has ${(ec.deciders ?? []).map(P).join('+') || 'nobody'} to act, the replay ${audit.expectedDeciders.map(P).join('+')}`);
                }
                for (const seat of SEATS) {
                    const engineDeck = ec.start![seat].deck.map((c) => c.card);
                    audit.decks[seat].engine = engineDeck.length;
                    const written = res.position[seat].deck.map((c) => c.card);
                    if (engineDeck.join('\n') !== written.join('\n')) {
                        fail('engine deck differs from the remainder', m, `${P(seat)}: the engine's deck (${engineDeck.length}) isn't the rebuilt remainder (${written.length}) in order`);
                    }
                }
                const parity = boardParity(seatStates(game, m)!, ec.start!, res.approximations);
                if (parity.length) {
                    fail('board differs from the replay', m, parity.join('; '));
                }
                if (ec.draw.status === 'failed') {
                    fail('draw not from the remainder', m, ec.draw.detail);
                }
            }
        }
        momentAudits.push(audit);
    }

    // decklist vs the deck played: size, and cards seen beyond the main deck (sideboarded in? another version?)
    for (const [i, seat] of SEATS.entries()) {
        const s = seatAudits[seat];
        const side = multiset(lists[i].sideboard.map((n) => nameOf(n)));
        s.beyondMain = [...beyondMax[seat]].map(([name, count]) => ({ name, count, inSideboard: Math.min(count, side.get(name) ?? 0) }));
        const sizeDiff = s.decklistSize - s.startingDeckCount;
        const fromSide = s.beyondMain.filter((x) => x.inSideboard > 0);
        const nowhere = s.beyondMain.filter((x) => x.count > x.inSideboard);
        const fmt = (xs: { name: string; count: number }[]) => xs.map((x) => `${x.name}${x.count > 1 ? ` ×${x.count}` : ''}`).join(', ');
        if (sizeDiff !== 0) {
            findings.push({ severity: 'limitation', category: 'decklist size differs from the deck played', message: `${P(seat)}: the decklist's main deck has ${s.decklistSize} cards, the replay's deck started with ${s.startingDeckCount}` });
        }
        if (fromSide.length) {
            const why = mg.gameInMatch > 1
                ? `game ${mg.gameInMatch} of the match: sideboarded in (the cards that went out are never shown, so they stay in the remainder)`
                : 'game 1 of the match, so the decklist is not the version played';
            findings.push({ severity: 'limitation', category: mg.gameInMatch > 1 ? 'sideboarded in (Bo3)' : 'decklist version differs', message: `${P(seat)} played ${fmt(fromSide.map((x) => ({ name: x.name, count: x.inSideboard })))} from the decklist's sideboard: ${why}` });
        }
        if (nowhere.length) {
            findings.push({ severity: 'limitation', category: 'card played that the decklist lacks', message: `${P(seat)} played ${fmt(nowhere.map((x) => ({ name: x.name, count: x.count - x.inSideboard })))}, in neither the decklist's main deck nor its sideboard: the decklist is not the version played` });
        }
        if (mg.gameInMatch > 1 && !fromSide.length && sizeDiff === 0) {
            findings.push({ severity: 'info', category: 'no sideboarding seen', message: `${P(seat)}: game ${mg.gameInMatch} of the match, and every card seen is in the main deck (any sideboarding never showed)` });
        }
    }

    // a count mismatch is a data limitation when the decklist explains it exactly (the import accounted for every card
    // that left the deck, so the difference is the list's size vs the deck played plus the cards seen beyond the
    // list); one the import's accounting doesn't explain is already a failure above
    const mismatched: Record<Seat, string[]> = { p1: [], p2: [] };
    for (const ma of momentAudits) {
        for (const seat of SEATS) {
            if (ma.decks[seat].remainder !== ma.decks[seat].replay && ma.decks[seat].accountingDelta === 0) {
                mismatched[seat].push(ma.label);
            }
        }
    }
    for (const seat of SEATS) {
        if (mismatched[seat].length) {
            findings.push({
                severity: 'limitation',
                category: 'deck count mismatch (decklist differs)',
                message: `${P(seat)}: the remainder differs from the replay's deck count at ${mismatched[seat].length} of ${momentAudits.length} moments, each explained by the decklist (size ${seatAudits[seat].decklistSize} vs ${seatAudits[seat].startingDeckCount} played, plus the cards seen beyond it)`,
                moments: mismatched[seat],
            });
        }
    }

    // draws that could not be reached are listed, not failed
    const skipped = momentAudits.filter((ma) => ma.draw.status === 'skipped');
    const byReason = new Map<string, string[]>();
    for (const ma of skipped) {
        const reason = ma.draw.detail.replace(/\(\d+ vs \d+\)/g, '');
        byReason.set(reason, [...(byReason.get(reason) ?? []), ma.label]);
    }
    for (const [reason, moments] of byReason) {
        findings.push({ severity: 'info', category: 'draw check not reached', message: reason, moments });
    }

    // categories: how many moments each warning / approximation kind appears in
    const cat = new Map<string, ICategoryCount>();
    for (const ma of momentAudits) {
        const seen = new Set<string>();
        for (const [kind, list] of [['warning', ma.warnings], ['approximation', ma.approximations]] as const) {
            for (const msg of list) {
                const k: ICategoryCount['kind'] = msg.startsWith('engine: ') ? 'engine' : kind;
                const category = k === 'engine' ? msg.slice(8).replace(/\d+/g, 'N') : categorize(msg);
                const key = `${k}|${category}`;
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                const entry = cat.get(key) ?? { kind: k, category, moments: 0, example: msg };
                entry.moments++;
                cat.set(key, entry);
            }
        }
    }
    for (const c of cat.values()) {
        if (c.category.startsWith('other: ') || c.category === 'card not in the card data') {
            findings.push({ severity: 'fail', category: `uncategorised or unresolved ${c.kind}`, message: c.example });
        }
    }

    const audit: IGameAudit = {
        gameId: game.gameId,
        tag: mg.tag,
        gameInMatch: mg.gameInMatch,
        gamesInMatch: mg.gamesInMatch,
        title: `${title('p1')} vs ${title('p2')}`,
        seats: seatAudits,
        alignment: game.alignment,
        moments: game.moments.length,
        clean: clean.length,
        momentAudits,
        categories: [...cat.values()].sort((x, y) => x.kind.localeCompare(y.kind) || y.moments - x.moments),
        findings: findings.map((f) => ({ ...f, message: scrub(f.message) })),
        durationMs: Date.now() - t0,
        generatedAt: new Date().toISOString(),
    };
    // nothing that leaves this function may carry a handle
    const serialized = JSON.stringify(audit);
    const leaked = nameRes.filter(({ re }) => new RegExp(re.source).test(serialized));
    if (leaked.length) {
        throw new Error(`the audit still holds ${leaked.length} player handle(s); scrubbing failed`);
    }
    return audit;
};
