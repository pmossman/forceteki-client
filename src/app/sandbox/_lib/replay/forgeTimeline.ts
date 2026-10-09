/**
 * The parts of SWU Forge's karabast replay parser that the sandbox needs, ported as plain functions.
 *
 * Source (read-only): acousineau/swu-deck-visualizer `origin/main` 504a886f
 *   - src/lib/karabast/parser/types.ts        NormalizedGamestate / NormalizedCard / ChatEntry shapes
 *   - src/lib/karabast/parser/diff.ts         applyPatch
 *   - src/lib/karabast/parser/persisted.ts    PersistedTimeline, expandPersistedTimeline (patch folding only),
 *                                             credit / Force ledgers
 *   - src/lib/karabast/replay/doubleSided.ts  publicProjectionHash, compressRuns, alignRuns, identifyRecorderId
 *   - src/lib/karabast/replay/replayPlayback.ts  estimateLogClockOffsetMs (log line -> frame attribution)
 *
 * Only what reading a recording needs is ported: no diffs, animation classification or reveal tracking.
 */

// ---------------- shapes (parser/types.ts) ----------------

export interface NormalizedCard {
    uuid: string | null;
    cardId: string | null;          // 'SEC_034' (set + zero-padded number); null for tokens and hidden cards
    karabastId: string | null;
    name: string | null;            // token cards are identified by name ('Shield', 'Experience', 'Spy', ...)
    type: string | null;            // 'basicUnit', 'event', 'leader', 'nonTokenLeaderUnit', 'tokenUpgrade', ...
    printedType: string | null;
    power: number | null;
    hp: number | null;
    damage: number;
    exhausted: boolean;
    isHidden: boolean;
    sentinel: boolean;
    isAttacker?: boolean;
    isDefender?: boolean;
    cannotBeAttacked?: boolean;
    epicDeployActionSpent: boolean;
    epicActionSpent: boolean;
    parentCardId: string | null;    // upgrades: the card they are attached to; captured cards: the captor
    onStartingSide?: boolean;       // double-sided leaders: false = flipped
    upgrades?: NormalizedCard[];    // bases only: fortifications
}

export interface NormalizedPlayer {
    id: string;
    name: string | null;
    hasInitiative: boolean;
    availableResources: number;
    credits?: number;
    numCardsInDeck: number;
    aspects?: string[];
    isActionPhaseActivePlayer: boolean | null;
    disconnected?: boolean;
    leader: NormalizedCard | null;
    secondLeader?: NormalizedCard | null;
    base: NormalizedCard | null;
    cardPiles: {
        hand: NormalizedCard[];
        resources: NormalizedCard[];
        groundArena: NormalizedCard[];
        spaceArena: NormalizedCard[];
        discard: NormalizedCard[];
        outsideTheGame: NormalizedCard[];
        capturedZone: NormalizedCard[];
    };
    promptState: IPromptState | Record<string, never> | null;
}

export interface IPromptState {
    menuTitle?: string;
    promptTitle?: string;
    promptType?: string;
    buttons?: { text?: string; arg?: unknown; command?: string }[];
}

export interface NormalizedGamestate {
    gameId: string | null;
    phase: string | null;
    initiativeClaimed: boolean;
    winners: string[];
    playerUpdate: string | null;
    players: Record<string, NormalizedPlayer>;
}

export type ChatToken =
    | string
    | { kind: 'player'; name: string; uuid: string | null }
    | { kind: 'card'; name: string; cardId: string | null; setId: { set?: string; number?: number } | null; controllerId: string | null }
    | { kind: 'alert'; text: string };

export interface ChatEntry { ts: number; tokens: ChatToken[]; step?: number }

export interface CreditEvent { ts: number; playerName: string; delta: number; step?: number }
export interface ForceEvent { ts: number; playerName: string; action: 'gain' | 'release'; step?: number }

export interface PersistedStep { capturedAt: string | null; timestamp: number | null; patch: object | null }

export interface PersistedTimeline {
    v: 2 | 3 | 4 | 5;
    base: NormalizedGamestate;
    baseCapturedAt: string | null;
    baseTimestamp: number | null;
    steps: PersistedStep[];
    chat?: ChatEntry[];
    credits?: CreditEvent[];
    force?: ForceEvent[];
    bounces?: unknown[];
}

export const isPersistedTimeline = (v: unknown): v is PersistedTimeline => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return false;
    }
    const c = v as { v?: unknown; steps?: unknown; base?: unknown };
    return [2, 3, 4, 5].includes(c.v as number) && Array.isArray(c.steps) && typeof c.base === 'object' && c.base !== null;
};

