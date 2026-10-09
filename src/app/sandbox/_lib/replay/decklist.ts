/**
 * Decklists pasted for a replay seat: SWU Forge's deck JSON export and SWUDB's deck JSON share one shape
 * (Forge's `buildDeckJson`, src/lib/deckExport.ts):
 *
 *   { metadata: { name, author, ... }, leader: { id: 'JTL_009', count: 1 }, secondleader?: {...},
 *     base: { id: 'HMW_022', count: 1 }, deck: [{ id: 'SEC_133', count: 3 }, ...], sideboard: [...] }
 *
 * Only the main deck (`deck`) is the draw deck; leader, base and sideboard are not.
 */
import { IReplayCards } from './replayCards';

export interface IDecklist {
    source: 'swuforge' | 'swudb';
    name: string | null;

    /** engine internalNames (null when the list has none) */
    leader: string | null;
    base: string | null;

    /** main deck: internalName -> copies */
    cards: Record<string, number>;
    size: number;
}

export type DecklistResult = { ok: true; deck: IDecklist; warnings: string[] } | { ok: false; error: string };

interface IEntry { id?: unknown; count?: unknown }

export const parseDecklist = (raw: string, cards: IReplayCards): DecklistResult => {
    let json: unknown;
    try {
        json = JSON.parse(raw);
    } catch {
        return { ok: false, error: 'That is not JSON. Paste a SWU Forge deck export (Export → JSON) or a SWUDB deck JSON.' };
    }
    const doc = json as { metadata?: Record<string, unknown>; leader?: IEntry; base?: IEntry; deck?: unknown };
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.deck)) {
        return { ok: false, error: 'Not a deck JSON: expected { leader, base, deck: [{ id, count }] } (SWU Forge / SWUDB format).' };
    }
    const unknown: string[] = [];
    const resolve = (e: IEntry | undefined): string | null => {
        if (!e || typeof e.id !== 'string') {
            return null;
        }
        const card = cards.bySetCode(e.id);
        if (!card) {
            unknown.push(e.id);
            return null;
        }
        return card.internalName;
    };
    const out: Record<string, number> = {};
    let size = 0;
    for (const e of doc.deck as IEntry[]) {
        const count = typeof e?.count === 'number' ? e.count : Number(e?.count ?? 1);
        const name = resolve(e);
        if (!name || !(count > 0)) {
            continue;
        }
        out[name] = (out[name] ?? 0) + count;
        size += count;
    }
    if (unknown.length) {
        return { ok: false, error: `These card ids are not in the sandbox's card data: ${[...new Set(unknown)].join(', ')}` };
    }
    const meta = doc.metadata ?? {};
    const warnings: string[] = [];
    if (size === 0) {
        return { ok: false, error: 'The deck list is empty.' };
    }
    // leader and base aren't part of the draw deck: an unknown one is a warning, not a refusal
    const leader = resolve(doc.leader);
    const base = resolve(doc.base);
    const unresolved = [
        doc.leader?.id && !leader ? `leader ${String(doc.leader.id)}` : null,
        doc.base?.id && !base ? `base ${String(doc.base.id)}` : null,
    ].filter(Boolean);
    if (unresolved.length) {
        warnings.push(`The decklist's ${unresolved.join(' and ')} ${unresolved.length > 1 ? 'are' : 'is'} not in the sandbox's card data, so it can't be checked against the replay.`);
    }
    return {
        ok: true,
        deck: {
            source: typeof meta.swuforgeDeckId === 'string' || typeof meta.swuforgeDeckUrl === 'string' ? 'swuforge' : 'swudb',
            name: typeof meta.name === 'string' ? meta.name : null,
            leader,
            base,
            cards: out,
            size,
        },
        warnings,
    };
};
