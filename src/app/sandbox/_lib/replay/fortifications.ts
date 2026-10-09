/**
 * Fortifications (Homeworlds "attach this to your base" upgrades) for recordings that never carried them.
 *
 * Karabast nests them on the base (`base.upgrades`); recordings made before SWU Forge kept that key have no
 * trace of them in any frame, only in the action log ("{P} plays {C}, attaching it to {base}"). SWU Forge
 * rebuilds them at view time (src/lib/karabast/server/fortificationRecovery.ts, origin/main 66206ab1); this is
 * a simpler version that leans on what a double-sided import has and Forge's single recording doesn't: the
 * owner's OWN recording, where the card is face up until it leaves the hand.
 *
 *  - attach: an attach line naming the player's base, and a copy of that card (same karabast template id)
 *    leaving one of the owner's piles within a frame of the line without landing in any pile;
 *  - removal: that uuid showing up in any pile again (defeated -> discard, returned -> hand, undone -> hand).
 *
 * Anything without that evidence is left out; the deck-count check then flags the gap.
 */
import { IForgeRecording } from './forgeExport';
import { ChatEntry, ChatToken, NormalizedCard, NormalizedGamestate, PersistedTimeline, attributeChat } from './forgeTimeline';

type CardToken = Extract<ChatToken, { kind: 'card' }>;

/** Does any base anywhere in this recording carry karabast's `upgrades` key? Then the data is real. */
export const hasRecordedFortifications = (timeline: PersistedTimeline): boolean => {
    const has = (base: unknown) => !!base && typeof base === 'object' && Object.prototype.hasOwnProperty.call(base, 'upgrades');
    for (const p of Object.values(timeline.base?.players ?? {})) {
        if (has(p?.base)) {
            return true;
        }
    }
    for (const step of timeline.steps ?? []) {
        const players = (step.patch as { players?: Record<string, { base?: unknown }> } | null)?.players;
        for (const p of Object.values(players ?? {})) {
            if (has(p?.base)) {
                return true;
            }
        }
    }
    return false;
};

const isCard = (t: ChatToken): t is CardToken => typeof t !== 'string' && t.kind === 'card';
const text = (t: ChatToken) => (typeof t === 'string' ? t : '');

/** "{P} plays {C}[ from …], attaching it to {B}" -> the card and its host, or null. */
const parseAttach = (entry: ChatEntry): { card: CardToken; host: CardToken } | null => {
    const verb = entry.tokens.findIndex((t) => /^\s*plays\b/i.test(text(t)));
    if (verb < 0) {
        return null;
    }
    const attaching = entry.tokens.findIndex((t, i) => i > verb && /attaching it to/i.test(text(t)));
    if (attaching < 0) {
        return null;
    }
    const card = entry.tokens.slice(verb + 1, attaching).find(isCard);
    const host = entry.tokens.slice(attaching + 1).find(isCard);
    return card && host && card.cardId ? { card, host } : null;
};

const pileCards = (gs: NormalizedGamestate, playerId?: string): Map<string, NormalizedCard> => {
    const out = new Map<string, NormalizedCard>();
    for (const [pid, p] of Object.entries(gs.players ?? {})) {
        if (playerId && pid !== playerId) {
            continue;
        }
        for (const pile of Object.values(p.cardPiles ?? {})) {
            for (const c of (pile as NormalizedCard[]) ?? []) {
                if (c?.uuid) {
                    out.set(c.uuid, c);
                }
            }
        }
    }
    return out;
};

/**
 * Per frame of `rec`, the fortifications on `playerId`'s base (attach order), rebuilt from the log; null when
 * the recording carries real `base.upgrades` data or there is nothing to rebuild.
 */
export const recoverFortifications = (rec: IForgeRecording, playerId: string): NormalizedCard[][] | null => {
    if (hasRecordedFortifications(rec.timeline)) {
        return null;
    }
    const chat = rec.timeline.chat ?? [];
    const frames = rec.frames;
    const base = frames.find((f) => f.gamestate.players?.[playerId]?.base)?.gamestate.players[playerId].base;
    if (!base) {
        return null;
    }
    const attachLines = chat
        .map((entry, i) => ({ i, parsed: parseAttach(entry) }))
        .filter(({ parsed }) => parsed && (parsed.host.cardId === base.karabastId || (!!parsed.host.name && parsed.host.name === base.name)) &&
            (!parsed.host.controllerId || parsed.host.controllerId === playerId));
    if (attachLines.length === 0) {
        return null;
    }
    const lineFrame = attributeChat(frames, chat);

    // what left the player's own piles each frame and landed in no pile at all
    const all = frames.map((f) => pileCards(f.gamestate));
    const own = frames.map((f) => pileCards(f.gamestate, playerId));
    const vanished: { uuid: string; card: NormalizedCard }[][] = frames.map((_, i) => {
        if (i === 0) {
            return [];
        }
        const out: { uuid: string; card: NormalizedCard }[] = [];
        for (const [uuid, card] of own[i - 1]) {
            if (!all[i].has(uuid)) {
                out.push({ uuid, card });
            }
        }
        return out;
    });

    const attachAt = new Map<number, NormalizedCard[]>();
    const claimed = new Set<string>();
    for (const { i, parsed } of attachLines) {
        const at = lineFrame[i];
        let hit: { frame: number; uuid: string; card: NormalizedCard } | null = null;
        for (const d of [0, 1, -1, 2]) {
            const f = at + d;
            if (f < 1 || f >= frames.length) {
                continue;
            }
            const v = vanished[f].find((x) => !claimed.has(`${x.uuid}@${f}`) && x.card.karabastId === parsed!.card.cardId);
            if (v) {
                hit = { frame: f, ...v };
                break;
            }
        }
        if (!hit) {
            continue;
        }
        claimed.add(`${hit.uuid}@${hit.frame}`);
        attachAt.set(hit.frame, [...(attachAt.get(hit.frame) ?? []), { ...hit.card, parentCardId: base.uuid, exhausted: false, damage: 0 }]);
    }
    if (attachAt.size === 0) {
        return null;
    }

    const out: NormalizedCard[][] = [];
    let onBase: NormalizedCard[] = [];
    frames.forEach((_, i) => {
        onBase = onBase.filter((c) => !all[i].has(c.uuid!));
        onBase = [...onBase, ...(attachAt.get(i) ?? [])];
        out.push(onBase);
    });
    return out;
};