// ---------------- expanding a timeline (diff.ts applyPatch + persisted.ts fold) ----------------

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Forge's structural patch: plain objects merge key by key, arrays and primitives are replaced. */
export const applyPatch = (prev: unknown, patch: unknown): unknown => {
    if (patch === undefined) {
        return prev;
    }
    if (!isPlainObject(patch) || !isPlainObject(prev)) {
        return patch;
    }
    const out: Record<string, unknown> = { ...prev };
    for (const k of Object.keys(patch)) {
        out[k] = applyPatch(prev[k], patch[k]);
    }
    return out;
};

export interface IFrame {
    gamestate: NormalizedGamestate;

    /** ms-epoch capture time (recorder's clock), when known */
    time: number | null;
}

/** Every snapshot of a recording, base first (frame i = base patched with steps[0..i-1]). */
export const expandTimeline = (p: PersistedTimeline): IFrame[] => {
    const frames: IFrame[] = [];
    let current = p.base;
    const baseTime = p.baseTimestamp ?? (p.baseCapturedAt ? Date.parse(p.baseCapturedAt) : null);
    frames.push({ gamestate: current, time: baseTime });
    for (const step of p.steps) {
        current = step.patch ? (applyPatch(current, step.patch) as NormalizedGamestate) : current;
        frames.push({ gamestate: current, time: step.timestamp ?? (step.capturedAt ? Date.parse(step.capturedAt) : null) });
    }
    return frames;
};

// ---------------- the double-sided join (replay/doubleSided.ts) ----------------

const FIELD = '\u0001';
const SECTION = '\u0002';

const cardTuple = (card: NormalizedCard | null | undefined): string => {
    if (!card) {
        return '-';
    }
    return [card.cardId ?? card.name ?? '?', card.damage, card.exhausted ? 1 : 0, card.sentinel ? 1 : 0, card.onStartingSide === false ? 'b' : 'f'].join(FIELD);
};

const pileTuple = (pile: NormalizedCard[] | undefined): string => (pile ?? []).map(cardTuple).join(SECTION);

const playerProjection = (player: NormalizedPlayer): string => {
    const piles = player.cardPiles ?? ({} as NormalizedPlayer['cardPiles']);
    return [
        player.id,
        player.hasInitiative ? 1 : 0,
        player.availableResources,
        player.credits ?? 0,
        player.numCardsInDeck,
        (player.aspects ?? []).join(','),
        player.isActionPhaseActivePlayer ? 1 : 0,
        cardTuple(player.leader),
        cardTuple(player.base),
        pileTuple(piles.groundArena),
        pileTuple(piles.spaceArena),
        pileTuple(piles.discard),
        pileTuple(piles.capturedZone),
        (piles.hand ?? []).length,
        (piles.resources ?? []).length,
    ].join(FIELD);
};

/** Everything both players can see, and nothing else (Forge's join key between the two recordings). */
export const publicProjectionHash = (state: NormalizedGamestate | null | undefined): string => {
    if (!state) {
        return 'nil';
    }
    const players = Object.entries(state.players ?? {})
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, p]) => playerProjection(p));
    return [state.phase ?? '', state.initiativeClaimed ? 1 : 0, [...(state.winners ?? [])].sort().join(','), ...players].join(SECTION + SECTION);
};

/** Consecutive frames sharing one public-projection hash. */
export interface IRun { hash: string; first: number; last: number }

export const compressRuns = (hashes: string[]): IRun[] => {
    const runs: IRun[] = [];
    hashes.forEach((hash, i) => {
        const last = runs[runs.length - 1];
        if (last && last.hash === hash) {
            last.last = i;
        } else {
            runs.push({ hash, first: i, last: i });
        }
    });
    return runs;
};

export const MAX_LCS_CELLS = 4_000_000;

/** Matched [leftRun, rightRun] index pairs: exact when the run sequences are equal, else their LCS. */
export const alignRuns = (left: IRun[], right: IRun[]): { mode: 'exact' | 'lcs' | 'none'; pairs: [number, number][] } => {
    if (left.length === right.length && left.every((r, i) => r.hash === right[i].hash)) {
        return { mode: 'exact', pairs: left.map((_, i) => [i, i]) };
    }
    const n = left.length;
    const m = right.length;
    if (n * m > MAX_LCS_CELLS) {
        return { mode: 'none', pairs: [] };
    }
    const ids = new Map<string, number>();
    const intern = (h: string) => {
        let id = ids.get(h);
        if (id === undefined) {
            id = ids.size;
            ids.set(h, id);
        }
        return id;
    };
    const a = Int32Array.from(left, (r) => intern(r.hash));
    const b = Int32Array.from(right, (r) => intern(r.hash));
    const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }
    const pairs: [number, number][] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            pairs.push([i++, j++]);
        } else if (table[i + 1][j] >= table[i][j + 1]) {
            i++;
        } else {
            j++;
        }
    }
    return { mode: 'lcs', pairs };
};

