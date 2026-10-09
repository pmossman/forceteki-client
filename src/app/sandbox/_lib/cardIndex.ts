'use client';
import { useEffect, useState } from 'react';
import { CardImageLocale, s3CardImageURL } from '@/app/_utils/s3Utils';
import { CardStyle } from '@/app/_components/_sharedcomponents/Cards/CardTypes';
import { sandboxServerUrl } from '../_engine/SocketSandboxEngine';

/** One card in the index (CONTRACT.md §4 `ICardIndexEntry`). */
export interface ISandboxCard {
    internalName: string;

    /** canonical position-format name, e.g. 'Cad Bane, Impressed Now?' or 'AT-ST' */
    name: string;
    title: string;
    subtitle?: string;
    needsSetCode?: boolean;
    setId: { set: string; number?: number };
    setCode?: string;
    id: string;
    types: string[];
    arena?: 'ground' | 'space';
    cost?: number;
    power?: number;
    hp?: number;
    upgradePower?: number;
    upgradeHp?: number;
    aspects?: string[];
    traits?: string[];
    keywords?: string[];
    unique?: boolean;
    text?: string;
    deployBox?: string;
    epicAction?: string;
    pilotText?: string;
    isToken?: boolean;
    isLeader?: boolean;
}

export type CardKind = 'leader' | 'base' | 'unit' | 'upgrade' | 'event' | 'tokenUnit' | 'tokenUpgrade' | 'token' | 'other';

export const cardKind = (card: ISandboxCard): CardKind => {
    const t = card.types;
    if (t.includes('token')) {
        if (t.includes('unit')) {
            return 'tokenUnit';
        }
        if (t.includes('upgrade')) {
            return 'tokenUpgrade';
        }
        return 'token';
    }
    if (t.includes('leader')) {
        return 'leader';
    }
    if (t.includes('base')) {
        return 'base';
    }
    if (t.includes('unit')) {
        return 'unit';
    }
    if (t.includes('upgrade')) {
        return 'upgrade';
    }
    if (t.includes('event')) {
        return 'event';
    }
    return 'other';
};

export const setCodeLabel = (card: ISandboxCard): string =>
    (card.setId.number != null ? `${card.setId.set} ${String(card.setId.number).padStart(3, '0')}` : `${card.setId.set} token`);

export const displayName = (card: ISandboxCard): string => (card.subtitle ? `${card.title}, ${card.subtitle}` : card.title);

export const cardImageUrl = (
    card: ISandboxCard,
    locale: CardImageLocale = CardImageLocale.English,
    options: { leaderSide?: boolean; inPlay?: boolean } = {}
): string => {
    const kind = cardKind(card);
    const isToken = kind === 'tokenUnit' || kind === 'tokenUpgrade' || kind === 'token';
    const style = options.inPlay ? CardStyle.InPlay : (kind === 'leader' && options.leaderSide !== false ? CardStyle.PlainLeader : CardStyle.Plain);
    return s3CardImageURL(
        {
            setId: { set: card.setId.set, number: card.setId.number ?? 0 },
            type: isToken ? `token${kind === 'tokenUnit' ? 'Unit' : 'Upgrade'}` : kind,
            id: card.id,
        },
        locale,
        style
    );
};

/** Same key as the engine's position parser: lower case, no accents, letters and digits only. */
export const nameKey = (name: string) =>
    name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const searchKey = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

const setCodeKey = (set: string, num: number) => `${set.toUpperCase()}_${String(num).padStart(3, '0')}`;

export interface ICardSearchOptions {
    kinds?: CardKind[];
    arena?: 'ground' | 'space';
    limit?: number;
}

export type CardLookup = { ok: true; card: ISandboxCard } | { ok: false; message: string; candidates: string[] };

export class CardIndex {
    public readonly all: ISandboxCard[];
    private readonly byInternal = new Map<string, ISandboxCard>();
    private readonly byFull = new Map<string, ISandboxCard[]>();
    private readonly byTitle = new Map<string, ISandboxCard[]>();
    private readonly bySetCode = new Map<string, ISandboxCard>();
    private readonly searchKeys: { card: ISandboxCard; title: string; full: string; code: string; extra: string }[];

    public constructor(cards: ISandboxCard[]) {
        this.all = cards;
        const push = (map: Map<string, ISandboxCard[]>, key: string, card: ISandboxCard) => {
            const list = map.get(key);
            if (list) {
                list.push(card);
            } else {
                map.set(key, [card]);
            }
        };
        for (const card of cards) {
            this.byInternal.set(card.internalName, card);
            push(this.byFull, nameKey(displayName(card)), card);
            push(this.byTitle, nameKey(card.title), card);
            if (card.setId.number != null) {
                const code = setCodeKey(card.setId.set, card.setId.number);
                if (!this.bySetCode.has(code)) {
                    this.bySetCode.set(code, card);
                }
            }
        }
        this.searchKeys = cards.map((card) => ({
            card,
            title: searchKey(card.title),
            full: searchKey(displayName(card)),
            code: card.setId.number != null ? `${card.setId.set}${String(card.setId.number).padStart(3, '0')}`.toLowerCase() : '',
            extra: searchKey([...(card.traits ?? []), ...(card.keywords ?? []), card.text ?? '', card.deployBox ?? ''].join(' ')),
        }));
    }

