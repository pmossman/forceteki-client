/**
 * Card identity for replays and decklists: SWU set codes ('SEC_034', reprints included) and token names
 * ('Shield', 'Spy') -> the sandbox card index entry (engine internalName + canonical position-format name).
 */
import type { ISandboxCard } from '../cardIndex';

/** The slice of `CardIndex` this module needs (keeps it testable without React). */
export interface ICardIndexLike {
    all: ISandboxCard[];
    get(internalName: string): ISandboxCard | undefined;
}

export interface IReplayCards {
    get(internalName: string): ISandboxCard | undefined;

    /** 'SEC_034', 'sec-34', 'SEC 034' ... including reprint codes when the set-code map is loaded */
    bySetCode(code: string): ISandboxCard | undefined;

    /** a token by its printed name ('Shield', 'Experience', 'Spy', 'X-Wing') */
    token(name: string): ISandboxCard | undefined;
}

/** 'SOR_10' / 'sor-010' / 'SOR 010' / 'LAW_T001' -> 'SOR_010' / 'LAW_T001'; null when it isn't a set code. */
export const normalizeSetCode = (raw: string): string | null => {
    const m = /^\s*([A-Za-z0-9]{2,6})[\s_-]+([A-Za-z]?)(\d{1,4})\s*$/.exec(raw ?? '');
    if (!m) {
        return null;
    }
    return `${m[1].toUpperCase()}_${m[2].toUpperCase()}${m[3].padStart(3, '0')}`;
};

const tokenKey = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * @param setCodeMap optional `{ 'SOR_010': 'internal-name', ... }` with every printing (forceteki's
 *   test/json/_setCodeMap.json, shipped as public/sandbox/engine/set-codes.json); without it only each card's
 *   primary printing resolves.
 */
export const replayCardsFrom = (index: ICardIndexLike, setCodeMap?: Record<string, string> | null): IReplayCards => {
    const byCode = new Map<string, ISandboxCard>();
    const tokens = new Map<string, ISandboxCard>();
    for (const card of index.all) {
        if (card.setId?.number != null) {
            const code = normalizeSetCode(`${card.setId.set}_${card.setId.number}`);
            if (code && !byCode.has(code)) {
                byCode.set(code, card);
            }
        }
        if (card.isToken || card.types?.includes('token')) {
            const key = tokenKey(card.title);
            if (!tokens.has(key)) {
                tokens.set(key, card);
            }
        }
    }
    for (const [raw, internalName] of Object.entries(setCodeMap ?? {})) {
        const code = normalizeSetCode(raw);
        const card = index.get(internalName);
        if (code && card && !byCode.has(code)) {
            byCode.set(code, card);
        }
    }
    return {
        get: (n) => index.get(n),
        bySetCode: (raw) => {
            const code = normalizeSetCode(raw);
            return code ? byCode.get(code) : undefined;
        },
        token: (name) => tokens.get(tokenKey(name)),
    };
};

let setCodeMapPromise: Promise<Record<string, string> | null> | null = null;

/** The reprint-aware set-code map, if the engine assets include it (optional; decklists with primary codes work without). */
export const loadSetCodeMap = (): Promise<Record<string, string> | null> => {
    if (!setCodeMapPromise) {
        setCodeMapPromise = fetch('/sandbox/engine/set-codes.json')
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);
    }
    return setCodeMapPromise;
};
