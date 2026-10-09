/**
 * A double-sided replay: the two seats' recordings of one game, joined frame by frame, and the list of
 * moments a game can be picked up from.
 *
 * Each recording sees only its own seat's hand and resources, and the two streams have different lengths
 * (a client gets a frame when *it* is sent state). Like SWU Forge's "both sides" view, the join key is the
 * public game state: consecutive frames with the same public state form a run, and the two run sequences are
 * matched (exactly, or by longest common subsequence). A matched pair of runs is one moment, with each seat's
 * hidden zones read from that seat's own recording.
 *
 * P1 is the first recording's seat, P2 the second's.
 */
import type { Seat } from '../../_engine/SandboxEngine';
import { IForgeRecording } from './forgeExport';
import {
    ChatEntry, IPromptState, IRun, NormalizedCard, NormalizedGamestate, NormalizedPlayer, alignRuns, attributeChat, chatText, compressRuns, publicProjectionHash,
} from './forgeTimeline';
import { recoverFortifications } from './fortifications';

export interface IReplaySeat {
    seat: Seat;
    playerId: string;

    /** the gamestate name in the seat's own recording: a handle, kept local, never put in position text */
    name: string | null;
    leaderCardId: string | null;
    baseCardId: string | null;
    deckName: string | null;

    /** cards in the draw deck at the first frame (main deck size) */
    startingDeckCount: number;
}

/** One moment of the game; `key` is stable within the game: `<first frame>-<last frame>` of the first recording. */
export interface IReplayMoment {
    key: string;
    index: number;

    /** frames of the run in each recording; the last frame of each is the one read */
    a: { first: number; last: number };
    b: { first: number; last: number } | null;
    phase: string;
    round: number;

    /** action-phase moments that can be picked up, numbered within the round from 1 */
    actionInRound: number | null;

    /** whose action it is (action phase) */
    active: Seat | null;
    clean: boolean;

    /** why a moment can't be picked up */
    why: string | null;

    /** short label: 'Round 3 · action 4 · P1 to act' */
    label: string;

    /** log lines that arrived since the previous moment (seat labels instead of handles) */
    log: string[];

    /** index into the first recording's chat: lines [0, chatEnd) have happened at this moment */
    chatEnd: number;
}

export interface IReplayGame {
    gameId: string;
    a: IForgeRecording;
    b: IForgeRecording;
    seats: Record<Seat, IReplaySeat>;
    moments: IReplayMoment[];
    alignment: { mode: 'exact' | 'lcs' | 'none'; matchedRuns: number; runsA: number; runsB: number };

    /** chat of the first recording, the frame each line arrived with, and its text with seat labels */
    chat: ChatEntry[];
    chatFrame: number[];
    lines: string[];

    /**
     * Per seat, per frame of that seat's OWN recording: fortifications rebuilt from the log, for recordings made
     * before SWU Forge kept `base.upgrades` (null when the recording has the real data or nothing to rebuild).
     */
    fortifications: Record<Seat, NormalizedCard[][] | null>;
}

export type PairResult = { ok: true; game: IReplayGame } | { ok: false; error: string };

const isActionWindow = (ps: IPromptState | null | undefined) =>
    !!ps && (ps.promptType === 'actionWindow' || (ps.promptTitle === 'Action Window' && /choose an action/i.test(ps.menuTitle ?? '')));

const isResourceChoice = (ps: IPromptState | null | undefined) =>
    !!ps && (ps.promptType === 'resource' || /resource step/i.test(ps.promptTitle ?? '')) && /^select/i.test(ps.menuTitle ?? '');

const isWaiting = (ps: IPromptState | null | undefined) => !ps || !ps.menuTitle || /^waiting for/i.test(ps.menuTitle);

const promptText = (ps: IPromptState | null | undefined) =>
    (ps ? [ps.promptTitle, ps.menuTitle].filter((s) => s && s.trim()).join(': ') : '') || 'a prompt';

const prompt = (gs: NormalizedGamestate, playerId: string): IPromptState | null => {
    const ps = gs.players?.[playerId]?.promptState;
    return ps && typeof ps === 'object' && Object.keys(ps).length ? ps as IPromptState : null;
};