/** The player whose hand this recording could read: the recorder's own seat. */
export const identifyRecorderId = (frames: IFrame[]): string | null => {
    for (const f of frames) {
        for (const [pid, player] of Object.entries(f.gamestate?.players ?? {})) {
            if ((player.cardPiles?.hand ?? []).some((c) => c?.isHidden === false)) {
                return pid;
            }
        }
    }
    return null;
};

// ---------------- log lines -> frames (replay/replayPlayback.ts) ----------------

const MIN_OFFSET_SAMPLE = 8;
const MAX_OFFSET_MS = 5000;
const LOG_JITTER_TOLERANCE_MS = 150;

/**
 * The log is dated on karabast's server clock and frames on the recorder's local clock. The median distance
 * from each line to its nearest capture is the offset between the two (Forge's `estimateLogClockOffsetMs`,
 * timestamp branch).
 */
export const estimateLogClockOffsetMs = (frameTimes: (number | null)[], chat: ChatEntry[]): number => {
    const times = frameTimes.filter((t): t is number => t != null).sort((a, b) => a - b);
    if (times.length === 0 || chat.length < MIN_OFFSET_SAMPLE) {
        return 0;
    }
    const deltas = chat.map((entry) => {
        let lo = 0;
        let hi = times.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (times[mid] < entry.ts) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        const after = times[lo];
        const before = times[lo - 1];
        return before != null && Math.abs(entry.ts - before) < Math.abs(entry.ts - after) ? entry.ts - before : entry.ts - after;
    }).sort((a, b) => a - b);
    return Math.max(-MAX_OFFSET_MS, Math.min(deltas[Math.floor(deltas.length / 2)], MAX_OFFSET_MS));
};

/**
 * For each log line, the frame it arrived with: its recorded `step` when the recording stamped one, else the
 * first frame captured at/after the line (on the log's clock). Lines past the last frame map to the last frame.
 */
export const attributeChat = (frames: IFrame[], chat: ChatEntry[]): number[] => {
    const times = frames.map((f) => f.time);
    const offset = estimateLogClockOffsetMs(times, chat);
    let cursor = 0;
    return chat.map((entry) => {
        if (entry.step != null && entry.step >= 0 && entry.step < frames.length) {
            cursor = Math.max(cursor, entry.step);
            return entry.step;
        }
        while (cursor < frames.length - 1) {
            const t = times[cursor];
            if (t != null && t + offset + LOG_JITTER_TOLERANCE_MS >= entry.ts) {
                break;
            }
            cursor++;
        }
        return cursor;
    });
};

/** Plain text of a log line, with player names passed through `name` (to swap handles for seat labels). */
export const chatText = (entry: ChatEntry, name: (playerName: string) => string = (n) => n): string =>
    entry.tokens.map((t) => {
        if (typeof t === 'string') {
            return t;
        }
        if (t.kind === 'player') {
            return name(t.name);
        }
        if (t.kind === 'card') {
            return t.name;
        }
        // older recordings flattened undo notices' player refs to "[object Object]"
        return t.text.replace(/\[object Object\]/g, 'A player');
    }).join('').replace(/\s+/g, ' ').trim();

// ---------------- credit and Force ledgers (parser/persisted.ts) ----------------

/** Credits per player name after every log line stamped at or before `upToTs` (log clock). */
export const creditsAfter = (events: CreditEvent[], upToTs: number): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const e of events) {
        if (e.ts > upToTs) {
            continue;
        }
        out[e.playerName] = (out[e.playerName] ?? 0) + e.delta;
    }
    return out;
};

/** Who holds the Force after the log lines up to `upToTs` (null: nobody). */
export const forceHolderAfter = (events: ForceEvent[], upToTs: number): string | null => {
    let holder: string | null = null;
    for (const e of events) {
        if (e.ts > upToTs) {
            continue;
        }
        holder = e.action === 'gain' ? e.playerName : null;
    }
    return holder;
};
