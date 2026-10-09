/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Optimistic edits for Edit mode. An edit changes the editor model (the truth) and, in the same render,
 * patches the board state the user is looking at, so a click shows at once. When the engine has loaded
 * the new position (~50 ms after a short coalescing debounce) its real state replaces the patched one.
 *
 * Patches mutate a fresh clone of the displayed game state (see SandboxStage).
 */
import { Seat } from '../_engine/SandboxEngine';
import { ISandboxCard, cardKind } from './cardIndex';
import { PileZone } from './position';

/**
 * A patch is written against the board the user saw. If the engine's state changed underneath it (an older
 * load landed), `resolve` maps the uuid it was written for to the same card in the current state.
 */
export type UuidResolver = (uuid: string) => string | undefined;
export type BoardPatch = (gs: any, resolve: UuidResolver) => void;

const same: UuidResolver = (uuid) => uuid;

/** Semantic identity of every card in a state: player + pile + card + n-th of its kind (leader/base by player). */
const semanticKeys = (gs: any): Map<string, string> => {
    const keyToUuid = new Map<string, string>();
    for (const pid of Object.keys(gs?.players ?? {})) {
        const p = gs.players[pid];
        if (p.base?.uuid) {
            keyToUuid.set(`${pid}|base`, p.base.uuid);
        }
        (p.leaders ?? []).forEach((l: any, i: number) => l?.uuid && keyToUuid.set(`${pid}|leader|${i}`, l.uuid));
        for (const [pile, list] of Object.entries(p.cardPiles ?? {})) {
            if (!Array.isArray(list)) {
                continue;
            }
            const counts = new Map<string, number>();
            for (const c of list as any[]) {
                if (!c?.uuid) {
                    continue;
                }
                const kind = `${pid}|${pile}|${c.id ?? c.name}|${c.parentCardId ? 'u' : 'c'}`;
                const n = counts.get(kind) ?? 0;
                counts.set(kind, n + 1);
                keyToUuid.set(`${kind}|${n}`, c.uuid);
            }
        }
    }
    return keyToUuid;
};

/** Map uuids of `from` to the uuids of the same cards in `to`. */
export const uuidTranslator = (from: any, to: any): UuidResolver => {
    if (!from || !to || from === to) {
        return same;
    }
    const fromKeys = semanticKeys(from);
    const toKeys = semanticKeys(to);
    const map = new Map<string, string>();
    for (const [key, uuid] of fromKeys) {
        const target = toKeys.get(key);
        if (target) {
            map.set(uuid, target);
        }
    }
    return (uuid) => (uuid.startsWith('opt-') ? uuid : map.get(uuid));
};

const PILE_FOR_ZONE: Partial<Record<PileZone, string>> = {
    ground: 'groundArena', space: 'spaceArena', hand: 'hand', resources: 'resources', discard: 'discard',
};

const forEachCardList = (gs: any, fn: (list: any[], pid: string) => void) => {
    for (const pid of Object.keys(gs?.players ?? {})) {
        for (const pile of Object.values(gs.players[pid].cardPiles ?? {})) {
            if (Array.isArray(pile)) {
                fn(pile, pid);
            }
        }
    }
};

export const findCardInState = (gs: any, uuid: string): any | null => {
    for (const pid of Object.keys(gs?.players ?? {})) {
        const p = gs.players[pid];
        if (p.base?.uuid === uuid) {
            return p.base;
        }
        const leader = (p.leaders ?? []).find((l: any) => l?.uuid === uuid);
        if (leader) {
            return leader;
        }
    }
    let found: any = null;
    forEachCardList(gs, (list) => {
        found = found ?? list.find((c) => c?.uuid === uuid) ?? null;
    });
    return found;
};

const engineType = (card: ISandboxCard): string => {
    switch (cardKind(card)) {
        case 'unit': return 'basicUnit';
        case 'upgrade': return 'basicUpgrade';
        case 'tokenUnit': return 'tokenUnit';
        case 'tokenUpgrade': return 'tokenUpgrade';
        case 'leader': return 'leader';
        case 'base': return 'base';
        case 'event': return 'event';
        default: return 'basicUnit';
    }
};