    /** By engine internalName. */
    public get(internalName: string): ISandboxCard | undefined {
        return this.byInternal.get(internalName);
    }

    /** Lenient name lookup, mirroring the engine's position parser (POSITION-FORMAT.md "Card names"). */
    public lookup(rawName: string): CardLookup {
        const name = (rawName ?? '').trim();
        if (!name) {
            return { ok: false, message: 'Missing card name', candidates: [] };
        }
        const internal = this.byInternal.get(name) ?? this.byInternal.get(name.toLowerCase());
        if (internal) {
            return { ok: true, card: internal };
        }
        const disambiguated = /^(.*)\(\s*([A-Za-z0-9]{2,5})[\s_-]*0*(\d{1,4})\s*\)\s*$/.exec(name);
        if (disambiguated) {
            const hit = this.bySetCode.get(setCodeKey(disambiguated[2], Number(disambiguated[3])));
            if (hit) {
                return { ok: true, card: hit };
            }
        }
        const key = nameKey(name);
        const full = this.byFull.get(key) ?? [];
        if (full.length === 1) {
            return { ok: true, card: full[0] };
        }
        if (full.length > 1) {
            return { ok: false, message: `Ambiguous card name "${name}": add a set code`, candidates: full.map((c) => c.name) };
        }
        const byTitle = this.byTitle.get(key) ?? [];
        if (byTitle.length === 1) {
            return { ok: true, card: byTitle[0] };
        }
        if (byTitle.length > 1) {
            return { ok: false, message: `Ambiguous card name "${name}": several cards have that title, add the subtitle`, candidates: byTitle.map((c) => c.name) };
        }
        const code = /^([A-Za-z0-9]{2,5}?)[\s_-]*0*(\d{1,4})$/.exec(name);
        if (code) {
            const hit = this.bySetCode.get(setCodeKey(code[1], Number(code[2])));
            if (hit) {
                return { ok: true, card: hit };
            }
        }
        return { ok: false, message: `Unknown card "${name}"`, candidates: this.search(name, { limit: 5 }).map((c) => c.name) };
    }

    public resolve(rawName: string): ISandboxCard | undefined {
        const r = this.lookup(rawName);
        return r.ok ? r.card : undefined;
    }

    public search(query: string, options: ICardSearchOptions = {}): ISandboxCard[] {
        const limit = options.limit ?? 60;
        const q = searchKey(query);
        const qCode = query.replace(/[\s_-]/g, '').toLowerCase();
        const kindOk = (card: ISandboxCard) => !options.kinds || options.kinds.includes(cardKind(card));
        const arenaOk = (card: ISandboxCard) => !options.arena || !card.arena || card.isLeader || card.arena === options.arena;

        if (!q) {
            return this.all.filter((c) => kindOk(c) && arenaOk(c)).slice(0, limit);
        }
        const words = q.split(' ');
        const scored: { card: ISandboxCard; score: number }[] = [];
        for (const key of this.searchKeys) {
            if (!kindOk(key.card) || !arenaOk(key.card)) {
                continue;
            }
            let score = 0;
            if (key.title === q || key.full === q) {
                score = 100;
            } else if (key.code && key.code === qCode) {
                score = 95;
            } else if (key.title.startsWith(q)) {
                score = 80;
            } else if (key.full.startsWith(q)) {
                score = 75;
            } else if (words.every((w) => key.full.includes(w))) {
                score = 60;
            } else if (words.every((w) => key.full.includes(w) || key.extra.includes(w))) {
                score = 20;
            }
            if (score > 0) {
                scored.push({ card: key.card, score });
            }
        }
        scored.sort((a, b) => b.score - a.score || a.card.title.localeCompare(b.card.title) || (a.card.subtitle ?? '').localeCompare(b.card.subtitle ?? ''));
        return scored.slice(0, limit).map((s) => s.card);
    }
}

let indexPromise: Promise<CardIndex> | null = null;

const fetchIndexJson = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`${url}: HTTP ${res.status}`);
    }
    return res.json();
};

/**
 * The card index ships as a static file (public/sandbox/card-index.json, copied from the engine's
 * build/sandbox/card-index.json by scripts/sandbox/sync-engine-assets.mjs). If it is missing, fall back to
 * the dev server's GET /api/sandbox/cards.
 */
export const loadCardIndex = (): Promise<CardIndex> => {
    if (!indexPromise) {
        indexPromise = fetchIndexJson('/sandbox/card-index.json')
            .catch(() => fetchIndexJson(`${sandboxServerUrl()}/api/sandbox/cards`))
            .then((data) => new CardIndex(data.cards as ISandboxCard[]))
            .catch((e) => {
                indexPromise = null;
                throw new Error(`Card index unavailable (${e?.message ?? e}). Run \`node scripts/sandbox/sync-engine-assets.mjs\` in forceteki-client.`);
            });
    }
    return indexPromise;
};

export const useCardIndex = (): { index: CardIndex | null; error: string | null } => {
    const [index, setIndex] = useState<CardIndex | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        let live = true;
        loadCardIndex()
            .then((idx) => live && setIndex(idx))
            .catch((e) => live && setError(String(e?.message ?? e)));
        return () => {
            live = false;
        };
    }, []);
    return { index, error };
};