const hasHidden = (p: NormalizedPlayer | undefined) =>
    !p || [...(p.cardPiles?.hand ?? []), ...(p.cardPiles?.resources ?? [])].some((c) => c?.isHidden || (!c?.cardId && !c?.name));

/**
 * Join two recordings of one game. Refuses (with the reason) anything that isn't the two different seats of
 * the same game.
 */
export const pairRecordings = (a: IForgeRecording, b: IForgeRecording): PairResult => {
    if (a.gameId !== b.gameId) {
        return { ok: false, error: 'These two recordings are from different games. Import the same game saved from each player\'s side.' };
    }
    const seatsA = [...a.playerIds].sort().join('|');
    const seatsB = [...b.playerIds].sort().join('|');
    if (seatsA !== seatsB) {
        return { ok: false, error: 'These two recordings have different players, so they are not two sides of one game.' };
    }
    if (a.recorderId === b.recorderId) {
        return { ok: false, error: 'Both files are the same player\'s recording. Add the OTHER player\'s recording of this game.' };
    }

    const p1 = a.recorderId;
    const p2 = b.recorderId;
    const seatOf = (pid: string | null | undefined): Seat | null => (pid === p1 ? 'p1' : pid === p2 ? 'p2' : null);

    const runsA = compressRuns(a.frames.map((f) => publicProjectionHash(f.gamestate)));
    const runsB = compressRuns(b.frames.map((f) => publicProjectionHash(f.gamestate)));
    const { mode, pairs } = alignRuns(runsA, runsB);
    if (pairs.length === 0) {
        return { ok: false, error: 'The two recordings could not be lined up (no shared public game state).' };
    }
    const counterpart = new Map<number, IRun>(pairs.map(([i, j]) => [i, runsB[j]]));

    const first = a.frames[0].gamestate;
    const firstB = b.frames[0].gamestate;
    const seatInfo = (seat: Seat, pid: string, own: NormalizedGamestate, deckName: string | null): IReplaySeat => {
        const p = own.players[pid];
        return {
            seat,
            playerId: pid,
            name: p?.name ?? null,
            leaderCardId: p?.leader?.cardId ?? null,
            baseCardId: p?.base?.cardId ?? null,
            deckName,
            startingDeckCount: first.players[pid]?.numCardsInDeck ?? 0,
        };
    };
    const seats: Record<Seat, IReplaySeat> = {
        p1: seatInfo('p1', p1, first, a.deckName),
        p2: seatInfo('p2', p2, firstB, b.deckName),
    };

    // log lines: the first recording's chat, attributed to its frames; handles become seat labels
    const chat = a.timeline.chat ?? [];
    const chatFrame = attributeChat(a.frames, chat);
    const nameSeat = new Map<string, string>();
    for (const [pid, player] of Object.entries(first.players)) {
        if (player.name) {
            nameSeat.set(player.name, seatOf(pid) === 'p1' ? 'P1' : 'P2');
        }
    }
    const label = (n: string) => nameSeat.get(n) ?? n;
    const lines = chat.map((e) => chatText(e, label));

    const moments: IReplayMoment[] = [];
    let round = 0;
    let prevPhase: string | null = null;
    let actionCount = 0;
    let chatCursor = 0;
    runsA.forEach((run, i) => {
        const gs = a.frames[run.last].gamestate;
        const phase = gs.phase ?? '';
        if (phase === 'action' && prevPhase !== 'action') {
            round++;
            actionCount = 0;
        }
        prevPhase = phase;

        const runB = counterpart.get(i) ?? null;
        const activePid = Object.values(gs.players).find((p) => p.isActionPhaseActivePlayer)?.id ?? null;
        const active = phase === 'action' ? seatOf(activePid) : null;

        let why: string | null = null;
        if (!runB) {
            why = 'Not in the other player\'s recording, so their hidden cards are unknown here';
        } else if (gs.winners?.length) {
            why = 'The game is over';
        } else if (phase === 'setup') {
            why = 'Setup (mulligan / first resources)';
        } else if (phase === 'action') {
            const framesOf = (seat: Seat) => {
                const range = seat === 'p1' ? run : runB;
                const rec = seat === 'p1' ? a : b;
                const pid = seat === 'p1' ? p1 : p2;
                return Array.from({ length: range.last - range.first + 1 }, (_, k) => prompt(rec.frames[range.first + k].gamestate, pid));
            };
            if (!active) {
                why = 'Nobody is to act';
            } else if (!framesOf(active).some(isActionWindow)) {
                const other: Seat = active === 'p1' ? 'p2' : 'p1';
                const own = framesOf(active);
                const deciding = !isWaiting(own[own.length - 1]) ? active : other;
                const ps = framesOf(deciding);
                why = `Mid-prompt: ${deciding.toUpperCase()} is deciding "${promptText(ps[ps.length - 1])}"`;
            }
        } else if (phase === 'regroup') {
            const choosing = (seat: Seat) => {
                const range = seat === 'p1' ? run : runB;
                const rec = seat === 'p1' ? a : b;
                const pid = seat === 'p1' ? p1 : p2;
                for (let f = range.first; f <= range.last; f++) {
                    if (isResourceChoice(prompt(rec.frames[f].gamestate, pid))) {
                        return true;
                    }
                }
                return false;
            };
            if (!(choosing('p1') && choosing('p2'))) {
                why = 'Regroup, between steps (only the start of the resource step can be picked up)';
            }
        } else {
            why = `Phase "${phase}"`;
        }
        if (!why && runB) {
            const own1 = a.frames[run.last].gamestate.players[p1];
            const own2 = b.frames[runB.last].gamestate.players[p2];
            if (hasHidden(own1) || hasHidden(own2)) {
                why = 'A hand or resource card is face down in its own player\'s recording';
            }
        }

        const clean = !why;
        let actionInRound: number | null = null;
        if (clean && phase === 'action') {
            actionInRound = ++actionCount;
        }

        // log lines up to the end of this run
        let chatEnd = chatCursor;
        while (chatEnd < chat.length && chatFrame[chatEnd] <= run.last) {
            chatEnd++;
        }
        const log = lines.slice(chatCursor, chatEnd).filter(Boolean);
        chatCursor = chatEnd;

        const roundLabel = round > 0 ? `Round ${round}` : 'Setup';
        const what = phase === 'action'
            ? (actionInRound ? `action ${actionInRound}` : 'action phase')
            : phase === 'regroup' ? (clean ? 'regroup, resource step' : 'regroup') : phase;
        moments.push({
            key: `${run.first}-${run.last}`,
            index: moments.length,
            a: { first: run.first, last: run.last },
            b: runB ? { first: runB.first, last: runB.last } : null,
            phase,
            round,
            actionInRound,
            active,
            clean,
            why,
            label: [roundLabel, round > 0 ? what : null, active ? `${active.toUpperCase()} to act` : null].filter(Boolean).join(' · '),
            log,
            chatEnd,
        });
    });

    return {
        ok: true,
        game: {
            gameId: a.gameId,
            a,
            b,
            seats,
            moments,
            alignment: { mode, matchedRuns: pairs.length, runsA: runsA.length, runsB: runsB.length },
            chat,
            chatFrame,
            lines,
            fortifications: { p1: recoverFortifications(a, p1), p2: recoverFortifications(b, p2) },
        },
    };
};

/** The pick-up-able moment nearest to `index` (ties go to the earlier one), or null if there are none. */
export const nearestCleanMoment = (game: IReplayGame, index: number): IReplayMoment | null => {
    let best: IReplayMoment | null = null;
    for (const m of game.moments) {
        if (!m.clean) {
            continue;
        }
        if (!best || Math.abs(m.index - index) < Math.abs(best.index - index)) {
            best = m;
        }
    }
    return best;
};

/** The moment containing frame `frame` of the first recording. */
export const momentForFrame = (game: IReplayGame, frame: number): IReplayMoment | null =>
    game.moments.find((m) => frame >= m.a.first && frame <= m.a.last) ?? null;

/** Each seat's player state at a moment: public zones plus that seat's own hand and resources. */
export const seatStates = (game: IReplayGame, moment: IReplayMoment): Record<Seat, NormalizedPlayer> | null => {
    if (!moment.b) {
        return null;
    }
    const p1 = game.a.frames[moment.a.last].gamestate.players[game.seats.p1.playerId];
    const p2 = game.b.frames[moment.b.last].gamestate.players[game.seats.p2.playerId];
    return p1 && p2 ? { p1, p2 } : null;
};