const cardFace = (card: ISandboxCard) => ({
    id: card.id,
    setId: { set: card.setId.set, number: card.setId.number ?? 0 },
    name: card.title,
    aspects: card.aspects,
});

export const patchRemove = (originalUuid: string): BoardPatch => (gs, resolve) => {
    const uuid = resolve(originalUuid);
    if (!uuid) {
        return;
    }
    forEachCardList(gs, (list) => {
        for (let i = list.length - 1; i >= 0; i--) {
            if (list[i]?.uuid === uuid || list[i]?.parentCardId === uuid) {
                list.splice(i, 1);
            }
        }
    });
};

export const patchDamage = (originalUuid: string, delta: number): BoardPatch => (gs, resolve) => {
    const uuid = resolve(originalUuid);
    const card = uuid ? findCardInState(gs, uuid) : null;
    if (card) {
        card.damage = Math.max(0, (card.damage ?? 0) + delta);
    }
};

export const patchExhaust = (originalUuid: string): BoardPatch => (gs, resolve) => {
    const uuid = resolve(originalUuid);
    const card = uuid ? findCardInState(gs, uuid) : null;
    if (card) {
        card.exhausted = !card.exhausted;
    }
};

/** Attach a token upgrade (Shield, Experience) to a unit; Experience also adds +1/+1. */
export const patchAddToken = (originalUuid: string, token: ISandboxCard, tempId: string): BoardPatch => (gs, resolve) => {
    const uuid = resolve(originalUuid);
    const unit = uuid ? findCardInState(gs, uuid) : null;
    if (!uuid || !unit) {
        return;
    }
    forEachCardList(gs, (list) => {
        if (list.includes(unit)) {
            list.push({
                ...cardFace(token),
                uuid: tempId,
                type: 'tokenUpgrade',
                printedType: 'tokenUpgrade',
                parentCardId: uuid,
                controllerId: unit.controllerId,
                ownerId: unit.controllerId,
                zone: unit.zone,
                selectable: false,
            });
        }
    });
    if (token.upgradePower) {
        unit.power = (unit.power ?? 0) + token.upgradePower;
    }
    if (token.upgradeHp) {
        unit.hp = (unit.hp ?? 0) + token.upgradeHp;
    }
};

/** Show a different card in the same place, keeping its state. */
export const patchSwap = (originalUuid: string, card: ISandboxCard): BoardPatch => (gs, resolve) => {
    const uuid = resolve(originalUuid);
    const target = uuid ? findCardInState(gs, uuid) : null;
    if (!target) {
        return;
    }
    Object.assign(target, cardFace(card));
    if (target.type !== 'leader' && target.type !== 'base') {
        target.type = engineType(card);
        target.printedType = target.type;
    }
    if (card.power != null) {
        target.power = card.power;
    }
    if (card.hp != null) {
        target.hp = card.hp;
    }
    if (card.cost != null) {
        target.cost = card.cost;
    }
};

/** A new card in a zone (shown until the engine's state arrives). */
export const patchAdd = (seat: Seat, zone: PileZone, card: ISandboxCard, tempId: string): BoardPatch => (gs) => {
    const player = gs?.players?.[seat];
    if (!player) {
        return;
    }
    if (zone === 'deck') {
        player.numCardsInDeck = (player.numCardsInDeck ?? 0) + 1;
        return;
    }
    const pile = PILE_FOR_ZONE[zone];
    if (!pile) {
        return;
    }
    player.cardPiles[pile] = player.cardPiles[pile] ?? [];
    player.cardPiles[pile].push({
        ...cardFace(card),
        uuid: tempId,
        type: engineType(card),
        printedType: engineType(card),
        controllerId: seat,
        ownerId: seat,
        zone: pile,
        exhausted: false,
        damage: 0,
        power: card.power,
        hp: card.hp,
        cost: card.cost,
        selectable: false,
    });
};
