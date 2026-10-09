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

export type BoardPatch = (gs: any) => void;

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

export const patchRemove = (uuid: string): BoardPatch => (gs) => {
    forEachCardList(gs, (list) => {
        for (let i = list.length - 1; i >= 0; i--) {
            if (list[i]?.uuid === uuid || list[i]?.parentCardId === uuid) {
                list.splice(i, 1);
            }
        }
    });
};

export const patchDamage = (uuid: string, delta: number): BoardPatch => (gs) => {
    const card = findCardInState(gs, uuid);
    if (card) {
        card.damage = Math.max(0, (card.damage ?? 0) + delta);
    }
};

export const patchExhaust = (uuid: string): BoardPatch => (gs) => {
    const card = findCardInState(gs, uuid);
    if (card) {
        card.exhausted = !card.exhausted;
    }
};

/** Attach a token upgrade (Shield, Experience) to a unit; Experience also adds +1/+1. */
export const patchAddToken = (uuid: string, token: ISandboxCard, tempId: string): BoardPatch => (gs) => {
    const unit = findCardInState(gs, uuid);
    if (!unit) {
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
export const patchSwap = (uuid: string, card: ISandboxCard): BoardPatch => (gs) => {
    const target = findCardInState(gs, uuid);
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
