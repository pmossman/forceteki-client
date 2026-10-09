/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Edit mode shows the engine's real game state for the edited position. When a card on that board is
 * clicked, this maps the engine card (by uuid) back to the editor model entry it came from.
 *
 * Cards are matched by player, zone and card identity; among identical cards in the same zone the
 * n-th one on the board is the n-th one in the editor (the engine keeps setup order).
 */
import { Seat } from '../_engine/SandboxEngine';
import { CardIndex } from './cardIndex';
import { EditorZone, FILLER_CARD, IPosCard, IPosition } from './position';

export type EditRef =
    | { kind: 'card'; seat: Seat; zone: EditorZone; uid: string; parentUid?: string }
    | { kind: 'fillerResource'; seat: Seat; exhausted: boolean }
    | { kind: 'unknown'; message: string };

const PILES = ['hand', 'resources', 'groundArena', 'spaceArena', 'discard'] as const;
const PILE_TO_ZONE: Record<(typeof PILES)[number], EditorZone> = {
    hand: 'hand', resources: 'resources', groundArena: 'ground', spaceArena: 'space', discard: 'discard',
};

interface ILocated { pid: string; where: 'base' | 'leader' | (typeof PILES)[number]; card: any }

export const locateInView = (gs: any, uuid: string): ILocated | null => {
    for (const pid of Object.keys(gs?.players ?? {})) {
        const p = gs.players[pid];
        if (p.base?.uuid === uuid) {
            return { pid, where: 'base', card: p.base };
        }
        const leader = (p.leaders ?? []).find((l: any) => l?.uuid === uuid);
        if (leader) {
            return { pid, where: 'leader', card: leader };
        }
        for (const pile of PILES) {
            const card = (p.cardPiles?.[pile] ?? []).find((c: any) => c?.uuid === uuid);
            if (card) {
                return { pid, where: pile, card };
            }
        }
    }
    return null;
};

const isLeaderCard = (gs: any, uuid: string) =>
    Object.values(gs?.players ?? {}).some((p: any) => (p.leaders ?? []).some((l: any) => l?.uuid === uuid));

const nth = <T>(list: T[], pred: (t: T) => boolean, n: number): T | undefined => list.filter(pred)[n];

export const mapViewCardToEditor = (gs: any, uuid: string, pos: IPosition, index: CardIndex): EditRef => {
    const located = locateInView(gs, uuid);
    if (!located) {
        return { kind: 'unknown', message: 'That card is not part of the position (it may be in a hidden zone).' };
    }
    const seat = located.pid as Seat;
    if (seat !== 'p1' && seat !== 'p2') {
        return { kind: 'unknown', message: `Unknown player ${located.pid}` };
    }
    const player = pos[seat];
    if (located.where === 'base') {
        return player.base ? { kind: 'card', seat, zone: 'base', uid: player.base.uid } : { kind: 'unknown', message: 'No base in the position' };
    }
    if (located.where === 'leader') {
        return player.leader ? { kind: 'card', seat, zone: 'leader', uid: player.leader.uid } : { kind: 'unknown', message: 'No leader in the position' };
    }

    const internalName = index.fromGameCard(located.card)?.internalName;
    if (!internalName) {
        return { kind: 'unknown', message: `Unknown card ${located.card?.name ?? uuid}` };
    }
    const pileCards: any[] = gs.players[located.pid].cardPiles[located.where] ?? [];
    const sameName = (c: any) => index.fromGameCard(c)?.internalName === internalName;

    // an upgrade: find its unit, then the n-th upgrade of this name on it
    if (located.card.parentCardId) {
        const parentRef = mapViewCardToEditor(gs, located.card.parentCardId, pos, index);
        if (parentRef.kind !== 'card') {
            return parentRef;
        }
        const parent = parentRef.zone === 'leader' ? pos[parentRef.seat].leader :
            parentRef.zone === 'base' ? pos[parentRef.seat].base :
                (pos[parentRef.seat][parentRef.zone as 'ground' | 'space'] as IPosCard[]).find((c) => c.uid === parentRef.uid);
        const siblings = Object.values(gs.players).flatMap((p: any) => [...(p.cardPiles?.groundArena ?? []), ...(p.cardPiles?.spaceArena ?? [])])
            .filter((c: any) => c.parentCardId === located.card.parentCardId && sameName(c));
        const n = siblings.findIndex((c: any) => c.uuid === uuid);
        const upgrade = nth(parent?.upgrades ?? [], (u) => u.card === internalName, Math.max(0, n));
        return upgrade && parent
            ? { kind: 'card', seat: parentRef.seat, zone: parentRef.zone, uid: upgrade.uid, parentUid: parent.uid }
            : { kind: 'unknown', message: 'Could not match that upgrade to the position' };
    }

    if (located.where === 'resources' && internalName === FILLER_CARD) {
        return { kind: 'fillerResource', seat, exhausted: !!located.card.exhausted };
    }

    // a deployed leader sits in the arena but is the editor's leader slot
    if ((located.where === 'groundArena' || located.where === 'spaceArena') && isLeaderCard(gs, uuid)) {
        return player.leader ? { kind: 'card', seat, zone: 'leader', uid: player.leader.uid } : { kind: 'unknown', message: 'No leader' };
    }

    const zone = PILE_TO_ZONE[located.where];
    const viewSame = pileCards.filter((c: any) => !c.parentCardId && !isLeaderCard(gs, c.uuid) && sameName(c));
    const n = viewSame.findIndex((c: any) => c.uuid === uuid);
    const list = player[zone as 'hand' | 'ground' | 'space' | 'resources' | 'discard'] as IPosCard[];
    const match = nth(list, (c) => c.card === internalName, Math.max(0, n)) ?? list.find((c) => c.card === internalName);
    return match ? { kind: 'card', seat, zone, uid: match.uid } : { kind: 'unknown', message: 'Could not match that card to the position' };
};
